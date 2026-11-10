import { EditorPayload } from '../intemptJs/types/intemptJs.types.ts';
import { EnvConfig } from '../shared/envConfig.ts';

import { createLogger } from '../shared/logger/logger.ts';

const log = createLogger('WebEditor');

class WebEditor {
  private readonly CHANNEL: string;
  private readonly CHANNEL_KEY: string = 'channel';
  private get BASE(): string {
    return EnvConfig.getWebEditorBaseLink();
  }
  private get CSS_URL(): string {
    return `${this.BASE}/app.style.css`;
  }
  private get JS_URL(): string {
    return `${this.BASE}/app.js`;
  }
  private readonly HOST_ID: string = 'intempt-root-host';
  private readonly APP_ID: string = 'intempt-editor-root';
  private readonly ALLOWED_ORIGINS: readonly string[];
  /** `?openerOrigin=` (trailing slashes stripped, as in `main.ts`); `''` if absent. */
  private readonly OPENER_ORIGIN: string;
  private __INTEMPT_EDITOR_MOUNTED: boolean = false;
  private _readyAcked: boolean = false;
  private _readyInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const qs = new URLSearchParams(location.search);
    this.CHANNEL = qs.get(`${this.CHANNEL_KEY}`) || '';
    this.ALLOWED_ORIGINS = EnvConfig.getOpenerOrigins();
    this.OPENER_ORIGIN = (qs.get('openerOrigin') || '').replace(/\/+$/, '');
  }

  /**
   * INT-3957: build the mount payload from exactly the six fields of the
   * web-editor's `EditorPayload`, type-checked. Anything else in the message is
   * dropped. Returns `null` on a bad shape.
   */
  private toEditorPayload(raw: unknown): EditorPayload | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const p = raw as Record<string, unknown>;
    const { organization, project, experience, variantId, token, view } = p;

    if (
      typeof organization !== 'string' ||
      typeof project !== 'string' ||
      typeof variantId !== 'string' ||
      typeof token !== 'string' ||
      typeof view !== 'string' ||
      !experience ||
      !variantId ||
      !token
    ) {
      return null;
    }

    return { organization, project, experience, variantId, token, view };
  }

  init() {
    const onReady = () => this.postReadyWithRetry();
    const listener = (event: MessageEvent) =>
      this.handleMessageFromOpener(event);

    window.addEventListener('message', listener);

    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', onReady, { once: true });
    } else this.postReadyWithRetry();
  }

  private ensureShadowHost() {
    let host = document.getElementById(this.HOST_ID) as HTMLElement | null;
    if (!host) {
      host = document.createElement('div');
      host.id = this.HOST_ID;
      document.documentElement.appendChild(host);
    }

    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });

    let appRoot = shadow.getElementById(this.APP_ID) as HTMLElement | null;
    if (!appRoot) {
      appRoot = document.createElement('div');
      appRoot.id = this.APP_ID;
      shadow.appendChild(appRoot);
    }

    return { shadow, appRoot };
  }

  private handleMessageFromOpener(event: MessageEvent) {
    if (!this.ALLOWED_ORIGINS.includes(event.origin)) return;
    // INT-3953: when the page was opened with `?openerOrigin=`, only that exact
    // origin may drive the editor — not any other allow-listed one.
    if (this.OPENER_ORIGIN && event.origin !== this.OPENER_ORIGIN) return;

    const msg = event.data || {};

    let chOk = true;

    let editorPayload: EditorPayload | null = null;

    if (msg?.type === 'INIT') {
      this._readyAcked = true;
      if (this._readyInterval) {
        clearInterval(this._readyInterval);
        this._readyInterval = null;
      }

      editorPayload = this.toEditorPayload(msg.payload);

      if (this.CHANNEL && msg.channel !== this.CHANNEL) chOk = false;
    }

    if (!chOk) return;

    // `unknown`: this is handed to `postMessage`, which structured-clones whatever
    // it is given. Nothing here reads it.
    const reply = (payload: unknown) => {
      try {
        (event.source as Window)?.postMessage(payload, event.origin);
      } catch {}
    };

    if (!editorPayload) {
      log.warn('INIT payload rejected: invalid shape');
      reply({
        type: 'ACK',
        ok: false,
        error: 'invalid_payload',
        channel: this.CHANNEL,
      });
      return;
    }

    try {
      if (this.__INTEMPT_EDITOR_MOUNTED) return; // guard
      const { shadow, appRoot } = this.ensureShadowHost();
      return Promise.all([
        this.injectCssIntoShadow(this.CSS_URL, shadow),
        this.injectWebEditorScript(editorPayload, appRoot),
      ]);
    } catch (e) {
      log.warn('failed to write session or mount editor', e);
      reply({
        type: 'ACK',
        ok: false,
        error: 'init_failed',
        channel: this.CHANNEL,
      });
      return;
    }
  }

  private postReadyWithRetry() {
    let tries = 0;
    const maxTries = 5;
    this._readyInterval = setInterval(() => {
      if ((this._readyAcked || tries++ >= maxTries) && this._readyInterval) {
        clearInterval(this._readyInterval);
        if (!this._readyAcked) {
          log.warn(`READY not acknowledged after ${maxTries} tries, giving up`);
        }
        return;
      }

      try {
        for (const origin of this.ALLOWED_ORIGINS) {
          window.opener?.postMessage(
            { type: 'READY', channel: this.CHANNEL },
            origin,
          );
        }
        if (this.ALLOWED_ORIGINS.length > 0) log.debug('READY sent');
      } catch (e) {
        log.warn('postReady failed', e);
      }
    }, 200);
  }

  private async injectCssIntoShadow(url: string, shadow: ShadowRoot) {
    // Try fetch + Constructable Stylesheets (best isolation/perf)
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const css = await res.text();

      if (
        'adoptedStyleSheets' in Document.prototype &&
        'replaceSync' in CSSStyleSheet.prototype
      ) {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        // append without breaking existing sheets
        // `adoptedStyleSheets` on a ShadowRoot is guarded by the feature test
        // above; the cast names the one property being reached for rather than
        // widening the whole root to `any`.
        const adoptive = shadow as ShadowRoot & {
          adoptedStyleSheets: CSSStyleSheet[];
        };
        adoptive.adoptedStyleSheets = [...adoptive.adoptedStyleSheets, sheet];
      } else {
        const style = document.createElement('style');
        style.textContent = css;
        shadow.appendChild(style);
      }
      return;
    } catch (e) {
      log.warn(
        'CSS fetch failed or CORS blocked; falling back to <link> in shadow',
        e,
      );
    }

    // Fallback: <link rel="stylesheet"> inside shadow (works in modern Chromium/Firefox)
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    shadow.appendChild(link);
  }

  private async injectWebEditorScript(
    payload: EditorPayload,
    appRoot: HTMLElement,
  ) {
    // @vite-ignore keeps Vite from trying to pre-bundle/transform the URL
    // A remote module fetched at runtime, so its shape is genuinely unknown until
    // it is checked — which is what the `mount` test below does.
    const mod: {
      mount?: (root: HTMLElement, payload: EditorPayload) => unknown;
    } = await import(/* @vite-ignore */ this.JS_URL);

    const globalMount = (
      window as Window & {
        __INTEMPT_MOUNT?: (root: HTMLElement, payload: EditorPayload) => void;
      }
    ).__INTEMPT_MOUNT;

    if (mod?.mount) {
      // Same clean payload as the fallback (INT-3706): web-editor's
      // `mount(target, payload)` needs it.
      await mod.mount(appRoot, payload);
    } else if (globalMount) {
      globalMount(appRoot, payload); // fallback: global mount function
    } else {
      throw new Error(
        'No mount function exported or on window.__INTEMPT_MOUNT',
      );
    }

    this.__INTEMPT_EDITOR_MOUNTED = true;
    log.debug('editor mounted');
  }
}

export const WEB_EDITOR = new WebEditor();
