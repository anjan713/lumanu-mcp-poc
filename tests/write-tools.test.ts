/**
 * Ticket 07 — the write tools, as an agent experiences them.
 *
 * These change state, so each test builds its own provider: an
 * `InMemoryLumanuProvider` copies the scenario in its constructor, so nothing
 * one test does can reach the next.
 *
 * The refusals matter more than the successes. An agent that cannot tell a
 * wrong identifier from a request that was wrong to make can only retry
 * blindly, and retrying a payment blindly is what this must not encourage.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { InMemoryLumanuProvider } from '@/providers';
import { CANONICAL, dollars, IDS } from '@/seed/canonical';

import { call, connect, payloadOf } from './support/mcp-client';

const WORKSPACE = { workspace_id: CANONICAL.workspace.id };

/** A client over its own scenario, so each test starts from the canonical state. */
async function session(): Promise<{ client: Client; provider: InMemoryLumanuProvider }> {
  const provider = new InMemoryLumanuProvider();

  return { client: await connect(provider), provider };
}

/** The `{ error: { kind, ... } }` payload a refused write answers with. */
async function refusalOf(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ kind: string; message: string } & Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args });

  expect(result.isError).toBe(true);
  return payloadOf(result)['error'] as { kind: string; message: string };
}

describe('approve_payable', () => {
  it('moves an unapproved Payable to approved and returns the new state', async () => {
    const { client } = await session();

    const payable = await call('approve_payable', { payable_id: IDS.alexPayable }, client);

    expect(payable['status']).toBe('approved');
    expect(payable['amount']).toBe(dollars(7_500));
  });

  it('refuses a Payable that has already been funded, saying why', async () => {
    const { client } = await session();

    const error = await refusalOf(client, 'approve_payable', {
      payable_id: IDS.studioXPayable,
    });

    expect(error.kind).toBe('invalid_state');
    expect(error['current_state']).toBe('will_pay');
  });

  it('distinguishes a wrong identifier from a wrong request', async () => {
    const { client } = await session();

    const notFound = await refusalOf(client, 'approve_payable', {
      payable_id: '00000000-0000-4000-8000-000000000000',
    });
    const wrongState = await refusalOf(client, 'approve_payable', {
      payable_id: IDS.mayaPayable,
    });

    expect(notFound.kind).toBe('not_found');
    expect(wrongState.kind).toBe('invalid_state');
  });
});

describe('cancel_payable', () => {
  it('withdraws an obligation raised in error', async () => {
    const { client } = await session();

    expect((await call('cancel_payable', { payable_id: IDS.alexPayable }, client))['status']).toBe(
      'canceled',
    );
  });

  /**
   * The money has already left the Workspace Balance. Withdrawing here would
   * leave the balance and the record disagreeing, with no credit to match.
   */
  it('refuses to withdraw a funded Payable, so committed money is not unwound', async () => {
    const { client } = await session();

    const error = await refusalOf(client, 'cancel_payable', { payable_id: IDS.studioXPayable });

    expect(error.kind).toBe('invalid_state');
  });
});

