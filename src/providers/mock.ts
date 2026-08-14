/**
 * `LumanuProvider` over Supabase, through Hasura, via Apollo Client.
 *
 * This is the deployed default. Its job is to make seeded PostgreSQL rows
 * indistinguishable — to everything above the provider boundary — from what
 * Lumanu's REST API returns. Nothing above it knows Hasura exists, and the
 * admin secret reaches no further than this file.
 *
 * The row-to-wire mapping lives in `to-wire.ts`, shared with the in-memory
 * implementation. What lives here is the part that is genuinely Hasura's: the
 * queries, the ordering translation, and the fact that a `bigint` or `numeric`
 * column crosses GraphQL as a string.
 */

import { ApolloClient, HttpLink, InMemoryCache, gql, type TypedDocumentNode } from '@apollo/client';

import type { HasuraConfig } from '@/config';

import {
  LumanuNotFoundError,
  resolveOrder,
  type Collection,
  type ListQuery,
  type LumanuProvider,
  type PayableQuery,
  type TransactionQuery,
} from './lumanu-provider';
import { LIST_DEFAULTS } from './lumanu-provider';
import {
  toAccount,
  toPartner,
  toPartnerDetail,
  toPayable,
  toProject,
  toProjectDetail,
  toTransaction,
  toWorkspace,
  type AccountLike,
  type PartnerLike,
  type PartnerOnPayable,
  type PayableLike,
  type ProjectLike,
  type TransactionLike,
  type WorkspaceLike,
} from './to-wire';
import type {
  GetPartnerResponse,
  GetPayableResponse,
  GetProjectResponse,
  GetWorkspaceBalanceResponse,
  GetWorkspaceResponse,
  ListBalanceTransactionsResponse,
  ListPartnersResponse,
  ListPayablesResponse,
  ListProjectsResponse,
  ListWorkspacesResponse,
} from './wire';

// --- Fragments -------------------------------------------------------------

/**
 * The balance columns are deliberately absent from the Workspace selection.
 * Lumanu serves the Workspace Balance from a separate endpoint as an `Account`,
 * and putting it on the Workspace would invent a shape Lumanu does not publish.
 * `getWorkspaceBalance` selects them instead.
 */
const WORKSPACE_FIELDS = gql`
  fragment WorkspaceFields on workspaces {
    id
    display_name
    profile_image_url
    created_at
    updated_at
    funding_fee_percent
    additive_funding_fee
    vendor_invite_url
  }
`;

const PARTNER_FIELDS = gql`
  fragment PartnerFields on partners {
    id
    name
    lumanu_id
    email
    status
    tax_origin_country
    tags
    notes
    has_approval_grant
    created_at
    updated_at
  }
`;

const PAYABLE_FIELDS = gql`
  fragment PayableFields on payables {
    id
    workspace_id
    project_id
    amount_cents
    description
    due_date
    invoice_number
    status
    payable_status
    vendor_status
    created_at
    updated_at
    partner {
      name
      email
      lumanu_id
    }
  }
`;

const PROJECT_FIELDS = gql`
  fragment ProjectFields on projects {
    id
    name
    alias
    description
    po_number
    budget_amount_cents
    budget_denomination
    archived
    created_at
    updated_at
  }
`;

const TRANSACTION_FIELDS = gql`
  fragment TransactionFields on balance_transactions {
    id
    description
    amount_cents
    balance_change_cents
    ending_balance_cents
    status
    type
    created_at
  }
`;

// --- Queries ---------------------------------------------------------------

const LIST_WORKSPACES = gql`
  ${WORKSPACE_FIELDS}
  query ListWorkspaces($limit: Int!, $offset: Int!, $order_by: [workspaces_order_by!]) {
    rows: workspaces(limit: $limit, offset: $offset, order_by: $order_by) {
      ...WorkspaceFields
    }
    aggregate: workspaces_aggregate {
      aggregate {
        count
      }
    }
  }
`;

