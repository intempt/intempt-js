// EnvConfig is initialized in __tests__/support/index.ts before this file runs
import { EnvConfig } from '../src/shared/envConfig.ts';

const DEFAULT_TEST_CONFIG = {
  VITE_API: 'https://api.test.com',
  VITE_CDN_LINK: 'intempt.js',
  VITE_ENV: 'test' as const,
  VITE_CHOICES_API: 'https://choices-api.test.com',
  VITE_WEB_EDITOR_BASE_LINK: 'https://editor.test.com',
  VITE_OPENER_LINKS: '["https://opener.test.com"]',
  VITE_WEB_EDITOR_STORAGE_KEY: '__test_editor__',
  VITE_LOCATION_API_URL: '',
  DEV: false,
};

describe('EnvConfig - getOpenerOrigins', () => {
  afterEach(() => {
    EnvConfig.reset();
    EnvConfig.initFromValues(DEFAULT_TEST_CONFIG);
  });

  it('returns origins from VITE_OPENER_LINKS JSON array', () => {
    EnvConfig.reset();
    EnvConfig.initFromValues({
      ...DEFAULT_TEST_CONFIG,
      VITE_OPENER_LINKS: '["https://app.intempt.com/", "https://app.staging.intempt.com/"]',
    });
    const origins = EnvConfig.getOpenerOrigins();
    expect(origins).to.deep.equal(['https://app.intempt.com', 'https://app.staging.intempt.com']);
  });

  it('deduplicates and normalizes origins (trailing slash removed)', () => {
    EnvConfig.reset();
    EnvConfig.initFromValues({
      ...DEFAULT_TEST_CONFIG,
      VITE_OPENER_LINKS: '["https://app.test.com/", "https://app.test.com"]',
    });
    const origins = EnvConfig.getOpenerOrigins();
    expect(origins).to.deep.equal(['https://app.test.com']);
  });

  it('skips invalid URLs and returns valid origins', () => {
    EnvConfig.reset();
    EnvConfig.initFromValues({
      ...DEFAULT_TEST_CONFIG,
      VITE_OPENER_LINKS: '["https://valid.com", "not-a-url", "https://also-valid.com/"]',
    });
    const origins = EnvConfig.getOpenerOrigins();
    expect(origins).to.deep.equal(['https://valid.com', 'https://also-valid.com']);
  });

  it('returns empty array when VITE_OPENER_LINKS is empty', () => {
    EnvConfig.reset();
    EnvConfig.initFromValues({
      ...DEFAULT_TEST_CONFIG,
      VITE_OPENER_LINKS: '',
    });
    const origins = EnvConfig.getOpenerOrigins();
    expect(origins).to.deep.equal([]);
  });
});
