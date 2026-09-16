import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnvConfig } from '../../src/shared/envConfig.ts';

/**
 * The literal DEFAULT_CONFIG, spelled out rather than imported.
 *
 * Importing the real object would make this a tautology: a mutant that changes
 * `VITE_ENV: 'production'` would change both sides of the assertion and survive.
 * Duplicating the values is the point — it is the second copy that makes the
 * comparison able to fail.
 */
const DEFAULTS = {
  VITE_API: '',
  VITE_CDN_LINK: '',
  VITE_ENV: 'production',
  VITE_CHOICES_API: '',
  VITE_WEB_EDITOR_BASE_LINK: '',
  VITE_OPENER_LINKS: '',
  VITE_WEB_EDITOR_STORAGE_KEY: '',
  DEV: false,
};

/**
 * EnvConfig is the single funnel for build-time configuration (CLAUDE.md forbids
 * reading `import.meta.env` anywhere else), so a wrong answer here misroutes
 * every request the SDK makes — including sending production traffic at a
 * staging endpoint.
 */
describe('EnvConfig', () => {
  afterEach(() => {
    EnvConfig.reset();
  });

  it('auto-initialises with defaults rather than throwing', () => {
    EnvConfig.reset();
    expect(EnvConfig.isInitialized()).toBe(false);

    // Called during bundling before any init, so it must be safe.
    expect(EnvConfig.get()).toBeTruthy();
    expect(EnvConfig.isInitialized()).toBe(true);
  });

  it('defaults to production, the safe assumption for debug output', () => {
    EnvConfig.reset();
    expect(EnvConfig.isProduction()).toBe(true);
    expect(EnvConfig.isDevelopment()).toBe(false);
    expect(EnvConfig.isStaging()).toBe(false);
  });

  it('exposes injected values through the typed getters', () => {
    EnvConfig.initFromValues({
      VITE_API: 'https://api.example.com',
      VITE_CDN_LINK: 'https://cdn.example.com',
      VITE_CHOICES_API: 'https://choices.example.com',
      VITE_WEB_EDITOR_BASE_LINK: 'https://editor.example.com',
      VITE_WEB_EDITOR_STORAGE_KEY: 'editor_key',
      VITE_ENV: 'staging',
      DEV: true,
    });

    expect(EnvConfig.getApi()).toBe('https://api.example.com');
    expect(EnvConfig.getCdnLink()).toBe('https://cdn.example.com');
    expect(EnvConfig.getChoicesApi()).toBe('https://choices.example.com');
    expect(EnvConfig.getWebEditorBaseLink()).toBe('https://editor.example.com');
    expect(EnvConfig.getWebEditorStorageKey()).toBe('editor_key');
    expect(EnvConfig.getEnv()).toBe('staging');
    expect(EnvConfig.isDev()).toBe(true);
  });

  it('reports the environment exclusively', () => {
    EnvConfig.initFromValues({ VITE_ENV: 'staging' });
    expect(EnvConfig.isStaging()).toBe(true);
    expect(EnvConfig.isProduction()).toBe(false);

    EnvConfig.initFromValues({ VITE_ENV: 'development' });
    expect(EnvConfig.isDevelopment()).toBe(true);
    expect(EnvConfig.isProduction()).toBe(false);

    EnvConfig.initFromValues({ VITE_ENV: 'production' });
    expect(EnvConfig.isProduction()).toBe(true);
    expect(EnvConfig.isDevelopment()).toBe(false);
  });

  it('falls back to the documented default for every single field', () => {
    // Kills the eight DEFAULT_CONFIG literal mutants plus the whole-object one:
    // each default is asserted by value, so flipping `VITE_ENV` to `''` or
    // `DEV` to `true` is visible here and nowhere else. These mutants only
    // entered the score once `mainBootstrap.test.ts` began re-importing
    // `main.ts` inside a test — before that they were module-load-time (static)
    // and `ignoreStatic` dropped them.
    EnvConfig.reset();
    expect(EnvConfig.get()).toEqual(DEFAULTS);
  });

  it('merges partial config over defaults instead of blanking the rest', () => {
    EnvConfig.initFromValues({ VITE_API: 'https://only-this.example.com' });

    expect(EnvConfig.getApi()).toBe('https://only-this.example.com');
    expect(EnvConfig.getEnv()).toBe('production');
  });

  describe('getOpenerOrigins', () => {
    it('parses a JSON array', () => {
      EnvConfig.initFromValues({
        VITE_OPENER_LINKS: JSON.stringify([
          'https://a.example.com/x',
          'https://b.example.com',
        ]),
      });
      expect(EnvConfig.getOpenerOrigins()).toEqual([
        'https://a.example.com',
        'https://b.example.com',
      ]);
    });

    it('parses a comma-separated list', () => {
      EnvConfig.initFromValues({
        VITE_OPENER_LINKS: 'https://a.example.com, https://b.example.com',
      });
      expect(EnvConfig.getOpenerOrigins()).toEqual([
        'https://a.example.com',
        'https://b.example.com',
      ]);
    });

    it('reduces each entry to its origin and de-duplicates', () => {
      // This list gates postMessage from the visual web editor, so a path or a
      // duplicate slipping through would widen what the SDK trusts.
      EnvConfig.initFromValues({
        VITE_OPENER_LINKS:
          'https://a.example.com/one,https://a.example.com/two',
      });
      expect(EnvConfig.getOpenerOrigins()).toEqual(['https://a.example.com']);
    });

    it('drops malformed URLs rather than trusting them', () => {
      EnvConfig.initFromValues({
        VITE_OPENER_LINKS: 'not-a-url,https://good.example.com',
      });
      expect(EnvConfig.getOpenerOrigins()).toEqual([
        'https://good.example.com',
      ]);
    });

    it('returns an empty list when unset', () => {
      EnvConfig.initFromValues({ VITE_OPENER_LINKS: '   ' });
      expect(EnvConfig.getOpenerOrigins()).toEqual([]);
    });
  });

  /**
   * `initFromVite()` is the path production actually takes — it is what the
   * module-level auto-init at the bottom of envConfig.ts calls, and every other
   * entry point (`initFromValues`) exists for tests. It had no direct test at
   * all: it was reached only as a side effect of importing the module, so
   * Stryker classified its mutants as static and `ignoreStatic` kept them out
   * of the score entirely. They are in the score now, so they are tested now.
   *
   * `vi.stubEnv` writes through to `import.meta.env`, which is the one source
   * `initFromVite()` reads.
   */
  describe('initFromVite', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      EnvConfig.reset();
    });

    it('copies every field out of import.meta.env', () => {
      // Kills, per field, the `viteEnv.X || DEFAULT.X` -> `&&` LogicalOperator
      // mutant (which would yield the empty default) and both ConditionalExpression
      // mutants (`true` / `false` in place of the whole expression). It also kills
      // the four mutants that would leave `viteEnv` null — an emptied
      // `initFromVite` body, an emptied `try`, an emptied `if` body, and
      // `if (false)` — because every one of them lands on the defaults instead
      // of these values. Same for `if (!viteEnv)` flipped to `if (viteEnv)` or
      // `if (true)`, and for `this.instance = {}`.
      vi.stubEnv('VITE_API', 'https://api.vite.example.com');
      vi.stubEnv('VITE_CDN_LINK', 'https://cdn.vite.example.com');
      vi.stubEnv('VITE_ENV', 'staging');
      vi.stubEnv('VITE_CHOICES_API', 'https://choices.vite.example.com');
      vi.stubEnv(
        'VITE_WEB_EDITOR_BASE_LINK',
        'https://editor.vite.example.com',
      );
      vi.stubEnv('VITE_OPENER_LINKS', 'https://opener.vite.example.com');
      vi.stubEnv('VITE_WEB_EDITOR_STORAGE_KEY', 'vite_editor_key');
      vi.stubEnv('DEV', true);

      EnvConfig.reset();
      EnvConfig.initFromVite();

      expect(EnvConfig.get()).toEqual({
        VITE_API: 'https://api.vite.example.com',
        VITE_CDN_LINK: 'https://cdn.vite.example.com',
        VITE_ENV: 'staging',
        VITE_CHOICES_API: 'https://choices.vite.example.com',
        VITE_WEB_EDITOR_BASE_LINK: 'https://editor.vite.example.com',
        VITE_OPENER_LINKS: 'https://opener.vite.example.com',
        VITE_WEB_EDITOR_STORAGE_KEY: 'vite_editor_key',
        DEV: true,
      });
    });

    it('falls back to the defaults for fields import.meta.env omits', () => {
      // The other half of each `||`: an absent field must produce the default,
      // not `undefined`. Stubbing to `undefined` deletes the key, so this is the
      // real shape of a build that did not define these variables.
      for (const key of Object.keys(DEFAULTS)) {
        vi.stubEnv(key, undefined);
      }

      EnvConfig.reset();
      EnvConfig.initFromVite();

      expect(EnvConfig.get()).toEqual(DEFAULTS);
    });

    it('keeps an explicit empty VITE_OPENER_LINKS rather than coercing it', () => {
      // This field alone uses `??`, not `||`, so an empty string must survive as
      // an empty string. Swapping `??` for `||` is indistinguishable here, but
      // the ConditionalExpression mutants that replace the expression with
      // `true` or `false` are not.
      vi.stubEnv('VITE_OPENER_LINKS', '');

      EnvConfig.reset();
      EnvConfig.initFromVite();

      expect(EnvConfig.get().VITE_OPENER_LINKS).toBe('');
      expect(EnvConfig.getOpenerOrigins()).toEqual([]);
    });

    /**
     * These two re-import the module *inside* the test body on purpose.
     *
     * The class's static `DEFAULT_CONFIG` initializer and the auto-init block at
     * the bottom of the file both run exactly once, at module evaluation. A
     * top-level `import` evaluates them before any test starts, so Stryker's
     * per-test coverage attributes those mutants to whichever test happened to
     * re-import the module — until this file existed, only
     * `mainBootstrap.test.ts`, which asserts nothing about env defaults. Pulling
     * the evaluation into a test body is what puts them in reach of an
     * assertion.
     */
    it('auto-initialises from import.meta.env at module load', async () => {
      vi.stubEnv('VITE_API', 'https://autoinit.example.com');
      vi.resetModules();

      const mod = await import('../../src/shared/envConfig.ts');

      // Kills the mutants that delete the auto-init: an emptied `try`, an
      // emptied `if` body, and `if (false)` all leave the module uninitialised,
      // which `get()` would silently paper over with defaults — so assert the
      // flag, not just the value.
      expect(mod.EnvConfig.isInitialized()).toBe(true);
      expect(mod.EnvConfig.getApi()).toBe('https://autoinit.example.com');
    });

    it('builds DEFAULT_CONFIG with the documented values at module load', async () => {
      for (const key of Object.keys(DEFAULTS)) {
        vi.stubEnv(key, undefined);
      }
      vi.resetModules();

      const mod = await import('../../src/shared/envConfig.ts');
      mod.EnvConfig.reset();

      expect(mod.EnvConfig.get()).toEqual(DEFAULTS);
    });

    it('honours DEV=false from the build instead of the default', () => {
      // Kills the EqualityOperator mutant on `viteEnv.DEV !== undefined`: with
      // `===` the ternary takes the default branch, and since the default is
      // also `false` only the `true` case above distinguishes them. This case
      // pins the other direction so the pair is unambiguous.
      vi.stubEnv('DEV', false);
      vi.stubEnv('VITE_ENV', 'development');

      EnvConfig.reset();
      EnvConfig.initFromVite();

      expect(EnvConfig.isDev()).toBe(false);
      expect(EnvConfig.isDevelopment()).toBe(true);
    });
  });
});
