/**
 * Lumanu's wire format — the vocabulary of the provider boundary.
 *
 * Every name here resolves, through `src/generated/lumanu-api.ts`, to a schema
 * harvested from Lumanu's own published reference pages. Nothing in this file
 * describes a shape this project invented: snake_case fields, Lumanu's enums,
 * Lumanu's nullability and Lumanu's `{ data, total, limit, offset }` envelope
 * all arrive from the contract rather than from a design decision made here.
 * See ADR 0001 for why the provider speaks this rather than a tidier model.
 *
 * Re-run `npm run harvest:contract && npm run generate:types` and this file
 * either still compiles or names exactly what Lumanu changed.
 */

import type { components, operations } from '@/generated/lumanu-api';

/** The 200 body of one harvested operation. */
type JsonBody<Operation> = Operation extends {
  responses: { 200: { content: { 'application/json': infer Body } } };
}
  ? Body
  : never;

/**
 * The request body one harvested operation accepts.
 *
 * `requestBody` is generated as optional even where the operation requires one,
 * so the wrapper is unwrapped before the content type is matched. Written the
 * obvious way — `requestBody: { content: ... }` — this silently resolved to
 * `never` for every operation, which is a type that assigns to nothing and
 * complains about nothing until something finally uses it.
 */
type RequestBody<Operation> = Operation extends { requestBody?: infer Wrapper }
  ? NonNullable<Wrapper> extends { content: { 'application/json': infer Body } }
    ? Body
    : never
  : never;

// --- Entities -------------------------------------------------------------

export type Workspace = components['schemas']['Workspace'];
export type Partner = components['schemas']['Partner'];
/** What `GET /workspace/{id}/partner/{partnerId}` adds on top of `Partner`. */
export type PartnerDetail = components['schemas']['PartnerDetail'];
export type Payable = components['schemas']['Payable'];
export type Funding = components['schemas']['Funding'];
export type Project = components['schemas']['Project'];
export type ProjectDetail = components['schemas']['ProjectDetail'];
/**
 * The Workspace Balance. Lumanu serves it from `GET /workspace/{id}/wallet`,
 * and its `balance` is an object rather than a number: `balance` is the total
 * held, `available_balance` is what can actually be committed.
 */
export type Account = components['schemas']['Account'];
/** One Balance Transaction. */
export type Transaction = components['schemas']['Transaction'];

// --- Enumerations ---------------------------------------------------------

/**
 * Lumanu's single Partner status, covering onboarding and tax state together.
 * Nullable on the wire, and `null` is a real value — a Partner invited but not
 * yet through any check has no status at all.
 */
export type PartnerStatus = NonNullable<Partner['status']>;

/**
 * Payor approval intent. `paid` exists in Lumanu's contract but no flow in
 * this POC produces it: funding moves a Payable to `will_pay`, and settlement
 * is evidenced by the Funding and its Balance Transaction.
 */
export type PayableStatus = NonNullable<Payable['status']>;

/**
 * Lumanu's second, richer Payable status, tracking payee state and transfers
 * as well as payor intent. Carried faithfully; the reasoning in this POC keys
 * off `status`.
 */
export type PayableLifecycleStatus = NonNullable<Payable['payable_status']>;

/** `balance` draws on the Workspace Balance; `invoice` is out of scope here. */
export type FundingMethod = NonNullable<Funding['method']>;

export type TransactionType = NonNullable<Transaction['type']>;
export type TransactionStatus = NonNullable<Transaction['status']>;

/**
 * Lumanu states the unit alongside every amount rather than leaving it
 * implicit. Amounts are integers in that unit — there is no decimal
 * representation anywhere in the contract.
 *
 * Taken from `Transaction`, which constrains the field to an enum. Lumanu
 * constrains it on `Transaction`, `Funding` and `Account` but leaves it an
 * unconstrained string on `Payable` and `Project`, so this is the narrowest
 * published statement of the unit rather than a universal one.
 */
export type AmountDenomination = NonNullable<Transaction['amount_denomination']>;

export const PARTNER_STATUSES = [
  'missing_metadata_file_us_taxes',
  'in_process',
  'awaiting_w9_submission',
  'w8_submitted',
  'awaiting_w8_submission',
  'completed_w9',
] as const satisfies readonly PartnerStatus[];

