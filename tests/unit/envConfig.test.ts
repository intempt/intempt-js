import { afterEach, describe, expect, it } from 'vitest';
import { EnvConfig } from '../../src/shared/envConfig.ts';

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
      VITE_LOCATION_API_URL: 'https://geo.example.com',
      VITE_ENV: 'staging',
      DEV: true,
    });

    expect(EnvConfig.getApi()).toBe('https://api.example.com');
    expect(EnvConfig.getCdnLink()).toBe('https://cdn.example.com');
    expect(EnvConfig.getChoicesApi()).toBe('https://choices.example.com');
    expect(EnvConfig.getWebEditorBaseLink()).toBe('https://editor.example.com');
    expect(EnvConfig.getWebEditorStorageKey()).toBe('editor_key');
    expect(EnvConfig.getLocationApiUrl()).toBe('https://geo.example.com');
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

  it('merges partial config over defaults instead of blanking the rest', () => {
    EnvConfig.initFromValues({ VITE_API: 'https://only-this.example.com' });

    expect(EnvConfig.getApi()).toBe('https://only-this.example.com');
    expect(EnvConfig.getEnv()).toBe('production');
  });

  describe('getOpenerOrigins', () => {
    it('parses a JSON array', () => {
      EnvConfig.initFromValues({
        VITE_OPENER_LINKS: JSON.stringify(['https://a.example.com/x', 'https://b.example.com']),
      });
      expect(EnvConfig.getOpenerOrigins()).toEqual(['https://a.example.com', 'https://b.example.com']);
    });

    it('parses a comma-separated list', () => {
      EnvConfig.initFromValues({
        VITE_OPENER_LINKS: 'https://a.example.com, https://b.example.com',
      });
      expect(EnvConfig.getOpenerOrigins()).toEqual(['https://a.example.com', 'https://b.example.com']);
    });

    it('reduces each entry to its origin and de-duplicates', () => {
      // This list gates postMessage from the visual web editor, so a path or a
      // duplicate slipping through would widen what the SDK trusts.
      EnvConfig.initFromValues({
        VITE_OPENER_LINKS: 'https://a.example.com/one,https://a.example.com/two',
      });
      expect(EnvConfig.getOpenerOrigins()).toEqual(['https://a.example.com']);
    });

    it('drops malformed URLs rather than trusting them', () => {
      EnvConfig.initFromValues({
        VITE_OPENER_LINKS: 'not-a-url,https://good.example.com',
      });
      expect(EnvConfig.getOpenerOrigins()).toEqual(['https://good.example.com']);
    });

    it('returns an empty list when unset', () => {
      EnvConfig.initFromValues({ VITE_OPENER_LINKS: '   ' });
      expect(EnvConfig.getOpenerOrigins()).toEqual([]);
    });
  });
});
