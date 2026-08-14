/**
 * Seam 1 — the MCP tool surface.
 *
 * The primary seam, and the highest available. A real MCP client talks to a
 * real MCP server over an in-memory transport, with `InMemoryLumanuProvider`
 * injected. No network, no credentials, no database.
 *
 * Everything here asserts what a client actually receives. Nothing asserts
 * that a provider method was called or that a query had a given shape — a test
 * that did would pass just as happily against a broken tool.
 */

import { InMemoryLumanuProvider } from '@/providers';
import type { LumanuProvider } from '@/providers';
import { CANONICAL, CURRENT_BALANCE_CENTS, dollars, IDS, OPENING_BALANCE_CENTS } from '@/seed/canonical';

import { expectMatchesLumanuSchema } from './support/lumanu-schema';
import { call, connect, payloadOf } from './support/mcp-client';

/**
 * A provider whose every method fails, standing in for a data layer that is
 * down. Built by proxy rather than by listing the methods, so a provider method
 * added later is covered here without anyone remembering to add it.
 */
function unreachableProvider(): LumanuProvider {
  return new Proxy({} as LumanuProvider, {
    get: () => () => Promise.reject(new Error('Hasura is unreachable')),
  });
}

describe('the tool surface an agent sees', () => {
  it('advertises the whole surface', async () => {
    const { tools } = await (await connect()).listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'approve_payable',
      'cancel_payable',
      'explain_payment_blocker',
      'fund_payables',
      'get_funding_capacity',
      'get_partner',
      'get_partner_payment_readiness',
      'get_payable',
      'get_project_payment_summary',
      'get_workspace_balance',
      'get_workspace_overview',
      'list_partners',
      'list_payables',
      'list_projects',
      'list_workspace_transactions',
      'list_workspaces',
    ]);
  });

  /**
   * An agent chooses between ten tools from their descriptions alone. A
   * description that named an endpoint would make that choice depend on
   * knowing Lumanu's REST surface, which is the thing this project exists to
   * make unnecessary.
   */
  it('describes every tool in business terms, not REST terms', async () => {
    const { tools } = await (await connect()).listTools();

    for (const tool of tools) {
      expect(tool.description).toBeDefined();
      expect(tool.description?.length).toBeGreaterThan(80);
      expect(tool.description).not.toMatch(/GET |POST |endpoint|REST|\/workspace/);
    }
  });

  it('never says Vendor, creator or payee where an agent can read it', async () => {
    const { tools } = await (await connect()).listTools();
    const visible = JSON.stringify(tools);

    expect(visible).not.toMatch(/\bvendor\b/i);
    expect(visible).not.toMatch(/\bpayee\b/i);
    expect(visible).not.toMatch(/\bwallet\b/i);
  });

  it('publishes an input schema so an agent can call it without guessing', async () => {
    const { tools } = await (await connect()).listTools();
    const tool = tools.find((candidate) => candidate.name === 'list_workspaces');

    expect(Object.keys(tool?.inputSchema.properties ?? {}).sort()).toEqual(['limit', 'offset']);
  });
});

describe('list_workspaces', () => {
  it('returns the canonical Workspace', async () => {
    const client = await connect();
    const payload = payloadOf(await client.callTool({ name: 'list_workspaces', arguments: {} }));

    const workspaces = payload['data'] as Array<{ display_name: string }>;
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]?.display_name).toBe('Acme US');
  });

  it("returns Lumanu's envelope, so behaviour will not change when the real API is connected", async () => {
    const client = await connect();
    const payload = payloadOf(await client.callTool({ name: 'list_workspaces', arguments: {} }));

    expect(Object.keys(payload).sort()).toEqual(['data', 'limit', 'offset', 'total']);
    expect(payload['total']).toBe(1);
    expect(payload['limit']).toBe(25);
    expect(payload['offset']).toBe(0);
  });

  it('returns Workspaces that validate against Lumanu’s published schema', async () => {
    const client = await connect();
    const payload = payloadOf(await client.callTool({ name: 'list_workspaces', arguments: {} }));

    for (const workspace of payload['data'] as unknown[]) {
      expectMatchesLumanuSchema('Workspace', workspace);
    }
  });

  it('honours the paging it is given', async () => {
    const many = Array.from({ length: 4 }, (_, index) => ({
      ...CANONICAL.workspace,
      id: `9f8b1c34-0000-4000-8000-00000000020${index}`,
    }));
    const client = await connect(new InMemoryLumanuProvider({ workspaces: many }));

    const payload = payloadOf(
      await client.callTool({ name: 'list_workspaces', arguments: { limit: 2, offset: 1 } }),
    );

    expect(payload['total']).toBe(4);
    expect(payload['limit']).toBe(2);
    expect((payload['data'] as unknown[]).length).toBe(2);
  });

  it('rejects a limit outside the range it advertises', async () => {
    const client = await connect();

    const result = await client.callTool({ name: 'list_workspaces', arguments: { limit: 0 } });

    expect(result.isError).toBe(true);
  });

  it('rejects an argument of the wrong type rather than guessing', async () => {
    const client = await connect();

    const result = await client.callTool({
      name: 'list_workspaces',
      arguments: { limit: 'twenty' },
    });

    expect(result.isError).toBe(true);
  });

  it('reports a provider failure as a tool error rather than crashing the server', async () => {
    const client = await connect(unreachableProvider());

    const result = await client.callTool({ name: 'list_workspaces', arguments: {} });

    expect(result.isError).toBe(true);
    // The server is still usable afterwards.
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
  });
});

