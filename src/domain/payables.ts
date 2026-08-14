/**
 * Payable arithmetic, computed from Lumanu-shaped Payables.
 *
 * None of this can live in the provider. Lumanu publishes no status filter on
 * its Payables endpoint and no totals of any kind, so a provider offering
 * either would be making a promise `RealLumanuProvider` could not keep. These
 * functions take what Lumanu does return and do the counting here — which is
 * exactly the division ADR 0001 describes.
 *
 * A note on vocabulary: nothing here is named `paid`. `will_pay` is this POC's
 * funded terminal state, and settlement is evidenced by a Funding and its
 * Balance Transaction. Lumanu's enum does contain `paid`, but no flow in this
 * project produces it, so no summary reports it.
 */

import { US_CENTS, type Payable, type PayableStatus } from '@/providers';

import { groupByStatus } from './group';

/** Statuses that still represent money the Workspace expects to pay out. */
const OPEN_STATUSES: readonly PayableStatus[] = ['unapproved', 'approved'];

export interface StatusTotal {
  readonly status: string;
  readonly count: number;
  readonly amount: number;
}

export interface PayableTotals {
  /**
   * Every Payable, cancelled ones included — it is a count of records, not of
   * money. The amounts below all exclude cancellations, which is why a
   * Workspace can report three Payables and the committed total of two.
   */
  readonly count: number;
  /** Everything not cancelled — what the Workspace has committed to pay. */
  readonly committed_amount: number;
  /** Already drawn from the Workspace Balance: Payables in `will_pay`. */
  readonly funded_amount: number;
  /** Committed but not yet funded — what is still owed. */
  readonly outstanding_amount: number;
  readonly by_status: readonly StatusTotal[];
  readonly denomination: string;
}

export function filterByStatus(payables: readonly Payable[], status?: string): readonly Payable[] {
  return status === undefined ? payables : payables.filter((payable) => payable.status === status);
}

export function totalsOf(payables: readonly Payable[]): PayableTotals {
  const live = payables.filter((payable) => payable.status !== 'canceled');

  return {
    count: payables.length,
    committed_amount: sum(live),
    funded_amount: sum(live.filter((payable) => payable.status === 'will_pay')),
    outstanding_amount: sum(
      live.filter((payable) => OPEN_STATUSES.includes(payable.status as PayableStatus)),
    ),
    by_status: byStatus(payables),
    // Stated rather than implied. Lumanu leaves `amount_denomination` an
    // unconstrained string on Payable, so it is read from the data rather
    // than assumed.
    denomination: payables[0]?.amount_denomination ?? US_CENTS,
  };
}

function sum(payables: readonly Payable[]): number {
  return payables.reduce((total, payable) => total + (payable.amount ?? 0), 0);
}

function byStatus(payables: readonly Payable[]): readonly StatusTotal[] {
  return groupByStatus(payables).map(({ status, items }) => ({
    status,
    count: items.length,
    amount: sum(items),
  }));
}
