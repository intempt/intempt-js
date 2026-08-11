import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureLogger,
  createLogger,
  DiagnosticRecord,
  isConsoleEnabled,
  resetLogger,
} from '../../src/shared/logger/logger.ts';
import { EnvConfig } from '../../src/shared/envConfig.ts';

/**
 * Tests for the structured logger.
 *
 * What is actually being protected here is a **support workflow**, not a
 * formatting helper. Two properties are load-bearing and both are easy to break
 * by accident:
 *
 *  1. **Production stays silent by default.** 55 `console.*` calls were replaced
 *     by this module, and every one of them used to be wrapped in
 *     `!EnvConfig.isProduction()`. If the default threshold regresses, every
 *     customer page starts printing SDK internals — a visible, embarrassing
 *     change on sites the SDK does not own.
 *  2. **`debug: true` lifts that silence in production.** This is the only reason
 *     the option exists: it is what a support engineer turns on instead of
 *     shipping a customer a staging bundle. A logger that silently ignored it
 *     would look fine in development and be useless in the field.
 *
 * The sink tests then cover the failure mode that matters most: a customer's own
 * callback throwing. `RequestBatcher.reportError` has swallowed `errorReporter`
 * throws since it was written, for the reason that an analytics SDK which can
 * break the page it measures is worse than no analytics SDK. The sink inherits
 * that contract, so it is asserted rather than assumed.
 */

const PROD = { VITE_ENV: 'production' };
const DEV = { VITE_ENV: 'development' };

