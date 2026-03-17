import { EditorPayload } from '../intemptJs/types/intemptJs.types.ts';
import { EnvConfig } from '../shared/envConfig.ts';



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
  private readonly HOST_ID :string = 'intempt-root-host';
  private readonly APP_ID  :string = 'intempt-editor-root';
  private readonly ALLOWED_ORIGINS: readonly string[];
  /** Set when a message is received from an origin in ALLOWED_ORIGINS; used for postMessage targetOrigin */
  private _allowedOrigin: string | null = null;
  private __INTEMPT_EDITOR_MOUNTED :boolean = false;
  private _readyAcked  :boolean = false;
  private _readyInterval: ReturnType<typeof setInterval> | null = null;



  constructor() {
    const qs = new URLSearchParams(location.search);
    this.CHANNEL = qs.get(`${this.CHANNEL_KEY}`) || '';
    this.ALLOWED_ORIGINS = EnvConfig.getOpenerOrigins();
  }




  init() {
    const onReady = () => this.postReadyWithRetry();
    const listener = (event: MessageEvent) => this.handleMessageFromOpener(event);

    window.addEventListener('message', listener)

    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', onReady, { once: true });
    }
    else this.postReadyWithRetry();


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
    this._allowedOrigin = event.origin;

    const msg = event.data || {};

    let chOk= true;

    let editorPayload: EditorPayload = {
      experience: undefined,
      variantId: '',
      token: '',
    };


    if (msg?.type === 'INIT') {

      this._readyAcked = true;
      if (this._readyInterval) {
        clearInterval(this._readyInterval);
        this._readyInterval = null;
      }

      const p = msg.payload || {};
      editorPayload = {...p};

      if (this.CHANNEL && msg.channel && msg.channel !== this.CHANNEL) chOk = false;
    }


    if (!chOk) return;

    const reply = (payload: any) => {
      try { (event.source as Window)?.postMessage(payload, event.origin); } catch {}
    };



    const { experience, variantId, token } = editorPayload

    if (!experience || !variantId || !token) {
      reply({ type: 'ACK', ok: false, error: 'invalid_payload', channel: this.CHANNEL });
      return;
    }

    try {
      if (this.__INTEMPT_EDITOR_MOUNTED) return; // guard
      const { shadow, appRoot } = this.ensureShadowHost();
      return Promise.all([
        this.injectCssIntoShadow(this.CSS_URL, shadow),
        this.injectWebEditorScript(editorPayload, appRoot),
      ])
    }
    catch (e) {
      console.warn('Failed to write session or mount editor', e);
      reply({ type: 'ACK', ok: false, error: 'init_failed', channel: this.CHANNEL });
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
          console.warn(`[intempt] READY not acknowledged after ${maxTries} tries, giving up`);
        }
        return;
      }


      try {
        const targetOrigin = this._allowedOrigin ?? this.ALLOWED_ORIGINS[0];
        if (targetOrigin) {
          window.opener?.postMessage(
            { type: 'READY', channel: this.CHANNEL },
            targetOrigin
          );
          console.log('[intempt] READY sent');
        }
      } catch (e) {
        console.warn('postReady failed', e);
      }
    }, 200)
  }

  private async injectCssIntoShadow(url: string, shadow: ShadowRoot) {
    // Try fetch + Constructable Stylesheets (best isolation/perf)
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const css = await res.text();

      if ('adoptedStyleSheets' in Document.prototype && 'replaceSync' in CSSStyleSheet.prototype) {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        // append without breaking existing sheets
        (shadow as any).adoptedStyleSheets = [...(shadow as any).adoptedStyleSheets, sheet];
      }
      else {
        const style = document.createElement('style');
        style.textContent = css;
        shadow.appendChild(style);
      }
      return;
    }
    catch (e) {
      console.warn('[intempt] CSS fetch failed or CORS blocked; falling back to <link> in shadow', e);
    }

    // Fallback: <link rel="stylesheet"> inside shadow (works in modern Chromium/Firefox)
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    shadow.appendChild(link);
  }

  private async injectWebEditorScript(payload: EditorPayload, appRoot:HTMLElement) {
      // @vite-ignore keeps Vite from trying to pre-bundle/transform the URL
      const mod: any = await import(/* @vite-ignore */ this.JS_URL);

      if (mod?.mount) {
        await mod.mount(appRoot);
      }
      else if ((window as any).__INTEMPT_MOUNT) {
        (window as any).__INTEMPT_MOUNT(appRoot, payload); // fallback: global mount function
      }
      else {
        throw new Error('No mount function exported or on window.__INTEMPT_MOUNT');
      }

      this.__INTEMPT_EDITOR_MOUNTED = true;
      console.log('[intempt] editor mounted');
  }
}

export const WEB_EDITOR = new WebEditor();
