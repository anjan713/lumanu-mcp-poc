/**
 * The canonical Acme scenario.
 *
 * This is the demo. The figures here are the ones a reviewer will check, so
 * they are written out rather than generated, and the consequences that must
 * hold are asserted in `tests/canonical-seed.test.ts`.
 *
 * One definition, two consumers: `scripts/db/seed.ts` writes these rows into
 * Supabase, and `InMemoryLumanuProvider` will serve them directly with no
 * database at all. That is what lets the test suite run green on a fresh clone
 * with no credentials, and it stops the in-memory fake from drifting away from
 * what the real data layer holds.
 *
 * Rows are in the internal schema's shape, not Lumanu's wire format. Mapping
 * one to the other is the provider's job — see ADR 0001.
 */

/** Money is integer cents throughout, exactly as Lumanu represents it. */
export const dollars = (amount: number): number => Math.round(amount * 100);

/**
 * Every timestamp derives from this. Nothing calls `now()`, because a reseed
 * has to reproduce byte-identical figures — see the determinism test.
 */
export const SEED_EPOCH = '2026-01-05T09:00:00.000Z';

const at = (dayOffset: number, hour = 12): string =>
  new Date(Date.parse(SEED_EPOCH) + dayOffset * 86_400_000 + hour * 3_600_000).toISOString();

/** Fixed so that a reseed, a test and a demo all name the same records. */
export const IDS = {
  workspace: '9f8b1c34-0000-4000-8000-000000000001',
  project: '9f8b1c34-0000-4000-8000-000000000002',
  maya: '9f8b1c34-0000-4000-8000-000000000010',
  alex: '9f8b1c34-0000-4000-8000-000000000011',
  sarah: '9f8b1c34-0000-4000-8000-000000000012',
  studioX: '9f8b1c34-0000-4000-8000-000000000013',
  mayaPayable: '9f8b1c34-0000-4000-8000-000000000020',
  alexPayable: '9f8b1c34-0000-4000-8000-000000000021',
  studioXPayable: '9f8b1c34-0000-4000-8000-000000000022',
  studioXFunding: '9f8b1c34-0000-4000-8000-000000000030',
  openingDeposit: '9f8b1c34-0000-4000-8000-000000000040',
  studioXDebit: '9f8b1c34-0000-4000-8000-000000000041',
} as const;

/** The balance opens here, and $10,000 of it has already gone to StudioX. */
export const OPENING_BALANCE_CENTS = dollars(25_000);
export const CURRENT_BALANCE_CENTS = dollars(15_000);

export interface WorkspaceRow {
  readonly id: string;
  readonly display_name: string;
  readonly balance_cents: number;
  readonly available_balance_cents: number;
  readonly funding_fee_percent: number | null;
  readonly additive_funding_fee: boolean | null;
  readonly vendor_invite_url: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ProjectRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly name: string;
  readonly alias: string | null;
  readonly description: string | null;
  readonly budget_amount_cents: number | null;
  readonly budget_denomination: string | null;
  readonly archived: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface PartnerRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly name: string;
  readonly lumanu_id: string | null;
  readonly email: string;
  readonly status: string | null;
  readonly tax_origin_country: string | null;
  readonly tags: readonly string[];
  readonly has_approval_grant: boolean;
  readonly legal_business_name: string | null;
  readonly has_wallet: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface PayableRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly partner_id: string;
  readonly amount_cents: number;
  readonly description: string;
  readonly invoice_number: number | null;
  readonly status: string;
  readonly payable_status: string | null;
  readonly vendor_status: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface FundingRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly method: string;
  readonly status: string;
  readonly amount_cents: number;
  readonly fee_amount_cents: number | null;
  readonly fee_percent: number | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface BalanceTransactionRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly funding_id: string | null;
  readonly description: string;
  readonly amount_cents: number;
  readonly balance_change_cents: number;
  readonly ending_balance_cents: number;
  readonly status: string;
  readonly type: string;
  readonly created_at: string;
}

export interface CanonicalScenario {
  readonly workspace: WorkspaceRow;
  readonly project: ProjectRow;
  readonly partners: readonly PartnerRow[];
  readonly payables: readonly PayableRow[];
  readonly fundings: readonly FundingRow[];
  readonly fundingPayables: ReadonlyArray<{ funding_id: string; payable_id: string }>;
  readonly balanceTransactions: readonly BalanceTransactionRow[];
}

const workspace: WorkspaceRow = {
  id: IDS.workspace,
  display_name: 'Acme US',
  // Held and available are equal: nothing in this scenario holds funds back.
  // Both are kept because Lumanu keeps both.
  balance_cents: CURRENT_BALANCE_CENTS,
  available_balance_cents: CURRENT_BALANCE_CENTS,
  // Fees are fixed at zero for this POC, so $10,000 of Payables costs exactly
  // $10,000. Null rather than 0 because that is what "not configured" is.
  funding_fee_percent: null,
  additive_funding_fee: null,
  vendor_invite_url: 'https://app.lumanu.com/invite/acme-us',
  created_at: at(0, 9),
  updated_at: at(27, 12),
};

const project: ProjectRow = {
  id: IDS.project,
  workspace_id: IDS.workspace,
  name: 'Summer Creator Campaign',
  alias: 'summer-creator-campaign',
  description: 'Influencer content for the summer product launch.',
  budget_amount_cents: dollars(30_000),
  budget_denomination: 'us_cents',
  archived: false,
  created_at: at(1, 10),
  updated_at: at(1, 10),
};

/**
 * Four Partners, each isolating exactly one outcome. That is the whole point
 * of the set: every question the MCP answers has one Partner who demonstrates
 * it and no others who muddy it.
 */
