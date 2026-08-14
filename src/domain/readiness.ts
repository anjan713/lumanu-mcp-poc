/**
 * Payment Readiness, Payment Blocker and Funding Capacity.
 *
 * None of these is a Lumanu field. Each is a conclusion reached by combining
 * Partner Status, Payable Status and the Workspace Balance — the three things
 * that between them decide whether money can move — and this file is the one
 * place that combining happens. An agent asked to work it out from the read
 * tools would reach the same answer on a good day and a different one on a bad
 * day, which is the whole reason this exists.
 *
 * Everything here reads Lumanu-shaped objects through `LumanuProvider` and
 * nothing else. See ADR 0001.
 *
 * Keyed on **Partner**, not Payable. `CONTEXT.md` defines Payment Readiness as
 * a property of a Payable, and that is right — but a Partner with no Payable is
 * a real and important case, and a Payable-keyed answer cannot express it. So
 * the concepts stay as the glossary defines them and the entry point is the
 * Partner, which is the thing a Buyer actually asks about.
 */

import {
  US_CENTS,
  type LumanuProvider,
  type Partner,
  type Payable,
  type PayableStatus,
} from '@/providers';

import { collectAll } from './collect';
import { OPEN_STATUSES } from './payables';

/** The onboarding and tax state a Partner must reach before money can move. */
const PAYABLE_PARTNER_STATUS = 'completed_w9';

/**
 * Every blocker, in precedence order — furthest upstream first.
 *
 * Only the binding reason is ever reported. Fixing a downstream condition while
 * an upstream one still fails changes nothing, so naming the downstream one
 * would send a Buyer to do work that cannot help: approving a Payable for a
 * Partner who cannot legally be paid moves nobody closer to being paid.
 *
 * `no_payable` and `payable_needs_approval` are the same rung of the ladder —
 * in both, there is nothing approved to fund. They stay separate codes because
 * the actions differ: raise a Payable, or approve the one that exists.
 */
export const BLOCKER_PRECEDENCE = [
  'partner_onboarding_incomplete',
  'no_payable',
  'payable_needs_approval',
  'insufficient_balance',
] as const;

export type BlockerCode = (typeof BLOCKER_PRECEDENCE)[number];

/**
 * Where a Partner stands. Three outcomes, not two: "not ready" would put
 * StudioX — already funded, nothing wrong — in the same bucket as Sarah, whose
 * onboarding is incomplete, and those call for opposite responses.
 *
 * There is deliberately no state for "onboarded but owed nothing". That is a
 * reason a Partner cannot be paid, so it is the `no_payable` blocker rather
 * than a state of its own; having both would mean the same condition was
 * reported two different ways depending on what else was wrong.
 */
export type ReadinessState = 'ready' | 'blocked' | 'already_funded';

export interface PaymentBlocker {
  readonly code: BlockerCode;
  readonly reason: string;
  /**
   * Whether a tool **in this server** can clear it. True only where one is
   * actually registered, so an agent is never sent looking for a tool that does
   * not exist — `resolution` names it when there is one.
   */
  readonly resolvable_here: boolean;
  readonly resolution: string;
}

export interface PartnerPaymentReadiness {
  readonly partner_id: string;
  readonly partner_name: string;
  readonly partner_status: string | null;
  readonly state: ReadinessState;
  /** What could be funded for this Partner right now. Zero unless `state` is `ready`. */
  readonly ready_amount: number;
  /** How many Payables make up `ready_amount`. Zero unless `state` is `ready`. */
  readonly ready_payable_count: number;
  readonly denomination: string;
  /** The single binding reason, or null. Never a list — see the precedence below. */
  readonly blocker: PaymentBlocker | null;
  /** The Payables the conclusion was drawn from, so it can be checked. */
  readonly payables: ReadonlyArray<{ payable_id: string; amount: number; status: string }>;
}