const WORKSPACE = { workspace_id: CANONICAL.workspace.id };

describe('get_workspace_overview', () => {
  it('answers the balance, the Partner count and what is owed in one call', async () => {
    const overview = await call('get_workspace_overview', WORKSPACE);

    expect(overview['display_name']).toBe('Acme US');
    expect(overview['balance']).toMatchObject({
      balance: CURRENT_BALANCE_CENTS,
      available_balance: CURRENT_BALANCE_CENTS,
      denomination: 'us_cents',
    });
    expect((overview['partners'] as { count: number }).count).toBe(4);
    expect((overview['payables'] as { count: number }).count).toBe(3);
  });

  it('reports what is committed, what is funded and what is still owed', async () => {
    const { payables } = (await call('get_workspace_overview', WORKSPACE)) as {
      payables: { committed_amount: number; funded_amount: number; outstanding_amount: number };
    };

    // $2,500 + $7,500 + $10,000 committed; the StudioX $10,000 already funded.
    expect(payables.committed_amount).toBe(dollars(20_000));
    expect(payables.funded_amount).toBe(dollars(10_000));
    expect(payables.outstanding_amount).toBe(dollars(10_000));
  });

  it('breaks the Partners down by the one status that governs whether they can be paid', async () => {
    const { partners } = (await call('get_workspace_overview', WORKSPACE)) as {
      partners: { by_status: Array<{ status: string; count: number }> };
    };

    expect(partners.by_status).toEqual([
      { status: 'awaiting_w9_submission', count: 1 },
      { status: 'completed_w9', count: 3 },
    ]);
  });

  /**
   * `paid` is in Lumanu's enum but no flow in this POC produces it. Reporting a
   * zero against it would put a state in front of an agent that this system
   * cannot reach.
   */
  it('never reports a status the scenario cannot produce', async () => {
    const overview = await call('get_workspace_overview', WORKSPACE);

    expect(JSON.stringify(overview)).not.toContain('"paid"');
  });
});

describe('get_workspace_balance', () => {
  it('returns both figures, because a funding decision needs the second one', async () => {
    const account = await call('get_workspace_balance', WORKSPACE);

    expect(account['balance']).toEqual({
      balance: CURRENT_BALANCE_CENTS,
      available_balance: CURRENT_BALANCE_CENTS,
    });
    expect(account['denomination']).toBe('us_cents');
  });

  it('returns an Account that validates against Lumanu’s published schema', async () => {
    expectMatchesLumanuSchema('Account', await call('get_workspace_balance', WORKSPACE));
  });
});

