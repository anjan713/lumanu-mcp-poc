/**
 * Runtime configuration, parsed once from the environment.
 *
 * Deployed configuration arrives as environment variables populated from AWS
 * Secrets Manager; locally it comes from a gitignored `.env`. Either way the
 * shape is the same, and nothing downstream reads `process.env` directly.
 */

export const PROVIDER_KINDS = ['mock', 'real'] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export class ConfigError extends Error {
  public override readonly name = 'ConfigError';
}

export interface AppConfig {
  /** Which LumanuProvider implementation to construct. See ADR 0001. */
  readonly provider: ProviderKind;
  readonly nodeEnv: string;
  readonly logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    provider: parseProvider(env['LUMANU_PROVIDER']),
    nodeEnv: env['NODE_ENV'] ?? 'development',
    logLevel: env['LOG_LEVEL'] ?? 'info',
  };
}

/**
 * Where the mock's data actually lives. Separate from `AppConfig` because
 * only `MockLumanuProvider` and the database scripts need it: the MCP server
 * running against `RealLumanuProvider` has no database at all, and should not
 * fail to start over a connection string it will never open.
 */
export interface DataLayerConfig {
  /** Supabase, via the Supavisor session-mode pooler. */
  readonly databaseUrl: string;
  readonly hasuraEndpoint: string;
  readonly hasuraAdminSecret: string;
}

export function loadDataLayerConfig(env: NodeJS.ProcessEnv = process.env): DataLayerConfig {
  return {
    databaseUrl: parseDatabaseUrl(required(env, 'SUPABASE_DB_URL')),
    hasuraEndpoint: required(env, 'HASURA_GRAPHQL_ENDPOINT'),
    hasuraAdminSecret: required(env, 'HASURA_ADMIN_SECRET'),
  };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value === '') {
    throw new ConfigError(`${key} is required for the mock data layer, and is not set.`);
  }
  return value;
}

/** Supavisor's session-mode port. Transaction mode listens on 6543. */
const SESSION_MODE_PORT = '5432';

/**
 * Supabase must be reached in session mode. Transaction-mode pooling breaks
 * the prepared statements Hasura issues by default, and it does so
 * intermittently and confusingly rather than at connection time — so the
 * cheapest place to catch it is here, before anything opens a socket.
 *
 * The check is deliberately scoped to Supavisor hosts. Any other PostgreSQL
 * is free to listen wherever it likes; 6543 means nothing there.
 */
function parseDatabaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError('SUPABASE_DB_URL is not a valid PostgreSQL connection URL.');
  }

  if (url.hostname.endsWith('.pooler.supabase.com') && url.port !== SESSION_MODE_PORT) {
    throw new ConfigError(
      `SUPABASE_DB_URL must use the Supavisor session-mode pooler on port ${SESSION_MODE_PORT}, ` +
        `but names port ${url.port || '(none)'}. Port 6543 is transaction mode, which breaks ` +
        'the prepared statements Hasura uses by default. See ADR 0002.',
    );
  }

  return raw;
}

/**
 * An unrecognised value throws rather than falling back to `mock`. A silent
 * fallback would be a genuine hazard once RealLumanuProvider is wired: a typo
 * in the deployed environment would quietly serve mock data from what looks
 * like a production endpoint.
 */
function parseProvider(raw: string | undefined): ProviderKind {
  if (raw === undefined || raw === '') {
    return 'mock';
  }

  const match = PROVIDER_KINDS.find((kind) => kind === raw);
  if (match === undefined) {
    throw new ConfigError(
      `LUMANU_PROVIDER must be one of: ${PROVIDER_KINDS.join(', ')} — received "${raw}"`,
    );
  }

  return match;
}
