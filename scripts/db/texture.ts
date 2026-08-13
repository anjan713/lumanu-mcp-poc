/**
 * The generated records that sit around the canonical scenario.
 *
 * Separate from `seed.ts` so it can be imported without side effects — that
 * file runs the seed on import, and a test that pulled it in would rewrite the
 * database.
 *
 * Texture exists so the demo does not look like a four-row fixture. It is
 * constrained so it cannot change what the demo demonstrates: generated
 * Partners are never `completed_w9` and generated Payables are never
 * `approved`, so nothing here can enter the ready-to-fund total. It introduces
 * no second Workspace, no second Project and no other funding model.
 */

import { faker } from '@faker-js/faker';

import { SEED_EPOCH, dollars, IDS } from '../../src/seed/canonical';

/** Fixed, so a reseed reproduces byte-identical rows. */
const FAKER_SEED = 713;
const TEXTURE_PARTNERS = 6;

/** Statuses a generated Partner may hold — `completed_w9` is excluded. */
export const TEXTURE_PARTNER_STATUSES = [
  'awaiting_w9_submission',
  'in_process',
  'missing_metadata_file_us_taxes',
  'awaiting_w8_submission',
  'w8_submitted',
] as const;

/** Statuses a generated Payable may hold — `approved` and `will_pay` are excluded. */
export const TEXTURE_PAYABLE_STATUSES = ['unapproved', 'canceled'] as const;

const at = (dayOffset: number, hour: number): string =>
  new Date(Date.parse(SEED_EPOCH) + dayOffset * 86_400_000 + hour * 3_600_000).toISOString();

export interface TextureRecords {
  readonly partners: ReadonlyArray<Record<string, unknown>>;
  readonly payables: ReadonlyArray<Record<string, unknown>>;
}

export function generateTexture(): TextureRecords {
  faker.seed(FAKER_SEED);

  const partners: Array<Record<string, unknown>> = [];
  const payables: Array<Record<string, unknown>> = [];

  for (let index = 0; index < TEXTURE_PARTNERS; index += 1) {
    const id = faker.string.uuid();
    const status = faker.helpers.arrayElement(TEXTURE_PARTNER_STATUSES);

    partners.push({
      id,
      workspace_id: IDS.workspace,
      name: faker.person.fullName(),
      lumanu_id: status === 'in_process' ? null : `LUM2000${index.toString().padStart(2, '0')}`,
      email: `texture.${index}@example.com`,
      status,
      tax_origin_country: 'US',
      tags: ['creator'],
      has_approval_grant: false,
      legal_business_name: null,
      has_wallet: false,
      created_at: at(9 + index, 9),
      updated_at: at(9 + index, 9),
    });

    // Not every Partner has a Payable. Sarah is the canonical case of that,
    // and the texture should not imply it is unusual.
    if (index % 3 === 2) continue;

    payables.push({
      id: faker.string.uuid(),
      workspace_id: IDS.workspace,
      project_id: IDS.project,
      partner_id: id,
      amount_cents: dollars(faker.number.int({ min: 250, max: 1_800 })),
      description: `Summer Creator Campaign — ${faker.commerce.productName()}`,
      invoice_number: 2000 + index,
      status: faker.helpers.arrayElement(TEXTURE_PAYABLE_STATUSES),
      payable_status: null,
      vendor_status: 'unverified',
      created_at: at(10 + index, 11),
      updated_at: at(10 + index, 11),
    });
  }

  return { partners, payables };
}