const GET_WORKSPACE = gql`
  ${WORKSPACE_FIELDS}
  query GetWorkspace($id: uuid!) {
    row: workspaces_by_pk(id: $id) {
      ...WorkspaceFields
    }
  }
`;

const GET_WORKSPACE_BALANCE = gql`
  query GetWorkspaceBalance($id: uuid!) {
    row: workspaces_by_pk(id: $id) {
      display_name
      balance_cents
      available_balance_cents
      created_at
      updated_at
    }
  }
`;

const LIST_PARTNERS = gql`
  ${PARTNER_FIELDS}
  query ListPartners(
    $workspace_id: uuid!
    $limit: Int!
    $offset: Int!
    $order_by: [partners_order_by!]
  ) {
    rows: partners(
      where: { workspace_id: { _eq: $workspace_id } }
      limit: $limit
      offset: $offset
      order_by: $order_by
    ) {
      ...PartnerFields
    }
    aggregate: partners_aggregate(where: { workspace_id: { _eq: $workspace_id } }) {
      aggregate {
        count
      }
    }
  }
`;

const GET_PARTNER = gql`
  ${PARTNER_FIELDS}
  query GetPartner($workspace_id: uuid!, $id: uuid!) {
    rows: partners(where: { id: { _eq: $id }, workspace_id: { _eq: $workspace_id } }, limit: 1) {
      ...PartnerFields
      legal_business_name
      legal_business_type
      description
      has_wallet
      payables_aggregate {
        aggregate {
          count
        }
      }
    }
  }
`;

const LIST_PAYABLES = gql`
  ${PAYABLE_FIELDS}
  query ListPayables(
    $where: payables_bool_exp!
    $limit: Int!
    $offset: Int!
    $order_by: [payables_order_by!]
  ) {
    rows: payables(where: $where, limit: $limit, offset: $offset, order_by: $order_by) {
      ...PayableFields
    }
    aggregate: payables_aggregate(where: $where) {
      aggregate {
        count
      }
    }
  }
`;

const GET_PAYABLE = gql`
  ${PAYABLE_FIELDS}
  query GetPayable($id: uuid!) {
    row: payables_by_pk(id: $id) {
      ...PayableFields
    }
  }
`;

const LIST_PROJECTS = gql`
  ${PROJECT_FIELDS}
  query ListProjects(
    $workspace_id: uuid!
    $limit: Int!
    $offset: Int!
    $order_by: [projects_order_by!]
  ) {
    rows: projects(
      where: { workspace_id: { _eq: $workspace_id } }
      limit: $limit
      offset: $offset
      order_by: $order_by
    ) {
      ...ProjectFields
    }
    aggregate: projects_aggregate(where: { workspace_id: { _eq: $workspace_id } }) {
      aggregate {
        count
      }
    }
  }
`;

const GET_PROJECT = gql`
  ${PROJECT_FIELDS}
  query GetProject($workspace_id: uuid!, $id: uuid!) {
    rows: projects(where: { id: { _eq: $id }, workspace_id: { _eq: $workspace_id } }, limit: 1) {
      ...ProjectFields
    }
  }
`;

const LIST_TRANSACTIONS = gql`
  ${TRANSACTION_FIELDS}
  query ListTransactions(
    $where: balance_transactions_bool_exp!
    $limit: Int!
    $offset: Int!
    $order_by: [balance_transactions_order_by!]
  ) {
    rows: balance_transactions(
      where: $where
      limit: $limit
      offset: $offset
      order_by: $order_by
    ) {
      ...TransactionFields
    }
    aggregate: balance_transactions_aggregate(where: $where) {
      aggregate {
        count
      }
    }
  }
`;

// --- Row shapes Hasura returns ---------------------------------------------

interface Aggregate {
  readonly aggregate: { readonly count: number };
}

type ListResult<Row> = { rows: Row[]; aggregate: Aggregate };

