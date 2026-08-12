import { afterEach, describe, expect, it } from 'vitest';
import { HtmlElementDataComponent } from '../../src/intemptJs/component/HtmlEventData.component.ts';
import { IntemptDomEventName } from '../../src/intemptJs/types/constants.types.ts';

/**
 * `HtmlEventData.component.ts` — **0.0% line coverage on arrival** (`AUDIT.md` §1c,
 * tier 1, second only to `platformParser.ts`).
 *
 * It builds the payload for every auto-tracked click, change and submit: the target
 * tag, id, classes, text, the CSS-ish hierarchy string, and the captured form data.
 * The reason it is tier 1 is narrower than "it is untested": **it contains the
 * `doNotCapture` / `type === 'password'` redaction — the only privacy control on
 * auto-tracked DOM data anywhere in the SDK — and nothing asserted that it fires.**
 *
 * The redaction tests below are therefore the point of this file; the rest is the
 * surrounding shape, which has to be pinned too or a refactor moves the redaction
 * out from under itself.
 */

const CLICK = IntemptDomEventName.CLICK;
const SUBMIT = IntemptDomEventName.SUBMIT;
const CHANGE = IntemptDomEventName.CHANGE;

/** Mount HTML in the real document — `generateHierarchy` walks to `<html>`. */
function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host.firstElementChild as HTMLElement;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the redaction — the one privacy control on auto-tracked DOM data', () => {
  it('redacts the value of a password input', () => {
    const input = mount('<input type="password" value="hunter2" />');
    expect(new HtmlElementDataComponent(input, CHANGE).targetText).toBe(
      '********',
    );
  });

  it('redacts any element carrying `doNotCapture`, whatever its type', () => {
    const field = mount(
      '<input type="text" doNotCapture value="4111111111111111" />',
    );
    expect(new HtmlElementDataComponent(field, CHANGE).targetText).toBe(
      '********',
    );

    // Not only inputs — the attribute is the contract, so a div opts out too.
    const div = mount('<div doNotCapture>Account balance $12,400</div>');
    expect(new HtmlElementDataComponent(div, CLICK).targetText).toBe(
      '********',
    );
  });

  it('matches `doNotCapture` case-insensitively, as HTML attributes are', () => {
    // The source writes `hasAttribute('doNotCapture')`, which reads as
    // case-sensitive but is not: HTML lowercases attribute names, so a customer
    // writing `donotcapture` is also covered. Asserted because the camelCase in
    // the source invites someone to "fix" it into a selector that *is* sensitive.
    const lower = mount('<input type="text" donotcapture value="secret" />');
    expect(new HtmlElementDataComponent(lower, CHANGE).targetText).toBe(
      '********',
    );
  });

  it('does not redact an ordinary text input', () => {
    const input = mount('<input type="text" value="Tokyo" />');
    expect(new HtmlElementDataComponent(input, CHANGE).targetText).toBe(
      'Tokyo',
    );
  });

  it('emits the marker itself, not a truncation of the value', () => {
    // Eight asterisks, a constant — not `value.replace(/./g, '*')`, which would
    // leak the length. Asserted exactly, because a "nicer" redaction that mirrors
    // the length is a real regression that reads as an improvement.
    const input = mount('<input type="password" value="hunter2" />');
    expect(new HtmlElementDataComponent(input, CHANGE).targetText).toBe(
      '********',
    );
    expect(
      new HtmlElementDataComponent(input, CHANGE).targetText,
    ).not.toContain('hunter2');
  });

  /**
   * **D-29 — the redaction does not cover submitted form data. Found writing this
   * file; pinned, not fixed.**
   *
   * `getHtmlElementText` redacts `targetText`. `getSubmittedData` is a separate path
   * that reads the form through `FormData`, and **`FormData` includes password fields
   * like any other named control**. So a click on a password box is redacted, and
   * submitting the form containing it is not — the password ships in
   * `formDataText`. `doNotCapture` is likewise ignored there.
   *
   * The fix is small (filter `type === 'password'` and `[doNotCapture]` out of both
   * the `FormData` entries and the unnamed-input sweep) but it changes what ingest
   * receives for every form submit, so it is a deliberate call, not a drive-by.
   * These assertions fail when it is fixed — that is the specification.
   */
  describe('D-29: submitted form data is NOT redacted', () => {
    it('captures a named password field on submit', () => {
      const form = mount(
        '<form action="/login"><input name="user" value="ada" /><input name="pw" type="password" value="hunter2" /></form>',
      );
      expect(new HtmlElementDataComponent(form, SUBMIT).formDataText).toEqual([
        { key: 'user', value: 'ada' },
        { key: 'pw', value: 'hunter2' },
      ]);
    });

    it('ignores `doNotCapture` on submit', () => {
      const form = mount(
        '<form action="/pay"><input name="card" doNotCapture value="4111111111111111" /></form>',
      );
      expect(new HtmlElementDataComponent(form, SUBMIT).formDataText).toEqual([
        { key: 'card', value: '4111111111111111' },
      ]);
    });
  });
});

