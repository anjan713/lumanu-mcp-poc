/**
 * Ticket 06 — the conclusions, as an agent receives them.
 *
 * "Who can I pay right now?" is not a field on any record. It combines a
 * Partner's onboarding state, a Payable's approval state and the Workspace
 * Balance, and the point of these tools is that the combining happens once here
 * rather than being reinvented by an agent on every conversation.
 *
 * The four canonical Partners exist to isolate one outcome each, so most of
 * these assertions name a Partner rather than constructing a case.
 */

import { InMemoryLumanuProvider } from '@/providers';
import { CANONICAL, dollars, IDS } from '@/seed/canonical';

import { call, connect } from './support/mcp-client';

const WORKSPACE = { workspace_id: CANONICAL.workspace.id };

/** The canonical scenario with the Workspace Balance moved. */
function withBalance(cents: number): InMemoryLumanuProvider {
  return new InMemoryLumanuProvider({
    workspaces: [
      { ...CANONICAL.workspace, balance_cents: cents, available_balance_cents: cents },
    ],
  });
}

/** The canonical scenario with one Partner changed. Index matches `CANONICAL.partners`. */
function withPartner(
  index: number,
  patch: Partial<(typeof CANONICAL.partners)[number]>,
): InMemoryLumanuProvider {
  return new InMemoryLumanuProvider({
    partners: CANONICAL.partners.map((partner, at) =>
      at === index ? { ...partner, ...patch } : partner,
    ),
  });
}

async function readiness(partnerId: string, provider?: InMemoryLumanuProvider) {
  const client = await connect(provider);

  return call('get_partner_payment_readiness', { ...WORKSPACE, partner_id: partnerId }, client);
}

describe('get_partner_payment_readiness', () => {
  it('reports Maya as ready: onboarded, approved, and covered by the balance', async () => {
    const result = await readiness(IDS.maya);

    expect(result['state']).toBe('ready');
    expect(result['blocker']).toBeNull();
    expect(result['ready_amount']).toBe(dollars(2_500));
  });

  it('reports Alex as blocked by approval, a decision inside this Workspace', async () => {
    const result = await readiness(IDS.alex);

    expect(result['state']).toBe('blocked');
    expect(result['blocker']).toMatchObject({ code: 'payable_needs_approval' });
    // Approving is a Buyer decision here, and the resolution says so — but no
    // tool in this server performs it yet, so `resolvable_here` must not claim
    // one exists. Ticket 07 flips it when `approve_payable` is registered.
    expect((result['blocker'] as { resolution: string }).resolution).toMatch(/Approve the Payable/);
    expect(result['blocker']).toMatchObject({ resolvable_here: false });
  });

  it('reports Sarah as blocked by onboarding, which is not fixable here', async () => {
    const result = await readiness(IDS.sarah);

    expect(result['state']).toBe('blocked');
    expect(result['blocker']).toMatchObject({
      code: 'partner_onboarding_incomplete',
      resolvable_here: false,
    });
  });

  it('reports StudioX as already funded rather than as ready or blocked', async () => {
    const result = await readiness(IDS.studioX);

    expect(result['state']).toBe('already_funded');
    expect(result['blocker']).toBeNull();
    expect(result['ready_amount']).toBe(0);
  });

  /**
   * Sarah has no Payable at all. Keying these tools on Partner rather than on
   * Payable is what makes her reachable — a Payable-centric design would make
   * her invisible to precisely the question she exists to answer.
   */
  it('reaches a Partner who has no Payable at all', async () => {
    const result = await readiness(IDS.sarah);

    expect(result['partner_name']).toBe('Sarah Chen');
    expect(result['payables']).toEqual([]);
  });

  it('accounts for the Workspace Balance, not only the two statuses', async () => {
    const result = await readiness(IDS.maya, withBalance(dollars(100)));

    expect(result['state']).toBe('blocked');
    expect(result['blocker']).toMatchObject({
      code: 'insufficient_balance',
      resolvable_here: false,
    });
  });

  /**
   * Having nothing to pay is a reason you cannot pay someone, so it is a
   * blocker rather than a state of its own. A separate `nothing_owed` state
   * would report the same condition two different ways depending on whether
   * onboarding also happened to be incomplete.
   */
  it('reports an onboarded Partner with no Payable as blocked by having none', async () => {
    const result = await readiness(IDS.sarah, withPartner(2, { status: 'completed_w9' }));

    expect(result['state']).toBe('blocked');
    expect(result['blocker']).toMatchObject({ code: 'no_payable', resolvable_here: false });
  });

  it('shows the Payables the conclusion was drawn from', async () => {
    const result = await readiness(IDS.alex);

    expect(result['payables']).toEqual([
      { payable_id: IDS.alexPayable, amount: dollars(7_500), status: 'unapproved' },
    ]);
  });

  /**
   * A Payable names its Partner by Lumanu id, and a Partner who has not
   * finished onboarding has none — so the match falls back to the email
   * address. Both sides of that comparison are optional in Lumanu's schema, so
   * without a guard a Partner with no email would match every Payable naming
   * nobody, and inherit obligations that are not theirs.
   */
  it('attributes no Payable to a Partner it cannot identify', async () => {
    const result = await readiness(IDS.sarah, withPartner(2, { lumanu_id: null, email: '' }));

    expect(result['payables']).toEqual([]);
    expect(result['ready_amount']).toBe(0);
  });

  it('reports an unknown Partner as a tool error rather than as not ready', async () => {
    const client = await connect();

    const result = await client.callTool({
      name: 'get_partner_payment_readiness',
      arguments: { ...WORKSPACE, partner_id: '00000000-0000-4000-8000-000000000000' },
    });

    expect(result.isError).toBe(true);
  });
});

