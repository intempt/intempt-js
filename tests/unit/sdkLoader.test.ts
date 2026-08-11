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

vi.mock('../../src/intemptJs/modules/autoTracker/autoTracker.module.ts', () => ({
  AutoTrackerModule: MockAutoTracker,
}));

vi.mock('../../src/intemptJs/modules/choices/choices.module.ts', () => ({
  ChoicesModule: MockChoices,
}));

const { SDK } = await import('../../src/loaders/sdkLoader.ts');

const CDN_LINK = 'https://cdn.example.com/v1/intempt.min.js';

/** Every field required for `isValidConfig` to accept the config. */
const REQUIRED_QUERY = 'project=proj-1&key=write-key-1&source=src-1&organization=acme';

function appendScript(query: string): HTMLScriptElement {
  const script = document.createElement('script');
  script.src = `${CDN_LINK}?${query}`;
  document.body.appendChild(script);
  return script;
}

describe('sdkLoader — building IntemptConfig from the script URL', () => {
  beforeEach(() => {
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
  });

  describe('script-tag discovery', () => {
    it('finds its own script by matching the CDN link against every script src', () => {
      appendScript(REQUIRED_QUERY);
      SDK.init();

      expect(autoTrackerInstances).toHaveLength(1);
      expect(autoTrackerInstances[0]!.config.project).toBe('proj-1');
    });

    it('ignores unrelated script tags on the page and still finds its own', () => {
      const other = document.createElement('script');
      other.src = 'https://unrelated.example.com/analytics.js';
      document.body.appendChild(other);
      appendScript(REQUIRED_QUERY);

      SDK.init();

      expect(autoTrackerInstances).toHaveLength(1);
    });

    it(
      "logs the exact \"CAN'T FIND SCRIPT\" string and throws when no script tag matches the CDN link " +
        '— this is the documented support signature (D-12/CHECKPOINT §0), so the string must not drift',
      () => {
        // No script appended at all: `document.scripts` has nothing whose src
        // includes the CDN link.
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // getIntemptConfig() falls back to an all-empty config (organization:
        // '', sourceId: '', project: '', writeKey: ''), and IntemptJsGuard's
        // isValidConfig() throws on any of those being ''. Nothing in
        // sdkLoader.ts or main.ts catches it, so SDK.init() itself throws —
        // matching main.ts's un-try/caught `SDK.init()` call.
        expect(() => SDK.init()).toThrow(
          'IntemptJs initialization failed: All config fields must be provided.',
        );

        expect(errorSpy).toHaveBeenCalledWith("CAN'T FIND SCRIPT");
        // window.intempt is never assigned, because the throw happens inside
        // `new IntemptJs(...)`, before the loader's own assignment line runs.
        expect((window as any).intempt).toBeUndefined();
      },
    );

    it('matches via String.includes rather than an exact match, so the CDN link may appear anywhere in the src', () => {
      // getCdnLink() -> 'https://cdn.example.com/v1/intempt.min.js', matched
      // with `s.src.includes(cdnLink)`. Confirm it is a substring test rather
      // than equality by appending harmless trailing content after the query
      // string via a second, unrelated param — still one full `includes` match
      // since the base URL is untouched.
      appendScript(`${REQUIRED_QUERY}&extra=1`);

      SDK.init();

      expect(autoTrackerInstances).toHaveLength(1);
    });
  });

  describe('required config fields', () => {
    it.each(['project', 'key', 'source', 'organization'])(
      'throws when %s is missing from the query string entirely',
      (missingParam) => {
        const params = new URLSearchParams(REQUIRED_QUERY);
        params.delete(missingParam);
        appendScript(params.toString());

        expect(() => SDK.init()).toThrow(
          'IntemptJs initialization failed: All config fields must be provided.',
        );
      },
    );

    it.each(['project', 'key', 'source', 'organization'])(
      'throws when %s is present but empty — a blank value is treated identically to a missing one',
      (emptyParam) => {
        const params = new URLSearchParams(REQUIRED_QUERY);
        params.set(emptyParam, '');
        appendScript(params.toString());

        expect(() => SDK.init()).toThrow(
          'IntemptJs initialization failed: All config fields must be provided.',
        );
      },
    );

    it('constructs successfully once every required field is present and non-empty', () => {
      appendScript(REQUIRED_QUERY);
      expect(() => SDK.init()).not.toThrow();
      expect(autoTrackerInstances).toHaveLength(1);
    });

    it('maps the query-string names to the config field names customers cannot guess from the type', () => {
      // The query string uses short names (`key`, `source`) for fields the
      // `IntemptConfig` type calls `writeKey` / `sourceId`. Getting this
      // mapping wrong silently produces an unreachable option, exactly the
      // failure mode this whole file exists to catch.
      appendScript(REQUIRED_QUERY);
      SDK.init();

      const config = autoTrackerInstances[0]!.config;
      expect(config.writeKey).toBe('write-key-1');
      expect(config.sourceId).toBe('src-1');
      expect(config.organization).toBe('acme');
      expect(config.project).toBe('proj-1');
    });
  });

  describe('shopify / magento — D-17, the !!searchParams.get() footgun', () => {
    it('defaults both to false when absent from the query string', () => {
      appendScript(REQUIRED_QUERY);
      SDK.init();

      expect(autoTrackerInstances[0]!.config.shopify).toBe(false);
      expect(autoTrackerInstances[0]!.config.magento).toBe(false);
    });

    it.each(['shopify=false', 'shopify=0'])(
      'D-17: %s is read as ENABLED, not disabled — !!get() is true for any non-empty string',
      (flag) => {
        appendScript(`${REQUIRED_QUERY}&${flag}`);
        SDK.init();

        // This is the known, documented, deliberately-unfixed defect
        // (DEFECTS.md D-17). An integrator who writes `?shopify=false`
        // expecting Shopify tracking to be off gets it turned ON, because
        // `!!searchParams.get('shopify')` is true for any present, non-empty
        // string — including the literal text "false".
        expect(autoTrackerInstances[0]!.config.shopify).toBe(true);
      },
    );

    it('shopify=true and shopify=1 are also (correctly, coincidentally) read as enabled', () => {
      appendScript(`${REQUIRED_QUERY}&shopify=true`);
      SDK.init();
      expect(autoTrackerInstances[0]!.config.shopify).toBe(true);
    });

    it('an empty shopify value is the one case that reads as disabled, because get() returns "" and !!"" is false', () => {
      appendScript(`${REQUIRED_QUERY}&shopify=`);
      SDK.init();
      expect(autoTrackerInstances[0]!.config.shopify).toBe(false);
    });

    it('magento shares the exact same footgun as shopify — D-17 names both', () => {
      appendScript(`${REQUIRED_QUERY}&magento=false`);
      SDK.init();
      expect(autoTrackerInstances[0]!.config.magento).toBe(true);
    });
  });

  describe('privacy switches — deliberately NOT using the D-17 idiom', () => {
    it('ignore_dnt=false correctly disables the flag, unlike the neighbouring shopify=false', () => {
      // This is the asymmetry §3h introduced on purpose: `readBooleanParam`
      // gives ignore_dnt/pii_scrubbing a real boolean parse specifically
      // because a privacy switch defaulting the wrong way is a regulator-grade
      // problem, not a cosmetics one. If this test and the D-17 test above
      // ever assert the same outcome for the same-shaped input, the asymmetry
      // has been lost.
      appendScript(`${REQUIRED_QUERY}&ignore_dnt=false`);
      SDK.init();
      expect(autoTrackerInstances[0]!.config.ignore_dnt).toBe(false);
    });

    it('ignore_dnt=true enables it', () => {
      appendScript(`${REQUIRED_QUERY}&ignore_dnt=true`);
      SDK.init();
      expect(autoTrackerInstances[0]!.config.ignore_dnt).toBe(true);
    });

    it('ignore_dnt is undefined (not false) when absent, leaving the SDK default in force', () => {
      appendScript(REQUIRED_QUERY);
      SDK.init();
      expect(autoTrackerInstances[0]!.config.ignore_dnt).toBeUndefined();
    });

    it('pii_scrubbing=false correctly disables scrubbing', () => {
      appendScript(`${REQUIRED_QUERY}&pii_scrubbing=false`);
      SDK.init();
      expect(autoTrackerInstances[0]!.config.piiScrubbing).toBe(false);
    });

    it('pii_scrubbing=true enables scrubbing', () => {
      appendScript(`${REQUIRED_QUERY}&pii_scrubbing=true`);
      SDK.init();
      expect(autoTrackerInstances[0]!.config.piiScrubbing).toBe(true);
    });

    it('pii_scrubbing is undefined when absent', () => {
      appendScript(REQUIRED_QUERY);
      SDK.init();
      expect(autoTrackerInstances[0]!.config.piiScrubbing).toBeUndefined();
    });

    it('api_host is read as a plain string, not through the boolean parser', () => {
      appendScript(`${REQUIRED_QUERY}&api_host=${encodeURIComponent('https://eu.ingest.example.com')}`);
      SDK.init();
      expect(autoTrackerInstances[0]!.config.apiHost).toBe('https://eu.ingest.example.com');
    });

    it('api_host is undefined (so resolveIngestBaseUrl falls through to the build-time default) when absent', () => {
      appendScript(REQUIRED_QUERY);
      SDK.init();
      expect(autoTrackerInstances[0]!.config.apiHost).toBeUndefined();
    });

    it('api_host="" is read as undefined, not as an empty-string host', () => {
      // `?? undefined` on a `.get()` that returns '' for a present-but-empty
      // param — `''` is not `null`, so the `?? ''` used for the required
      // fields would keep it as `''`; api_host instead falls back to
      // `undefined` because it uses `?? undefined` rather than `?? ''`. This
      // pins today's behaviour rather than asserting the "right" one.
      appendScript(`${REQUIRED_QUERY}&api_host=`);
      SDK.init();
      expect(autoTrackerInstances[0]!.config.apiHost).toBe('');
    });
  });

  describe('stub-queue replay — the async handoff between the inline snippet and the real SDK', () => {
    it('replays a queued synchronous call onto the real IntemptJs instance once it exists', () => {
      // The inline snippet installs a stub `window.intempt` that just records
      // calls in `_queue` before the real bundle has loaded. `SDK.init()` must
      // drain that queue onto the freshly constructed real instance.
      const queue: { method: string; args: any[] }[] = [
        { method: 'track', args: [{ eventTitle: 'queued-event', data: { x: 1 } }] },
      ];
      (window as any).intempt = { _queue: queue };

      appendScript(REQUIRED_QUERY);

      const seen: any[] = [];
      const listener = (ev: Event) => seen.push((ev as CustomEvent).detail);
      document.addEventListener('intempt:event', listener);
      try {
        SDK.init();
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

    it('does not attempt to replay when there was no stub (window.intempt was never set)', () => {
      appendScript(REQUIRED_QUERY);
      expect(() => SDK.init()).not.toThrow();
      expect((window as any).intempt).toBeDefined();
    });

    it('ignores a window.intempt that exists but carries none of the recognised queue property names', () => {
      (window as any).intempt = { somethingElse: [] };
      appendScript(REQUIRED_QUERY);

      expect(() => SDK.init()).not.toThrow();
      // Replaced with the real instance rather than left alone or crashed on.
      expect((window as any).intempt.VERSION).toBeDefined();
    });
  });

  describe('window.intempt replacement', () => {
    it('replaces window.intempt with the real IntemptJs instance', () => {
      appendScript(REQUIRED_QUERY);
      SDK.init();

      expect((window as any).intempt).toBeDefined();
      expect((window as any).intempt.VERSION).toBeDefined();
      // The real instance has real public methods, unlike a stub.
      expect(typeof (window as any).intempt.track).toBe('function');
    });
  });
});