describe('getSubmittedData', () => {
  it('is undefined for anything that is not a form submit', () => {
    const form = mount('<form action="/x"><input name="a" value="1" /></form>');
    expect(
      new HtmlElementDataComponent(form, CLICK).formDataText,
    ).toBeUndefined();

    const div = mount('<div>not a form</div>');
    expect(
      new HtmlElementDataComponent(div, SUBMIT).formDataText,
    ).toBeUndefined();
  });

  it('captures unnamed inputs under a positional key', () => {
    // `FormData` skips controls with no `name`, so they are swept separately and
    // keyed `input-0`, `input-1`, … — the index is per-form and order-dependent.
    const form = mount(
      '<form action="/x"><input value="first" /><input value="second" /></form>',
    );
    expect(new HtmlElementDataComponent(form, SUBMIT).formDataText).toEqual([
      { key: 'input-0', value: 'first' },
      { key: 'input-1', value: 'second' },
    ]);
  });

  it('excludes unnamed submit and hidden inputs, and only those', () => {
    const form = mount(
      '<form action="/x">' +
        '<input type="submit" value="Send" />' +
        '<input type="hidden" value="csrf-token" />' +
        '<input type="checkbox" checked />' +
        '</form>',
    );
    // A hidden field is machinery, not user input; a submit button's value is its
    // label. Anything else unnamed is captured, checkbox included.
    expect(new HtmlElementDataComponent(form, SUBMIT).formDataText).toEqual([
      { key: 'input-0', value: 'on' },
    ]);
  });

  it('numbers unnamed inputs by kept order, not by DOM position', () => {
    // `unnamedIndex` only advances on a kept input, so a skipped hidden field does
    // not leave a hole in the sequence. One `++` in the wrong place changes every
    // key a customer sees.
    const form = mount(
      '<form action="/x">' +
        '<input type="hidden" value="csrf" />' +
        '<input value="kept" />' +
        '</form>',
    );
    expect(new HtmlElementDataComponent(form, SUBMIT).formDataText).toEqual([
      { key: 'input-0', value: 'kept' },
    ]);
  });

  it('returns an empty array for a form with no controls', () => {
    const form = mount('<form action="/x"></form>');
    // Empty array, not `undefined` — the two mean different things downstream
    // ("submitted nothing" vs "not a submit").
    expect(new HtmlElementDataComponent(form, SUBMIT).formDataText).toEqual([]);
  });

  it('stringifies non-string form values', () => {
    const form = mount(
      '<form action="/x"><select name="n"><option value="2" selected>Two</option></select></form>',
    );
    expect(new HtmlElementDataComponent(form, SUBMIT).formDataText).toEqual([
      { key: 'n', value: '2' },
    ]);
  });
});

describe('getHtmlElementText', () => {
  it('is undefined for a form, and for any submit', () => {
    const form = mount('<form action="/x">label</form>');
    expect(
      new HtmlElementDataComponent(form, CLICK).targetText,
    ).toBeUndefined();

    const button = mount('<button>Send</button>');
    expect(
      new HtmlElementDataComponent(button, SUBMIT).targetText,
    ).toBeUndefined();
  });

  it('prefers textContent, falling back to a control value', () => {
    const link = mount('<a href="/pricing">  Pricing  </a>');
    expect(new HtmlElementDataComponent(link, CLICK).targetText).toBe(
      'Pricing',
    );

    const input = mount('<input type="text" value="  Tokyo  " />');
    expect(new HtmlElementDataComponent(input, CHANGE).targetText).toBe(
      'Tokyo',
    );
  });

  it('flattens the text of descendants, since the click target is the ancestor', () => {
    const card = mount('<div><span>Buy</span> <b>now</b></div>');
    expect(new HtmlElementDataComponent(card, CLICK).targetText).toBe(
      'Buy now',
    );
  });

  it('is an empty string when there is neither text nor value', () => {
    const div = mount('<div></div>');
    expect(new HtmlElementDataComponent(div, CLICK).targetText).toBe('');
  });
});