describe('explain_payment_blocker', () => {
  it('returns the single binding reason, not a list of everything wrong', async () => {
    const client = await connect(withBalance(dollars(1)));
    const result = await call(
      'explain_payment_blocker',
      { ...WORKSPACE, partner_id: IDS.sarah },
      client,
    );

    // Sarah's onboarding is incomplete, she has no Payable, and the balance is
    // a dollar. Three conditions fail; one answer comes back.
    expect(Array.isArray(result['blocker'])).toBe(false);
    expect(result['blocker']).toMatchObject({ code: 'partner_onboarding_incomplete' });
  });

  /**
   * Furthest upstream wins. Fixing a downstream condition while an upstream one
   * still fails changes nothing, so reporting the downstream one would send an
   * agent to do work that cannot help.
   */
  it('prefers onboarding over approval', async () => {
    const client = await connect(withPartner(1, { status: 'awaiting_w9_submission' }));

    const result = await call(
      'explain_payment_blocker',
      { ...WORKSPACE, partner_id: IDS.alex },
      client,
    );

    expect(result['blocker']).toMatchObject({ code: 'partner_onboarding_incomplete' });
  });

  it('prefers approval over the balance', async () => {
    const client = await connect(withBalance(dollars(1)));

    const result = await call(
      'explain_payment_blocker',
      { ...WORKSPACE, partner_id: IDS.alex },
      client,
    );

    expect(result['blocker']).toMatchObject({ code: 'payable_needs_approval' });
  });

  it('says plainly when nothing is blocking', async () => {
    const result = await call('explain_payment_blocker', {
      ...WORKSPACE,
      partner_id: IDS.maya,
    });

    expect(result['blocker']).toBeNull();
    expect(result['state']).toBe('ready');
  });

  /**
   * Two tools that returned the same payload would be the same tool under two
   * names, and an agent choosing between them would be choosing between
   * identical things. This one answers why; the amounts and the Payable
   * evidence are `get_partner_payment_readiness`'s answer.
   */
  it('answers more narrowly than the readiness tool it shares reasoning with', async () => {
    const client = await connect();
    const blocker = await call(
      'explain_payment_blocker',
      { ...WORKSPACE, partner_id: IDS.alex },
      client,
    );
    const full = await call(
      'get_partner_payment_readiness',
      { ...WORKSPACE, partner_id: IDS.alex },
      client,
    );

    expect(Object.keys(blocker).sort()).toEqual(['blocker', 'partner_id', 'partner_name', 'state']);
    expect(Object.keys(full).length).toBeGreaterThan(Object.keys(blocker).length);
    expect(blocker['blocker']).toEqual(full['blocker']);
  });

  it('states what would resolve each blocker', async () => {
    for (const partner of [IDS.alex, IDS.sarah]) {
      const result = await call('explain_payment_blocker', {
        ...WORKSPACE,
        partner_id: partner,
      });
      const blocker = result['blocker'] as { resolution: string; resolvable_here: boolean };

      expect(typeof blocker.resolution).toBe('string');
      expect(blocker.resolution.length).toBeGreaterThan(10);
      expect(typeof blocker.resolvable_here).toBe('boolean');
    }
  });
});