describe('logger', () => {
  let errors: any[][];
  let warns: any[][];
  let logs: any[][];

  beforeEach(() => {
    resetLogger();
    errors = [];
    warns = [];
    logs = [];
    vi.spyOn(console, 'error').mockImplementation((...a: any[]) => void errors.push(a));
    vi.spyOn(console, 'warn').mockImplementation((...a: any[]) => void warns.push(a));
    vi.spyOn(console, 'log').mockImplementation((...a: any[]) => void logs.push(a));
  });

  afterEach(() => {
    resetLogger();
    EnvConfig.reset();
  });

  describe('environment default', () => {
    it('prints nothing in production, reproducing the behaviour it replaced', () => {
      EnvConfig.initFromValues(PROD);
      const log = createLogger('Scope');

      log.error('boom');
      log.warn('careful');
      log.info('fyi');
      log.debug('noisy');

      // Not "fewer" calls — none. Every replaced call site was gated on
      // !isProduction(), so anything reaching a customer console is a regression.
      expect([...errors, ...warns, ...logs]).toEqual([]);
    });

    it('prints everything outside production', () => {
      EnvConfig.initFromValues(DEV);
      const log = createLogger('Scope');

      log.error('boom');
      log.debug('noisy');

      expect(errors).toHaveLength(1);
      expect(logs).toHaveLength(1);
    });
  });

  describe('debug switch', () => {
    it('turns on verbose output in a production build', () => {
      EnvConfig.initFromValues(PROD);
      configureLogger({ debug: true });
      const log = createLogger('Scope');

      log.debug('now visible');

      // The entire point of the option: a support case on a live site.
      expect(logs).toEqual([['[Scope] now visible']]);
    });

    it('can be turned back off', () => {
      EnvConfig.initFromValues(PROD);
      configureLogger({ debug: true });
      configureLogger({ debug: false });

      createLogger('Scope').debug('quiet again');

      expect(logs).toEqual([]);
    });

    it('is overridden by an explicit level, so a customer can force silence', () => {
      EnvConfig.initFromValues(DEV);
      configureLogger({ level: 'silent' });

      createLogger('Scope').error('boom');

      expect(errors).toEqual([]);
    });
  });

  describe('level filtering', () => {
    it('accepts the threshold and everything more severe, and drops the rest', () => {
      configureLogger({ level: 'warn' });
      const log = createLogger('Scope');

      log.error('e');
      log.warn('w');
      log.info('i');
      log.debug('d');

      expect(errors).toHaveLength(1);
      expect(warns).toHaveLength(1);
      expect(logs).toEqual([]);
    });

    it('reports what is enabled without emitting anything', () => {
      configureLogger({ level: 'info' });

      expect(isConsoleEnabled('error')).toBe(true);
      expect(isConsoleEnabled('info')).toBe(true);
      expect(isConsoleEnabled('debug')).toBe(false);
      expect([...errors, ...warns, ...logs]).toEqual([]);
    });

    it("'silent' accepts nothing at all, not even errors", () => {
      configureLogger({ level: 'silent' });
      const log = createLogger('Scope');

      log.error('e');
      log.warn('w');

      expect([...errors, ...warns]).toEqual([]);
    });
  });

  describe('console output shape', () => {
    beforeEach(() => {
      EnvConfig.initFromValues(DEV);
    });

    it('keeps the [Scope] prefix convention the replaced calls already used', () => {
      createLogger('RequestBatcher').error('Network timeout; retrying');

      expect(errors[0][0]).toBe('[RequestBatcher] Network timeout; retrying');
    });

    it('omits the second argument when there is no detail', () => {
      createLogger('Scope').warn('no context here');

      // Passing `undefined` through would render a trailing "undefined" in the
      // console, which is what the old `console.error(msg, err)` calls did.
      expect(warns[0]).toHaveLength(1);
    });

    it('passes the detail through untouched, so an Error keeps its stack', () => {
      const err = new Error('kaboom');

      createLogger('Scope').error('failed', err);

      expect(errors[0][1]).toBe(err);
    });

    it('routes info and debug to console.log, not console.debug', () => {
      const log = createLogger('Scope');

      log.info('i');
      log.debug('d');

      // console.debug is hidden behind Chrome's default verbosity filter, so a
      // support engineer who asked for debug output would still see nothing.
      expect(logs).toHaveLength(2);
    });
  });

  describe('sink hook', () => {
    beforeEach(() => {
      EnvConfig.initFromValues(PROD);
    });

    it('forwards warnings and errors in production, where the console is silent', () => {
      const received: DiagnosticRecord[] = [];
      configureLogger({ sink: r => received.push(r) });
      const log = createLogger('Queue');

      log.error('dropped 3 events');
      log.warn('circuit breaker closed -> open');
      log.info('routine');
      log.debug('chatty');

      // A sink exists precisely to see production problems, so it must not
      // inherit the console's production silence. It does inherit a threshold:
      // warn and above, so routine chatter does not become a customer's bill.
      expect(received.map(r => r.level)).toEqual(['error', 'warn']);
      expect([...errors, ...warns, ...logs]).toEqual([]);
    });

    it('delivers a structured record rather than a formatted string', () => {
      const received: DiagnosticRecord[] = [];
      configureLogger({ sink: r => received.push(r) });
      const detail = { droppedEvents: 12 };

      createLogger('RequestBatcher').error('queue full', detail);

      const record = received[0];
      // The scope is a field, not embedded in the message: a telemetry backend
      // needs to group by subsystem without parsing "[RequestBatcher] ...".
      expect(record.scope).toBe('RequestBatcher');
      expect(record.message).toBe('queue full');
      expect(record.level).toBe('error');
      expect(record.detail).toBe(detail);
      expect(typeof record.timestamp).toBe('number');
    });

    it('receives debug records once debug is on', () => {
      const received: DiagnosticRecord[] = [];
      configureLogger({ debug: true, sink: r => received.push(r) });

      createLogger('Scope').debug('verbose');

      expect(received).toHaveLength(1);
    });

    it('honours an explicit sinkLevel independently of the console level', () => {
      const received: DiagnosticRecord[] = [];
      configureLogger({ level: 'silent', sinkLevel: 'debug', sink: r => received.push(r) });

      createLogger('Scope').debug('to telemetry only');

      expect(received).toHaveLength(1);
      expect(logs).toEqual([]);
    });

    it('swallows a throwing sink instead of surfacing it on the host page', () => {
      configureLogger({
        sink: () => {
          throw new Error('customer telemetry is down');
        },
      });

      // The assertion IS "does not throw". A customer's broken sink must never
      // become an unhandled error in their page — same contract as
      // RequestBatcher.reportError, which has always swallowed errorReporter
      // throws.
      expect(() => createLogger('Scope').error('boom')).not.toThrow();
    });

    it('still writes to the console when the sink throws', () => {
      EnvConfig.initFromValues(DEV);
      configureLogger({
        sink: () => {
          throw new Error('nope');
        },
      });

      createLogger('Scope').error('boom');

      // One broken channel must not take the other down with it.
      expect(errors).toHaveLength(1);
    });

    it('does not recurse when the sink throws', () => {
      let calls = 0;
      configureLogger({
        sink: () => {
          calls++;
          throw new Error('always');
        },
      });

      createLogger('Scope').error('boom');

      // Logging the swallowed failure would re-enter the sink and loop forever.
      expect(calls).toBe(1);
    });

    it('can be removed with sink: null', () => {
      const received: DiagnosticRecord[] = [];
      configureLogger({ sink: r => received.push(r) });
      configureLogger({ sink: null });

      createLogger('Scope').error('boom');

      expect(received).toEqual([]);
    });
  });

  describe('configuration merging', () => {
    it('leaves untouched fields alone, so one option does not clear another', () => {
      EnvConfig.initFromValues(PROD);
      const received: DiagnosticRecord[] = [];
      configureLogger({ sink: r => received.push(r) });
      configureLogger({ debug: true });

      createLogger('Scope').debug('verbose');

      // Callers set `debug` and `sink` from different places (config parsing vs a
      // later support toggle); a merge that reset the other would break both.
      expect(logs).toHaveLength(1);
      expect(received).toHaveLength(1);
    });

    it('restores defaults on reset, so state cannot leak between test files', () => {
      EnvConfig.initFromValues(PROD);
      configureLogger({ debug: true, sink: () => undefined });
      resetLogger();

      createLogger('Scope').error('boom');

      expect(errors).toEqual([]);
    });
  });
});
