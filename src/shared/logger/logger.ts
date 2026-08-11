import { EnvConfig } from '../envConfig.ts';

/**
 * Structured, levelled diagnostics for the SDK.
 *
 * ## Why this exists
 *
 * Before this module the SDK's entire observability story was 55 raw `console.*`
 * calls, each gated — when it was gated at all — on `EnvConfig.isProduction()`.
 * That has three consequences, and all three are support problems:
 *
 *  - **Production is silent, with no way to un-silence it.** The one situation
 *    where a diagnostic is worth anything is a customer incident, and that is
 *    exactly the build that prints nothing. The only remedy was to ship a
 *    staging bundle to a customer's page.
 *  - **There is no severity.** `console.log` for a swallowed exception and
 *    `console.log` for "editor mounted" are indistinguishable to anyone reading
 *    a browser console, so nobody reads it.
 *  - **Nothing can be forwarded.** A customer with Sentry or Datadog could not
 *    see SDK failures at all; the diagnostics only ever reached a human sitting
 *    in front of devtools with the right build.
 *
 * So: four levels, two independent thresholds (console and sink), and a `debug`
 * switch that turns verbose output on **in production** for a support case.
 *
 * ## Two thresholds, not one
 *
 * The console channel and the sink channel are gated separately on purpose. The
 * console default has to stay quiet in production — a chatty SDK on a customer's
 * page is a bug, and the existing behaviour is what customers already expect.
 * But a *sink* is code the customer opted into precisely so it would receive
 * errors in production, so gating it on the console's threshold would make the
 * feature useless in the only environment it matters in. Hence `warn` and above
 * goes to the sink by default while the console stays silent.
 *
 * ## Relationship to `errorReporter`
 *
 * `RequestBatcher` and `PersistentStore` already take an `errorReporter`
 * callback. That hook is **narrower and stays**: it is a per-instance,
 * queue-specific error channel that the batcher's own tests drive. This logger
 * complements it — `reportError` now writes to both, so the batcher's callers
 * keep the callback they wired, and a customer who sets a sink also sees those
 * same failures without having to construct a batcher.
 *
 * The sink copies one important property from `reportError`: **exceptions thrown
 * by the customer's callback are swallowed.** A broken sink must never surface
 * as an unhandled error on the host page. An analytics SDK that can break the
 * page it measures is worse than no analytics SDK.
 *
 * ## Bundle cost
 *
 * This ships to every customer page and bundle size is a tracked metric, so:
 * no classes, no formatter, no dependency, no timestamp formatting, and record
 * objects are only allocated when a channel is actually going to consume them.
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

/** A threshold. `'silent'` accepts nothing; the rest accept themselves and above. */
export type LogThreshold = LogLevel | 'silent';

export interface DiagnosticRecord {
  level: LogLevel;
  /** Subsystem name, e.g. `RequestBatcher`. Rendered as `[RequestBatcher]`. */
  scope: string;
  message: string;
  /** Whatever context the call site had — usually an `Error`. */
  detail?: unknown;
  /** `Date.now()` at emit time. Unformatted; a sink may want the raw number. */
  timestamp: number;
}

/**
 * A customer-supplied consumer of SDK diagnostics.
 *
 * Called synchronously. Must not throw — but if it does, the throw is swallowed
 * (see the note above), so a bug here degrades diagnostics rather than the page.
 */
export type DiagnosticSink = (record: DiagnosticRecord) => void;

export interface LoggerOptions {
  /**
   * Verbose output regardless of environment. This is the support switch: set
   * `debug: true` in the SDK config and a production bundle starts printing at
   * `debug` level.
   */
  debug?: boolean;
  /** Explicit console threshold. Overrides both `debug` and the env default. */
  level?: LogThreshold;
  /** Threshold for the sink. Defaults to `warn`, or `debug` when `debug` is on. */
  sinkLevel?: LogThreshold;
  /** Where to forward diagnostics. `null` clears a previously set sink. */
  sink?: DiagnosticSink | null;
}

/**
 * Numeric ranks. Higher accepts more. `silent` is 0 so nothing can pass it —
 * every real level is >= 1.
 */
const RANK: Record<LogThreshold, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

