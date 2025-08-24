import { EditorPayload } from '../intemptJs/types/intemptJs.types.ts';


const BASE = import.meta.env.VITE_WEB_EDITOR_BASE_LINK;
const CSS_URL = `${BASE}/app.style.css`;
const JS_URL  = `${BASE}/app.js`;

const HOST_ID     = 'intempt-root-host';
const APP_ID      = 'intempt-editor-root';

let __INTEMPT_EDITOR_MOUNTED = false;


async function injectCssIntoShadow(url: string, shadow: ShadowRoot) {
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
    } else {
      const style = document.createElement('style');
      style.textContent = css;
      shadow.appendChild(style);
    }
    return;
  } catch (e) {
    console.warn('[intempt] CSS fetch failed or CORS blocked; falling back to <link> in shadow', e);
  }

  // Fallback: <link rel="stylesheet"> inside shadow (works in modern Chromium/Firefox)
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  shadow.appendChild(link);
}

async function injectWebEditorScript(payload: EditorPayload) {
  if (__INTEMPT_EDITOR_MOUNTED) return; // guard

  const { shadow, appRoot } = ensureShadowHost();

  await injectCssIntoShadow(CSS_URL, shadow);

  try {
    // @vite-ignore keeps Vite from trying to pre-bundle/transform the URL
    const mod: any = await import(/* @vite-ignore */ JS_URL);

    if (mod?.mount) {
      await mod.mount(appRoot);
    } else if ((window as any).__INTEMPT_MOUNT) {
      (window as any).__INTEMPT_MOUNT(appRoot, payload); // fallback: global mount function
    } else {
      throw new Error('No mount function exported or on window.__INTEMPT_MOUNT');
    }

    __INTEMPT_EDITOR_MOUNTED = true;
    console.log('[intempt] editor mounted');
  } catch (e) {
    console.error('[intempt] failed to load app.js', e);
  }
}

function postReadyWithRetry(openerOrigin: string, channel: string) {
  // backoff to dodge parent-listener races
  let tries = 0, max = 7;
  const tick = () => {
    try { window.opener?.postMessage({ type: 'READY', channel }, openerOrigin || '*'); } catch {}
    if (tries++ < max) setTimeout(tick, 50 * 2 ** tries);
  };
  tick();
}

function ensureShadowHost() {
  let host = document.getElementById(HOST_ID) as HTMLElement | null;
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    document.documentElement.appendChild(host);
  }

  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });

  let appRoot = shadow.getElementById(APP_ID) as HTMLElement | null;
  if (!appRoot) {
    appRoot = document.createElement('div');
    appRoot.id = APP_ID;
    shadow.appendChild(appRoot);
  }

  return { shadow, appRoot };
}

function handleMessageFromOpener(event: MessageEvent, allowedOrigin:string, channel:string) {
  // *** Exact origin check (NO trailing slash) ***
  if (event.origin !== allowedOrigin) return;

  const msg = event.data || {};

  // let experienceId: string | undefined;
  // let variantId:    string | undefined;
  // let token:        string | undefined;
  let chOk          = true;

  let editorPayload: EditorPayload = {
    experience: undefined,
    variantId: '',
    token: '',
  };

  if (msg?.type === 'INIT') {
    const p = msg.payload || {};
    editorPayload = {...p};
    // experienceId = p.experienceId;
    // variantId    = p.variantId;
    // token        = p.token;

    if (channel && msg.channel && msg.channel !== channel) chOk = false;
  }
  // else {
  //   // legacy: parent sent the payload directly
  //   experienceId = msg.experienceId;
  //   variantId    = msg.variantId;
  //   token        = msg.token;
  // }

  if (!chOk) return;

  const reply = (payload: any) => {
    try { (event.source as Window)?.postMessage(payload, event.origin); } catch {}
  };

  //console.log('DATA from opener:', editorPayload);

  const { experience, variantId, token } = editorPayload

  if (!experience || !variantId || !token) {
    reply({ type: 'ACK', ok: false, error: 'invalid_payload', channel });
    return;
  }

  try {
    // Prefer sessionStorage over localStorage for reload-only persistence
    // sessionStorage.setItem(
    //   import.meta.env.VITE_WEB_EDITOR_STORAGE_KEY,
    //   JSON.stringify({
    //     experienceId,
    //     variantId,
    //     token,
    //     isEditor: true,
    //     savedAt: new Date().toISOString(),
    //   })
    // );

    return injectWebEditorScript(editorPayload);
  }
  catch (e) {
    console.warn('Failed to write session or mount editor', e);
    reply({ type: 'ACK', ok: false, error: 'init_failed', channel });
    return;
  }
}

function initWebEditor() {
  // Read bootstrap from URL (set by the opener)
  const qs = new URLSearchParams(location.search);
  const openerOrigin = (qs.get('openerOrigin') || '').replace(/\/+$/, ''); // e.g. https://app.example.com
  const channel      = qs.get('channel') || '';

  // Fallback for dev/backward-compat: allow env origin if not provided
  const allowedOrigin = openerOrigin || new URL(import.meta.env.VITE_OPENER_LINK).origin;

  const start = () => postReadyWithRetry(
    allowedOrigin, channel
  );

  const listenToOpener = (event:MessageEvent) => handleMessageFromOpener(
    event, allowedOrigin, channel
  )


  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', start, { once: true });
  }
  else start();

  window.addEventListener('message', listenToOpener)
}

export const WEB_EDITOR = {
  init: initWebEditor,
}
