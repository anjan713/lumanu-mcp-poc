/**
 * Runtime configuration, parsed once from the environment.
 *
 * Deployed configuration arrives as environment variables populated from AWS
 * SSM Parameter Store; locally it comes from a gitignored `.env`. Either way the
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
 * What `MockLumanuProvider` needs, and nothing more. It reaches the seeded data
 * over GraphQL and never opens a PostgreSQL socket, so it must be able to start
 * without a connection string — otherwise the deployed function would demand a
 * database password in SSM to satisfy a check rather than a caller, and would
 * fail its cold start when that password was rightly absent.
 *
 * Separate from `AppConfig` because a server running `RealLumanuProvider` needs
 * no Hasura credentials either.
 */
export interface HasuraConfig {
  readonly hasuraEndpoint: string;
  readonly hasuraAdminSecret: string;
}

export function loadHasuraConfig(env: NodeJS.ProcessEnv = process.env): HasuraConfig {
  return {
    hasuraEndpoint: required(env, 'HASURA_GRAPHQL_ENDPOINT', 'for the mock data layer'),
    hasuraAdminSecret: required(env, 'HASURA_ADMIN_SECRET', 'for the mock data layer'),
  };
}

/**
 * The above, plus direct access to the database underneath it.
 *
 * Only the `scripts/db/*` tools load this: migrating, seeding and smoke-testing
 * all speak SQL, which Hasura deliberately does not expose. Those scripts run
 * from a developer machine against a gitignored `.env`, which is why the
 * connection string never has to reach the deployed environment.
 */
export interface DataLayerConfig extends HasuraConfig {
  /** Supabase, via the Supavisor session-mode pooler. */
  readonly databaseUrl: string;
}

export function loadDataLayerConfig(env: NodeJS.ProcessEnv = process.env): DataLayerConfig {
  return {
    ...loadHasuraConfig(env),
    databaseUrl: parseDatabaseUrl(
      required(env, 'SUPABASE_DB_URL', 'for the database scripts'),
    ),
  };
}

/**
 * What `RealLumanuProvider` needs to reach Lumanu, and nothing more.
 *
 * Separate from `HasuraConfig` for the same reason that is separate from
 * `DataLayerConfig`: a server running one provider must not be made to hold
 * credentials for the other. Selecting `real` in a deployment should ask for
 * Lumanu's credentials and stop asking for Hasura's.
 *
 * `baseUrl` is a published fact — the sandbox and production servers are in the
 * harvested `servers` block. `tokenUrl` is **not**. Lumanu documents the grant
 * (`client_credentials`) and the audience but publishes no token endpoint among
 * the fourteen harvested pages, so it is configured rather than derived, and
 * this is the one value here that cannot be checked against the contract.
 */
export interface LumanuApiConfig {
  /** Sandbox `https://api.demo.lumanu.link/api/rest`, production `https://api.lumanu.com/api/rest`. */
  readonly baseUrl: string;
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** Lumanu's sandbox audience is `https://lumanu-demo.hasura.app/v1/graphql`. */
  readonly audience?: string;
}

export function loadLumanuApiConfig(env: NodeJS.ProcessEnv = process.env): LumanuApiConfig {
  const purpose = 'to reach Lumanu with LUMANU_PROVIDER=real';
  const audience = env['LUMANU_AUDIENCE'];

  return {
    baseUrl: stripTrailingSlash(required(env, 'LUMANU_API_BASE_URL', purpose)),
    tokenUrl: required(env, 'LUMANU_TOKEN_URL', purpose),
    clientId: required(env, 'LUMANU_CLIENT_ID', purpose),
    clientSecret: required(env, 'LUMANU_CLIENT_SECRET', purpose),
    // Omitted rather than set to undefined: under exactOptionalPropertyTypes
    // those are different things, and the token request sends the field only
    // when there is one to send.
    ...(audience === undefined || audience === '' ? {} : { audience }),
  };
}

/** So that `${baseUrl}${path}` never produces a double slash. */
function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function required(env: NodeJS.ProcessEnv, key: string, purpose: string): string {
  const value = env[key];
  if (value === undefined || value === '') {
    throw new ConfigError(`${key} is required ${purpose}, and is not set.`);
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
