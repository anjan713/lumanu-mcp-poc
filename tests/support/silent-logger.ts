/** A logger that records nothing. Tool tests assert on results, not log lines. */
import { pino, type Logger } from 'pino';

export function silentLogger(): Logger {
  return pino({ level: 'silent' });
}
