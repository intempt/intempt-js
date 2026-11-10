import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * INT-2483 — experience custom JS carries the page's CSP nonce.
 *
 * The nonce is captured once at bundle load (`document.currentScript` is null
 * afterwards), so each case re-imports the modules with a fresh registry.
 */

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

function addScript(nonce?: string, parent: HTMLElement = document.head) {
  const s = document.createElement('script');
  if (nonce) s.setAttribute('nonce', nonce);
  parent.appendChild(s);
  return s;
}

async function loadNonce() {
  return (await import('../../src/shared/cspNonce.ts')).getSdkScriptNonce();
}

describe('getSdkScriptNonce (INT-2483)', () => {
  it("uses the SDK's own <script> nonce (document.currentScript)", async () => {
    addScript('page-other');
    const own = addScript('sdk-own');
    vi.spyOn(document, 'currentScript', 'get').mockReturnValue(own);

    expect(await loadNonce()).toBe('sdk-own');
  });

  it('falls back to the first nonce on the page (the loader snippet)', async () => {
    addScript();
    addScript('snippet-nonce');
    vi.spyOn(document, 'currentScript', 'get').mockReturnValue(null);

    expect(await loadNonce()).toBe('snippet-nonce');
  });

  it('is undefined when the page has no nonce (no CSP)', async () => {
    addScript();
    vi.spyOn(document, 'currentScript', 'get').mockReturnValue(null);

    expect(await loadNonce()).toBeUndefined();
  });

  it('is captured at load, not re-read later', async () => {
    vi.spyOn(document, 'currentScript', 'get').mockReturnValue(null);
    const get = await import('../../src/shared/cspNonce.ts');
    addScript('added-after-load');

    expect(get.getSdkScriptNonce()).toBeUndefined();
  });
});

describe('insert runs custom JS with the nonce (INT-2483)', () => {
  async function insertWithJs() {
    document.body.innerHTML = '<div id="p" iwe1="true"></div>';
    const { WebEditorModificationHandler } =
      await import('../../src/intemptJs/modules/choices/models/WebEditorModificationHandler.ts');
    const appended: HTMLScriptElement[] = [];
    const orig = document.body.append.bind(document.body);
    vi.spyOn(document.body, 'append').mockImplementation((...nodes) => {
      nodes.forEach((n) => {
        if (n instanceof HTMLScriptElement) appended.push(n);
      });
      orig(...nodes);
    });
    await new WebEditorModificationHandler().insert({
      html: '<b>x</b>',
      parent: { _iweId: 'iwe1' },
      js: 'void 0',
    } as any);
    return appended;
  }

  it('sets the captured nonce on the appended script', async () => {
    addScript('page-nonce');
    vi.spyOn(document, 'currentScript', 'get').mockReturnValue(null);

    const scripts = await insertWithJs();

    expect(scripts).toHaveLength(1);
    expect(scripts[0]!.getAttribute('nonce')).toBe('page-nonce');
  });

  it('sets no nonce attribute when the page has none', async () => {
    vi.spyOn(document, 'currentScript', 'get').mockReturnValue(null);

    const scripts = await insertWithJs();

    expect(scripts).toHaveLength(1);
    expect(scripts[0]!.hasAttribute('nonce')).toBe(false);
  });
});
