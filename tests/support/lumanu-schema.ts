/**
 * Validating values against Lumanu's published schemas.
 *
 * This is the mechanism behind the project's central claim. A provider that
 * returns Lumanu-shaped objects can say so cheaply; one whose return values
 * are checked against the schemas Lumanu itself publishes cannot drift into
 * invention without a test going red.
 *
 * The schemas come from `docs/lumanu-reference/openapi.json`, harvested by
 * `npm run harvest:contract`, so this reads a committed file and never a
 * network.
 */

import Ajv2020, { type AnySchema, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

import spec from '../../docs/lumanu-reference/openapi.json';

export type LumanuSchemaName = keyof typeof spec.components.schemas;

/**
 * Lumanu's documents declare OpenAPI 3.1 — whose schemas are JSON Schema
 * 2020-12 — but express nullability with 3.0's `nullable: true` keyword, which
 * 2020-12 does not define. A validator would silently ignore it and then
 * reject the `null` that Lumanu genuinely returns, so it is translated to the
 * union type 2020-12 uses. This is the one adaptation made to the harvested
 * schemas, and it is deliberately narrow.
 */
function toJsonSchema2020(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toJsonSchema2020);
  if (typeof node !== 'object' || node === null) return node;

  const source = node as Record<string, unknown>;
  const translated: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key !== 'nullable') translated[key] = toJsonSchema2020(value);
  }

  if (source['nullable'] === true) {
    const type = translated['type'];
    if (typeof type === 'string') translated['type'] = [type, 'null'];
    else if (Array.isArray(type) && !type.includes('null')) translated['type'] = [...type, 'null'];

    const values = translated['enum'];
    if (Array.isArray(values) && !values.includes(null)) translated['enum'] = [...values, null];
  }

  return translated;
}

const ajv = new Ajv2020({
  // Lumanu's schemas carry `x-stoplight`, `x-examples` and other vendor
  // extensions. Ignoring them is correct; refusing to compile is not.
  strict: false,
  allErrors: true,
});
addFormats(ajv);
// Only the schemas are registered. The rest of the OpenAPI document describes
// paths and operations, which are not JSON Schema and have no business being
// compiled as one; `#/components/schemas/...` references still resolve.
const schemaRoot = toJsonSchema2020({
  components: { schemas: spec.components.schemas },
}) as AnySchema;
ajv.addSchema(schemaRoot, 'lumanu');

function compiledSchemaFor(name: LumanuSchemaName): ValidateFunction {
  const validate = ajv.getSchema(`lumanu#/components/schemas/${name}`);
  if (validate === undefined) {
    throw new Error(
      `Lumanu publishes no schema named "${name}". Harvested schemas: ` +
        `${Object.keys(spec.components.schemas).join(', ')}.`,
    );
  }
  return validate;
}

/** Every schema name the harvest cached, for suites that sweep all of them. */
export const LUMANU_SCHEMA_NAMES = Object.keys(spec.components.schemas) as LumanuSchemaName[];

interface HarvestedSchema {
  readonly 'x-examples'?: Record<string, unknown>;
  readonly properties?: Record<string, { readonly enum?: readonly unknown[] }>;
  readonly allOf?: ReadonlyArray<HarvestedSchema & { readonly $ref?: string }>;
}

function harvestedSchema(name: LumanuSchemaName): HarvestedSchema {
  return spec.components.schemas[name] as HarvestedSchema;
}

/** The examples Lumanu publishes alongside a schema, if it publishes any. */
export function publishedExamples(name: LumanuSchemaName): unknown[] {
  return Object.values(harvestedSchema(name)['x-examples'] ?? {});
}

/**
 * The field names Lumanu's schema declares, following one level of `allOf`
 * composition so `PartnerDetail` reports what it inherits from `Partner` too.
 *
 * This exists because schema *validation* cannot see a field disappear.
 * Lumanu marks almost nothing required and forbids no additional properties,
 * so an object missing a renamed field still validates perfectly. Asserting
 * the declared field names is what actually catches a rename — the commonest
 * kind of wire drift, and the one that would silently break the provider.
 */
export function declaredFields(name: LumanuSchemaName): string[] {
  const schema = harvestedSchema(name);
  const fields = new Set(Object.keys(schema.properties ?? {}));

  for (const branch of schema.allOf ?? []) {
    const inherited = branch.$ref?.replace('#/components/schemas/', '');
    const source =
      inherited === undefined ? branch : harvestedSchema(inherited as LumanuSchemaName);
    for (const field of Object.keys(source.properties ?? {})) fields.add(field);
  }

  return [...fields].sort();
}

/** The values Lumanu's schema permits for a field, or `undefined` if unconstrained. */
export function declaredEnum(
  name: LumanuSchemaName,
  field: string,
): readonly unknown[] | undefined {
  return harvestedSchema(name).properties?.[field]?.enum;
}

/**
 * Fails the test with the offending field paths when `value` is not a valid
 * instance of Lumanu's `name` schema.
 */
export function expectMatchesLumanuSchema(name: LumanuSchemaName, value: unknown): void {
  const validate = compiledSchemaFor(name);
  if (validate(value)) return;

  const problems = (validate.errors ?? [])
    .map((error) => `  ${error.instancePath || '(root)'} ${error.message ?? ''}`.trimEnd())
    .join('\n');

  throw new Error(`This value does not match Lumanu's published ${name} schema:\n${problems}`);
}
