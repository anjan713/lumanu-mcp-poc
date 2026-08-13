/**
 * The generated texture, held to the constraints that keep it harmless.
 *
 * Texture makes the demo look like a real workspace rather than a four-row
 * fixture. The risk is that it quietly changes what the demo demonstrates —
 * one generated `approved` Payable belonging to a `completed_w9` Partner would
 * move the ready-to-fund total and break the headline figures. These run with
 * no credentials, so that cannot reach a database unnoticed.
 */

import { generateTexture } from '../scripts/db/texture';
import { CANONICAL, IDS } from '@/seed/canonical';
import { PARTNER_STATUSES, PAYABLE_STATUSES } from '@/providers/wire';

const texture = generateTexture();

describe('generated texture', () => {
  it('is deterministic, so a reseed reproduces identical rows', () => {
    expect(generateTexture()).toEqual(generateTexture());
  });

  it('produces both Partners and Payables', () => {
    expect(texture.partners.length).toBeGreaterThan(0);
    expect(texture.payables.length).toBeGreaterThan(0);
  });

  /** The constraint the headline figures depend on. */
  it('never generates a Partner who is onboarded', () => {
    for (const partner of texture.partners) {
      expect(partner['status']).not.toBe('completed_w9');
    }
  });

  it('never generates an approved or funded Payable', () => {
    for (const payable of texture.payables) {
      expect(['approved', 'will_pay', 'paid']).not.toContain(payable['status']);
    }
  });

  it('uses only statuses Lumanu publishes', () => {
    for (const partner of texture.partners) {
      expect(PARTNER_STATUSES).toContain(partner['status']);
    }
    for (const payable of texture.payables) {
      expect(PAYABLE_STATUSES).toContain(payable['status']);
    }
  });

  it('introduces no second Workspace or Project', () => {
    for (const row of [...texture.partners, ...texture.payables]) {
      expect(row['workspace_id']).toBe(IDS.workspace);
    }
    for (const payable of texture.payables) {
      expect(payable['project_id']).toBe(IDS.project);
    }
  });

  it('leaves some Partners with no Payable, as Sarah has none', () => {
    const withPayables = new Set(texture.payables.map((row) => row['partner_id']));

    expect(texture.partners.some((row) => !withPayables.has(row['id']))).toBe(true);
  });

  it('collides with no canonical identifier or email', () => {
    const canonicalIds = new Set<unknown>([
      ...CANONICAL.partners.map((row) => row.id),
      ...CANONICAL.payables.map((row) => row.id),
    ]);
    const canonicalEmails = new Set<unknown>(CANONICAL.partners.map((row) => row.email));

    for (const row of [...texture.partners, ...texture.payables]) {
      expect(canonicalIds.has(row['id'])).toBe(false);
    }
    for (const partner of texture.partners) {
      expect(canonicalEmails.has(partner['email'])).toBe(false);
    }
  });
});
