/**
 * `LumanuProvider` over Supabase, through Hasura, via Apollo Client.
 *
 * This is the deployed default. Its job is to make seeded PostgreSQL rows
 * indistinguishable — to everything above the provider boundary — from what
 * Lumanu's REST API returns. Nothing above it knows Hasura exists, and the
 * admin secret reaches no further than this file.
 *
 * The mapping from database row to wire format lives here on purpose. It is
 * the price of the swap claim: `RealLumanuProvider` gets these shapes for
 * free from Lumanu, so the work of producing them has to happen somewhere, and
 * the boundary is the only place it can happen without leaking into the tools.
 */

import { ApolloClient, HttpLink, InMemoryCache, gql } from '@apollo/client';

import type { HasuraConfig } from '@/config';

import {
  LumanuNotFoundError,
  LIST_DEFAULTS,
  type ListQuery,
  type LumanuProvider,
} from './lumanu-provider';
import type { GetWorkspaceResponse, ListWorkspacesResponse, Workspace } from './wire';

/**
 * The columns that make up a Lumanu `Workspace`. The balance columns are
 * deliberately not selected: Lumanu serves the Workspace Balance from a
 * separate wallet endpoint as an `Account`, and putting it on the Workspace
 * would invent a shape Lumanu does not publish.
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

const LIST_WORKSPACES = gql`
  ${WORKSPACE_FIELDS}
  query ListWorkspaces($limit: Int!, $offset: Int!) {
    workspaces(limit: $limit, offset: $offset, order_by: { created_at: asc }) {
      ...WorkspaceFields
    }
    workspaces_aggregate {
      aggregate {
        count
      }
    }
  }
`;

const GET_WORKSPACE = gql`
  ${WORKSPACE_FIELDS}
  query GetWorkspace($id: uuid!) {
    workspaces_by_pk(id: $id) {
      ...WorkspaceFields
    }
  }
`;

/** What Hasura returns for one workspaces row, before mapping. */
interface WorkspaceRecord {
  readonly id: string;
  readonly display_name: string;
  readonly profile_image_url: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly funding_fee_percent: string | number | null;
  readonly additive_funding_fee: boolean | null;
  readonly vendor_invite_url: string | null;
}

/**
 * PostgreSQL `numeric` arrives over GraphQL as a string, because it can hold
 * values a JavaScript number cannot. Lumanu publishes `funding_fee_percent` as
 * a number, so it is converted here rather than leaked as a string — a
 * difference the contract suite would otherwise let through, since both are
 * truthy and neither is null.
 */
function toNumberOrNull(value: string | number | null): number | null {
  if (value === null) return null;
  return typeof value === 'number' ? value : Number(value);
}

/** Omits a field entirely when the database holds no value for it. */
function optional<T>(key: string, value: T | null): Record<string, T> {
  return value === null ? {} : { [key]: value };
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

function toWorkspace(record: WorkspaceRecord): Workspace {
  return {
    id: record.id,
    display_name: record.display_name,
    created_at: record.created_at,
    updated_at: record.updated_at,
    // Nullable in Lumanu's schema, so null is carried through as null rather
    // than dropped. Absent and null mean different things.
    funding_fee_percent: toNumberOrNull(record.funding_fee_percent),
    additive_funding_fee: record.additive_funding_fee,
    ...optional('profile_image_url', record.profile_image_url),
    ...optional('vendor_invite_url', record.vendor_invite_url),
  };
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
    const limit = query?.limit ?? LIST_DEFAULTS.limit;
    const offset = query?.offset ?? LIST_DEFAULTS.offset;

    const result = await this.client.query<{
      workspaces: WorkspaceRecord[];
      workspaces_aggregate: { aggregate: { count: number } };
    }>({ query: LIST_WORKSPACES, variables: { limit, offset } });
    const data = requireData(result.data, 'ListWorkspaces');

    return {
      data: data.workspaces.map(toWorkspace),
      // The count of everything, not of this page — which is what Lumanu's
      // `total` means, and why it needs its own aggregate.
      total: data.workspaces_aggregate.aggregate.count,
      limit,
      offset,
    };
  }

  public async getWorkspace(id: string): Promise<GetWorkspaceResponse> {
    const result = await this.client.query<{ workspaces_by_pk: WorkspaceRecord | null }>({
      query: GET_WORKSPACE,
      variables: { id },
    });
    const data = requireData(result.data, 'GetWorkspace');

    if (data.workspaces_by_pk === null) {
      throw new LumanuNotFoundError('Workspace', id);
    }
    return toWorkspace(data.workspaces_by_pk);
  }

  /** Releases the underlying connections. Lambda reuses the client between invocations. */
  public async dispose(): Promise<void> {
    this.client.stop();
  }
}
