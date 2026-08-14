import {
  ConfigError,
  loadConfig,
  loadDataLayerConfig,
  loadHasuraConfig,
  loadLumanuApiConfig,
} from '@/config';

const SESSION_MODE_URL =
  'postgresql://postgres.abcdefghijklm:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres';

describe('loadConfig', () => {
  it('defaults to the mock provider when nothing is set', () => {
    expect(loadConfig({}).provider).toBe('mock');
  });

  it('reads an explicit provider selection', () => {
    expect(loadConfig({ LUMANU_PROVIDER: 'mock' }).provider).toBe('mock');
    expect(loadConfig({ LUMANU_PROVIDER: 'real' }).provider).toBe('real');
  });

  it('rejects an unrecognised provider rather than falling back to mock', () => {
    expect(() => loadConfig({ LUMANU_PROVIDER: 'Mock' })).toThrow(ConfigError);
    expect(() => loadConfig({ LUMANU_PROVIDER: 'hasura' })).toThrow(ConfigError);
  });

  it('names the offending value so a deployment typo is obvious', () => {
    expect(() => loadConfig({ LUMANU_PROVIDER: 'reeal' })).toThrow(/reeal/);
  });

  it('treats an empty provider as unset', () => {
    expect(loadConfig({ LUMANU_PROVIDER: '' }).provider).toBe('mock');
  });

  it('defaults the environment and log level', () => {
    const config = loadConfig({});
    expect(config.nodeEnv).toBe('development');
    expect(config.logLevel).toBe('info');
  });

  it('reads the environment and log level when supplied', () => {
    const config = loadConfig({ NODE_ENV: 'production', LOG_LEVEL: 'warn' });
    expect(config.nodeEnv).toBe('production');
    expect(config.logLevel).toBe('warn');
  });
});

describe('loadHasuraConfig', () => {
  const complete = {
    HASURA_GRAPHQL_ENDPOINT: 'https://acme.hasura.app/v1/graphql',
    HASURA_ADMIN_SECRET: 'secret',
  };

  it('reads what the provider needs to reach Hasura', () => {
    const config = loadHasuraConfig(complete);

    expect(config.hasuraEndpoint).toBe('https://acme.hasura.app/v1/graphql');
    expect(config.hasuraAdminSecret).toBe('secret');
  });

  /**
   * The deployed MCP server reaches Hasura over GraphQL and never opens a
   * PostgreSQL socket, so it must start without a connection string. Requiring
   * one would put a database password in SSM to satisfy a check rather than a
   * caller, and would fail the Lambda's cold start when it was absent.
   */
  it('starts without a database connection string, which it never opens', () => {
    expect(() => loadHasuraConfig(complete)).not.toThrow();
    expect(loadHasuraConfig(complete)).not.toHaveProperty('databaseUrl');
  });

  const keys = Object.keys(complete) as Array<keyof typeof complete>;

  it.each(keys)('names %s when it is missing', (key) => {
    const { [key]: _omitted, ...rest } = complete;

    expect(() => loadHasuraConfig(rest)).toThrow(new RegExp(key));
  });

  it('treats an empty value as missing rather than connecting to nothing', () => {
    expect(() => loadHasuraConfig({ ...complete, HASURA_ADMIN_SECRET: '' })).toThrow(ConfigError);
  });
});