describe('get_funding_capacity', () => {
  it('totals only genuinely ready Payables, so blocked obligations do not inflate it', async () => {
    const capacity = await call('get_funding_capacity', WORKSPACE);

    // Maya alone is ready. Alex is unapproved, Sarah has nothing, StudioX is
    // already funded — $17,500 of obligations that must not be counted.
    expect(capacity['required_amount']).toBe(dollars(2_500));
    expect(capacity['ready_payable_count']).toBe(1);
  });

  /**
   * The count has to describe the Payables that make up the requirement, not
   * every Payable a ready Partner happens to hold. A Partner can be ready on
   * one while holding an unapproved one, and counting that would describe a
   * requirement that does not exist.
   */
  it('counts the Payables that make up the requirement, not the Partner’s other ones', async () => {
    const extra = {
      ...CANONICAL.payables[0]!,
      id: '9f8b1c34-0000-4000-8000-0000000000ff',
      amount_cents: dollars(400),
      status: 'unapproved',
      payable_status: 'not_approved',
    };
    const client = await connect(
      new InMemoryLumanuProvider({ payables: [...CANONICAL.payables, extra] }),
    );

    const capacity = await call('get_funding_capacity', WORKSPACE, client);

    expect(capacity['ready_payable_count']).toBe(1);
    expect(capacity['required_amount']).toBe(dollars(2_500));
  });

  it('answers whether the balance covers what is ready, and states the remainder', async () => {
    const capacity = await call('get_funding_capacity', WORKSPACE);

    expect(capacity['sufficient']).toBe(true);
    expect(capacity['available_balance']).toBe(dollars(15_000));
    expect(capacity['remainder']).toBe(dollars(12_500));
    expect(capacity['shortfall']).toBeNull();
  });

  it('states the shortfall when the balance does not cover it', async () => {
    const client = await connect(withBalance(dollars(1_000)));

    const capacity = await call('get_funding_capacity', WORKSPACE, client);

    expect(capacity['sufficient']).toBe(false);
    expect(capacity['shortfall']).toBe(dollars(1_500));
    expect(capacity['remainder']).toBeNull();
  });

  /**
   * The demo's opening question — "which Partners are currently ready to be
   * paid?" — is answered from this one call, including the Partner who has no
   * Payable and would otherwise not appear anywhere in a Payable-keyed answer.
   */
  it('accounts for every Partner, each with its own state', async () => {
    const capacity = await call('get_funding_capacity', WORKSPACE);
    const partners = capacity['partners'] as Array<{ partner_name: string; state: string }>;

    expect(
      Object.fromEntries(partners.map((partner) => [partner.partner_name, partner.state])),
    ).toEqual({
      'Maya Patel': 'ready',
      'Alex Rivera': 'blocked',
      'Sarah Chen': 'blocked',
      'StudioX LLC': 'already_funded',
    });
  });

  it('states the denomination rather than leaving the unit implicit', async () => {
    const capacity = await call('get_funding_capacity', WORKSPACE);

    expect(capacity['denomination']).toBe('us_cents');
  });

  /**
   * The reason this question needs asking separately at all. Two Partners can
   * each be individually affordable while their total is not, and nothing in a
   * per-Partner answer catches that.
   */
  it('catches a total the balance cannot cover even though each part fits', async () => {
    const approvedAlex = { ...CANONICAL.payables[1]!, status: 'approved' };
    const provider = new InMemoryLumanuProvider({
      workspaces: [
        {
          ...CANONICAL.workspace,
          balance_cents: dollars(8_000),
          available_balance_cents: dollars(8_000),
        },
      ],
      payables: [CANONICAL.payables[0]!, approvedAlex, CANONICAL.payables[2]!],
    });
    const client = await connect(provider);

    // Maya $2,500 and Alex $7,500 each fit inside $8,000. Together they do not.
    expect(
      (await call('get_partner_payment_readiness', { ...WORKSPACE, partner_id: IDS.maya }, client))[
        'state'
      ],
    ).toBe('ready');

    const capacity = await call('get_funding_capacity', WORKSPACE, client);
    expect(capacity['required_amount']).toBe(dollars(10_000));
    expect(capacity['sufficient']).toBe(false);
    expect(capacity['shortfall']).toBe(dollars(2_000));
  });

  /**
   * Capacity assesses each Partner on onboarding and approval only. If it also
   * required the balance to cover them, nothing unaffordable could ever be
   * "ready" and the shortfall above could never be reported — the question
   * would answer itself "yes, always". So a row here can say ready while the
   * total says the money is not there, and that is not a contradiction.
   */
  it('keeps the balance out of its Partner rows, or it could never report a shortfall', async () => {
    const client = await connect(withBalance(dollars(1_000)));

    const capacity = await call('get_funding_capacity', WORKSPACE, client);
    const maya = (capacity['partners'] as Array<{ partner_name: string; state: string }>).find(
      (partner) => partner.partner_name === 'Maya Patel',
    );

    expect(maya?.state).toBe('ready');
    expect(capacity['sufficient']).toBe(false);

    // Asked about Maya alone, the balance is part of the question and the
    // answer is different. Both are correct.
    const alone = await call(
      'get_partner_payment_readiness',
      { ...WORKSPACE, partner_id: IDS.maya },
      client,
    );
    expect(alone['state']).toBe('blocked');
  });
});

describe('the reasoning tools an agent sees', () => {
  it('advertises all three', async () => {
    const { tools } = await (await connect()).listTools();
    const names = tools.map((tool) => tool.name);

    expect(names).toContain('get_partner_payment_readiness');
    expect(names).toContain('explain_payment_blocker');
    expect(names).toContain('get_funding_capacity');
  });

  it('never says Vendor, payee or Wallet where an agent can read it', async () => {
    const { tools } = await (await connect()).listTools();
    const reasoning = tools.filter((tool) => /readiness|blocker|capacity/.test(tool.name));
    const visible = JSON.stringify(reasoning);

    expect(visible).not.toMatch(/\bvendor\b/i);
    expect(visible).not.toMatch(/\bpayee\b/i);
    expect(visible).not.toMatch(/\bwallet\b/i);
  });

  /**
   * `paid` is in Lumanu's enum and no flow here produces it. A conclusion is
   * exactly the place an invented state would look most convincing.
   */
  it('never reports a state the scenario cannot produce', async () => {
    const capacity = await call('get_funding_capacity', WORKSPACE);

    expect(JSON.stringify(capacity)).not.toContain('"paid"');
  });
});