/**
 * Every member of Lumanu's enum, `paid` included. This exists to be checked
 * against the contract, not to be offered to anyone — see `REACHABLE_PAYABLE_STATUSES`.
 */
export const PAYABLE_STATUSES = [
  'unapproved',
  'approved',
  'will_pay',
  'canceled',
  'paid',
] as const satisfies readonly PayableStatus[];

/**
 * The statuses a Payable in this POC can actually be in.
 *
 * `paid` is deliberately absent. It is real in Lumanu's contract — the
 * harvested fragment confirms it — but no flow here produces it: `will_pay` is
 * this project's funded terminal state, and settlement is evidenced by a
 * Funding and its Balance Transaction. Anything an agent can see offers this
 * list, so the tool surface never names a state the system cannot reach.
 */
export const REACHABLE_PAYABLE_STATUSES = [
  'unapproved',
  'approved',
  'will_pay',
  'canceled',
] as const satisfies readonly PayableStatus[];

/** `true` only when `Listed` names every member of `Union`. */
type Covers<Union, Listed extends Union> = [Union] extends [Listed] ? true : never;

// --- Envelopes and operation shapes ---------------------------------------

/**
 * Lumanu's list envelope. Declared inline on each operation rather than as a
 * named schema, so it is recovered from one of them and reused; the identity
 * is asserted below.
 */
export type LumanuList<Item> = {
  readonly data?: readonly Item[];
  readonly total?: number;
  readonly limit?: number;
  readonly offset?: number;
};

export type ListWorkspacesResponse = JsonBody<operations['get-workspaces']>;
export type GetWorkspaceResponse = JsonBody<operations['get-workspace']>;
export type ListPartnersResponse = JsonBody<operations['get-workspace-partners']>;
export type GetPartnerResponse = JsonBody<operations['get-workspace-partner']>;
export type ListPayablesResponse = JsonBody<operations['get-payables']>;
export type GetPayableResponse = JsonBody<operations['get-payable']>;
export type ApprovePayableResponse = JsonBody<operations['payable-approve']>;
export type CancelPayableResponse = JsonBody<operations['payable-cancel']>;
export type GetWorkspaceBalanceResponse = JsonBody<operations['get-workspace-wallet']>;
export type ListBalanceTransactionsResponse = JsonBody<
  operations['get-workspace-wallet-transactions']
>;
export type CreateFundingRequest = RequestBody<operations['create-funding']>;
export type CreateFundingResponse = JsonBody<operations['create-funding']>;
export type ListProjectsResponse = JsonBody<operations['get-workspace-projects']>;
export type GetProjectResponse = JsonBody<operations['get-workspace-project']>;

/** Query parameters Lumanu accepts on its list endpoints. */
export type ListPayablesQuery = NonNullable<operations['get-payables']['parameters']['query']>;
export type ListPartnersQuery = NonNullable<
  operations['get-workspace-partners']['parameters']['query']
>;
export type ListBalanceTransactionsQuery = NonNullable<
  operations['get-workspace-wallet-transactions']['parameters']['query']
>;
export type OrderByDirection = NonNullable<ListPartnersQuery['order_by_direction']>;

// --- Guards against the contract moving underneath us ---------------------

/**
 * Nothing reads this. Its job is to stop compiling when a re-harvest changes
 * something this file has committed to — a status enum gaining a member, or
 * the list envelope changing shape. The fragments are the source of truth, so
 * a change in Lumanu's contract must break the build rather than pass quietly.
 */
const CONTRACT_STILL_MATCHES: [
  Covers<PartnerStatus, (typeof PARTNER_STATUSES)[number]>,
  Covers<PayableStatus, (typeof PAYABLE_STATUSES)[number]>,
  ListPayablesResponse extends LumanuList<Payable> ? true : never,
  // A request body that resolves to `never` assigns to nothing and reports
  // nothing, so the extraction is asserted rather than assumed.
  CreateFundingRequest extends never ? never : true,
] = [true, true, true, true];
void CONTRACT_STILL_MATCHES;
