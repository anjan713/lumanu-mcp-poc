import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  ContractHarvestError,
  extractOpenApiFragment,
  stitchFragments,
  type OpenApiDocument,
} from '../scripts/lib/harvest';

/** Builds a reference page in the shape developers.lumanu.com actually serves. */
function referencePage(fragment: unknown, fence = '````'): string {
  return [
    '---',
    'updatedAt: 2026-01-20T23:35:52.000Z',
    '---',
    '',
    '# Get Single Payable',
    '',
    '# OpenAPI definition',
    '',
    `${fence}json`,
    JSON.stringify(fragment, null, 2),
    fence,
    '',
  ].join('\n');
}

const minimalFragment = {
  openapi: '3.1.0',
  info: { title: 'Lumanu Payment API', version: '1.0' },
  servers: [{ url: 'https://api.lumanu.com/api/rest', description: 'Production' }],
  paths: {
    '/payable/{id}': {
      get: { operationId: 'get-payable', responses: {} },
    },
  },
  components: {
    schemas: { Payable: { type: 'object', properties: { amount: { type: 'integer' } } } },
  },
};

describe('extractOpenApiFragment', () => {
  it('reads the OpenAPI fragment out of a reference page', () => {
    expect(extractOpenApiFragment(referencePage(minimalFragment))).toEqual(minimalFragment);
  });

  it('reads a fragment fenced with three backticks as well as four', () => {
    expect(extractOpenApiFragment(referencePage(minimalFragment, '```'))).toEqual(minimalFragment);
  });

  it('is not confused by fenced code blocks inside the fragment itself', () => {
    // Lumanu embeds a whole markdown guide, backticks and all, in info.description.
    const withNestedFences = {
      ...minimalFragment,
      info: {
        ...minimalFragment.info,
        description: 'Verify like so:\n```javascript\nconst x = 1;\n```\nDone.',
      },
    };

    expect(extractOpenApiFragment(referencePage(withNestedFences))).toEqual(withNestedFences);
  });

  it('ignores fenced blocks that are not the OpenAPI definition', () => {
    const page = [
      '# Get Single Payable',
      '',
      '```json',
      '{ "example": "response" }',
      '```',
      '',
      referencePage(minimalFragment),
    ].join('\n');

    expect(extractOpenApiFragment(page)).toEqual(minimalFragment);
  });

  it('fails loudly when a page carries no OpenAPI definition', () => {
    expect(() => extractOpenApiFragment('# Just prose\n\nNothing to see.')).toThrow(
      ContractHarvestError,
    );
  });

  it('fails loudly when the fenced block is not valid JSON', () => {
    const page = ['```json', '{ "openapi": ', '```'].join('\n');

    expect(() => extractOpenApiFragment(page)).toThrow(ContractHarvestError);
  });
});

