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
   * **D-29 — fixed 2026-08-12. These were the pinning tests; they are now the
   * regression tests.**
   *
   * The redaction used to exist on one of the two capture paths only.
   * `getHtmlElementText` masked a clicked password field; `getSubmittedData` read
   * the form through `FormData`, which includes password controls like any other
   * named control and knows nothing about `doNotCapture`. So clicking a password
   * box was redacted and **submitting the form containing it was not** — the
   * password shipped in `formDataText`.
   *
   * Redacted rather than dropped, deliberately: an absent key is
   * indistinguishable from a field the user left empty, while "this form had a
   * password" is legitimate analytics and its value never is.
   */
  describe('D-29 regression: submitted form data is redacted too', () => {
    it('masks a named password field on submit and keeps the rest', () => {
      const form = mount(
        '<form action="/login"><input name="user" value="ada" /><input name="pw" type="password" value="hunter2" /></form>',
      );
      expect(new HtmlElementDataComponent(form, SUBMIT).formDataText).toEqual([
        { key: 'user', value: 'ada' },
        { key: 'pw', value: '********' },
      ]);
    });

    it('honours `doNotCapture` on submit', () => {
      const form = mount(
        '<form action="/pay"><input name="card" doNotCapture value="4111111111111111" /></form>',
      );
      expect(new HtmlElementDataComponent(form, SUBMIT).formDataText).toEqual([
        { key: 'card', value: '********' },
      ]);
    });

    it('masks an unnamed password field, matched directly rather than by name', () => {
      // `FormData` skips unnamed controls, so these come through the separate
      // sweep and cannot be matched on a name — there is none.
      const form = mount(
        '<form action="/login"><input type="password" value="hunter2" /></form>',
      );
      expect(new HtmlElementDataComponent(form, SUBMIT).formDataText).toEqual([
        { key: 'input-0', value: '********' },
      ]);
    });

    it('never lets the raw value into the payload by any path', () => {
      const form = mount(
        '<form action="/login"><input name="pw" type="password" value="hunter2" /><input name="card" doNotCapture value="4111111111111111" /></form>',
      );
      const captured = new HtmlElementDataComponent(form, SUBMIT);

      // The whole object, not just `formDataText`: the hierarchy string is the
      // other path a markup `value=` attribute can escape through.
      const serialised = JSON.stringify(captured);
      expect(serialised).not.toContain('hunter2');
      expect(serialised).not.toContain('4111111111111111');
    });

    it('redacts by field, not by form — one password does not blank the others', () => {
      const form = mount(
        '<form action="/login"><input name="user" value="ada" /><input name="pw" type="password" value="x" /><input name="remember" value="yes" /></form>',
      );
      expect(new HtmlElementDataComponent(form, SUBMIT).formDataText).toEqual([
        { key: 'user', value: 'ada' },
        { key: 'pw', value: '********' },
        { key: 'remember', value: 'yes' },
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

  it('masks a redacted element’s value attribute in the hierarchy too (D-29)', () => {
    // The hierarchy is the third path a value can escape through, after
    // `targetText` and `formDataText`. A `value` written in the markup is a real
    // attribute and used to survive here even when the text was masked.
    const input = mount('<input type="password" value="hunter2" />');
    const captured = new HtmlElementDataComponent(input, CHANGE);

    expect(captured.targetText).toBe('********');
    expect(captured.hierarchy).toContain("value='********'");
    expect(JSON.stringify(captured)).not.toContain('hunter2');
  });

  it('keeps every other attribute intact on a redacted element', () => {
    // Masking the value must not turn the selector into a useless one — the
    // element's shape is what makes the hierarchy worth sending.
    const input = mount(
      '<input type="password" name="pw" value="hunter2" placeholder="Password" />',
    );
    const hierarchy = new HtmlElementDataComponent(input, CHANGE).hierarchy;

    expect(hierarchy).toContain("[type='password']");
    expect(hierarchy).toContain("[name='pw']");
    expect(hierarchy).toContain("[placeholder='Password']");
  });
});
