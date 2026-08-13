/**
 * Turning Lumanu's published documentation into a machine-readable contract.
 *
 * Lumanu publishes no single OpenAPI document. Each page under
 * `developers.lumanu.com/reference/` embeds a complete OpenAPI 3.1 document
 * that describes exactly one endpoint, carrying only the schemas that endpoint
 * references. Recovering the whole contract therefore means fetching one page
 * per endpoint and stitching the fragments back together.
 *
 * Everything here is pure: fetching and writing live in
 * `scripts/harvest-lumanu-contract.ts`, so the parsing and stitching rules —
 * the parts that can be wrong — are testable without a network.
 */

import { isDeepStrictEqual } from 'node:util';

export class ContractHarvestError extends Error {
  public override readonly name = 'ContractHarvestError';
}

/** One path's operations, keyed by HTTP method (plus a shared `parameters`). */
export type PathItem = Record<string, unknown>;

export interface OpenApiDocument {
  readonly openapi: string;
  readonly info?: Record<string, unknown>;
  readonly servers?: readonly unknown[];
  readonly security?: readonly unknown[];
  readonly paths: Record<string, PathItem>;
  readonly components?: {
    readonly schemas?: Record<string, unknown>;
    readonly securitySchemes?: Record<string, unknown>;
  };
}

/** A harvested page: the endpoint slug it came from, and what it contained. */
export interface HarvestedFragment {
  readonly slug: string;
  readonly fragment: OpenApiDocument;
}

/**
 * Fenced blocks tagged `json`. Lumanu fences the definition with four
 * backticks because its own `info.description` contains three-backtick blocks,
 * so the fence length is captured and matched rather than assumed. The closing
 * fence must sit alone on its line, which the nested blocks never do — inside
 * the JSON they are escaped newlines within a single physical line.
 */
const FENCED_JSON = /^(`{3,})json[^\n]*\n([\s\S]*?)\n\1[ \t]*$/gm;

/**
 * Reads the OpenAPI definition out of one reference page.
 *
 * A page may fence several JSON blocks — request samples, response samples —
 * so blocks are tried in order and the first that is actually an OpenAPI
 * document wins.
 */
export function extractOpenApiFragment(markdown: string): OpenApiDocument {
  const normalised = markdown.replace(/\r\n/g, '\n');
  let sawDefinition = false;

  for (const [, , body = ''] of normalised.matchAll(FENCED_JSON)) {
    const looksLikeDefinition = body.includes('"openapi"');
    sawDefinition ||= looksLikeDefinition;

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (cause) {
      if (!looksLikeDefinition) continue;
      throw new ContractHarvestError(
        `The OpenAPI definition is not valid JSON: ${(cause as Error).message}`,
      );
    }

    if (isOpenApiDocument(parsed)) return parsed;
  }

  throw new ContractHarvestError(
    sawDefinition
      ? 'A fenced block mentions "openapi" but is not an OpenAPI document.'
      : 'No OpenAPI definition found on this page. Lumanu may have changed its layout.',
  );
}

/**
 * Stitches per-endpoint fragments into the one specification the generated
 * types and the contract tests are built from.
 *
 * Fragments overlap heavily — every page that touches a Payable ships the
 * `Payable` schema — so the merge is a deduplication, and a disagreement
 * between two copies is a genuine finding rather than something to paper over.
 * It aborts, naming both pages.
 */
export function stitchFragments(harvested: readonly HarvestedFragment[]): OpenApiDocument {
  const first = harvested[0];
  if (first === undefined) {
    throw new ContractHarvestError('Nothing was harvested, so there is no contract to stitch.');
  }

  const owners = new Map<string, string>();
  const paths: Record<string, PathItem> = {};
  const schemas: Record<string, unknown> = {};
  const securitySchemes: Record<string, unknown> = {};

  for (const { slug, fragment } of harvested) {
    requireAgreement('openapi version', first.slug, slug, fragment.openapi, first.fragment.openapi);
    requireAgreement('servers', first.slug, slug, fragment.servers, first.fragment.servers);
    requireAgreement('security', first.slug, slug, fragment.security, first.fragment.security);

    for (const [path, operations] of Object.entries(fragment.paths ?? {})) {
      const pathItem = paths[path] ?? {};
      paths[path] = pathItem;
      mergeDisjoint(`operation on ${path}`, pathItem, operations, slug, owners);
    }
    mergeDisjoint('schema', schemas, fragment.components?.schemas, slug, owners);
    mergeDisjoint(
      'security scheme',
      securitySchemes,
      fragment.components?.securitySchemes,
      slug,
      owners,
    );
  }

  return {
    openapi: first.fragment.openapi,
    ...(first.fragment.info === undefined ? {} : { info: first.fragment.info }),
    ...(first.fragment.servers === undefined ? {} : { servers: first.fragment.servers }),
    ...(first.fragment.security === undefined ? {} : { security: first.fragment.security }),
    paths: sortKeys(paths),
    components: { schemas: sortKeys(schemas), securitySchemes: sortKeys(securitySchemes) },
  };
}

/**
 * Copies named entries in, refusing to overwrite one page's definition with a
 * different definition from another — hence "disjoint": identical entries
 * collapse, differing ones abort. The page that contributed each entry is
 * remembered so the error can name both sides of the disagreement.
 */
function mergeDisjoint(
  what: string,
  into: Record<string, unknown>,
  from: Record<string, unknown> | undefined,
  slug: string,
  owners: Map<string, string>,
): void {
  for (const [name, value] of Object.entries(from ?? {})) {
    const qualified = `${what} ${name}`;
    const owner = owners.get(qualified);

    if (owner !== undefined) {
      if (!isDeepStrictEqual(into[name], value)) {
        throw new ContractHarvestError(
          `The ${what} "${name}" is defined differently by ${owner} and by ${slug}. ` +
            'Reconcile the two reference pages before stitching — the fragments are the ' +
            'source of truth, so one of them describes something this project has wrong.',
        );
      }
      continue;
    }

    into[name] = value;
    owners.set(qualified, slug);
  }
}

function requireAgreement(
  what: string,
  firstSlug: string,
  slug: string,
  value: unknown,
  expected: unknown,
): void {
  if (isDeepStrictEqual(value, expected)) return;

  throw new ContractHarvestError(
    `The ${what} differs between ${firstSlug} and ${slug}: ` +
      `${JSON.stringify(expected)} versus ${JSON.stringify(value)}.`,
  );
}

/** Stable ordering, so re-harvesting produces no spurious diff. */
function sortKeys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

function isOpenApiDocument(value: unknown): value is OpenApiDocument {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { openapi?: unknown }).openapi === 'string'
  );
}
