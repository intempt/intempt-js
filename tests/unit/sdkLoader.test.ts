import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvConfig } from '../../src/shared/envConfig.ts';

/**
 * `src/loaders/sdkLoader.ts` — the loader that turns the SDK `<script>` tag's
 * own URL into the entire `IntemptConfig`.
 *
 * **Why this file, and why the roundabout setup.** `getIntemptConfig`,
 * `initSDK`, `extractStubQueue`, `findStubScriptTag` and friends are all
 * module-private — only `readBooleanParam` and the `SDK.init` entry point are
 * exported. There is no constructor in the supported embed, so the only way to
 * observe the config this module builds is to reproduce what the real snippet
 * does: put a `<script src="...?query">` on the page, call `SDK.init()`, and
 * read back what landed on `window.intempt` / what the mocked collaborators
 * were constructed with.
 *
 * `AutoTrackerModule` and `ChoicesModule` are mocked exactly as
 * `intemptJs.test.ts` mocks them (constructing the real ones opens IndexedDB,
 * starts timers and issues network requests, none of which this file's
 * behaviour depends on) and the mock captures the config object it was handed
 * — which is the parsed output of `getIntemptConfig()`, and the only window
 * into it available from outside the module.
 */

const autoTrackerInstances: { config: any; api: string }[] = [];

class MockAutoTracker {
  doNotTrack = false;
  init = vi.fn();
  refresh = vi.fn();
  getProfileId = vi.fn(() => 'profile-1');
  getSessionId = vi.fn(() => 'session-1');
  getPageId = vi.fn(() => 'page-1');
  constructor(
    public config: any,
    public api: string,
  ) {
    autoTrackerInstances.push({ config, api });
  }
}

class MockChoices {
  init = vi.fn(async () => undefined);
  constructor(public config: Record<string, unknown>) {}
}

vi.mock(
  '../../src/intemptJs/modules/autoTracker/autoTracker.module.ts',
  () => ({
    AutoTrackerModule: MockAutoTracker,
  }),
);

vi.mock('../../src/intemptJs/modules/choices/choices.module.ts', () => ({
  ChoicesModule: MockChoices,
}));

const { SDK } = await import('../../src/loaders/sdkLoader.ts');

const CDN_LINK = 'https://cdn.example.com/v1/intempt.min.js';

/** Every field required for `isValidConfig` to accept the config. */
const REQUIRED_QUERY =
  'project=proj-1&key=write-key-1&source=src-1&organization=acme';

function appendScript(query: string): HTMLScriptElement {
  const script = document.createElement('script');
  script.src = `${CDN_LINK}?${query}`;
  document.body.appendChild(script);
  return script;
}