describe('list_workspace_transactions', () => {
  it('shows how the balance reached its current figure', async () => {
    const payload = await call('list_workspace_transactions', WORKSPACE);
    const transactions = payload['data'] as Array<{
      type: string;
      amount: number;
      balance_change: number;
      ending_balance: number;
      description: string;
    }>;

    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({
      type: 'deposit',
      ending_balance: OPENING_BALANCE_CENTS,
    });
    // The StudioX debit: $25,000 in, $10,000 out, $15,000 standing.
    expect(transactions[1]).toMatchObject({
      type: 'payment',
      amount: dollars(10_000),
      balance_change: -dollars(10_000),
      ending_balance: CURRENT_BALANCE_CENTS,
    });
  });

  it('names the Partner the movement relates to', async () => {
    const payload = await call('list_workspace_transactions', { ...WORKSPACE, type: 'payment' });
    const [debit] = payload['data'] as Array<{ description: string }>;

    expect(debit?.description).toContain('StudioX');
  });

  it('filters to money out', async () => {
    const payload = await call('list_workspace_transactions', { ...WORKSPACE, type: 'payment' });

    expect(payload['total']).toBe(1);
    expect((payload['data'] as unknown[]).length).toBe(1);
  });

  it('carries the envelope', async () => {
    const payload = await call('list_workspace_transactions', WORKSPACE);

    expect(Object.keys(payload).sort()).toEqual(['data', 'limit', 'offset', 'total']);
  });
});

describe('list_partners', () => {
  it('returns the Workspace’s Partners with one combined onboarding and tax status', async () => {
    const payload = await call('list_partners', WORKSPACE);
    const partners = payload['data'] as Array<Record<string, unknown>>;

    expect(payload['total']).toBe(4);
    expect(partners.map((partner) => partner['status'])).toContain('awaiting_w9_submission');
    for (const partner of partners) {
      expect(partner).not.toHaveProperty('onboarding_status');
      expect(partner).not.toHaveProperty('tax_status');
    }
  });

  /**
   * The question a list answers is who the Partners are and what state they are
   * in. An email address in that answer is personal data spent for nothing.
   */
  it('withholds contact details, which the question does not need', async () => {
    const payload = await call('list_partners', WORKSPACE);

    for (const partner of payload['data'] as Array<Record<string, unknown>>) {
      expect(partner).not.toHaveProperty('email');
      expect(partner).not.toHaveProperty('notes');
      expect(partner['name']).toBeDefined();
    }
  });

  it('orders on request', async () => {
    const payload = await call('list_partners', { ...WORKSPACE, order_by: 'name' });
    const names = (payload['data'] as Array<{ name: string }>).map((partner) => partner.name);

    expect(names[0]).toBe('Alex Rivera');
  });

  it('reports an order it cannot honour as a tool error', async () => {
    const client = await connect();

    const result = await client.callTool({
      name: 'list_partners',
      arguments: { ...WORKSPACE, order_by: 'salary' },
    });

    expect(result.isError).toBe(true);
  });
});

describe('get_partner', () => {
  it('returns one Partner in full, with how many Payables they hold', async () => {
    const partner = await call('get_partner', { ...WORKSPACE, partner_id: IDS.maya });

    expect(partner['name']).toBe('Maya Patel');
    expect(partner['status']).toBe('completed_w9');
    expect(partner['payables_count']).toBe(1);
  });

  it('includes the contact address, which is part of what a lookup asks for', async () => {
    const partner = await call('get_partner', { ...WORKSPACE, partner_id: IDS.maya });

    expect(partner['email']).toBe('maya.patel@example.com');
    expect(partner).not.toHaveProperty('notes');
  });

  it('reports an unknown Partner as a tool error', async () => {
    const client = await connect();

    const result = await client.callTool({
      name: 'get_partner',
      arguments: { ...WORKSPACE, partner_id: '00000000-0000-4000-8000-000000000000' },
    });

    expect(result.isError).toBe(true);
  });
});