describe('stitchFragments', () => {
  const payableFragment = {
    openapi: '3.1.0',
    info: { title: 'Lumanu Payment API', version: '1.0' },
    servers: [{ url: 'https://api.lumanu.com/api/rest' }],
    paths: { '/payable/{id}': { get: { operationId: 'get-payable' } } },
    components: { schemas: { Payable: { type: 'object' } } },
  };

  const approveFragment = {
    openapi: '3.1.0',
    info: { title: 'Lumanu Payment API', version: '1.0' },
    servers: [{ url: 'https://api.lumanu.com/api/rest' }],
    paths: { '/payable/{id}/approve': { post: { operationId: 'payable-approve' } } },
    components: { schemas: { Payable: { type: 'object' }, Error: { type: 'object' } } },
  };

  it('gathers every endpoint into one document', () => {
    const stitched = stitchFragments([
      { slug: 'get-payable', fragment: payableFragment },
      { slug: 'payable-approve', fragment: approveFragment },
    ]);

    expect(Object.keys(stitched.paths).sort()).toEqual([
      '/payable/{id}',
      '/payable/{id}/approve',
    ]);
  });

  it('gathers every referenced schema, keeping one copy of shared ones', () => {
    const stitched = stitchFragments([
      { slug: 'get-payable', fragment: payableFragment },
      { slug: 'payable-approve', fragment: approveFragment },
    ]);

    expect(Object.keys(stitched.components?.schemas ?? {}).sort()).toEqual(['Error', 'Payable']);
  });

  it('merges operations that share a path', () => {
    const stitched = stitchFragments([
      { slug: 'get-payable', fragment: payableFragment },
      {
        slug: 'update-payable',
        fragment: {
          ...payableFragment,
          paths: { '/payable/{id}': { patch: { operationId: 'update-payable' } } },
        },
      },
    ]);

    expect(Object.keys(stitched.paths['/payable/{id}'] ?? {}).sort()).toEqual(['get', 'patch']);
  });

  it('refuses to stitch when two pages disagree about a shared schema', () => {
    const drifted = {
      ...approveFragment,
      components: { schemas: { Payable: { type: 'object', required: ['amount'] } } },
    };

    expect(() =>
      stitchFragments([
        { slug: 'get-payable', fragment: payableFragment },
        { slug: 'payable-approve', fragment: drifted },
      ]),
    ).toThrow(/Payable/);
  });

  it('names both pages when they disagree, so the conflict can be looked up', () => {
    const drifted = {
      ...approveFragment,
      components: { schemas: { Payable: { type: 'string' } } },
    };

    expect(() =>
      stitchFragments([
        { slug: 'get-payable', fragment: payableFragment },
        { slug: 'payable-approve', fragment: drifted },
      ]),
    ).toThrow(/get-payable.*payable-approve|payable-approve.*get-payable/);
  });

  it('refuses to stitch when two pages disagree about an operation', () => {
    const drifted = {
      ...payableFragment,
      paths: { '/payable/{id}': { get: { operationId: 'something-else' } } },
    };

    expect(() =>
      stitchFragments([
        { slug: 'get-payable', fragment: payableFragment },
        { slug: 'other', fragment: drifted },
      ]),
    ).toThrow(ContractHarvestError);
  });

  it('refuses to stitch when pages disagree about the servers', () => {
    const drifted = {
      ...approveFragment,
      servers: [{ url: 'https://elsewhere.example.com' }],
    };

    expect(() =>
      stitchFragments([
        { slug: 'get-payable', fragment: payableFragment },
        { slug: 'payable-approve', fragment: drifted },
      ]),
    ).toThrow(/servers/i);
  });

  it('rejects an empty harvest rather than writing an empty specification', () => {
    expect(() => stitchFragments([])).toThrow(ContractHarvestError);
  });
});

/**
 * The tests above run on synthetic pages. This one runs on the real cache, and
 * exists because `openapi.json` is a derived file committed alongside its own
 * inputs: without this, the two could drift apart and every other test would
 * keep passing against a stale stitch.
 */
describe('the committed specification', () => {
  const cacheDir = path.join(__dirname, '..', 'docs', 'lumanu-reference');

  function readJson(file: string): OpenApiDocument {
    return JSON.parse(readFileSync(file, 'utf8')) as OpenApiDocument;
  }

  const fragmentDir = path.join(cacheDir, 'fragments');
  const slugs = readdirSync(fragmentDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.replace(/\.json$/, ''));

  it('was stitched from exactly the fragments committed beside it', () => {
    const restitched = stitchFragments(
      slugs.map((slug) => ({
        slug,
        fragment: readJson(path.join(fragmentDir, `${slug}.json`)),
      })),
    );

    expect(restitched).toEqual(readJson(path.join(cacheDir, 'openapi.json')));
  });

  it('covers every endpoint the provider needs, with the verb Lumanu publishes', () => {
    const spec = readJson(path.join(cacheDir, 'openapi.json'));
    const operations = Object.entries(spec.paths).flatMap(([route, item]) =>
      Object.keys(item)
        .filter((key) => key !== 'parameters')
        .map((method) => `${method.toUpperCase()} ${route}`),
    );

    expect(operations).toEqual(
      expect.arrayContaining([
        'GET /workspace',
        'GET /workspace/{id}',
        'GET /workspace/{id}/partner',
        'GET /workspace/{id}/partner/{partnerId}',
        'GET /workspace/{id}/wallet',
        'GET /workspace/{id}/wallet/transaction',
        'GET /payable',
        'GET /payable/{id}',
        'POST /payable/{id}/approve',
        'POST /payable/{id}/cancel',
        'POST /funding',
      ]),
    );
  });
});