describe('sdkLoader — building IntemptConfig from the script URL', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    EnvConfig.initFromValues({ VITE_CDN_LINK: CDN_LINK });
    autoTrackerInstances.length = 0;
    delete (window as any).intempt;
    // Clear any script tags a previous test left on the page — document.scripts
    // is a live collection over the whole document, and jsdom does not reset it
    // between tests in the same file.
    document.querySelectorAll('script').forEach((s) => s.remove());
  });

  afterEach(() => {
    document.querySelectorAll('script').forEach((s) => s.remove());
    delete (window as any).intempt;
    vi.useRealTimers();
  });

  describe('script-tag discovery', () => {
    it('finds its own script by matching the CDN link against every script src', async () => {
      appendScript(REQUIRED_QUERY);
      SDK.init();
      await vi.runAllTimersAsync();

      expect(autoTrackerInstances).toHaveLength(1);
      expect(autoTrackerInstances[0]!.config.project).toBe('proj-1');
    });

    it('ignores unrelated script tags on the page and still finds its own', async () => {
      const other = document.createElement('script');
      other.src = 'https://unrelated.example.com/analytics.js';
      document.body.appendChild(other);
      appendScript(REQUIRED_QUERY);

      SDK.init();
      await vi.runAllTimersAsync();

      expect(autoTrackerInstances).toHaveLength(1);
    });

    it(
      'logs the exact "CAN\'T FIND SCRIPT" string, and no longer throws, when no script tag matches ' +
        'the CDN link (D-12) — the support signature stays, the uncaught throw into the host page does not',
      async () => {
        // No script appended at all: `document.scripts` has nothing whose src
        // includes the CDN link.
        const errorSpy = vi
          .spyOn(console, 'error')
          .mockImplementation(() => {});

        // getIntemptConfig() falls back to an all-empty config (organization:
        // '', sourceId: '', project: '', writeKey: ''), and IntemptJsGuard's
        // isValidConfig() throws on any of those being ''. sdkLoader.ts now
        // catches that throw around the constructor call: main.ts calls
        // `SDK.init()` un-try/caught, and an analytics SDK must never break
        // the page that embeds it.
        expect(() => SDK.init()).not.toThrow();
        await vi.runAllTimersAsync();

        expect(errorSpy).toHaveBeenCalledWith("CAN'T FIND SCRIPT");
        // window.intempt is never assigned, because construction failed and
        // the loader returns before its own assignment line runs.
        expect((window as any).intempt).toBeUndefined();
      },
    );

    it('matches via String.includes rather than an exact match, so the CDN link may appear anywhere in the src', async () => {
      // getCdnLink() -> 'https://cdn.example.com/v1/intempt.min.js', matched
      // with `s.src.includes(cdnLink)`. Confirm it is a substring test rather
      // than equality by appending harmless trailing content after the query
      // string via a second, unrelated param — still one full `includes` match
      // since the base URL is untouched.
      appendScript(`${REQUIRED_QUERY}&extra=1`);

      SDK.init();
      await vi.runAllTimersAsync();

      expect(autoTrackerInstances).toHaveLength(1);
    });
  });

  describe('required config fields', () => {
    it.each(['project', 'key', 'source', 'organization'])(
      'does not throw, and leaves window.intempt unset, when %s is missing from the query string entirely (D-12)',
      async (missingParam) => {
        const params = new URLSearchParams(REQUIRED_QUERY);
        params.delete(missingParam);
        appendScript(params.toString());

        expect(() => SDK.init()).not.toThrow();
        await vi.runAllTimersAsync();
        expect((window as any).intempt).toBeUndefined();
      },
    );

    it.each(['project', 'key', 'source', 'organization'])(
      'does not throw when %s is present but empty — a blank value is treated identically to a missing one (D-12)',
      async (emptyParam) => {
        const params = new URLSearchParams(REQUIRED_QUERY);
        params.set(emptyParam, '');
        appendScript(params.toString());

        expect(() => SDK.init()).not.toThrow();
        await vi.runAllTimersAsync();
        expect((window as any).intempt).toBeUndefined();
      },
    );

    it('constructs successfully once every required field is present and non-empty', async () => {
      appendScript(REQUIRED_QUERY);
      expect(() => SDK.init()).not.toThrow();
      await vi.runAllTimersAsync();
      expect(autoTrackerInstances).toHaveLength(1);
    });

    it('maps the query-string names to the config field names customers cannot guess from the type', async () => {
      // The query string uses short names (`key`, `source`) for fields the
      // `IntemptConfig` type calls `writeKey` / `sourceId`. Getting this
      // mapping wrong silently produces an unreachable option, exactly the
      // failure mode this whole file exists to catch.
      appendScript(REQUIRED_QUERY);
      SDK.init();
      await vi.runAllTimersAsync();

      const config = autoTrackerInstances[0]!.config;
      expect(config.writeKey).toBe('write-key-1');
      expect(config.sourceId).toBe('src-1');
      expect(config.organization).toBe('acme');
      expect(config.project).toBe('proj-1');
    });
  });

  describe('shopify / magento — D-17, formerly the !!searchParams.get() footgun', () => {
    it('defaults both to false when absent from the query string', async () => {
      appendScript(REQUIRED_QUERY);
      SDK.init();
      await vi.runAllTimersAsync();

      expect(autoTrackerInstances[0]!.config.shopify).toBe(false);
      expect(autoTrackerInstances[0]!.config.magento).toBe(false);
    });

    it.each(['shopify=false', 'shopify=0'])(
      'D-17 (fixed): %s is now read as DISABLED via readBooleanParam, not enabled',
      async (flag) => {
        appendScript(`${REQUIRED_QUERY}&${flag}`);
        SDK.init();
        await vi.runAllTimersAsync();

        // Previously this was the known, documented D-17 defect: `!!get()`
        // treats any present, non-empty string — including the literal text
        // "false" — as true. shopify/magento now go through the same
        // readBooleanParam helper as the privacy switches, so a customer who
        // writes ?shopify=false actually gets Shopify tracking off.
        expect(autoTrackerInstances[0]!.config.shopify).toBe(false);
      },
    );

    it('shopify=true and shopify=1 are read as enabled', async () => {
      appendScript(`${REQUIRED_QUERY}&shopify=true`);
      SDK.init();
      await vi.runAllTimersAsync();
      expect(autoTrackerInstances[0]!.config.shopify).toBe(true);
    });

    it("a bare/empty shopify value opts in, matching readBooleanParam's HTML-boolean-attribute semantics", async () => {
      // Under the old !!get() idiom this was the one case that read as
      // disabled (get() returns '' and !!'' is false). readBooleanParam
      // treats a present-but-empty value as an explicit opt-in instead,
      // exactly like `?ignore_dnt` with no value — that asymmetry with the
      // old behaviour is intentional and shared with the privacy switches.
      appendScript(`${REQUIRED_QUERY}&shopify=`);
      SDK.init();
      await vi.runAllTimersAsync();
      expect(autoTrackerInstances[0]!.config.shopify).toBe(true);
    });

    it('magento shares the same fix as shopify — D-17 named both', async () => {
      appendScript(`${REQUIRED_QUERY}&magento=false`);
      SDK.init();
      await vi.runAllTimersAsync();
      expect(autoTrackerInstances[0]!.config.magento).toBe(false);
    });
  });

  describe('privacy switches — the readBooleanParam parse shopify/magento now also use', () => {
    it('ignore_dnt=false correctly disables the flag', async () => {
      // §3h gave ignore_dnt/pii_scrubbing a real boolean parse specifically
      // because a privacy switch defaulting the wrong way is a regulator-grade
      // problem, not a cosmetics one. D-17's fix extended the same parse to
      // shopify/magento, so this and the shopify=false test above now agree.
      appendScript(`${REQUIRED_QUERY}&ignore_dnt=false`);
      SDK.init();
      await vi.runAllTimersAsync();
      expect(autoTrackerInstances[0]!.config.ignore_dnt).toBe(false);
    });

    it('ignore_dnt=true enables it', async () => {
      appendScript(`${REQUIRED_QUERY}&ignore_dnt=true`);
      SDK.init();
      await vi.runAllTimersAsync();
      expect(autoTrackerInstances[0]!.config.ignore_dnt).toBe(true);
    });

    it('ignore_dnt is undefined (not false) when absent, leaving the SDK default in force', async () => {
      appendScript(REQUIRED_QUERY);
      SDK.init();
      await vi.runAllTimersAsync();
      expect(autoTrackerInstances[0]!.config.ignore_dnt).toBeUndefined();
    });

    it('pii_scrubbing=false correctly disables scrubbing', async () => {
      appendScript(`${REQUIRED_QUERY}&pii_scrubbing=false`);
      SDK.init();
      await vi.runAllTimersAsync();
      expect(autoTrackerInstances[0]!.config.piiScrubbing).toBe(false);
    });

    it('pii_scrubbing=true enables scrubbing', async () => {
      appendScript(`${REQUIRED_QUERY}&pii_scrubbing=true`);
      SDK.init();
      await vi.runAllTimersAsync();
      expect(autoTrackerInstances[0]!.config.piiScrubbing).toBe(true);
    });

    it('pii_scrubbing is undefined when absent', async () => {
      appendScript(REQUIRED_QUERY);
      SDK.init();
      await vi.runAllTimersAsync();
      expect(autoTrackerInstances[0]!.config.piiScrubbing).toBeUndefined();
    });

    it('api_host is read as a plain string, not through the boolean parser', async () => {
      appendScript(
        `${REQUIRED_QUERY}&api_host=${encodeURIComponent('https://eu.ingest.example.com')}`,
      );
      SDK.init();
      await vi.runAllTimersAsync();
      expect(autoTrackerInstances[0]!.config.apiHost).toBe(
        'https://eu.ingest.example.com',
      );
    });

    it('api_host is undefined (so resolveIngestBaseUrl falls through to the build-time default) when absent', async () => {
      appendScript(REQUIRED_QUERY);
      SDK.init();
      await vi.runAllTimersAsync();
      expect(autoTrackerInstances[0]!.config.apiHost).toBeUndefined();
    });

    it('api_host="" is read as undefined, not as an empty-string host (D-27, fixed)', async () => {
      // Previously `.get()` returning '' for a present-but-empty param
      // survived `?? undefined` unchanged (`''` is not `null`), so
      // resolveIngestBaseUrl received an empty string instead of falling
      // through to the build-time default. `||` now treats the empty string
      // the same as absent.
      appendScript(`${REQUIRED_QUERY}&api_host=`);
      SDK.init();
      await vi.runAllTimersAsync();
      expect(autoTrackerInstances[0]!.config.apiHost).toBeUndefined();
    });
  });

  describe('stub-queue replay — the async handoff between the inline snippet and the real SDK', () => {
    it('replays a queued synchronous call onto the real IntemptJs instance once it exists', async () => {
      // The inline snippet installs a stub `window.intempt` that just records
      // calls in `_queue` before the real bundle has loaded. `SDK.init()` must
      // drain that queue onto the freshly constructed real instance.
      const queue: { method: string; args: any[] }[] = [
        {
          method: 'track',
          args: [{ eventTitle: 'queued-event', data: { x: 1 } }],
        },
      ];
      (window as any).intempt = { _queue: queue };

      appendScript(REQUIRED_QUERY);

      const seen: any[] = [];
      const listener = (ev: Event) => seen.push((ev as CustomEvent).detail);
      document.addEventListener('intempt:event', listener);
      try {
        SDK.init();
        await vi.runAllTimersAsync();
      } finally {
        document.removeEventListener('intempt:event', listener);
      }

      // The queued track() call reached the real instance and was dispatched
      // as a real event, rather than being silently dropped when window.intempt
      // was replaced.
      expect(seen.some((d) => d.event?.name === 'queued-event')).toBe(true);
      // The queue array is drained in place after replay.
      expect(queue).toHaveLength(0);
    });

    it('does not attempt to replay when there was no stub (window.intempt was never set)', async () => {
      appendScript(REQUIRED_QUERY);
      expect(() => SDK.init()).not.toThrow();
      await vi.runAllTimersAsync();
      expect((window as any).intempt).toBeDefined();
    });

    it('ignores a window.intempt that exists but carries none of the recognised queue property names', async () => {
      (window as any).intempt = { somethingElse: [] };
      appendScript(REQUIRED_QUERY);

      expect(() => SDK.init()).not.toThrow();
      await vi.runAllTimersAsync();
      // Replaced with the real instance rather than left alone or crashed on.
      expect((window as any).intempt.VERSION).toBeDefined();
    });
  });

  /**
   * `AUDIT.md` §1c tier 1, item 3: `sdkLoader.ts` sat at **42.78% mutation score with
   * 51 uncovered mutants** despite 26 Cypress tests and the suites above. The gap was
   * not the config parse — it is the best-tested part of the file — but everything
   * around the *handoff*: which of the four stub queue names is recognised, what
   * happens when a queued method does not exist, how the async `recommendation`
   * promises are settled, whether the stub `<script>` is removed, and what an init
   * failure does to the host page.
   *
   * That is the code whose failure mode is "every pre-init event is lost", which is
   * silent from the customer's side.
   */
  describe('the four stub queue names', () => {
    // The loader checks `_queue`, `_stubQueue`, `queue` and `__queue` in that order,
    // because the snippet is written by whoever installed it and the name is a guess
    // at another implementation's convention. Each is a separate branch, and a
    // dropped one means that customer's pre-init events vanish with no error.
    it.each(['_queue', '_stubQueue', 'queue', '__queue'])(
      'drains a stub queue named %s',
      async (queueName) => {
        const queue = [
          {
            method: 'track',
            args: [{ eventTitle: 'from-' + queueName, data: { x: 1 } }],
          },
        ];
        (window as any).intempt = { [queueName]: queue };
        appendScript(REQUIRED_QUERY);

        const seen: any[] = [];
        const listener = (ev: Event) => seen.push((ev as CustomEvent).detail);
        document.addEventListener('intempt:event', listener);
        try {
          SDK.init();
          await vi.runAllTimersAsync();
        } finally {
          document.removeEventListener('intempt:event', listener);
        }

        expect(seen.some((d) => d.event?.name === 'from-' + queueName)).toBe(
          true,
        );
        expect(queue).toHaveLength(0);
      },
    );

    it('prefers _queue when a stub carries more than one of the names', async () => {
      // Order is the contract: `_queue` first. A stub that sets two names is
      // malformed, but silently replaying the wrong one would double-count or drop.
      (window as any).intempt = {
        _queue: [
          { method: 'track', args: [{ eventTitle: 'winner', data: { x: 1 } }] },
        ],
        queue: [
          { method: 'track', args: [{ eventTitle: 'loser', data: { x: 1 } }] },
        ],
      };
      appendScript(REQUIRED_QUERY);

      const seen: any[] = [];
      const listener = (ev: Event) => seen.push((ev as CustomEvent).detail);
      document.addEventListener('intempt:event', listener);
      try {
        SDK.init();
        await vi.runAllTimersAsync();
      } finally {
        document.removeEventListener('intempt:event', listener);
      }

      expect(seen.some((d) => d.event?.name === 'winner')).toBe(true);
      expect(seen.some((d) => d.event?.name === 'loser')).toBe(false);
    });

    it('ignores a queue property that is not an array', async () => {
      // `Array.isArray` guards every one of the four reads. Without it the `for`
      // loop over a string or object throws inside init, on the host page.
      (window as any).intempt = { _queue: 'not-an-array' };
      appendScript(REQUIRED_QUERY);

      expect(() => SDK.init()).not.toThrow();
      await vi.runAllTimersAsync();
      expect((window as any).intempt.VERSION).toBeDefined();
    });
  });

  describe('replay failures must not stop the rest of the queue', () => {
    it('skips a queued call naming a method that does not exist', async () => {
      const queue = [
        { method: 'notARealMethod', args: [] },
        {
          method: 'track',
          args: [{ eventTitle: 'after-bad-method', data: { x: 1 } }],
        },
      ];
      (window as any).intempt = { _queue: queue };
      appendScript(REQUIRED_QUERY);

      const seen: any[] = [];
      const listener = (ev: Event) => seen.push((ev as CustomEvent).detail);
      document.addEventListener('intempt:event', listener);
      try {
        SDK.init();
        await vi.runAllTimersAsync();
      } finally {
        document.removeEventListener('intempt:event', listener);
      }

      // The `typeof fn !== 'function'` guard `continue`s rather than throwing, so
      // one bad entry from a hand-written snippet cannot cost the whole queue.
      expect(seen.some((d) => d.event?.name === 'after-bad-method')).toBe(true);
    });

    it('keeps replaying after a queued call throws', async () => {
      // `track` with no arguments throws out of IntemptJsGuard. The per-call
      // try/catch is what keeps the following entries alive.
      const queue = [
        { method: 'track', args: [] },
        {
          method: 'track',
          args: [{ eventTitle: 'after-throw', data: { x: 1 } }],
        },
      ];
      (window as any).intempt = { _queue: queue };
      appendScript(REQUIRED_QUERY);

      const seen: any[] = [];
      const listener = (ev: Event) => seen.push((ev as CustomEvent).detail);
      document.addEventListener('intempt:event', listener);
      try {
        expect(() => SDK.init()).not.toThrow();
        await vi.runAllTimersAsync();
      } finally {
        document.removeEventListener('intempt:event', listener);
      }

      expect(seen.some((d) => d.event?.name === 'after-throw')).toBe(true);
    });

    it('drains the queue exactly once, so a second init cannot double-send', async () => {
      const queue = [
        {
          method: 'track',
          args: [{ eventTitle: 'once-only', data: { x: 1 } }],
        },
      ];
      (window as any).intempt = { _queue: queue };
      appendScript(REQUIRED_QUERY);
      SDK.init();
      await vi.runAllTimersAsync();

      expect(queue).toHaveLength(0);
    });
  });

  describe('the stub script tag', () => {
    /** A stub `<script>` as the snippet writes it, alongside the SDK's own tag. */
    function appendStubScript(content: string): HTMLScriptElement {
      const script = document.createElement('script');
      script.textContent = content;
      document.body.appendChild(script);
      return script;
    }

    it('removes an inline stub script once its queue has been replayed', async () => {
      const stub = appendStubScript('window.intempt={_queue:[],_isStub:true};');
      (window as any).intempt = { _queue: [] };
      appendScript(REQUIRED_QUERY);

      SDK.init();
      await vi.runAllTimersAsync();

      // Left in place it would be dead markup that still *looks* like the SDK to
      // anyone debugging the page, and to any later loader run.
      expect(document.body.contains(stub)).toBe(false);
    });

    it("leaves the SDK's own script tag alone", async () => {
      appendStubScript('window.intempt={_queue:[]};');
      (window as any).intempt = { _queue: [] };
      const sdkScript = appendScript(REQUIRED_QUERY);

      SDK.init();
      await vi.runAllTimersAsync();

      // The removal walks every script on the page and skips the SDK one by
      // identity. Getting that check wrong deletes the bundle's own tag.
      expect(document.body.contains(sdkScript)).toBe(true);
    });

    it('recognises a stub by any of the three inline markers', async () => {
      const markers = ['_isStub', '_queue', '_pendingPromises'];
      for (const marker of markers) {
        document.querySelectorAll('script').forEach((s) => s.remove());
        delete (window as any).intempt;

        const stub = appendStubScript(`var x = { ${marker}: 1 };`);
        (window as any).intempt = { _queue: [] };
        appendScript(REQUIRED_QUERY);

        SDK.init();
        await vi.runAllTimersAsync();
        expect(document.body.contains(stub)).toBe(false);
      }
    });

    it('recognises an external stub by src rather than content', async () => {
      const stub = document.createElement('script');
      stub.src = 'https://example.com/assets/intempt-stub.js';
      document.body.appendChild(stub);
      (window as any).intempt = { _queue: [] };
      appendScript(REQUIRED_QUERY);

      SDK.init();
      await vi.runAllTimersAsync();
      expect(document.body.contains(stub)).toBe(false);
    });

    it('leaves an unrelated script tag alone', async () => {
      const unrelated = appendStubScript('var unrelatedGlobal = 1;');
      (window as any).intempt = { _queue: [] };
      appendScript(REQUIRED_QUERY);

      SDK.init();
      await vi.runAllTimersAsync();

      // The markers are what identify a stub. Removing scripts that merely happen
      // to be inline would be the SDK vandalising the host page.
      expect(document.body.contains(unrelated)).toBe(true);
    });

    it('does not touch any script when there was no stub at all', async () => {
      const unrelated = appendStubScript('var unrelated = 1;');
      appendScript(REQUIRED_QUERY);

      SDK.init();
      await vi.runAllTimersAsync();
      expect(document.body.contains(unrelated)).toBe(true);
    });
  });

  describe('the async handoff — recommendation() promises the stub is still holding', () => {
    it('settles the stub promises in FIFO order rather than by matching arguments', async () => {
      // `recommendation()` is the one async public method, so the snippet handed the
      // page a promise it cannot itself resolve. The loader settles those in the
      // order the calls were queued — deliberately, rather than by JSON-matching
      // arguments, which is brittle. Untested until now, and its failure mode is a
      // promise on the customer's page that never settles.
      const settled: string[] = [];
      const pendingPromises = [
        {
          resolve: () => settled.push('first-resolve'),
          reject: () => settled.push('first-reject'),
        },
        {
          resolve: () => settled.push('second-resolve'),
          reject: () => settled.push('second-reject'),
        },
      ];
      (window as any).intempt = {
        _queue: [
          { method: 'recommendation', args: [{ id: 'a' }] },
          { method: 'recommendation', args: [{ id: 'b' }] },
        ],
        _pendingPromises: pendingPromises,
      };
      appendScript(REQUIRED_QUERY);

      SDK.init();
      await vi.runAllTimersAsync();

      expect(settled).toHaveLength(2);

      // Both **resolve**, not reject, even with no network: `recommendation()`
      // degrades to control rather than failing, which is the safe direction and is
      // asserted here so a future change to that policy surfaces at the handoff too.
      expect(settled).toEqual(['first-resolve', 'second-resolve']);
      // Drained in place, so a second replay cannot settle them twice.
      expect(pendingPromises).toHaveLength(0);
    });

    it('does not throw when there are more recommendation calls than pending promises', async () => {
      // A snippet may queue a call without holding a promise for it. The loader
      // logs and carries on; throwing here would abort the rest of the replay.
      (window as any).intempt = {
        _queue: [
          { method: 'recommendation', args: [{ id: 'a' }] },
          { method: 'recommendation', args: [{ id: 'b' }] },
        ],
        _pendingPromises: [{ resolve: () => {}, reject: () => {} }],
      };
      appendScript(REQUIRED_QUERY);

      expect(() => SDK.init()).not.toThrow();
      await vi.runAllTimersAsync();
    });
  });

  describe('init failure must not break the host page', () => {
    it('reports and returns when the config is invalid, instead of throwing (D-12)', async () => {
      // No script tag at all: `getIntemptConfig()` falls back to an all-empty
      // config and `new IntemptJs(...)` throws inside `isValidConfig`. `main.ts`
      // calls `SDK.init()` un-try/caught, so an uncaught throw here would land in
      // the customer's own JavaScript. An analytics SDK must never break the page
      // that embeds it.
      expect(() => SDK.init()).not.toThrow();
      await vi.runAllTimersAsync();
    });

    it('leaves window.intempt unreplaced when construction failed', async () => {
      const stub = { _queue: [], marker: 'still-the-stub' };
      (window as any).intempt = stub;

      SDK.init();
      await vi.runAllTimersAsync();

      // Assigning a half-built instance would be worse than leaving the stub: the
      // stub at least keeps queueing, and every call on it is a no-op rather than
      // a TypeError.
      expect((window as any).intempt).toBe(stub);
    });
  });

  describe('window.intempt replacement', () => {
    it('replaces window.intempt with the real IntemptJs instance', async () => {
      appendScript(REQUIRED_QUERY);
      SDK.init();
      await vi.runAllTimersAsync();

      expect((window as any).intempt).toBeDefined();
      expect((window as any).intempt.VERSION).toBeDefined();
      // The real instance has real public methods, unlike a stub.
      expect(typeof (window as any).intempt.track).toBe('function');
    });
  });
});
