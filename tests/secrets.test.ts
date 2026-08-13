import {
  loadParametersInto,
  parametersToEnvironment,
  SecretsError,
  type ParameterReader,
} from '@/config/secrets';

const PATH = '/lumanu-mcp-poc/prod';

/** A reader that answers from a fixture and counts how often it was asked. */
function fakeReader(values: Record<string, string>): ParameterReader & { calls: number } {
  return {
    calls: 0,
    async byPath(path: string) {
      this.calls += 1;
      if (!path.startsWith('/')) throw new Error('unexpected path');
      return values;
    },
  };
}

describe('parametersToEnvironment', () => {
  it('names each variable after the last segment of its parameter path', () => {
    const environment = parametersToEnvironment({
      [`${PATH}/HASURA_ADMIN_SECRET`]: 'shh',
      [`${PATH}/SUPABASE_DB_URL`]: 'postgresql://host/db',
    });

    expect(environment).toEqual({
      HASURA_ADMIN_SECRET: 'shh',
      SUPABASE_DB_URL: 'postgresql://host/db',
    });
  });

  it('ignores a trailing slash on the path', () => {
    expect(parametersToEnvironment({ [`${PATH}/AUTH0_DOMAIN/`]: 'x' })).toEqual({
      AUTH0_DOMAIN: 'x',
    });
  });

  it('rejects a parameter whose name is not a usable variable name', () => {
    expect(() => parametersToEnvironment({ [`${PATH}/not a name`]: 'x' })).toThrow(SecretsError);
  });

  it('names the offending parameter, so a typo in the path is obvious', () => {
    expect(() => parametersToEnvironment({ [`${PATH}/lower-case`]: 'x' })).toThrow(/lower-case/);
  });
});

describe('loadParametersInto', () => {
  it('adds the fetched values to the environment', async () => {
    const environment: NodeJS.ProcessEnv = {};

    await loadParametersInto(environment, fakeReader({ [`${PATH}/HASURA_ADMIN_SECRET`]: 'shh' }), {
      path: PATH,
    });

    expect(environment['HASURA_ADMIN_SECRET']).toBe('shh');
  });

  /**
   * A value already present was set deliberately — by `.env` locally, or by a
   * Lambda environment variable. Letting SSM overwrite it would make local
   * overrides silently ineffective.
   */
  it('does not overwrite a value the environment already holds', async () => {
    const environment: NodeJS.ProcessEnv = { HASURA_ADMIN_SECRET: 'from-dotenv' };

    await loadParametersInto(environment, fakeReader({ [`${PATH}/HASURA_ADMIN_SECRET`]: 'ssm' }), {
      path: PATH,
    });

    expect(environment['HASURA_ADMIN_SECRET']).toBe('from-dotenv');
  });

  it('treats an empty existing value as absent', async () => {
    const environment: NodeJS.ProcessEnv = { HASURA_ADMIN_SECRET: '' };

    await loadParametersInto(environment, fakeReader({ [`${PATH}/HASURA_ADMIN_SECRET`]: 'ssm' }), {
      path: PATH,
    });

    expect(environment['HASURA_ADMIN_SECRET']).toBe('ssm');
  });

  /** A warm Lambda container must not pay the latency again on every request. */
  it('reads once per container, however many times it is called', async () => {
    const reader = fakeReader({ [`${PATH}/HASURA_ADMIN_SECRET`]: 'shh' });
    const cache = {};

    await loadParametersInto({}, reader, { path: PATH, cache });
    await loadParametersInto({}, reader, { path: PATH, cache });
    await loadParametersInto({}, reader, { path: PATH, cache });

    expect(reader.calls).toBe(1);
  });

  it('caches per path, so two paths are fetched separately', async () => {
    const reader = fakeReader({ [`${PATH}/A`]: '1' });
    const cache = {};

    await loadParametersInto({}, reader, { path: PATH, cache });
    await loadParametersInto({}, reader, { path: '/other', cache });

    expect(reader.calls).toBe(2);
  });

  it('does nothing at all when no path is configured', async () => {
    const reader = fakeReader({});
    const environment: NodeJS.ProcessEnv = { EXISTING: 'kept' };

    await loadParametersInto(environment, reader, { path: undefined });

    expect(reader.calls).toBe(0);
    expect(environment).toEqual({ EXISTING: 'kept' });
  });

  it('fails loudly when a configured path holds nothing', async () => {
    await expect(loadParametersInto({}, fakeReader({}), { path: PATH })).rejects.toThrow(
      SecretsError,
    );
  });

  it('names the path when it holds nothing, because the usual cause is a wrong path', async () => {
    await expect(loadParametersInto({}, fakeReader({}), { path: PATH })).rejects.toThrow(
      new RegExp(PATH),
    );
  });

  it('never puts a secret value in the error text', async () => {
    const reader: ParameterReader = {
      byPath: () => Promise.reject(new Error('AccessDenied for user')),
    };

    await expect(loadParametersInto({}, reader, { path: PATH })).rejects.not.toThrow(/shh/);
    await expect(loadParametersInto({}, reader, { path: PATH })).rejects.toThrow(/AccessDenied/);
  });
});