type PartnerRecord = PartnerLike;
type PayableRecord = PayableLike & { readonly partner: PartnerOnPayable | null };
type PartnerDetailRecord = PartnerLike & { readonly payables_aggregate: Aggregate };

/**
 * Wire field to database column. The two agree everywhere except money, where
 * Lumanu publishes `amount` and the schema stores `amount_cents` — a difference
 * of name only, since both are integer cents.
 */
const COLUMN_OF: Record<string, string> = { amount: 'amount_cents' };

/**
 * Ordering as a GraphQL variable rather than an interpolated string. The field
 * is already restricted to a closed set by `resolveOrder`, so this is belt and
 * braces — but a query built by concatenation is the kind of thing that stops
 * being safe the moment someone widens the set.
 */
function orderBy(collection: Collection, query: ListQuery | undefined): Array<Record<string, string>> {
  const { field, direction } = resolveOrder(collection, query);
  const column = COLUMN_OF[field] ?? field;

  // Ties broken by id, so a repeated call returns a repeatable page — the same
  // rule the in-memory implementation applies.
  return [{ [column]: direction }, { id: direction }];
}

function paging(query: ListQuery | undefined): { limit: number; offset: number } {
  return {
    limit: query?.limit ?? LIST_DEFAULTS.limit,
    offset: query?.offset ?? LIST_DEFAULTS.offset,
  };
}

/**
 * Apollo types `data` as possibly absent, because a response can carry errors
 * and no data. Turning that into a named failure here means the tools above
 * never see `undefined` where they expect a Workspace.
 */
function requireData<T>(data: T | undefined, operation: string): T {
  if (data === undefined) {
    throw new Error(`Hasura returned no data for ${operation}.`);
  }
  return data;
}

export class MockLumanuProvider implements LumanuProvider {
  private readonly client: ApolloClient;

  public constructor(config: HasuraConfig) {
    this.client = new ApolloClient({
      link: new HttpLink({
        uri: new URL('/v1/graphql', config.hasuraEndpoint).toString(),
        headers: { 'x-hasura-admin-secret': config.hasuraAdminSecret },
      }),
      cache: new InMemoryCache(),
      // Every MCP request is independent and the Lambda is stateless, so a
      // cache hit would only serve a previous request's data. Reads go to the
      // network; the cache stays because Apollo requires one.
      defaultOptions: { query: { fetchPolicy: 'no-cache' } },
    });
  }

  public async listWorkspaces(query?: ListQuery): Promise<ListWorkspacesResponse> {
    const result = await this.query<ListResult<WorkspaceLike>>(LIST_WORKSPACES, 'ListWorkspaces', {
      ...paging(query),
      order_by: orderBy('workspaces', query),
    });

    return { ...pageMeta(result, query), data: result.rows.map(toWorkspace) };
  }

  public async getWorkspace(id: string): Promise<GetWorkspaceResponse> {
    return toWorkspace(await this.one<WorkspaceLike>(GET_WORKSPACE, 'GetWorkspace', 'Workspace', id, { id }));
  }

  public async listPartners(workspaceId: string, query?: ListQuery): Promise<ListPartnersResponse> {
    const result = await this.query<ListResult<PartnerRecord>>(LIST_PARTNERS, 'ListPartners', {
      workspace_id: workspaceId,
      ...paging(query),
      order_by: orderBy('partners', query),
    });

    return { ...pageMeta(result, query), data: result.rows.map(toPartner) };
  }

  public async getPartner(workspaceId: string, partnerId: string): Promise<GetPartnerResponse> {
    const [row] = (
      await this.query<{ rows: PartnerDetailRecord[] }>(GET_PARTNER, 'GetPartner', {
        workspace_id: workspaceId,
        id: partnerId,
      })
    ).rows;

    if (row === undefined) {
      throw new LumanuNotFoundError('Partner', partnerId);
    }
    return toPartnerDetail(row, row.payables_aggregate.aggregate.count);
  }