describe('loadDataLayerConfig', () => {
  const complete = {
    SUPABASE_DB_URL: SESSION_MODE_URL,
    HASURA_GRAPHQL_ENDPOINT: 'https://acme.hasura.app/v1/graphql',
    HASURA_ADMIN_SECRET: 'secret',
  };

  it('reads the connection details the data layer needs', () => {
    const config = loadDataLayerConfig(complete);

    expect(config.databaseUrl).toBe(SESSION_MODE_URL);
    expect(config.hasuraEndpoint).toBe('https://acme.hasura.app/v1/graphql');
    expect(config.hasuraAdminSecret).toBe('secret');
  });

  const keys = Object.keys(complete) as Array<keyof typeof complete>;

  it.each(keys)('names %s when it is missing', (key) => {
    const { [key]: _omitted, ...rest } = complete;

    expect(() => loadDataLayerConfig(rest)).toThrow(new RegExp(key));
  });

  it('treats an empty value as missing rather than connecting to nothing', () => {
    expect(() => loadDataLayerConfig({ ...complete, HASURA_ADMIN_SECRET: '' })).toThrow(
      ConfigError,
    );
  });

  /**
   * Transaction-mode pooling on 6543 breaks the prepared statements Hasura
   * uses by default, and the failure is confusing and intermittent rather
   * than immediate. Rejecting it here is much kinder than debugging it later.
   */
  it('rejects the transaction-mode pooler, which breaks Hasura prepared statements', () => {
    const transactionMode = SESSION_MODE_URL.replace(':5432/', ':6543/');

    expect(() => loadDataLayerConfig({ ...complete, SUPABASE_DB_URL: transactionMode })).toThrow(
      /6543|session/i,
    );
  });

  it('accepts a non-Supabase database on any port, since the rule is Supavisor-specific', () => {
    const local = 'postgresql://postgres:pw@localhost:6543/postgres';

    expect(loadDataLayerConfig({ ...complete, SUPABASE_DB_URL: local }).databaseUrl).toBe(local);
  });

  it('rejects a database URL that is not a URL at all', () => {
    expect(() => loadDataLayerConfig({ ...complete, SUPABASE_DB_URL: 'not-a-url' })).toThrow(
      ConfigError,
    );
  });

  it('keeps the admin secret out of the error text when the URL is bad', () => {
    try {
      loadDataLayerConfig({ ...complete, SUPABASE_DB_URL: 'not-a-url' });
      throw new Error('expected loadDataLayerConfig to throw');
    } catch (error) {
      expect((error as Error).message).not.toContain('secret');
    }
  });
});

describe('loadLumanuApiConfig', () => {
  const complete = {
    LUMANU_API_BASE_URL: 'https://api.demo.lumanu.link/api/rest',
    LUMANU_TOKEN_URL: 'https://auth.demo.lumanu.link/oauth/token',
    LUMANU_CLIENT_ID: 'client-id',
    LUMANU_CLIENT_SECRET: 'client-secret',
  };

  it('reads what the real provider needs to reach Lumanu', () => {
    const config = loadLumanuApiConfig(complete);

    expect(config.baseUrl).toBe('https://api.demo.lumanu.link/api/rest');
    expect(config.clientId).toBe('client-id');
  });

  const keys = Object.keys(complete) as Array<keyof typeof complete>;

  it.each(keys)('names %s when it is missing', (key) => {
    const { [key]: _omitted, ...rest } = complete;

    expect(() => loadLumanuApiConfig(rest)).toThrow(new RegExp(key));
  });

  /**
   * Lumanu names no Hasura or Supabase value, and must not be made to. The two
   * loaders are separate so that selecting a provider selects its credentials
   * and only its credentials — the same reasoning that kept the Supabase
   * password out of AWS.
   */
  it('asks for nothing belonging to the mock data layer', () => {
    expect(() => loadLumanuApiConfig(complete)).not.toThrow();
    expect(Object.keys(loadLumanuApiConfig(complete)).sort()).toEqual([
      'baseUrl',
      'clientId',
      'clientSecret',
      'tokenUrl',
    ]);
  });

  it('carries the audience when there is one', () => {
    const config = loadLumanuApiConfig({ ...complete, LUMANU_AUDIENCE: 'https://acme/graphql' });

    expect(config.audience).toBe('https://acme/graphql');
  });

  /**
   * Omitted rather than present-and-undefined. The token request sends the
   * field only when it is there, and under `exactOptionalPropertyTypes` those
   * are two different objects.
   */
  it('omits the audience entirely when none is set', () => {
    expect(loadLumanuApiConfig(complete)).not.toHaveProperty('audience');
    expect(loadLumanuApiConfig({ ...complete, LUMANU_AUDIENCE: '' })).not.toHaveProperty(
      'audience',
    );
  });

  it('trims a trailing slash, so a path is never joined onto a double slash', () => {
    const config = loadLumanuApiConfig({
      ...complete,
      LUMANU_API_BASE_URL: 'https://api.demo.lumanu.link/api/rest/',
    });

    expect(config.baseUrl).toBe('https://api.demo.lumanu.link/api/rest');
  });
});