describe('list_payables', () => {
  it('returns what the Workspace owes, in Lumanu’s envelope', async () => {
    const payload = await call('list_payables', WORKSPACE);

    expect(Object.keys(payload).sort()).toEqual(['data', 'limit', 'offset', 'total']);
    expect(payload['total']).toBe(3);
    for (const payable of payload['data'] as unknown[]) {
      expectMatchesLumanuSchema('Payable', payable);
    }
  });

  /**
   * Lumanu publishes no status filter on its Payables endpoint, so this is
   * applied above the provider — and the total has to describe the filtered
   * set, not the page it came from.
   */
  it('filters by status, and reports the total of what matched', async () => {
    const approved = await call('list_payables', { ...WORKSPACE, status: 'approved' });

    expect(approved['total']).toBe(1);
    const [payable] = approved['data'] as Array<{ status: string; amount: number }>;
    expect(payable?.status).toBe('approved');
    expect(payable?.amount).toBe(dollars(2_500));
  });

  it('separates what still needs approving from what has been funded', async () => {
    const unapproved = await call('list_payables', { ...WORKSPACE, status: 'unapproved' });
    const funded = await call('list_payables', { ...WORKSPACE, status: 'will_pay' });

    expect(unapproved['total']).toBe(1);
    expect(funded['total']).toBe(1);
    expect((funded['data'] as Array<{ amount: number }>)[0]?.amount).toBe(dollars(10_000));
  });

  it('filters by Project', async () => {
    const payload = await call('list_payables', { ...WORKSPACE, project_id: CANONICAL.project.id });

    expect(payload['total']).toBe(3);
  });

  it('names the Partner without inventing a partner_id Lumanu does not publish', async () => {
    const payload = await call('list_payables', WORKSPACE);
    const [payable] = payload['data'] as Array<Record<string, unknown>>;

    expect(payable).not.toHaveProperty('partner_id');
    expect(payable?.['vendor_display_name']).toBe('Maya Patel');
  });

  /**
   * A Payable names its Partner three ways and one of them is an email address,
   * so without this a page of Payables hands back every contact address that
   * `list_partners` had just withheld — which would make that withholding
   * decorative. The display name and Lumanu id already say who is owed.
   */
  it('withholds the contact address it carries, as the Partner list does', async () => {
    const unfiltered = await call('list_payables', WORKSPACE);
    const filtered = await call('list_payables', { ...WORKSPACE, status: 'approved' });

    for (const payable of [...(unfiltered['data'] as unknown[]), ...(filtered['data'] as unknown[])]) {
      expect(payable).not.toHaveProperty('vendor_email');
      expect(payable).toHaveProperty('vendor_display_name');
    }
  });

  /**
   * `paid` is in Lumanu's enum and no flow here produces it. An input schema
   * offering it invites an agent to ask a question this system can only answer
   * with an empty list.
   */
  it('does not offer a status the system cannot reach', async () => {
    const { tools } = await (await connect()).listTools();
    const tool = tools.find((candidate) => candidate.name === 'list_payables');
    const status = (tool?.inputSchema.properties as { status?: { enum?: string[] } })?.status;

    expect(status?.enum).toEqual(['unapproved', 'approved', 'will_pay', 'canceled']);
  });
});

describe('get_payable', () => {
  it('returns one Payable in full', async () => {
    const payable = await call('get_payable', { payable_id: IDS.alexPayable });

    expect(payable['amount']).toBe(dollars(7_500));
    expect(payable['status']).toBe('unapproved');
    expect(payable['project_id']).toBe(CANONICAL.project.id);
  });
});

describe('get_project_payment_summary', () => {
  it('reports what the Summer Creator Campaign has committed, funded and still owes', async () => {
    const summary = await call('get_project_payment_summary', {
      ...WORKSPACE,
      project_id: CANONICAL.project.id,
    });

    expect(summary['name']).toBe('Summer Creator Campaign');
    expect(summary['payables']).toMatchObject({
      count: 3,
      committed_amount: dollars(20_000),
      funded_amount: dollars(10_000),
      outstanding_amount: dollars(10_000),
    });
  });

  it('compares the commitment with the Project budget', async () => {
    const summary = await call('get_project_payment_summary', {
      ...WORKSPACE,
      project_id: CANONICAL.project.id,
    });

    expect(summary['budget_amount']).toBe(dollars(30_000));
    expect(summary['budget_remaining']).toBe(dollars(10_000));
  });
});

describe('list_projects', () => {
  it('returns the Projects a Workspace holds', async () => {
    const payload = await call('list_projects', WORKSPACE);

    expect(payload['total']).toBe(1);
    expect((payload['data'] as Array<{ name: string }>)[0]?.name).toBe('Summer Creator Campaign');
  });
});

describe('the layering', () => {
  it('reaches its data only through the provider it was given', async () => {
    // A provider that answers with a Workspace no database contains. If the
    // tool consulted anything else, this could not be the answer.
    const invented = {
      ...CANONICAL.workspace,
      id: '9f8b1c34-0000-4000-8000-0000000003ff',
      display_name: 'Nowhere Ltd',
    };
    const client = await connect(new InMemoryLumanuProvider({ workspaces: [invented] }));

    const payload = payloadOf(await client.callTool({ name: 'list_workspaces', arguments: {} }));

    expect((payload['data'] as Array<{ display_name: string }>)[0]?.display_name).toBe(
      'Nowhere Ltd',
    );
  });
});
