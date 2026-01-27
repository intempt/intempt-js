// Setup EnvConfig for all tests
// This must run before any modules that use EnvConfig are imported
import { EnvConfig } from '../../src/shared/envConfig.ts';

// Initialize EnvConfig with test values
EnvConfig.initFromValues({
  VITE_API: 'https://api.test.com',
  VITE_CDN_LINK: 'intempt.js',
  VITE_ENV: 'test',
  VITE_CHOICES_API: 'https://choices-api.test.com',
  VITE_WEB_EDITOR_BASE_LINK: 'https://editor.test.com',
  VITE_OPENER_LINK: 'https://opener.test.com',
  VITE_WEB_EDITOR_STORAGE_KEY: '__test_editor__',
  VITE_LOCATION_API_URL: '',
  DEV: false,
});