let debugEnabled = false;
/** `null` means "derive from the environment" — see `consoleThreshold()`. */
let explicitLevel: LogThreshold | null = null;
let explicitSinkLevel: LogThreshold | null = null;
let sink: DiagnosticSink | null = null;

/**
 * Console threshold.
 *
 * The production default is `silent`, which reproduces today's behaviour
 * exactly: every `!EnvConfig.isProduction()` guard in the old code amounted to
 * "print everything outside production, nothing inside it". `debug: true` lifts
 * it, which is the entire point of the option.
 */
function consoleThreshold(): LogThreshold {
  if (explicitLevel) return explicitLevel;
  if (debugEnabled) return 'debug';
  return EnvConfig.isProduction() ? 'silent' : 'debug';
}

function sinkThreshold(): LogThreshold {
  if (explicitSinkLevel) return explicitSinkLevel;
  return debugEnabled ? 'debug' : 'warn';
}

/**
 * Apply configuration. Merges, so callers can set one field without clearing
 * the others; `sink: null` is the way to remove a sink.
 */
export function configureLogger(options: LoggerOptions = {}): void {
  if (options.debug !== undefined) debugEnabled = !!options.debug;
  if (options.level !== undefined) explicitLevel = options.level;
  if (options.sinkLevel !== undefined) explicitSinkLevel = options.sinkLevel;
  if (options.sink !== undefined) sink = options.sink;
}

/** Restore defaults. Exists for tests — module state is global and leaks otherwise. */
export function resetLogger(): void {
  debugEnabled = false;
  explicitLevel = null;
  explicitSinkLevel = null;
  sink = null;
}

/** True when `level` would reach the console right now. */
export function isConsoleEnabled(level: LogLevel): boolean {
  return RANK[level] <= RANK[consoleThreshold()];
}

/**
 * `info` and `debug` both go to `console.log` rather than `console.info` /
 * `console.debug`: `console.debug` is hidden behind a verbosity filter in
 * Chrome's default console view, so a support engineer who asked for
 * `debug: true` would still see nothing.
 */
function writeToConsole(record: DiagnosticRecord): void {
  const line = `[${record.scope}] ${record.message}`;
  const method =
    record.level === 'error'
      ? console.error
      : record.level === 'warn'
        ? console.warn
        : console.log;

  // Only pass the second argument when there is one, so a message with no
  // context does not render a trailing `undefined`.
  if (record.detail === undefined) {
    method(line);
  } else {
    method(line, record.detail);
  }
}

function emit(
  level: LogLevel,
  scope: string,
  message: string,
  detail?: unknown,
): void {
  const toConsole = RANK[level] <= RANK[consoleThreshold()];
  const toSink = !!sink && RANK[level] <= RANK[sinkThreshold()];
  if (!toConsole && !toSink) {
    return;
  }

  const record: DiagnosticRecord = {
    level,
    scope,
    message,
    timestamp: Date.now(),
  };
  if (detail !== undefined) {
    record.detail = detail;
  }

  if (toConsole) {
    writeToConsole(record);
  }

  if (toSink && sink) {
    try {
      sink(record);
    } catch {
      // A customer's broken sink must not become an unhandled error on their
      // page. Same reasoning as RequestBatcher.reportError, which has swallowed
      // errorReporter throws since it was written. Deliberately not logged
      // either: a sink that throws on every record would then recurse.
    }
  }
}

export interface ScopedLogger {
  error(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
  info(message: string, detail?: unknown): void;
  debug(message: string, detail?: unknown): void;
  readonly scope: string;
}

/**
 * A logger bound to one subsystem.
 *
 * The scope is rendered as `[RequestBatcher] message`, matching the prefix
 * convention the pre-existing `console.*` calls already used — so console output
 * is recognisably the same, and the sink gets the scope as a separate field
 * instead of embedded in the string.
 */
export function createLogger(scope: string): ScopedLogger {
  return {
    scope,
    error: (message, detail) => emit('error', scope, message, detail),
    warn: (message, detail) => emit('warn', scope, message, detail),
    info: (message, detail) => emit('info', scope, message, detail),
    debug: (message, detail) => emit('debug', scope, message, detail),
  };
}