  public async listPayables(query?: PayableQuery): Promise<ListPayablesResponse> {
    const result = await this.query<ListResult<PayableRecord>>(LIST_PAYABLES, 'ListPayables', {
      where: payableWhere(query),
      ...paging(query),
      order_by: orderBy('payables', query),
    });

    return {
      ...pageMeta(result, query),
      data: result.rows.map((row) => toPayable(row, row.partner ?? undefined)),
    };
  }

  public async getPayable(id: string): Promise<GetPayableResponse> {
    const row = await this.one<PayableRecord>(GET_PAYABLE, 'GetPayable', 'Payable', id, { id });

    return toPayable(row, row.partner ?? undefined);
  }

  public async listProjects(workspaceId: string, query?: ListQuery): Promise<ListProjectsResponse> {
    const result = await this.query<ListResult<ProjectLike>>(LIST_PROJECTS, 'ListProjects', {
      workspace_id: workspaceId,
      ...paging(query),
      order_by: orderBy('projects', query),
    });

    return { ...pageMeta(result, query), data: result.rows.map(toProject) };
  }

  public async getProject(workspaceId: string, projectId: string): Promise<GetProjectResponse> {
    const [row] = (
      await this.query<{ rows: ProjectLike[] }>(GET_PROJECT, 'GetProject', {
        workspace_id: workspaceId,
        id: projectId,
      })
    ).rows;

    if (row === undefined) {
      throw new LumanuNotFoundError('Project', projectId);
    }
    return toProjectDetail(row);
  }

  public async getWorkspaceBalance(workspaceId: string): Promise<GetWorkspaceBalanceResponse> {
    return toAccount(
      await this.one<AccountLike>(
        GET_WORKSPACE_BALANCE,
        'GetWorkspaceBalance',
        'Workspace',
        workspaceId,
        { id: workspaceId },
      ),
    );
  }

  public async listBalanceTransactions(
    workspaceId: string,
    query?: TransactionQuery,
  ): Promise<ListBalanceTransactionsResponse> {
    const result = await this.query<ListResult<TransactionLike>>(LIST_TRANSACTIONS, 'ListTransactions', {
      where: {
        workspace_id: { _eq: workspaceId },
        ...(query?.type === undefined ? {} : { type: { _eq: query.type } }),
      },
      ...paging(query),
      order_by: orderBy('transactions', query),
    });

    return { ...pageMeta(result, query), data: result.rows.map(toTransaction) };
  }

  /** Releases the underlying connections. Lambda reuses the client between invocations. */
  public async dispose(): Promise<void> {
    this.client.stop();
  }

  private async query<Data>(
    document: TypedDocumentNode | ReturnType<typeof gql>,
    operation: string,
    variables: Record<string, unknown>,
  ): Promise<Data> {
    const result = await this.client.query<Data>({ query: document, variables });

    return requireData(result.data, operation);
  }

  /** A by-primary-key read, with Hasura's `null` for "no such row" turned into a named failure. */
  private async one<Row>(
    document: ReturnType<typeof gql>,
    operation: string,
    resource: string,
    id: string,
    variables: Record<string, unknown>,
  ): Promise<Row> {
    const { row } = await this.query<{ row: Row | null }>(document, operation, variables);

    if (row === null) {
      throw new LumanuNotFoundError(resource, id);
    }
    return row;
  }
}

/**
 * The count of everything matching, not of this page — which is what Lumanu's
 * `total` means, and why it needs its own aggregate.
 */
function pageMeta(
  result: { aggregate: Aggregate },
  query: ListQuery | undefined,
): { total: number; limit: number; offset: number } {
  return { total: result.aggregate.aggregate.count, ...paging(query) };
}

function payableWhere(query: PayableQuery | undefined): Record<string, unknown> {
  return {
    ...(query?.workspace_id === undefined ? {} : { workspace_id: { _eq: query.workspace_id } }),
    ...(query?.project_id === undefined ? {} : { project_id: { _eq: query.project_id } }),
  };
}
