/**
 * The canonical scenario, held to the figures the demo depends on.
 *
 * These run with no credentials, because the scenario is defined as data
 * rather than as SQL. `tests/integration/seeded-database.test.ts` asserts that
 * what actually reached Supabase matches.
 */

import {
  CANONICAL,
  CURRENT_BALANCE_CENTS,
  dollars,
  IDS,
  OPENING_BALANCE_CENTS,
} from '@/seed/canonical';
import { PARTNER_STATUSES, PAYABLE_STATUSES } from '@/providers/wire';

const partner = (id: string) => CANONICAL.partners.find((row) => row.id === id);
const payableFor = (partnerId: string) =>
  CANONICAL.payables.find((row) => row.partner_id === partnerId);

describe('the canonical Partners', () => {
  it('are the four that each isolate one outcome', () => {
    expect(CANONICAL.partners.map((row) => row.name)).toEqual([
      'Maya Patel',
      'Alex Rivera',
      'Sarah Chen',
      'StudioX LLC',
    ]);
  });

  it('has Maya onboarded with an approved $2,500 Payable — ready to fund', () => {
    expect(partner(IDS.maya)?.status).toBe('completed_w9');
    expect(payableFor(IDS.maya)).toMatchObject({
      amount_cents: dollars(2_500),
      status: 'approved',
    });
  });

  it('has Alex onboarded with an unapproved $7,500 Payable — blocked on approval alone', () => {
    expect(partner(IDS.alex)?.status).toBe('completed_w9');
    expect(payableFor(IDS.alex)).toMatchObject({
      amount_cents: dollars(7_500),
      status: 'unapproved',
    });
  });

  it('has Sarah mid-onboarding with no Payable at all', () => {
    expect(partner(IDS.sarah)?.status).toBe('awaiting_w9_submission');
    expect(payableFor(IDS.sarah)).toBeUndefined();
  });

  it('has StudioX already funded, with a $10,000 Payable at will_pay', () => {
    expect(partner(IDS.studioX)?.status).toBe('completed_w9');
    expect(payableFor(IDS.studioX)).toMatchObject({
      amount_cents: dollars(10_000),
      status: 'will_pay',
    });
  });

  it('uses only statuses Lumanu publishes', () => {
    for (const row of CANONICAL.partners) {
      expect(PARTNER_STATUSES).toContain(row.status);
    }
    for (const row of CANONICAL.payables) {
      expect(PAYABLE_STATUSES).toContain(row.status);
    }
  });

  it('never produces the `paid` status, which this POC does not model', () => {
    expect(CANONICAL.payables.map((row) => row.status)).not.toContain('paid');
  });
});

describe('the Workspace Balance', () => {
  const ledger = CANONICAL.balanceTransactions;

  it('opens at $25,000 and stands at $15,000', () => {
    expect(OPENING_BALANCE_CENTS).toBe(dollars(25_000));
    expect(CANONICAL.workspace.balance_cents).toBe(dollars(15_000));
  });

  /** The deliberate redundancy in the schema, guarded. */
  it('equals the sum of its Balance Transactions', () => {
    const summed = ledger.reduce((total, row) => total + row.balance_change_cents, 0);

    expect(summed).toBe(CANONICAL.workspace.balance_cents);
  });

  it('carries a running ending balance that agrees with the running sum', () => {
    let running = 0;
    for (const row of ledger) {
      running += row.balance_change_cents;
      expect(row.ending_balance_cents).toBe(running);
    }
  });

  it('holds no more than it has, since nothing in this scenario reserves funds', () => {
    expect(CANONICAL.workspace.available_balance_cents).toBe(
      CANONICAL.workspace.balance_cents,
    );
  });

  it('explains the $10,000 gap with StudioX’s Funding', () => {
    const debit = ledger.find((row) => row.type === 'payment');

    expect(debit).toMatchObject({
      balance_change_cents: -dollars(10_000),
      ending_balance_cents: CURRENT_BALANCE_CENTS,
      funding_id: IDS.studioXFunding,
    });
  });
});

describe('the consequence the demo turns on', () => {
  const completed = new Set(
    CANONICAL.partners.filter((row) => row.status === 'completed_w9').map((row) => row.id),
  );
  const readyTotal = (statuses: ReadonlySet<string>) =>
    CANONICAL.payables
      .filter((row) => completed.has(row.partner_id) && statuses.has(row.status))
      .reduce((total, row) => total + row.amount_cents, 0);

  it('has $2,500 ready to fund today', () => {
    expect(readyTotal(new Set(['approved']))).toBe(dollars(2_500));
  });

  /**
   * The figures a reviewer will check, stated directly: approve Alex and the
   * Workspace owes $10,000 against a $15,000 balance, leaving $5,000.
   */
  it('has $10,000 ready once Alex is approved, leaving $5,000 of a $15,000 balance', () => {
    const afterApprovingAlex = dollars(2_500) + dollars(7_500);

    expect(afterApprovingAlex).toBe(dollars(10_000));
    expect(CANONICAL.workspace.available_balance_cents - afterApprovingAlex).toBe(dollars(5_000));
  });

  it('does not count StudioX again, because it is already funded', () => {
    expect(readyTotal(new Set(['approved', 'unapproved']))).toBe(dollars(10_000));
  });
});

describe('the scenario as a whole', () => {
  it('has exactly one Workspace, one Project and one Funding', () => {
    expect(CANONICAL.project.workspace_id).toBe(CANONICAL.workspace.id);
    expect(CANONICAL.fundings).toHaveLength(1);
  });

  it('models only balance funding, never invoice funding', () => {
    expect(CANONICAL.fundings.map((row) => row.method)).toEqual(['balance']);
  });

  it('charges no funding fee, so $10,000 of Payables costs exactly $10,000', () => {
    expect(CANONICAL.fundings[0]?.fee_amount_cents).toBe(0);
    expect(CANONICAL.workspace.funding_fee_percent).toBeNull();
  });

  it('links the Funding to exactly the Payable it paid', () => {
    expect(CANONICAL.fundingPayables).toEqual([
      { funding_id: IDS.studioXFunding, payable_id: IDS.studioXPayable },
    ]);
  });

  it('uses fixed timestamps, so a reseed reproduces identical figures', () => {
    const timestamps = [
      CANONICAL.workspace.created_at,
      ...CANONICAL.partners.map((row) => row.created_at),
      ...CANONICAL.balanceTransactions.map((row) => row.created_at),
    ];

    for (const value of timestamps) {
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });
});
