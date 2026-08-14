/**
 * What a Partner's record looks like once it leaves the server.
 *
 * The provider returns exactly what Lumanu returns, contact details included —
 * that fidelity is the point of ADR 0001 and is not negotiable at the boundary.
 * Deciding what an agent actually needs is a different job, and it belongs
 * here, at the edge where a record becomes something a model reads and a client
 * may log.
 *
 * The rule is need, not sensitivity: a question about who is ready to be paid
 * is answered by names and statuses, so an email address in the answer is
 * personal data spent for nothing. A lookup of one Partner is a different
 * question, and the contact address is part of what was asked for.
 *
 * `notes` is withheld from both. It is free text written by a Buyer about a
 * Partner, it answers no question this server offers, and it is the field most
 * likely to hold something nobody meant to publish.
 */

import type { Partner, PartnerDetail, Payable } from '@/providers';

/** Fields no tool result carries, whatever the question. */
const ALWAYS_WITHHELD = ['notes'] as const;

/** Fields a list result withholds, being about a set rather than a person. */
const WITHHELD_FROM_LISTS = [...ALWAYS_WITHHELD, 'email', 'emails'] as const;

export function partnerForList(partner: Partner): Partner {
  return without(partner, WITHHELD_FROM_LISTS);
}

export function partnerForDetail(partner: PartnerDetail): PartnerDetail {
  return without(partner, ALWAYS_WITHHELD);
}

/**
 * A Payable names its Partner three ways, and one of them is an email address.
 *
 * The same rule applies as to a list of Partners, and for the same reason: a
 * page of Payables is about amounts and approval states, and
 * `vendor_display_name` with `payee_lumanu_id` already say who each one is
 * owed to. Without this, `list_payables` would hand back every contact address
 * that `list_partners` had just withheld — which would make the withholding
 * decorative.
 */
export function payableForList(payable: Payable): Payable {
  return without(payable, ['vendor_email']);
}

function without<T extends object>(value: T, keys: readonly string[]): T {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.includes(key)),
  ) as T;
}
