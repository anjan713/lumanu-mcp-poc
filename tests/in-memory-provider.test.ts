import { InMemoryLumanuProvider } from '@/providers/in-memory';
import {
  LumanuInsufficientBalanceError,
  LumanuInvalidStateError,
  LumanuNotFoundError,
} from '@/providers/lumanu-provider';
import { CANONICAL, IDS } from '@/seed/canonical';

import { describeLumanuProviderContract } from './support/provider-contract';

describeLumanuProviderContract('InMemoryLumanuProvider', {
  create: () => new InMemoryLumanuProvider(),
  knownWorkspaceId: CANONICAL.workspace.id,
  knownProjectId: CANONICAL.project.id,
  knownPartnerId: IDS.maya,
  knownPayableId: IDS.mayaPayable,
  // A fresh provider is a fresh scenario: the rows are copied in the
  // constructor, so nothing a write test does can reach the next one.
  reset: () => Promise.resolve(new InMemoryLumanuProvider()),
});

describe('InMemoryLumanuProvider specifics', () => {
  it('serves the canonical Workspace by default', async () => {
    const { data, total } = await new InMemoryLumanuProvider().listWorkspaces();

    expect(total).toBe(1);
    expect(data?.[0]?.display_name).toBe('Acme US');
  });

  it('names the resource and the id when one is not found', async () => {
    const provider = new InMemoryLumanuProvider();

    await expect(provider.getWorkspace('missing')).rejects.toThrow(LumanuNotFoundError);
    await expect(provider.getWorkspace('missing')).rejects.toThrow(/Workspace.*missing/);
  });

  it('pages through a longer list when one is supplied', async () => {
    const many = Array.from({ length: 5 }, (_, index) => ({
      ...CANONICAL.workspace,
      id: `9f8b1c34-0000-4000-8000-00000000010${index}`,
    }));
    const provider = new InMemoryLumanuProvider({ workspaces: many });

    const page = await provider.listWorkspaces({ limit: 2, offset: 2 });
    expect(page.total).toBe(5);
    expect(page.data?.map((row) => row.id)).toEqual([many[2]?.id, many[3]?.id]);
  });

  it('reports an empty list without inventing an envelope', async () => {
    const result = await new InMemoryLumanuProvider({ workspaces: [] }).listWorkspaces();

    expect(result).toEqual({ data: [], total: 0, limit: 25, offset: 0 });
  });

  /**
   * The shared contract suite cannot assert this: it needs a Payable belonging
   * to a Partner who has not completed onboarding, and the canonical scenario
   * has none — Sarah is the un-onboarded Partner and has no Payable. The
   * scenario is constructed here instead. `integration/mock-provider.test`
   * covers the same rule against the database.
   */
  it('refuses to fund a Payable whose Partner has not completed onboarding', async () => {
    const sarahsPayable = {
      ...CANONICAL.payables[0]!,
      id: '9f8b1c34-0000-4000-8000-0000000000aa',
      partner_id: IDS.sarah,
      status: 'approved',
      payable_status: 'approved',
    };
    const provider = new InMemoryLumanuProvider({
      payables: [...CANONICAL.payables, sarahsPayable],
    });

    await expect(
      provider.createFunding({
        workspace_id: CANONICAL.workspace.id,
        method: 'balance',
        payable_ids: [sarahsPayable.id],
      }),
    ).rejects.toThrow(LumanuInvalidStateError);

    // And nothing moved.
    expect((await provider.getWorkspaceBalance(CANONICAL.workspace.id)).balance?.balance).toBe(
      CANONICAL.workspace.balance_cents,
    );
  });

  it('rejects the whole batch when one Partner is not onboarded', async () => {
    const sarahsPayable = {
      ...CANONICAL.payables[0]!,
      id: '9f8b1c34-0000-4000-8000-0000000000ab',
      partner_id: IDS.sarah,
      status: 'approved',
      payable_status: 'approved',
    };
    const provider = new InMemoryLumanuProvider({
      payables: [...CANONICAL.payables, sarahsPayable],
    });

    await expect(
      provider.createFunding({
        workspace_id: CANONICAL.workspace.id,
        method: 'balance',
        payable_ids: [IDS.mayaPayable, sarahsPayable.id],
      }),
    ).rejects.toThrow(LumanuInvalidStateError);

    // Maya's Payable was valid and is still untouched: all or nothing.
    expect((await provider.getPayable(IDS.mayaPayable)).status).toBe('approved');
  });

  it('writes an audit event for every state change', async () => {
    const provider = new InMemoryLumanuProvider();

    await provider.approvePayable(IDS.alexPayable);
    await provider.cancelPayable(IDS.alexPayable);
    await provider.createFunding({
      workspace_id: CANONICAL.workspace.id,
      method: 'balance',
      payable_ids: [IDS.mayaPayable],
    });

    expect(provider.auditEvents.map((event) => event.event_type)).toEqual([
      'payable.approved',
      'payable.canceled',
      'funding.created',
    ]);
  });

  /**
   * The shortfall branch cannot be reached from canonical data through the
   * public interface — every approved Payable fits inside the $15,000 balance,
   * and no write raises an amount or lowers the balance without funding
   * something. The Workspace is built short instead.
   */
  it('refuses a Funding the balance cannot cover, and leaves everything untouched', async () => {
    const provider = new InMemoryLumanuProvider({
      workspaces: [
        { ...CANONICAL.workspace, balance_cents: 10_000, available_balance_cents: 10_000 },
      ],
    });

    await expect(
      provider.createFunding({
        workspace_id: CANONICAL.workspace.id,
        method: 'balance',
        payable_ids: [IDS.mayaPayable],
      }),
    ).rejects.toThrow(LumanuInsufficientBalanceError);

    expect((await provider.getWorkspaceBalance(CANONICAL.workspace.id)).balance?.balance).toBe(
      10_000,
    );
    expect((await provider.getPayable(IDS.mayaPayable)).status).toBe('approved');
    expect(provider.auditEvents).toEqual([]);
  });

  /**
   * The same Payable named twice in one request. What gets funded is decided by
   * looking for an existing Funding link, and none exists yet within the call —
   * so without deduplication the amount is counted twice and debited twice.
   */
  it('funds a Payable once even when it is named twice in the same request', async () => {
    const provider = new InMemoryLumanuProvider();

    const funding = await provider.createFunding({
      workspace_id: CANONICAL.workspace.id,
      method: 'balance',
      payable_ids: [IDS.mayaPayable, IDS.mayaPayable],
    });

    expect(funding.amount).toBe(250_000);
    expect((await provider.getWorkspaceBalance(CANONICAL.workspace.id)).balance?.balance).toBe(
      CANONICAL.workspace.balance_cents - 250_000,
    );
  });
});
