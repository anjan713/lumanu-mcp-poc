/**
 * What actually reached Supabase, read back through Hasura.
 *
 * `tests/canonical-seed.test.ts` proves the scenario's figures are internally
 * consistent, with no credentials. This proves the database holds that same
 * scenario, and that Hasura is serving it with the relationships the provider
 * will query through. Between them the fixture cannot quietly diverge from the
 * deployed data.
 *
 * Skipped when the data layer is not configured, so a fresh clone still runs
 * green. Run `npm run db:reset` first.
 */

import { config as loadDotenv } from 'dotenv';

import { CANONICAL, IDS, dollars } from '@/seed/canonical';

loadDotenv({ quiet: true });

const endpoint = process.env['HASURA_GRAPHQL_ENDPOINT'];
const adminSecret = process.env['HASURA_ADMIN_SECRET'];
const configured = Boolean(endpoint && adminSecret);

const describeWhenConfigured = configured ? describe : describe.skip;

async function graphql<T>(query: string): Promise<T> {
  const response = await fetch(new URL('/v1/graphql', endpoint), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hasura-admin-secret': adminSecret ?? '',
    },
    body: JSON.stringify({ query }),
  });

  const body = (await response.json()) as { data?: T; errors?: unknown };
  if (body.errors !== undefined) throw new Error(JSON.stringify(body.errors));
  if (body.data === undefined) throw new Error('Hasura returned no data');
  return body.data;
}

describeWhenConfigured('the seeded database', () => {
  jest.setTimeout(30_000);

  it('holds Acme US with the standing balance', async () => {
    const data = await graphql<{
      workspaces: Array<{ display_name: string; balance_cents: string }>;
    }>(`{ workspaces { display_name balance_cents } }`);

    expect(data.workspaces).toHaveLength(1);
    expect(data.workspaces[0]?.display_name).toBe('Acme US');
    // bigint arrives as a string over GraphQL — see the note below.
    expect(Number(data.workspaces[0]?.balance_cents)).toBe(dollars(15_000));
  });

  it('holds the four canonical Partners with their statuses', async () => {
    const data = await graphql<{ partners: Array<{ name: string; status: string | null }> }>(
      `{ partners(where: {lumanu_id: {_in: ["LUM100001","LUM100002","LUM100004"]}},
                  order_by: {created_at: asc}) { name status } }`,
    );

    expect(data.partners.map((row) => row.name)).toEqual([
      'StudioX LLC',
      'Maya Patel',
      'Alex Rivera',
    ]);
    for (const row of data.partners) expect(row.status).toBe('completed_w9');
  });

  it('holds Sarah mid-onboarding with no Payable', async () => {
    const data = await graphql<{
      partners: Array<{ status: string; payables: unknown[] }>;
    }>(`{ partners(where: {email: {_eq: "sarah.chen@example.com"}}) {
           status payables { id } } }`);

    expect(data.partners[0]?.status).toBe('awaiting_w9_submission');
    expect(data.partners[0]?.payables).toEqual([]);
  });

  /** The relationship `MockLumanuProvider` needs to build a Payable's wire format. */
  it('resolves a Payable to the Partner whose email the wire format carries', async () => {
    const data = await graphql<{
      payables_by_pk: { amount_cents: string; status: string; partner: { email: string } };
    }>(`{ payables_by_pk(id: "${IDS.mayaPayable}") {
           amount_cents status partner { email } } }`);

    expect(data.payables_by_pk).toMatchObject({
      status: 'approved',
      partner: { email: 'maya.patel@example.com' },
    });
    expect(Number(data.payables_by_pk.amount_cents)).toBe(dollars(2_500));
  });

  it('records the stored balance as the sum of its Balance Transactions', async () => {
    const data = await graphql<{
      balance_transactions_aggregate: { aggregate: { sum: { balance_change_cents: string } } };
      workspaces: Array<{ balance_cents: string }>;
    }>(`{
      balance_transactions_aggregate { aggregate { sum { balance_change_cents } } }
      workspaces { balance_cents }
    }`);

    const summed = Number(data.balance_transactions_aggregate.aggregate.sum.balance_change_cents);
    expect(summed).toBe(Number(data.workspaces[0]?.balance_cents));
    expect(summed).toBe(dollars(15_000));
  });

  it('links StudioX’s Funding to exactly the Payable it paid', async () => {
    const data = await graphql<{
      fundings: Array<{ method: string; funding_payables: Array<{ payable: { id: string } }> }>;
    }>(`{ fundings { method funding_payables { payable { id } } } }`);

    expect(data.fundings).toHaveLength(1);
    expect(data.fundings[0]?.method).toBe('balance');
    expect(data.fundings[0]?.funding_payables.map((row) => row.payable.id)).toEqual([
      IDS.studioXPayable,
    ]);
  });

  it('adds generated texture without a second Workspace, Project or funding model', async () => {
    const data = await graphql<{
      workspaces_aggregate: { aggregate: { count: number } };
      projects_aggregate: { aggregate: { count: number } };
      partners_aggregate: { aggregate: { count: number } };
      fundings_aggregate: { aggregate: { count: number } };
    }>(`{
      workspaces_aggregate { aggregate { count } }
      projects_aggregate { aggregate { count } }
      partners_aggregate { aggregate { count } }
      fundings_aggregate { aggregate { count } }
    }`);

    expect(data.workspaces_aggregate.aggregate.count).toBe(1);
    expect(data.projects_aggregate.aggregate.count).toBe(1);
    expect(data.fundings_aggregate.aggregate.count).toBe(1);
    expect(data.partners_aggregate.aggregate.count).toBeGreaterThan(CANONICAL.partners.length);
  });

  /**
   * No generated Partner is `completed_w9` and no generated Payable is
   * `approved`, so texture cannot enter the ready-to-fund total. Without this
   * constraint a Faker seed change could silently move the demo's figures.
   */
  it('keeps generated texture out of the ready-to-fund total', async () => {
    const data = await graphql<{
      payables_aggregate: { aggregate: { sum: { amount_cents: string | null } } };
    }>(`{ payables_aggregate(
           where: {status: {_eq: "approved"}, partner: {status: {_eq: "completed_w9"}}}
         ) { aggregate { sum { amount_cents } } } }`);

    expect(Number(data.payables_aggregate.aggregate.sum.amount_cents)).toBe(dollars(2_500));
  });
});

describe('the integration suite', () => {
  it(configured ? 'ran against the configured data layer' : 'skipped, as no data layer is configured', () => {
    expect(true).toBe(true);
  });
});
