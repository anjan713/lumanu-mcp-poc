/**
 * Caches Lumanu's published contract into the repository.
 *
 *   npm run harvest:contract
 *
 * Fetches one reference page per endpoint this project calls, extracts the
 * OpenAPI 3.1 fragment each page embeds, and stitches them into a single
 * specification. Everything it writes is committed, so no other step — build,
 * typecheck, test — ever touches the network.
 *
 * Re-run it when Lumanu updates its documentation. The diff on
 * `docs/lumanu-reference/` is then a readable statement of what changed in the
 * contract this project claims to be compatible with.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  ContractHarvestError,
  extractOpenApiFragment,
  stitchFragments,
  type HarvestedFragment,
} from './lib/harvest';

const DOCS_BASE = 'https://developers.lumanu.com';
const CACHE_DIR = path.join(__dirname, '..', 'docs', 'lumanu-reference');

/**
 * The endpoints this project calls, each named with the `LumanuProvider`
 * method it backs. Anything Lumanu publishes that no provider method needs is
 * deliberately absent — the cache is the contract we hold ourselves to, not a
 * mirror of the documentation site.
 */
const ENDPOINTS: ReadonlyArray<{ slug: string; backs: string }> = [
  { slug: 'get-workspaces', backs: 'listWorkspaces' },
  { slug: 'get-workspace', backs: 'getWorkspace' },
  { slug: 'get-workspace-partners', backs: 'listPartners' },
  { slug: 'get-workspace-partner', backs: 'getPartner' },
  { slug: 'get-payables', backs: 'listPayables' },
  { slug: 'get-payable', backs: 'getPayable' },
  { slug: 'payable-approve', backs: 'approvePayable' },
  { slug: 'payable-cancel', backs: 'cancelPayable' },
  { slug: 'get-workspace-wallet', backs: 'getWorkspaceBalance' },
  { slug: 'get-workspace-wallet-transactions', backs: 'listBalanceTransactions' },
  { slug: 'create-funding', backs: 'createFunding' },
  { slug: 'get-funding', backs: 'createFunding (the record it returns)' },
  // Both Project reads back the get_project_payment_summary tool.
  { slug: 'get-workspace-projects', backs: 'listProjects' },
  { slug: 'get-workspace-project', backs: 'getProject' },
];

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new ContractHarvestError(`GET ${url} returned ${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main(): Promise<void> {
  const fragmentsDir = path.join(CACHE_DIR, 'fragments');
  // Cleared rather than merged into, so an endpoint dropped from the list above
  // cannot linger in the cache and quietly keep feeding the generated types.
  await rm(fragmentsDir, { recursive: true, force: true });
  await mkdir(fragmentsDir, { recursive: true });

  await writeFile(
    path.join(CACHE_DIR, 'llms.txt'),
    await fetchText(`${DOCS_BASE}/llms.txt`),
    'utf8',
  );
  console.log('cached llms.txt');

  const harvested: HarvestedFragment[] = [];
  for (const { slug, backs } of ENDPOINTS) {
    const page = await fetchText(`${DOCS_BASE}/reference/${slug}.md`);
    const fragment = extractOpenApiFragment(page);

    await writeJson(path.join(fragmentsDir, `${slug}.json`), fragment);
    harvested.push({ slug, fragment });

    const paths = Object.keys(fragment.paths).join(', ');
    console.log(`cached ${slug}.json  ${paths}  → ${backs}`);
  }

  const stitched = stitchFragments(harvested);
  await writeJson(path.join(CACHE_DIR, 'openapi.json'), stitched);

  console.log(
    `\nstitched ${harvested.length} fragments into openapi.json: ` +
      `${Object.keys(stitched.paths).length} paths, ` +
      `${Object.keys(stitched.components?.schemas ?? {}).length} schemas`,
  );
  console.log('Now run: npm run generate:types');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