describe('fund_payables', () => {
  it('pays an approved Payable from the Workspace Balance', async () => {
    const { client } = await session();

    const funding = await call(
      'fund_payables',
      { ...WORKSPACE, payable_ids: [IDS.mayaPayable] },
      client,
    );

    expect(funding['amount']).toBe(dollars(2_500));
    expect(funding['method']).toBe('balance');
    expect((await call('get_payable', { payable_id: IDS.mayaPayable }, client))['status']).toBe(
      'will_pay',
    );
  });

  it('shows the movement in the balance history afterwards', async () => {
    const { client } = await session();

    await call('fund_payables', { ...WORKSPACE, payable_ids: [IDS.mayaPayable] }, client);
    const history = await call(
      'list_workspace_transactions',
      { ...WORKSPACE, order_by: 'created_at', order_by_direction: 'desc' },
      client,
    );
    const [latest] = history['data'] as Array<{ balance_change: number; description: string }>;

    expect(latest?.balance_change).toBe(-dollars(2_500));
    expect(latest?.description).toContain('Maya');
  });

  it('refuses the whole request when one Payable is unapproved', async () => {
    const { client } = await session();

    const error = await refusalOf(client, 'fund_payables', {
      ...WORKSPACE,
      payable_ids: [IDS.mayaPayable, IDS.alexPayable],
    });

    expect(error.kind).toBe('invalid_state');
    // And Maya, who was fundable, is untouched.
    expect((await call('get_payable', { payable_id: IDS.mayaPayable }, client))['status']).toBe(
      'approved',
    );
  });

  it('states the shortfall when the balance does not cover it', async () => {
    const provider = new InMemoryLumanuProvider({
      workspaces: [
        {
          ...CANONICAL.workspace,
          balance_cents: dollars(100),
          available_balance_cents: dollars(100),
        },
      ],
    });
    const client = await connect(provider);

    const error = await refusalOf(client, 'fund_payables', {
      ...WORKSPACE,
      payable_ids: [IDS.mayaPayable],
    });

    expect(error.kind).toBe('insufficient_balance');
    expect(error['required']).toBe(dollars(2_500));
    expect(error['available']).toBe(dollars(100));
    expect(error['shortfall']).toBe(dollars(2_400));

    // And nothing moved.
    const balance = await call('get_workspace_balance', WORKSPACE, client);
    expect((balance['balance'] as { balance: number }).balance).toBe(dollars(100));
    expect((await call('get_payable', { payable_id: IDS.mayaPayable }, client))['status']).toBe(
      'approved',
    );
  });

  it('rejects an empty request before it reaches the provider', async () => {
    const { client } = await session();

    const result = await client.callTool({
      name: 'fund_payables',
      arguments: { ...WORKSPACE, payable_ids: [] },
    });

    expect(result.isError).toBe(true);
  });

  it('is safe to retry: a Payable already paid for is not paid twice', async () => {
    const { client } = await session();
    const args = { ...WORKSPACE, payable_ids: [IDS.mayaPayable] };

    const first = await call('fund_payables', args, client);
    const second = await call('fund_payables', args, client);

    expect(second['id']).toBe(first['id']);
    const balance = await call('get_workspace_balance', WORKSPACE, client);
    expect((balance['balance'] as { balance: number }).balance).toBe(dollars(12_500));
  });
});

describe('the demo flow, end to end', () => {
  /**
   * The sequence the README promises, through the tools an agent actually
   * calls: ask what is blocking Alex, clear it with the tool the answer names,
   * check the money is there, pay both, and read the balance back.
   */
  it('explains Alex’s blocker, clears it, and funds Maya and Alex for $10,000', async () => {
    const { client } = await session();

    const blocker = await call(
      'explain_payment_blocker',
      { ...WORKSPACE, partner_id: IDS.alex },
      client,
    );
    const { resolution, resolvable_here } = blocker['blocker'] as {
      resolution: string;
      resolvable_here: boolean;
    };
    expect(resolvable_here).toBe(true);
    expect(resolution).toContain('approve_payable');

    await call('approve_payable', { payable_id: IDS.alexPayable }, client);

    const capacity = await call('get_funding_capacity', WORKSPACE, client);
    expect(capacity['required_amount']).toBe(dollars(10_000));
    expect(capacity['sufficient']).toBe(true);

    const funding = await call(
      'fund_payables',
      { ...WORKSPACE, payable_ids: [IDS.mayaPayable, IDS.alexPayable] },
      client,
    );
    expect(funding['amount']).toBe(dollars(10_000));

    const balance = await call('get_workspace_balance', WORKSPACE, client);
    expect((balance['balance'] as { balance: number }).balance).toBe(dollars(5_000));

    // And afterwards nobody is left waiting.
    const after = await call('get_funding_capacity', WORKSPACE, client);
    expect(after['required_amount']).toBe(0);
  });
});

describe('the write surface an agent sees', () => {
  it('describes each write in terms of what it does to the money', async () => {
    const { tools } = await (await connect()).listTools();
    const writes = tools.filter((tool) =>
      ['approve_payable', 'cancel_payable', 'fund_payables'].includes(tool.name),
    );

    expect(writes).toHaveLength(3);
    for (const tool of writes) {
      expect(tool.description).not.toMatch(/GET |POST |endpoint|REST|mutation|SQL/);
      expect(tool.description?.length).toBeGreaterThan(80);
    }
  });

  it('never says Vendor, payee or Wallet where an agent can read it', async () => {
    const { tools } = await (await connect()).listTools();
    const writes = JSON.stringify(
      tools.filter((tool) => /approve|cancel|fund/.test(tool.name)),
    );

    expect(writes).not.toMatch(/\bvendor\b/i);
    expect(writes).not.toMatch(/\bpayee\b/i);
    expect(writes).not.toMatch(/\bwallet\b/i);
  });
});
