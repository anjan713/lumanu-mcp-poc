/**
 * Which provider `createProvider` builds, and what it demands of the
 * environment to do it.
 *
 * The second half matters as much as the first. The deployed function reads its
 * environment from SSM Parameter Store, so anything `createProvider` requires
 * is a value that has to be stored in AWS — and a value stored in AWS is one
 * more credential to protect. A requirement no caller actually uses is
 * therefore not a harmless extra check; it is an unnecessary secret.
 */

import { ConfigError, loadConfig } from '@/config';
import { createProvider, MockLumanuProvider, RealLumanuProvider } from '@/providers';

const HASURA_ONLY = {
  HASURA_GRAPHQL_ENDPOINT: 'https://acme.hasura.app/v1/graphql',
  HASURA_ADMIN_SECRET: 'secret',
};

const LUMANU_ONLY = {
  LUMANU_PROVIDER: 'real',
  LUMANU_API_BASE_URL: 'https://api.demo.lumanu.link/api/rest',
  LUMANU_TOKEN_URL: 'https://auth.demo.lumanu.link/oauth/token',
  LUMANU_CLIENT_ID: 'client-id',
  LUMANU_CLIENT_SECRET: 'client-secret',
};

describe('createProvider', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...HASURA_ONLY };
  });

  afterEach(() => {
    process.env = original;
  });

  it('builds the mock provider by default', () => {
    const provider = createProvider(loadConfig({}));

    expect(provider).toBeInstanceOf(MockLumanuProvider);
  });

  /**
   * `MockLumanuProvider` reaches the seeded data over GraphQL and never opens a
   * PostgreSQL socket, so the deployed function must start without a connection
   * string. It previously loaded the whole data-layer configuration, which made
   * `SUPABASE_DB_URL` mandatory — putting a database password in SSM to satisfy
   * a check rather than a caller, and failing the cold start once that password
   * was rightly left out. See docs/10.
   */
  it('needs no database connection string, because nothing here opens one', () => {
    expect(process.env['SUPABASE_DB_URL']).toBeUndefined();

    expect(() => createProvider(loadConfig({}))).not.toThrow();
  });

  it('still names a missing Hasura credential, which the provider does use', () => {
    delete process.env['HASURA_ADMIN_SECRET'];

    expect(() => createProvider(loadConfig({}))).toThrow(ConfigError);
    expect(() => createProvider(loadConfig({}))).toThrow(/HASURA_ADMIN_SECRET/);
  });

  it('builds the real provider when it is selected', () => {
    process.env = { ...LUMANU_ONLY };

    expect(createProvider(loadConfig())).toBeInstanceOf(RealLumanuProvider);
  });

  /**
   * The mirror of the rule above, and the reason the two configurations are
   * separate. A deployment running against Lumanu holds Lumanu's credentials
   * and stops holding Hasura's — otherwise selecting `real` would leave an
   * admin secret in SSM that nothing uses, which is a stored credential
   * protecting nothing.
   */
  it('asks for no Hasura credentials once it is running against Lumanu', () => {
    process.env = { ...LUMANU_ONLY };

    expect(process.env['HASURA_ADMIN_SECRET']).toBeUndefined();
    expect(() => createProvider(loadConfig())).not.toThrow();
  });

  it('names the missing Lumanu credential rather than silently serving mock data', () => {
    process.env = { LUMANU_PROVIDER: 'real', ...HASURA_ONLY };

    expect(() => createProvider(loadConfig())).toThrow(ConfigError);
    expect(() => createProvider(loadConfig())).toThrow(/LUMANU_/);
  });
});