const BLOCKERS: Record<BlockerCode, Omit<PaymentBlocker, 'code'>> = {
  partner_onboarding_incomplete: {
    reason: 'The Partner has not completed onboarding and tax verification.',
    // The Partner submits their own tax documents. No tool here can do it for
    // them, and reporting otherwise would send a Buyer looking for one.
    resolvable_here: false,
    resolution:
      'The Partner must complete onboarding and tax verification. This happens outside ' +
      'this Workspace, and no tool here can do it on their behalf.',
  },
  no_payable: {
    reason: 'The Partner has no outstanding Payable.',
    resolvable_here: false,
    resolution:
      'Raise a Payable for the work owed. Creating Payables is outside the scope of this ' +
      'server.',
  },
  payable_needs_approval: {
    reason: 'The Partner’s Payable has not been approved.',
    // The only one of the four this server can clear itself.
    resolvable_here: true,
    resolution:
      'Approve the Payable with approve_payable. This is a Buyer decision inside this ' +
      'Workspace and needs no action elsewhere.',
  },
  insufficient_balance: {
    reason: 'The Workspace Balance does not cover what is owed to this Partner.',
    // Topping the balance up is invoice funding, which this POC does not model.
    resolvable_here: false,
    resolution:
      'Add funds to the Workspace Balance. Doing so is outside the scope of this server.',
  },
};

/**
 * Passed where the Workspace Balance is deliberately not part of the test.
 * Named, because a bare `null` reads as "unknown" and this means "do not ask".
 */
const IGNORE_BALANCE = null;

export async function partnerPaymentReadiness(
  provider: LumanuProvider,
  workspaceId: string,
  partnerId: string,
): Promise<PartnerPaymentReadiness> {
  const [partner, payables, account] = await Promise.all([
    provider.getPartner(workspaceId, partnerId),
    payablesOfWorkspace(provider, workspaceId),
    provider.getWorkspaceBalance(workspaceId),
  ]);

  return assess(
    partner,
    forPartner(payables, partner),
    account.denomination ?? US_CENTS,
    account.balance?.available_balance ?? 0,
  );
}

export interface FundingCapacity {
  readonly workspace_id: string;
  readonly available_balance: number;
  readonly denomination: string;
  /** The total of every Payable that is genuinely ready — nothing blocked. */
  readonly required_amount: number;
  readonly ready_payable_count: number;
  readonly sufficient: boolean;
  /** What would be left afterwards, when the balance covers it. */
  readonly remainder: number | null;
  /** What is missing, when it does not. */
  readonly shortfall: number | null;
  /** Every Partner, so the one with no Payable is still accounted for. */
  readonly partners: readonly PartnerPaymentReadiness[];
}

/**
 * Whether the balance covers everything currently ready.
 *
 * **Readiness here excludes the balance, deliberately.** `partnerPaymentReadiness`
 * asks "can I pay this person right now", and the money being there is part of
 * that. This asks "does the money cover what is ready", and if readiness already
 * required the money to be there, then nothing unaffordable could ever be ready
 * and the answer would be "yes, always" — the shortfall this exists to report
 * could never be reported. So the Partner rows below are assessed on onboarding
 * and approval only, and the balance is the thing this function reports on
 * rather than an input to the rows.
 *
 * The two together read correctly: a row says the work is ready, and the total
 * says whether the money is.
 */
export async function fundingCapacity(
  provider: LumanuProvider,
  workspaceId: string,
): Promise<FundingCapacity> {
  const [partners, payables, account] = await Promise.all([
    collectAll<Partner>((query) => provider.listPartners(workspaceId, query)),
    payablesOfWorkspace(provider, workspaceId),
    provider.getWorkspaceBalance(workspaceId),
  ]);

  const available = account.balance?.available_balance ?? 0;
  const denomination = account.denomination ?? US_CENTS;
  const assessed = partners.map((partner) =>
    assess(partner, forPartner(payables, partner), denomination, IGNORE_BALANCE),
  );

  const ready = assessed.filter((partner) => partner.state === 'ready');
  const required = ready.reduce((total, partner) => total + partner.ready_amount, 0);
  const sufficient = available >= required;

  return {
    workspace_id: workspaceId,
    available_balance: available,
    denomination,
    required_amount: required,
    // The Payables that make up `required_amount`, not every Payable belonging
    // to a ready Partner — a Partner can be ready on one Payable while holding
    // an unapproved and an already-funded one, and counting those would
    // describe a requirement that does not exist.
    ready_payable_count: ready.reduce((count, partner) => count + partner.ready_payable_count, 0),
    sufficient,
    remainder: sufficient ? available - required : null,
    shortfall: sufficient ? null : required - available,
    partners: assessed,
  };
}

