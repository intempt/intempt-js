/**
 * INT-2483 — CSP nonce for the inline scripts the SDK appends (custom JS from
 * experiences, `WebEditorModificationHandler.appendInlineScriptAfter`).
 *
 * Sites with a strict Content-Security-Policy block inline scripts that carry no
 * nonce, so experience JS silently did nothing there. Rather than a new config
 * option, the SDK reuses the nonce the site already gave it:
 *
 * 1. the SDK's own `<script>` tag (`document.currentScript`), else
 * 2. the first `<script nonce>` on the page (the loader snippet that injected
 *    the SDK normally carries the page's nonce).
 *
 * It is read ONCE, while the IIFE bundle is evaluating: `document.currentScript`
 * is `null` in every later callback. Browsers hide the nonce attribute after
 * parsing (`getAttribute('nonce')` → `""`), so the `.nonce` property is read
 * first and the attribute is only a fallback for environments without it.
 */
function nonceOf(el: Element | null | undefined): string | undefined {
  if (!el) return undefined;
  const prop = (el as HTMLScriptElement).nonce;
  if (typeof prop === 'string' && prop) return prop;
  const attr = el.getAttribute('nonce');
  return attr || undefined;
}

export function readPageScriptNonce(): string | undefined {
  try {
    if (typeof document === 'undefined') return undefined;
    const own = nonceOf(document.currentScript);
    if (own) return own;
    const scripts = document.querySelectorAll('script');
    for (let i = 0; i < scripts.length; i++) {
      const n = nonceOf(scripts[i]);
      if (n) return n;
    }
  } catch {
    // A nonce is best-effort: without one the script still runs on sites with
    // no CSP, which is every site where it ran before.
  }
  return undefined;
}

const capturedAtLoad = readPageScriptNonce();

/** The nonce captured when the SDK bundle loaded, or `undefined`. */
export function getSdkScriptNonce(): string | undefined {
  return capturedAtLoad;
}