describe('handleHref', () => {
  it('is undefined on change', () => {
    const link = mount('<a href="/pricing">Pricing</a>');
    expect(new HtmlElementDataComponent(link, CHANGE).href).toBeUndefined();
  });

  it('is the form action on submit', () => {
    const form = mount('<form action="/login"></form>');
    // jsdom resolves `action` against the document URL, so this is absolute.
    expect(new HtmlElementDataComponent(form, SUBMIT).href).toContain('/login');
  });

  it('falls back to the document URL, not an empty string, when a form has no action', () => {
    // The `|| ''` in `handleHref` looks like the no-action case and is not: per
    // spec, `form.action` **reflects the document URL** when the attribute is
    // absent, so it is never falsy for a form in a document. The fallback is
    // effectively dead. Pinned because the payload here is a URL a customer never
    // wrote, which is surprising when reading a dashboard.
    const form = mount('<form></form>');
    expect(new HtmlElementDataComponent(form, SUBMIT).href).toBe(document.URL);
  });

  it('is the raw href attribute on click, unresolved', () => {
    // `getAttribute`, not `.href` — a relative href stays relative, which is what
    // a customer wrote and what they expect to see in the dashboard.
    const link = mount('<a href="/pricing">Pricing</a>');
    expect(new HtmlElementDataComponent(link, CLICK).href).toBe('/pricing');
  });

  it('is an empty string for a clicked element with no href', () => {
    const button = mount('<button>Send</button>');
    expect(new HtmlElementDataComponent(button, CLICK).href).toBe('');
  });
});

describe('the identity fields', () => {
  it('lowercases the tag and joins every class with a space', () => {
    const el = mount('<BUTTON id="cta" class="btn btn-primary">Go</BUTTON>');
    const captured = new HtmlElementDataComponent(el, CLICK);

    expect(captured.targetTag).toBe('button');
    expect(captured.targetId).toBe('#cta');
    expect(captured.targetClass).toBe('btn btn-primary');
  });

  it('prefixes the id with `#`, and is an empty string when there is none', () => {
    // `targetId` carries the `#`; `targetClass` does NOT carry a `.`, while the
    // hierarchy's class segment does. That asymmetry is real — pinned so nobody
    // normalises one to the other and silently changes every payload.
    const el = mount('<div class="a b"></div>');
    const captured = new HtmlElementDataComponent(el, CLICK);

    expect(captured.targetId).toBe('');
    expect(captured.targetClass).toBe('a b');
    expect(captured.hierarchy).toContain('div.a.b');
  });
});

describe('generateHierarchy', () => {
  it('reads outermost-first and stops below `<html>`', () => {
    const el = mount(
      '<section id="hero"><a href="/x" class="cta">Go</a></section>',
    );
    const link = el.querySelector('a') as HTMLElement;

    // `body` is included, `html` is not — the loop's terminating condition.
    expect(new HtmlElementDataComponent(link, CLICK).hierarchy).toBe(
      "body > div > section#hero > a.cta[href='/x']",
    );
  });

  it('includes every attribute except class, id and style', () => {
    const el = mount(
      '<button id="cta" class="btn" style="color:red" data-test="buy" aria-label="Buy">Go</button>',
    );
    const hierarchy = new HtmlElementDataComponent(el, CLICK).hierarchy;

    // class and id appear in their own segments, so repeating them as attributes
    // would duplicate them; `style` is excluded as noise.
    expect(hierarchy).toContain(
      "button#cta.btn[data-test='buy'][aria-label='Buy']",
    );
    expect(hierarchy).not.toContain('style=');
    expect(hierarchy).not.toContain('[class=');
    expect(hierarchy).not.toContain('[id=');
  });

  it('is just the element itself when it is detached from the document', () => {
    // No `parentElement`, so the walk terminates immediately rather than throwing.
    const orphan = document.createElement('span');
    orphan.className = 'floating';
    expect(new HtmlElementDataComponent(orphan, CLICK).hierarchy).toBe(
      'span.floating',
    );
  });

  it('does not redact the hierarchy, so a value attribute survives it', () => {
    // The redaction covers `targetText` only. A password input's *attributes* still
    // go into the hierarchy string — and `value` set in the markup is one of them.
    // This is the same gap as D-29, on a second path, and it is asserted rather
    // than fixed for the same reason.
    const input = mount('<input type="password" value="hunter2" />');
    const captured = new HtmlElementDataComponent(input, CHANGE);

    expect(captured.targetText).toBe('********');
    expect(captured.hierarchy).toContain("value='hunter2'");
  });
});
