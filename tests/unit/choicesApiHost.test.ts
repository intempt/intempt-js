import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntemptJs } from '../../src/intemptJs/intemptJs.ts';
import { EnvConfig } from '../../src/shared/envConfig.ts';

/**
 * INT-5180: `apiHost` was honoured for tracking, consent and choose-api, but the
 * personalization (`choose-web`) request built its URL from `EnvConfig.getApi()`
 * and so always went to the build-time host. These run a real `IntemptJs` with
 * only `fetch` stubbed.
 */

const CONFIG = {
  organization: 'acme',
  sourceId: 'src-choices',
  project: 'proj-1',
  writeKey: 'wk-user.wk-pass',
  shopify: false,
  magento: false,
};

let urls: string[] = [];

const choiceUrls = () =>
  urls.filter((u) => u.includes('/optimization/choose-web'));

async function waitForChoicesRequest() {
  for (let i = 0; i < 100 && choiceUrls().length === 0; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(() => {
  urls = [];
  vi.stubGlobal('fetch', async (url: string) => {
    urls.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [] }),
      text: async () => '',
    };
  });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('choices request host (INT-5180)', () => {
  it('uses a valid apiHost', async () => {
    new IntemptJs({ ...CONFIG, apiHost: 'https://eu.example.test' });
    await waitForChoicesRequest();
    expect(choiceUrls()[0]).toBe(
      'https://eu.example.test/acme/projects/proj-1/optimization/choose-web',
    );
  });

  it('uses the build-time default when no apiHost is set', async () => {
    new IntemptJs({ ...CONFIG });
    await waitForChoicesRequest();
    expect(choiceUrls()[0]).toBe(
      `${EnvConfig.getApi()}/acme/projects/proj-1/optimization/choose-web`,
    );
  });

  it('falls back to the build-time default for an invalid apiHost', async () => {
    new IntemptJs({ ...CONFIG, apiHost: 'http://insecure.example.test' });
    await waitForChoicesRequest();
    expect(choiceUrls()[0]).toBe(
      `${EnvConfig.getApi()}/acme/projects/proj-1/optimization/choose-web`,
    );
  });
});
