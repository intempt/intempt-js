import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebEditorModificationHandler } from '../../src/intemptJs/modules/choices/models/WebEditorModificationHandler.ts';

/**
 * INT-2481: experience `html` is parsed with createContextualFragment, which makes <script>
 * executable and lets inline on* handlers go live. Script must run only through `change.js`
 * (INT-2483), so the handler strips executable content from `html` before inserting it.
 */

const PARENT = 'iwe-ptr-parent';
const TARGET = 'iwe-ptr-target';

let handler: WebEditorModificationHandler;
let parent: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = `<div ${PARENT}="true"><p ${TARGET}="true">old</p></div>`;
  parent = document.querySelector(`[${PARENT}="true"]`) as HTMLElement;
  handler = new WebEditorModificationHandler();
  (window as any).__pwned = 0;
});

afterEach(() => {
  delete (window as any).__pwned;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const insert = (html: string) =>
  handler.insert({
    type: 'insert',
    html,
    parent: { _iwePtrId: PARENT },
  } as any);

describe('INT-2481: experience html is made inert', () => {
  it('removes <script> so it never runs', async () => {
    await insert('<div class="x"><script>window.__pwned = 1</script>hi</div>');
    expect(parent.querySelector('script')).toBeNull();
    expect(parent.querySelector('.x')?.textContent).toBe('hi');
    expect((window as any).__pwned).toBe(0);
  });

  it('removes inline on* handlers and keeps other attributes', async () => {
    await insert(
      '<button class="cta" data-k="v" onclick="window.__pwned=1" ONMOUSEOVER="x()">Go</button>',
    );
    const btn = parent.querySelector('button.cta') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('onclick')).toBeNull();
    expect(btn.getAttribute('onmouseover')).toBeNull();
    expect(btn.getAttribute('data-k')).toBe('v');
    btn.click();
    expect((window as any).__pwned).toBe(0);
  });

  it('removes iframe, frame, object and embed', async () => {
    await insert(
      '<div class="w"><iframe src="https://e.x"></iframe><object data="x"></object><embed src="x"><span>ok</span></div>',
    );
    const w = parent.querySelector('.w') as HTMLElement;
    expect(w.querySelector('iframe, object, embed')).toBeNull();
    expect(w.querySelector('span')?.textContent).toBe('ok');
  });

  it('removes javascript: and vbscript: URLs, including obfuscated ones', async () => {
    await insert(
      '<div class="w">' +
        '<a class="a1" href="javascript:alert(1)">1</a>' +
        '<a class="a2" href=" JaVa\tScRiPt:alert(1)">2</a>' +
        '<a class="a3" href="vbscript:x">3</a>' +
        '<a class="ok" href="https://example.com/p?q=1">4</a>' +
        '<img class="i" src="/img.png">' +
        '</div>',
    );
    expect(parent.querySelector('.a1')?.getAttribute('href')).toBeNull();
    expect(parent.querySelector('.a2')?.getAttribute('href')).toBeNull();
    expect(parent.querySelector('.a3')?.getAttribute('href')).toBeNull();
    expect(parent.querySelector('.ok')?.getAttribute('href')).toBe(
      'https://example.com/p?q=1',
    );
    expect(parent.querySelector('.i')?.getAttribute('src')).toBe('/img.png');
  });

  it('strips svg <script> and javascript: xlink:href', async () => {
    await insert(
      '<svg class="s"><script>window.__pwned=1</script><a xlink:href="javascript:x()"><text>t</text></a></svg>',
    );
    const svg = parent.querySelector('svg.s') as Element;
    expect(svg.querySelector('script')).toBeNull();
    expect(svg.querySelector('a')?.getAttribute('xlink:href')).toBeNull();
  });

  it('sanitizes <template> content too', async () => {
    await insert(
      '<template class="t"><img src="x" onerror="window.__pwned=1"></template>',
    );
    const tpl = parent.querySelector('template.t') as HTMLTemplateElement;
    expect(
      tpl.content.querySelector('img')?.getAttribute('onerror'),
    ).toBeNull();
  });

  it('applies on update as well as insert', async () => {
    await handler.update({
      type: 'update',
      html: '<p class="n" onclick="window.__pwned=1">new<script>window.__pwned=1</script></p>',
      parent: { _iwePtrId: PARENT },
      iwePtrId: TARGET,
    } as any);
    const p = parent.querySelector('p.n') as HTMLElement;
    expect(p.textContent).toBe('new');
    expect(p.getAttribute('onclick')).toBeNull();
    expect(p.querySelector('script')).toBeNull();
    expect(parent.querySelector(`[${TARGET}="true"]`)).toBeNull();
  });

  it("keeps the editor's product-card image fallback as a listener, not a handler", async () => {
    const placeholder =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E";
    await insert(
      // As the editor serialises it: double-quoted attribute, inner quotes as &quot;.
      `<img class="pc" src="https://broken.example/x.png" onerror="this.onerror=null; this.src=&quot;${placeholder}&quot;;">`,
    );
    const img = parent.querySelector('img.pc') as HTMLImageElement;
    expect(img.getAttribute('onerror')).toBeNull();
    img.dispatchEvent(new Event('error'));
    expect(img.getAttribute('src')).toBe(placeholder);
  });

  it('does not re-attach a fallback whose URL is not data:image', async () => {
    await insert(
      `<img class="pc" src="https://broken.example/x.png" onerror='this.onerror=null; this.src="javascript:alert(1)";'>`,
    );
    const img = parent.querySelector('img.pc') as HTMLImageElement;
    expect(img.getAttribute('onerror')).toBeNull();
    img.dispatchEvent(new Event('error'));
    expect(img.getAttribute('src')).toBe('https://broken.example/x.png');
  });

  it('still hands custom JS from the dedicated js field to a <script> (INT-2483)', async () => {
    // jsdom here does not execute scripts, so assert the element, not the side effect.
    vi.useFakeTimers();
    const append = vi.spyOn(document.body, 'append');
    await handler.insert({
      type: 'insert',
      html: '<div class="c"></div>',
      js: 'window.__pwned = 2;',
      parent: { _iwePtrId: PARENT },
    } as any);
    const s = append.mock.calls[0]?.[0] as HTMLScriptElement;
    expect(s?.tagName).toBe('SCRIPT');
    expect(s.textContent).toBe('window.__pwned = 2;');
  });
  // Ro-bot security:F1 (batch mcp-1794321115-47): SMIL can set an href to a script URL through
  // `values`/`to`, which the attribute check never sees; <base>/<meta> redirect or rebase the page.
  it.each([
    [
      'animate',
      '<svg><a><animate attributeName="href" values="x;javascript:alert(1)"/></a></svg>',
    ],
    [
      'set',
      '<svg><a><set attributeName="href" to="javascript:alert(1)"/></a></svg>',
    ],
    ['base', '<base href="https://evil.example/">'],
    [
      'meta',
      '<meta http-equiv="refresh" content="0;url=https://evil.example/">',
    ],
  ])('drops <%s> from experience html', async (tag, html) => {
    await handler.insert({
      type: 'insert',
      html: `<div>${html}</div>`,
      parent: { _iwePtrId: PARENT },
    } as any);
    expect(parent.querySelector(tag)).toBeNull();
  });
});