/**
 * The whole assessment for one Partner, given their open Payables and what the
 * Workspace can spend. Pure, and the only place the precedence is applied.
 *
 * `availableBalance` is `null` when the balance is deliberately not part of the
 * test — see `fundingCapacity`, where including it would make the question it
 * exists to answer unanswerable.
 */
function assess(
  partner: Partner,
  payables: readonly Payable[],
  denomination: string,
  availableBalance: number | null,
): PartnerPaymentReadiness {
  const open = payables.filter((payable) =>
    OPEN_STATUSES.includes(payable.status as PayableStatus),
  );
  const approved = open.filter((payable) => payable.status === 'approved');
  const owed = approved.reduce((total, payable) => total + (payable.amount ?? 0), 0);

  const failing = [
    partner.status === PAYABLE_PARTNER_STATUS ? null : 'partner_onboarding_incomplete',
    open.length === 0 ? 'no_payable' : null,
    open.length > 0 && approved.length === 0 ? 'payable_needs_approval' : null,
    availableBalance !== null && approved.length > 0 && owed > availableBalance
      ? 'insufficient_balance'
      : null,
  ].filter((code): code is BlockerCode => code !== null);

  const base = {
    partner_id: partner.id ?? '',
    partner_name: partner.name ?? '',
    partner_status: partner.status ?? null,
    denomination,
    // Every Payable, not only the open ones: the funded one is what explains an
    // `already_funded` answer, so leaving it out would make that unreadable.
    payables: payables.map((payable) => ({
      payable_id: payable.id ?? '',
      amount: payable.amount ?? 0,
      status: payable.status ?? 'unknown',
    })),
  };

  const [first, ...rest] = failing;

  if (first === undefined) {
    return {
      ...base,
      state: 'ready',
      ready_amount: owed,
      ready_payable_count: approved.length,
      blocker: null,
    };
  }

  // Reported only when nothing upstream is wrong. A Partner whose onboarding
  // lapsed after being funded is blocked, and saying "already funded" would
  // hide that.
  const settled =
    rest.length === 0 &&
    first === 'no_payable' &&
    payables.some((payable) => payable.status === 'will_pay');

  if (settled) {
    return { ...base, state: 'already_funded', ready_amount: 0, ready_payable_count: 0, blocker: null };
  }

  return {
    ...base,
    state: 'blocked',
    ready_amount: 0,
    ready_payable_count: 0,
    blocker: bindingBlocker([first, ...rest]),
  };
}

/**
 * The failing condition furthest upstream. Never a list.
 *
 * Takes a non-empty array so that "the blocker of a Partner with none" cannot
 * be asked for, which is what lets this return a `PaymentBlocker` rather than
 * one that might be absent.
 */
function bindingBlocker(failing: readonly [BlockerCode, ...BlockerCode[]]): PaymentBlocker {
  const code = BLOCKER_PRECEDENCE.find((candidate) => failing.includes(candidate)) ?? failing[0];

  return { code, ...BLOCKERS[code] };
}

/**
 * Lumanu's Payable carries no `partner_id`, so the Partner is matched the way
 * Lumanu names them: by Lumanu id where the Partner has one, and by email
 * otherwise. A Partner who has not finished onboarding has no Lumanu id, which
 * is why the fallback exists rather than being defensive padding.
 */
function forPartner(payables: readonly Payable[], partner: Partner): readonly Payable[] {
  // Either identifier is enough, and neither is always present. A Partner has
  // no Lumanu id until onboarding completes, and a Payable raised before that
  // can carry the email address without one — so matching on the Lumanu id
  // alone would make those Payables invisible and report the Partner as owed
  // nothing.
  //
  // Empty values match nothing rather than matching each other. Both fields are
  // optional in Lumanu's schema, so without this a Partner with no email would
  // collect every Payable that names nobody.
  const lumanuId = partner.lumanu_id ?? '';
  const email = partner.email ?? '';

  return payables.filter(
    (payable) =>
      (lumanuId !== '' && payable.payee_lumanu_id === lumanuId) ||
      (email !== '' && payable.vendor_email === email),
  );
}

function payablesOfWorkspace(
  provider: LumanuProvider,
  workspaceId: string,
): Promise<Payable[]> {
  return collectAll<Payable>((query) =>
    provider.listPayables({ ...query, workspace_id: workspaceId }),
  );
}
