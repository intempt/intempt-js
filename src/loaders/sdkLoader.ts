import { IntemptConfig } from '../intemptJs/types/intemptJs.types.ts';
import { IntemptJs } from '../intemptJs/intemptJs.ts';
import { EnvConfig } from '../shared/envConfig.ts';

import { createLogger } from '../shared/logger/logger.ts';

const log = createLogger('Intempt');

type QueuedCall = {
  method: string;
  /**
   * Whatever the host page passed to the stub before the real SDK arrived, so
   * `unknown[]`: it is spread straight back into the real method via `apply`,
   * which does not require knowing the types, and the method's own guard is what
   * validates them.
   */
  args: unknown[];
  timestamp?: number;
};

/**
 * A promise the stub handed the host page and is still holding open, so the real
 * SDK can settle it once the queued call actually runs. Both handlers are optional
 * because the stub is written by whoever installed the snippet, not by us — this is
 * the shape we hope for, checked before use.
 */
type PendingStubPromise = {
  resolve?: (value: unknown) => void;
  reject?: (reason?: unknown) => void;
};

/**
 * The pre-init stub, as it may exist on `window` when this bundle loads. Every
 * field is optional and every name is a guess at another implementation's
 * convention — that is why the reads below check four different queue names before
 * giving up. Typed as a shape rather than `any` so those reads are visibly
 * defensive instead of accidentally permitted.
 */
type IntemptStub = {
  _queue?: unknown;
  _stubQueue?: unknown;
  queue?: unknown;
  __queue?: unknown;
  _pendingPromises?: unknown;
};

/**
 * Read a boolean from a script-URL query parameter.
 *
 * A real boolean parse, rather than the `!!searchParams.get(name)` idiom this
 * replaced everywhere it appeared (D-17). That shorthand treated `?shopify=false`
 * as **true**, because any non-empty string is truthy — including the literal
 * text "false". Fixed to a single shared helper so every boolean query
 * parameter — `shopify`, `magento`, and the privacy switches — parses the same
 * way; the privacy switches were the first to get this treatment, since
 * `?ignore_dnt=false` silently meaning "ignore the visitor's Do Not Track
 * signal" is the kind of default that ends up in a regulator's finding.
 */
export function readBooleanParam(
  params: URLSearchParams,
  name: string,
): boolean | undefined {
  const raw = params.get(name);
  if (raw === null) return undefined;

  const normalized = raw.trim().toLowerCase();
  if (
    normalized === '' ||
    normalized === 'true' ||
    normalized === '1' ||
    normalized === 'yes'
  ) {
    // A bare `?ignore_dnt` with no value reads as opting in to the flag, which is
    // how HTML boolean attributes behave and therefore what an author expects.
    return true;
  }
  return false;
}

