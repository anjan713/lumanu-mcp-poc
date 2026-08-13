/**
 * The harvested contract, held to.
 *
 * Two kinds of drift are caught here. Lumanu changing its published contract
 * shows up when a re-harvest makes one of these assertions fail. This project
 * drifting away from Lumanu shows up when a value shaped the way the seed and
 * the provider mapping intend to shape it stops validating.
 */

import type {
  Account,
  Partner,
  Payable,
  Transaction,
  Workspace,
  ListPayablesResponse,
} from '@/providers/wire';
import { PARTNER_STATUSES, PAYABLE_STATUSES } from '@/providers/wire';
import spec from '../docs/lumanu-reference/openapi.json';
import {
  declaredEnum,
  declaredFields,
  expectMatchesLumanuSchema,
  LUMANU_SCHEMA_NAMES,
  publishedExamples,
} from './support/lumanu-schema';

describe('the cached Lumanu contract', () => {
  it('covers every entity the provider surface needs', () => {
    expect(LUMANU_SCHEMA_NAMES.sort()).toEqual([
      'Account',
      'Funding',
      'Partner',
      'PartnerDetail',
      'Payable',
      'Project',
      'ProjectDetail',
      'Transaction',
      'Workspace',
    ]);
  });

  it("validates Lumanu's own published examples against Lumanu's own schemas", () => {
    const checked = LUMANU_SCHEMA_NAMES.flatMap((name) =>
      publishedExamples(name).map((example) => {
        expectMatchesLumanuSchema(name, example);
        return name;
      }),
    );

    // Guards the sweep itself: an extraction that mangled the cache would
    // leave nothing to check and the loop above would pass vacuously.
    expect(checked.length).toBeGreaterThan(0);
  });
});

describe('monetary amounts', () => {
  it('are integers in an explicitly named unit, never decimals', () => {
    const wholeCents: Transaction = {
      amount: 250_000,
      amount_denomination: 'us_cents',
      balance_change: -250_000,
      ending_balance: 1_250_000,
    };

    expectMatchesLumanuSchema('Transaction', wholeCents);
    expect(() =>
      expectMatchesLumanuSchema('Transaction', { ...wholeCents, amount: 2500.5 }),
    ).toThrow(/Transaction schema/);
  });

  it('names a unit Lumanu recognises', () => {
    expect(() =>
      expectMatchesLumanuSchema('Transaction', { amount: 1, amount_denomination: 'usd' }),
    ).toThrow(/amount_denomination/);
  });

  it('states the unit on the Workspace Balance too', () => {
    const balance: Account = {
      balance: { available_balance: 1_500_000, balance: 1_500_000 },
      display_name: 'Acme US',
      denomination: 'us_cents',
    };

    expectMatchesLumanuSchema('Account', balance);
  });
});

describe('the canonical Acme scenario, in Lumanu wire format', () => {
  const workspaceId = '11111111-1111-4111-8111-111111111111';

  it("matches Lumanu's Workspace schema", () => {
    const acme: Workspace = {
      id: workspaceId,
      display_name: 'Acme US',
      funding_fee_percent: null,
      additive_funding_fee: null,
      vendor_invite_url: 'https://app.lumanu.com/invite/acme-us',
      created_at: '2026-01-05T09:00:00Z',
      updated_at: '2026-01-05T09:00:00Z',
    };

    expectMatchesLumanuSchema('Workspace', acme);
  });

  it("matches Lumanu's Partner schema, including a Partner mid-onboarding", () => {
    const sarah: Partner = {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Sarah Chen',
      email: 'sarah.chen@example.com',
      status: 'awaiting_w9_submission',
      tax_origin_country: 'US',
      tags: [],
      has_approval_grant: false,
    };

    expectMatchesLumanuSchema('Partner', sarah);
  });

  it('accepts a Partner with no status at all, because Lumanu allows null', () => {
    expectMatchesLumanuSchema('Partner', { name: 'Newly invited', status: null });
  });

  it("matches Lumanu's Payable schema for Maya's approved $2,500", () => {
    const maya: Payable = {
      id: '33333333-3333-4333-8333-333333333333',
      workspace_id: workspaceId,
      vendor_email: 'maya.patel@example.com',
      vendor_display_name: 'Maya Patel',
      amount: 250_000,
      amount_denomination: 'us_cents',
      description: 'Summer Creator Campaign — Instagram deliverables',
      status: 'approved',
    };

    expectMatchesLumanuSchema('Payable', maya);
    expect(maya.amount).toBe(2500 * 100);
  });

  it('rejects a Payable missing a field Lumanu requires', () => {
    expect(() =>
      expectMatchesLumanuSchema('Payable', { workspace_id: workspaceId, amount: 250_000 }),
    ).toThrow(/description/);
  });

  it('rejects a Payable status this project invented', () => {
    expect(() =>
      expectMatchesLumanuSchema('Payable', {
        workspace_id: workspaceId,
        amount: 250_000,
        description: 'Summer Creator Campaign',
        status: 'funded',
      }),
    ).toThrow(/status/);
  });

  it("matches Lumanu's Transaction schema for the $10,000 StudioX funding debit", () => {
    const studioXDebit: Transaction = {
      id: '44444444-4444-4444-8444-444444444444',
      description: 'Funding — StudioX LLC',
      amount: 1_000_000,
      amount_denomination: 'us_cents',
      balance_change: -1_000_000,
      ending_balance: 1_500_000,
      status: 'processed',
      type: 'payment',
      created_at: '2026-02-01T12:00:00Z',
    };

    expectMatchesLumanuSchema('Transaction', studioXDebit);
    expect(studioXDebit.ending_balance).toBe(2_500_000 - 1_000_000);
  });
});

