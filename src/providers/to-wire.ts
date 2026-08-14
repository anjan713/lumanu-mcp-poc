/**
 * Internal rows to Lumanu wire format.
 *
 * Shared by `InMemoryLumanuProvider` and `MockLumanuProvider` for the same
 * reason `src/seed/canonical.ts` is shared by the fixture and the seed script:
 * the two must agree by construction rather than by discipline. The contract
 * suite's job is to prove that a fixture and a database can be swapped, and it
 * cannot do that if the two spend their effort disagreeing about how a row
 * becomes a Payable.
 *
 * Every function here is the translation the internal schema's comment
 * promises — most visibly for Payables, where Lumanu publishes no `partner_id`
 * and identifies the Partner by display name, email and Lumanu id instead.
 *
 * Numbers arrive as strings from Hasura and as numbers from the fixture:
 * PostgreSQL `bigint` and `numeric` both cross GraphQL as strings, because
 * either can hold a value a JavaScript number cannot. Every numeric field is
 * therefore coerced here rather than at one of the two call sites.
 */

import type {
  Account,
  Funding,
  Partner,
  PartnerDetail,
  PartnerStatus,
  Payable,
  PayableLifecycleStatus,
  PayableStatus,
  Project,
  ProjectDetail,
  Transaction,
  TransactionStatus,
  TransactionType,
  Workspace,
} from './wire';

/** What either source supplies for a numeric column. */
export type Numeric = number | string | null;

export function toNumber(value: Numeric): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

export function toNumberOrNull(value: Numeric): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' ? value : Number(value);
}

/** Omits a field entirely when the source holds no value for it. */
function optional<T>(key: string, value: T | null | undefined): Record<string, T> {
  return value === null || value === undefined ? {} : { [key]: value };
}

/**
 * Lumanu states the unit alongside every amount rather than leaving it
 * implicit. It is `us_cents` everywhere in this POC, which models one Workspace
 * in one currency — a second currency is out of scope, not unimplemented.
 *
 * Exported because the domain services state it too, on figures they compute
 * rather than read.
 */
export const US_CENTS = 'us_cents';

// --- Workspace ------------------------------------------------------------