function getIntemptConfig(): IntemptConfig {
  const cdnLink = EnvConfig.getCdnLink();
  const scripts = document.scripts;

  const intemptScript = Array.from(scripts).find((s) =>
    s.src.includes(cdnLink),
  );
  if (!intemptScript) {
    // Deliberately a raw, unconditional console.error and NOT routed through the
    // logger.
    //
    // Everything else in the SDK is silent in production by default, which is
    // the right default — except here. This branch means the bundle could not
    // find its own <script> tag, so it has no write key, no source id and no
    // config at all: nothing will ever be tracked, and the logger cannot have
    // been configured (`debug: true` arrives *with* the config we just failed to
    // read), so a levelled call would be swallowed in exactly the case where the
    // message is the only diagnostic that exists. It is also the known signature
    // of the mutable `/v1` CDN path coupling, and support has told customers to
    // look for this exact string. Changing it would break that.
    // eslint-disable-next-line no-console -- deliberate: see the comment above.
    console.error("CAN'T FIND SCRIPT");
    return {
      project: '',
      writeKey: '',
      sourceId: '',
      organization: '',
      shopify: false,
      magento: false,
    };
  }

  const source = new URL(intemptScript.src);
  return {
    project: source.searchParams.get('project') ?? '',
    writeKey: source.searchParams.get('key') ?? '',
    sourceId: source.searchParams.get('source') ?? '',
    organization: source.searchParams.get('organization') ?? '',
    shopify: readBooleanParam(source.searchParams, 'shopify') ?? false,
    magento: readBooleanParam(source.searchParams, 'magento') ?? false,

    // Privacy switches. These have to be readable here or they are unreachable:
    // there is no constructor in the supported embed — the snippet configures the
    // SDK entirely through this script URL, so an option that only exists on
    // `IntemptConfig` is an option no customer can actually set.
    //
    // `piiScrubbing` is boolean-only from the URL. Its object form (custom
    // patterns, key lists) has no sane query-string encoding, and a half-encoded
    // redaction rule is worse than none.
    ignore_dnt: readBooleanParam(source.searchParams, 'ignore_dnt'),
    piiScrubbing: readBooleanParam(source.searchParams, 'pii_scrubbing'),
    // `?? undefined` alone is not enough: `.get()` returns `''` (not `null`)
    // for a present-but-empty `?api_host=`, so `?? undefined` never fires and
    // `resolveIngestBaseUrl` receives an empty string instead of falling
    // through to the build-time default (D-27). Treat an empty value the same
    // as an absent one.
    apiHost: source.searchParams.get('api_host') || undefined,
  };
}

/**
 * Extracts queued calls from stub if it exists
 * Checks multiple possible queue property names for compatibility
 */
function extractStubQueue(): QueuedCall[] | null {
  if (!window.intempt) return null;

  const stub = window.intempt as IntemptStub;

  if (Array.isArray(stub._queue)) return stub._queue as QueuedCall[];
  if (Array.isArray(stub._stubQueue)) return stub._stubQueue as QueuedCall[];
  if (Array.isArray(stub.queue)) return stub.queue as QueuedCall[];
  if (Array.isArray(stub.__queue)) return stub.__queue as QueuedCall[];

  return null;
}

/**
 * Extracts pending promises from stub if it exists
 */
function extractStubPromises(): PendingStubPromise[] | null {
  if (!window.intempt) return null;

  const stub = window.intempt as IntemptStub;
  if (Array.isArray(stub._pendingPromises)) {
    return stub._pendingPromises as PendingStubPromise[];
  }

  return null;
}

/**
 * Finds and returns the stub script tag element
 * Returns null if no stub script is found
 */
function findStubScriptTag(): HTMLScriptElement | null {
  const cdnLink = EnvConfig.getCdnLink();
  const scripts = Array.from(document.scripts);

  // Find the SDK script tag (the one we need to keep)
  const sdkScript = scripts.find((s) => s.src.includes(cdnLink));

  // Find stub script - it's any script that:
  // 1. Is NOT the SDK script
  // 2. Either has inline content with stub markers OR src pointing to stub file
  for (const script of scripts) {
    // Skip the SDK script
    if (script === sdkScript) continue;

    // Check if inline script contains stub markers
    const hasStubMarkers =
      script.textContent?.includes('_isStub') ||
      script.textContent?.includes('_queue') ||
      script.textContent?.includes('_pendingPromises');

    // Check if external script points to stub file
    const isStubFile =
      script.src &&
      (script.src.includes('stub') || script.src.includes('standalone'));

    if (hasStubMarkers || isStubFile) {
      return script;
    }
  }

  return null;
}

/**
 * Removes the stub script tag from the DOM
 * Only removes if stub was detected and processed
 */
function removeStubScriptTag(): void {
  try {
    const stubScript = findStubScriptTag();
    if (stubScript && stubScript.parentNode) {
      stubScript.parentNode.removeChild(stubScript);

      log.debug('removed stub script tag');
    }
  } catch (error) {
    // Silently fail - removal is optional cleanup
    log.warn('failed to remove stub script tag', error);
  }
}