describe("Lumanu's list envelope", () => {
  it('wraps list results with the paging figures, not a bare array', () => {
    const page: ListPayablesResponse = {
      data: [
        {
          workspace_id: '11111111-1111-4111-8111-111111111111',
          amount: 250_000,
          description: 'Summer Creator Campaign — Instagram deliverables',
          status: 'approved',
        },
      ],
      total: 4,
      limit: 25,
      offset: 0,
    };

    expect(Object.keys(page).sort()).toEqual(['data', 'limit', 'offset', 'total']);
    for (const payable of page.data ?? []) expectMatchesLumanuSchema('Payable', payable);
  });
});

describe('the status vocabularies the domain layer reasons over', () => {
  // Compared against the cached fragment rather than against a second copy of
  // the same list. A hand-written expectation would only prove this file and
  // `wire.ts` agree with each other, which is not the thing at risk.
  it("are exactly Lumanu's Partner statuses", () => {
    const published = [...(declaredEnum('Partner', 'status') ?? [])].sort();

    expect(published).toHaveLength(6);
    expect([...PARTNER_STATUSES].sort()).toEqual(published);
  });

  it("are exactly Lumanu's Payable statuses, including the `paid` this POC never produces", () => {
    const published = [...(declaredEnum('Payable', 'status') ?? [])].sort();

    expect([...PAYABLE_STATUSES].sort()).toEqual(published);
    expect(PAYABLE_STATUSES).toContain('paid');
  });
});

/**
 * Validation alone cannot catch a field being renamed or removed: Lumanu marks
 * almost nothing `required` and forbids no additional properties, so an object
 * missing a field still validates. These assertions pin the field names the
 * provider mapping will read, so a re-harvest that renames one fails here —
 * loudly, and pointing at the field.
 */
describe('the fields the provider depends on', () => {
  it.each([
    ['Workspace', ['additive_funding_fee', 'display_name', 'funding_fee_percent', 'id']],
    ['Partner', ['email', 'id', 'lumanu_id', 'name', 'status', 'tax_origin_country']],
    ['PartnerDetail', ['email', 'has_wallet', 'name', 'payables_count', 'status']],
    [
      'Payable',
      [
        'amount',
        'amount_denomination',
        'description',
        'id',
        'payable_status',
        'project_id',
        'status',
        'vendor_email',
        'vendor_status',
        'workspace_id',
      ],
    ],
    ['Account', ['balance', 'denomination', 'display_name']],
    [
      'Transaction',
      ['amount', 'amount_denomination', 'balance_change', 'ending_balance', 'id', 'status', 'type'],
    ],
    ['Funding', ['amount', 'method', 'payable_ids', 'status', 'workspace_id']],
    ['Project', ['budget_amount', 'budget_denomination', 'id', 'name']],
  ] as const)('are all still declared on %s', (schema, expected) => {
    const declared = declaredFields(schema);
    expect(declared).toEqual(expect.arrayContaining([...expected]));
  });

  it('reports the Workspace Balance as an object of two figures, not a number', () => {
    const balance = spec.components.schemas.Account.properties.balance;

    expect(Object.keys(balance.properties).sort()).toEqual(['available_balance', 'balance']);
  });
});