const partners: readonly PartnerRow[] = [
  {
    // Ready to fund: onboarded, and her Payable is approved.
    id: IDS.maya,
    workspace_id: IDS.workspace,
    name: 'Maya Patel',
    lumanu_id: 'LUM100001',
    email: 'maya.patel@example.com',
    status: 'completed_w9',
    tax_origin_country: 'US',
    tags: ['creator'],
    has_approval_grant: true,
    legal_business_name: null,
    has_wallet: true,
    created_at: at(2, 9),
    updated_at: at(6, 15),
  },
  {
    // Blocked by approval only. Onboarding is complete, so approving his
    // Payable is enough to make him fundable — which is the demo.
    id: IDS.alex,
    workspace_id: IDS.workspace,
    name: 'Alex Rivera',
    lumanu_id: 'LUM100002',
    email: 'alex.rivera@example.com',
    status: 'completed_w9',
    tax_origin_country: 'US',
    tags: ['creator'],
    has_approval_grant: true,
    legal_business_name: null,
    has_wallet: true,
    created_at: at(3, 9),
    updated_at: at(7, 11),
  },
  {
    // Blocked by onboarding, and has no Payable at all — which is why the
    // readiness and blocker tools are keyed on Partner rather than Payable.
    // A Payable-centric design would make her invisible.
    id: IDS.sarah,
    workspace_id: IDS.workspace,
    name: 'Sarah Chen',
    lumanu_id: null,
    email: 'sarah.chen@example.com',
    status: 'awaiting_w9_submission',
    tax_origin_country: 'US',
    tags: ['creator'],
    has_approval_grant: false,
    legal_business_name: null,
    has_wallet: false,
    created_at: at(4, 9),
    updated_at: at(4, 9),
  },
  {
    // Already funded: the history that explains the balance.
    id: IDS.studioX,
    workspace_id: IDS.workspace,
    name: 'StudioX LLC',
    lumanu_id: 'LUM100004',
    email: 'billing@studiox.example.com',
    status: 'completed_w9',
    tax_origin_country: 'US',
    tags: ['agency'],
    has_approval_grant: true,
    legal_business_name: 'StudioX Productions LLC',
    has_wallet: true,
    created_at: at(1, 14),
    updated_at: at(20, 16),
  },
];

const payables: readonly PayableRow[] = [
  {
    id: IDS.mayaPayable,
    workspace_id: IDS.workspace,
    project_id: IDS.project,
    partner_id: IDS.maya,
    amount_cents: dollars(2_500),
    description: 'Summer Creator Campaign — Instagram deliverables',
    invoice_number: 1001,
    status: 'approved',
    payable_status: 'approved',
    vendor_status: 'verified',
    created_at: at(6, 10),
    updated_at: at(8, 10),
  },
  {
    id: IDS.alexPayable,
    workspace_id: IDS.workspace,
    project_id: IDS.project,
    partner_id: IDS.alex,
    amount_cents: dollars(7_500),
    description: 'Summer Creator Campaign — YouTube integration',
    invoice_number: 1002,
    status: 'unapproved',
    payable_status: 'not_approved',
    vendor_status: 'verified',
    created_at: at(7, 10),
    updated_at: at(7, 10),
  },
  {
    id: IDS.studioXPayable,
    workspace_id: IDS.workspace,
    project_id: IDS.project,
    partner_id: IDS.studioX,
    amount_cents: dollars(10_000),
    description: 'Summer Creator Campaign — production services',
    invoice_number: 1003,
    status: 'will_pay',
    payable_status: 'scheduled',
    vendor_status: 'verified',
    created_at: at(18, 10),
    updated_at: at(20, 16),
  },
];

const fundings: readonly FundingRow[] = [
  {
    id: IDS.studioXFunding,
    workspace_id: IDS.workspace,
    // The only funding model this POC models: drawing on the Workspace
    // Balance. `invoice` — funding the Workspace from outside — is out of scope.
    method: 'balance',
    status: 'completed',
    amount_cents: dollars(10_000),
    fee_amount_cents: 0,
    fee_percent: 0,
    created_at: at(20, 16),
    updated_at: at(20, 16),
  },
];

/**
 * The ledger that explains the balance: $25,000 in, $10,000 out, $15,000
 * standing. `ending_balance_cents` is carried on each row exactly as Lumanu
 * carries it, so the history reads without having to re-sum it.
 */
const balanceTransactions: readonly BalanceTransactionRow[] = [
  {
    id: IDS.openingDeposit,
    workspace_id: IDS.workspace,
    funding_id: null,
    description: 'Opening pre-funding deposit',
    amount_cents: OPENING_BALANCE_CENTS,
    balance_change_cents: OPENING_BALANCE_CENTS,
    ending_balance_cents: OPENING_BALANCE_CENTS,
    status: 'processed',
    type: 'deposit',
    created_at: at(5, 9),
  },
  {
    id: IDS.studioXDebit,
    workspace_id: IDS.workspace,
    funding_id: IDS.studioXFunding,
    description: 'Funding — StudioX LLC',
    amount_cents: dollars(10_000),
    balance_change_cents: -dollars(10_000),
    ending_balance_cents: CURRENT_BALANCE_CENTS,
    status: 'processed',
    type: 'payment',
    created_at: at(20, 16),
  },
];

export const CANONICAL: CanonicalScenario = {
  workspace,
  project,
  partners,
  payables,
  fundings,
  fundingPayables: [{ funding_id: IDS.studioXFunding, payable_id: IDS.studioXPayable }],
  balanceTransactions,
};