/**
 * Replays queued calls from stub on the real IntemptJs instance
 * Handles both sync and async methods, resolving promises for async calls.
 *
 * Important: For async `recommendation()` calls we resolve stub promises in FIFO order.
 * This is robust and avoids brittle JSON.stringify matching.
 */
function replayQueuedCalls(
  realIntempt: IntemptJs,
  queue: QueuedCall[],
  pendingPromises: PendingStubPromise[] | null,
): void {
  if (!queue || queue.length === 0) return;

  log.debug(`replaying ${queue.length} queued calls from stub`);

  for (const call of queue) {
    try {
      // Indexed by a string that came off the page, so the lookup is unavoidably
      // dynamic; `unknown` then forces the `typeof` check below rather than
      // trusting it to be callable.
      const fn = (realIntempt as unknown as Record<string, unknown>)[
        call.method
      ];
      if (typeof fn !== 'function') {
        log.warn(`method ${call.method} not found on IntemptJs instance`);
        continue;
      }

      const result = (fn as (...args: unknown[]) => unknown).apply(
        realIntempt,
        call.args,
      );

      // Handle async methods (recommendation returns Promise)
      if (result instanceof Promise) {
        let promiseInfo: PendingStubPromise | null = null;

        // Resolve stub promises for recommendation in the same order calls were queued.
        if (pendingPromises && call.method === 'recommendation') {
          if (pendingPromises.length > 0) {
            promiseInfo = pendingPromises.shift() ?? null; // FIFO
          } else {
            log.warn('no pending promise found for recommendation call');
          }
        }

        if (promiseInfo?.resolve) {
          const settle = promiseInfo;
          result
            .then((data: unknown) => settle.resolve?.(data))
            .catch((err: unknown) => {
              if (settle.reject) settle.reject(err);
              else log.error(`error in async queued call ${call.method}`, err);
            });
        } else {
          // No promise to resolve, just handle errors
          result.catch((err: unknown) => {
            log.error(`error in async queued call ${call.method}`, err);
          });
        }
      }
    } catch (error) {
      log.error(`error replaying queued call ${call.method}`, error);
    }
  }

  // Optional: clear extracted arrays to prevent accidental double-replay
  try {
    queue.length = 0;
    if (pendingPromises) pendingPromises.length = 0;
  } catch {}
}

function initSDK() {
  // Extract from stub BEFORE replacing window.intempt
  const stubQueue = extractStubQueue();
  const stubPromises = extractStubPromises();

  // Check if stub existed (we'll need this to know if we should remove it)
  const hadStub = stubQueue !== null;

  // Create real IntemptJs instance.
  //
  // When the script tag can't be found, getIntemptConfig() falls back to an
  // all-empty config, and `new IntemptJs(...)` throws inside isValidConfig
  // (D-12). Nothing downstream catches that — main.ts calls `SDK.init()`
  // un-try/caught — so an uncaught throw here would propagate into the host
  // page and could break the customer's own JavaScript, not just our
  // tracking. An analytics SDK must never break the page that embeds it
  // (the same principle consentCookie.ts's cookie helpers apply): report it
  // loudly through the logger and return without throwing.
  let realIntempt: IntemptJs;
  try {
    realIntempt = new IntemptJs({ ...getIntemptConfig() });
  } catch (error) {
    log.error(
      'IntemptJs failed to initialize; the SDK will not track on this page',
      error,
    );
    return;
  }

  // Replace window.intempt with real instance
  window.intempt = realIntempt;

  // Replay queued calls if stub existed
  if (stubQueue && stubQueue.length > 0) {
    replayQueuedCalls(realIntempt, stubQueue, stubPromises);
  }

  // Remove stub script tag if stub existed
  if (hadStub) {
    removeStubScriptTag();
  }

  log.info('SDK initialized', window.intempt);
}

const IDLE_TIMEOUT_MS = 2000;

function runWhenIdle(fn: () => void): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(fn, { timeout: IDLE_TIMEOUT_MS });
  } else {
    setTimeout(fn, 0);
  }
}

export const SDK = {
  init: () => runWhenIdle(initSDK),
};
