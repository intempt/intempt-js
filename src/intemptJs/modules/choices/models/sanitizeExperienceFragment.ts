/**
 * INT-2481: make experience `html` inert before it reaches the customer page.
 *
 * `change.html` is parsed with `createContextualFragment`, which (unlike `innerHTML`) produces
 * executable `<script>` elements, and inline `on*` handlers go live once the fragment is inserted.
 * The html comes from the choices API or from the `changes_<path>` localStorage cache, which any
 * script on the host page can write. Custom JS has its own field (`change.js`, INT-2483); script
 * hidden inside `html` is never legitimate.
 *
 * Mirrors the rules of the web-editor sanitizer (web-editor#109, `src/services/sanitize.ts`):
 *  - `<script>`, `<iframe>`, `<frame>`, `<object>`, `<embed>` are removed with their content;
 *  - every `on*` attribute is removed;
 *  - any attribute whose value is a `javascript:` / `vbscript:` URL is removed (checked after
 *    stripping the whitespace and control characters browsers ignore inside a scheme).
 *
 * One exception, as in the editor: the product-card `<img onerror>` placeholder fallback the
 * editor emits (`this.onerror=null; this.src="data:image/...";`). Its handler is still removed,
 * and the same behaviour is re-attached as a listener that only assigns that `data:image/` URL,
 * so no code from the html ever runs.
 *
 * Zero dependencies on purpose: the SDK is CDN-delivered.
 */

const FORBIDDEN_TAGS = new Set([
  'script',
  'iframe',
  'frame',
  'object',
  'embed',
]);

// eslint-disable-next-line no-control-regex
const IGNORED_URL_CHARS = /[\u0000-\u0020]/g;
const SCRIPT_URL = /^(?:javascript|vbscript):/i;

/** The editor's product-card fallback (web-editor `PRODUCT_IMG_FALLBACK_ONERROR`). */
const IMG_FALLBACK_ONERROR =
  /^\s*this\.onerror\s*=\s*null\s*;\s*this\.src\s*=\s*"(data:image\/[^"]*)"\s*;?\s*$/;

function isScriptUrl(value: string): boolean {
  return SCRIPT_URL.test(value.replace(IGNORED_URL_CHARS, ''));
}

function sanitizeElement(el: Element): void {
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (name.startsWith('on')) {
      el.removeAttribute(attr.name);
      if (name === 'onerror' && el.localName === 'img') {
        const fallback = IMG_FALLBACK_ONERROR.exec(attr.value)?.[1];
        if (fallback) {
          el.addEventListener(
            'error',
            () => {
              (el as HTMLImageElement).src = fallback;
            },
            { once: true },
          );
        }
      }
      continue;
    }
    if (isScriptUrl(attr.value)) el.removeAttribute(attr.name);
  }
}

/** Strips executable content from `root` in place. */
export function sanitizeExperienceFragment(root: DocumentFragment): void {
  const elements = Array.from(root.querySelectorAll('*'));
  for (const el of elements) {
    if (FORBIDDEN_TAGS.has(el.localName.toLowerCase())) {
      el.remove();
      continue;
    }
    sanitizeElement(el);
    // <template> content is a separate fragment that querySelectorAll does not enter.
    if (el.localName === 'template') {
      sanitizeExperienceFragment((el as HTMLTemplateElement).content);
    }
  }
}
