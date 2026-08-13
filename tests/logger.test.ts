import { Writable } from 'node:stream';

import type { AppConfig } from '@/config';
import { createLogger, forRequest } from '@/observability/logger';

function capture(): { lines: () => unknown[]; stream: Writable } {
  const written: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      written.push(String(chunk));
      callback();
    },
  });
  return {
    stream,
    lines: () =>
      written
        .join('')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as unknown),
  };
}

const config: Pick<AppConfig, 'logLevel' | 'nodeEnv' | 'provider'> = {
  logLevel: 'info',
  nodeEnv: 'test',
  provider: 'mock',
};

describe('createLogger', () => {
  it('stamps every line with the active provider', () => {
    const { stream, lines } = capture();
    createLogger(config, stream).info('hello');

    expect(lines()[0]).toMatchObject({ provider: 'mock', env: 'test' });
  });

  it('redacts secrets logged at the top level', () => {
    const { stream, lines } = capture();
    createLogger(config, stream).info({ client_secret: 'shhh' }, 'auth');

    expect(lines()[0]).toMatchObject({ client_secret: '[redacted]' });
  });

  it('redacts secrets logged one level deep', () => {
    const { stream, lines } = capture();
    createLogger(config, stream).info({ headers: { authorization: 'Bearer abc' } }, 'req');

    expect(lines()[0]).toMatchObject({ headers: { authorization: '[redacted]' } });
  });

  it('redacts the Hasura admin secret and the database connection string', () => {
    const { stream, lines } = capture();
    createLogger(config, stream).info(
      { hasura_admin_secret: 'secret', connection_string: 'postgresql://u:p@host/db' },
      'boot',
    );

    expect(lines()[0]).toMatchObject({
      hasura_admin_secret: '[redacted]',
      connection_string: '[redacted]',
    });
  });

  it('leaves non-secret fields intact', () => {
    const { stream, lines } = capture();
    createLogger(config, stream).info({ duration_ms: 42, success: true }, 'done');

    expect(lines()[0]).toMatchObject({ duration_ms: 42, success: true });
  });

  it('honours the configured level', () => {
    const { stream, lines } = capture();
    createLogger({ ...config, logLevel: 'warn' }, stream).info('quiet');

    expect(lines()).toHaveLength(0);
  });
});

describe('forRequest', () => {
  it('carries the correlation id onto every line', () => {
    const { stream, lines } = capture();
    const requestLogger = forRequest(createLogger(config, stream), {
      request_id: 'req-1',
      tool_name: 'list_workspaces',
    });

    requestLogger.info('start');
    requestLogger.info({ duration_ms: 3, success: true }, 'end');

    const emitted = lines();
    expect(emitted).toHaveLength(2);
    for (const line of emitted) {
      expect(line).toMatchObject({
        request_id: 'req-1',
        tool_name: 'list_workspaces',
        provider: 'mock',
      });
    }
  });
});