export interface WorkspaceLike {
  id: string;
  display_name: string;
  profile_image_url?: string | null;
  funding_fee_percent: Numeric;
  additive_funding_fee: boolean | null;
  vendor_invite_url: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The balance is deliberately absent: Lumanu does not put it on the Workspace.
 * It is served from the wallet endpoint as an `Account`, and mixing the two
 * here would invent a shape Lumanu does not publish.
 */
export function toWorkspace(row: WorkspaceLike): Workspace {
  return {
    id: row.id,
    display_name: row.display_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
    funding_fee_percent: toNumberOrNull(row.funding_fee_percent),
    additive_funding_fee: row.additive_funding_fee,
    ...optional('profile_image_url', row.profile_image_url),
    ...optional('vendor_invite_url', row.vendor_invite_url),
  };
}

/**
 * What the Workspace Balance is made of. Narrower than `WorkspaceLike` so that
 * a caller selecting only the balance columns does not have to invent fee and
 * invite-url values it never read.
 */
export interface AccountLike {
  display_name: string;
  balance_cents: Numeric;
  available_balance_cents: Numeric;
  created_at: string;
  updated_at: string;
}

/** The Workspace Balance, as Lumanu serves it: two figures, not one. */
export function toAccount(row: AccountLike): Account {
  return {
    display_name: row.display_name,
    denomination: US_CENTS,
    balance: {
      balance: toNumber(row.balance_cents),
      // What may actually be committed. Funding Capacity is measured against
      // this one — see the discovery note on the two figures.
      available_balance: toNumber(row.available_balance_cents),
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// --- Partner --------------------------------------------------------------

export interface PartnerLike {
  id: string;
  name: string;
  lumanu_id: string | null;
  email: string;
  status: string | null;
  tax_origin_country: string | null;
  tags: readonly string[];
  notes?: string | null;
  has_approval_grant: boolean;
  legal_business_name?: string | null;
  legal_business_type?: string | null;
  description?: string | null;
  has_wallet?: boolean;
  created_at: string;
  updated_at: string;
}

export function toPartner(row: PartnerLike): Partner {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    // One value covering onboarding and tax state together, and `null` is a
    // real value: a Partner invited but not yet through any check has no
    // status at all. Preserved rather than defaulted.
    status: row.status as PartnerStatus | null,
    tags: [...row.tags],
    has_approval_grant: row.has_approval_grant,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...optional('lumanu_id', row.lumanu_id),
    ...optional('tax_origin_country', row.tax_origin_country),
    ...optional('notes', row.notes),
  };
}

/** What `GET /workspace/{id}/partner/{partnerId}` adds on top of `Partner`. */
export function toPartnerDetail(row: PartnerLike, payablesCount: number): PartnerDetail {
  return {
    ...toPartner(row),
    has_wallet: row.has_wallet ?? false,
    payables_count: payablesCount,
    emails: [row.email],
    ...optional('legal_business_name', row.legal_business_name),
    ...optional('legal_business_type', row.legal_business_type),
    ...optional('description', row.description),
  };
}

// --- Payable --------------------------------------------------------------

export interface PayableLike {
  id: string;
  workspace_id: string;
  project_id: string | null;
  amount_cents: Numeric;
  description: string;
  due_date?: string | null;
  invoice_number: number | null;
  status: string;
  payable_status: string | null;
  vendor_status: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * How Lumanu names the Partner on a Payable: three denormalised fields and no
 * identifier. Narrower than `PartnerLike` on purpose, so that a source holding
 * only these three does not have to invent the rest of a Partner to use it.
 */
export interface PartnerOnPayable {
  name: string;
  email: string;
  lumanu_id: string | null;
}

/**
 * Lumanu's Payable carries **no `partner_id`**. The Partner is identified by
 * display name, email and Lumanu id, which is why this takes the Partner as a
 * second argument rather than resolving one from the Payable. A Partner who has
 * not finished onboarding has no `lumanu_id` at all, so that field is omitted
 * rather than sent as null.
 */
export function toPayable(row: PayableLike, partner: PartnerOnPayable | undefined): Payable {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    amount: toNumber(row.amount_cents),
    amount_denomination: US_CENTS,
    description: row.description,
    status: row.status as PayableStatus,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...optional('project_id', row.project_id),
    ...optional('due_date', row.due_date),
    ...optional('invoice_number', row.invoice_number),
    ...optional('payable_status', row.payable_status as PayableLifecycleStatus | null),
    ...optional('vendor_status', row.vendor_status),
    ...optional('vendor_display_name', partner?.name),
    ...optional('vendor_email', partner?.email),
    ...optional('payee_lumanu_id', partner?.lumanu_id),
  };
}

// --- Project --------------------------------------------------------------

export interface ProjectLike {
  id: string;
  name: string;
  alias: string | null;
  description: string | null;
  po_number?: string | null;
  budget_amount_cents: Numeric;
  budget_denomination: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export function toProject(row: ProjectLike): Project {
  return {
    id: row.id,
    name: row.name,
    archived: row.archived,
    budget_amount: toNumberOrNull(row.budget_amount_cents),
    budget_denomination: row.budget_denomination,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...optional('alias', row.alias),
    ...optional('description', row.description),
    ...optional('po_number', row.po_number),
  };
}

/**
 * `balance` is null throughout this POC: Lumanu offers a Project its own wallet,
 * and the Acme scenario funds everything from the one Workspace Balance. Null
 * is the published way to say "no dedicated wallet", so it is stated rather
 * than omitted.
 */
export function toProjectDetail(row: ProjectLike): ProjectDetail {
  return { ...toProject(row), balance: null };
}

// --- Funding --------------------------------------------------------------

export interface FundingLike {
  id: string;
  workspace_id: string;
  method: string;
  status: string;
  amount_cents: Numeric;
  base_amount_cents?: Numeric;
  fee_amount_cents: Numeric;
  fee_percent: Numeric;
  is_fee_additive?: boolean | null;
  created_at: string;
  updated_at: string;
}

/**
 * `payable_ids` is absent rather than empty. Lumanu accepts it on the way in
 * and does not document it on the way out, and inventing a response field is
 * the drift ADR 0001 exists to prevent — the Payables a Funding paid are read
 * back from their own `will_pay` status.
 */
export function toFunding(row: FundingLike): Funding {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    method: row.method as Funding['method'],
    status: row.status,
    amount: toNumber(row.amount_cents),
    amount_denomination: US_CENTS,
    fee_amount: toNumberOrNull(row.fee_amount_cents),
    fee_percent: toNumberOrNull(row.fee_percent),
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...optional('base_amount', toNumberOrNull(row.base_amount_cents ?? null)),
    ...optional('is_fee_additive', row.is_fee_additive),
  };
}

// --- Balance Transaction --------------------------------------------------

export interface TransactionLike {
  id: string;
  description: string;
  amount_cents: Numeric;
  balance_change_cents: Numeric;
  ending_balance_cents: Numeric;
  status: string;
  type: string;
  created_at: string;
}

export function toTransaction(row: TransactionLike): Transaction {
  return {
    id: row.id,
    description: row.description,
    amount: toNumber(row.amount_cents),
    amount_denomination: US_CENTS,
    balance_change: toNumber(row.balance_change_cents),
    ending_balance: toNumber(row.ending_balance_cents),
    status: row.status as TransactionStatus,
    type: row.type as TransactionType,
    created_at: row.created_at,
  };
}
