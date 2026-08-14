/**
 * The vocabulary the write implementations use.
 *
 * The rules themselves cannot be shared: `InMemoryLumanuProvider` enforces them
 * in TypeScript and `MockLumanuProvider` enforces them inside a PostgreSQL
 * function, because only the database can make the whole operation atomic (ADR
 * 0005). The contract suite is what keeps the two honest.
 *
 * These constants only reach the TypeScript half. `db/migrations/0002` spells
 * the same values out in SQL, because a migration cannot import from `src/`.
 * That is worth stating rather than glossing: this file removes one source of
 * drift, not the source of drift, and a test asserts the audit names the
 * database actually writes rather than trusting these.
 */

/** The one Partner Status that allows money to move. */
export const ONBOARDED = 'completed_w9';

/**
 * Audit event names, in the style of Lumanu's webhook events, so a future real
 * integration has an obvious place to land inbound events.
 *
 * A caveat worth keeping: these are **not harvested**. No webhook reference was
 * among the fourteen pages this project extracted its contract from, so unlike
 * every field name and enum in `wire.ts` these are our convention rather than a
 * verified fact. `docs/03` names `payable.created`, `payable.approved` and
 * `payable.paid`; `payable.paid` is not used, because funding in this POC moves
 * a Payable to `will_pay` and no flow reaches `paid`.
 */
export const AUDIT = {
  approved: 'payable.approved',
  canceled: 'payable.canceled',
  funded: 'funding.created',
} as const;
