import { ConfigError, loadConfig } from '@/config';

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
