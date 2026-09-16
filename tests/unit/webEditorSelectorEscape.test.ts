import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebEditorModificationHandler } from '../../src/intemptJs/modules/choices/models/WebEditorModificationHandler.ts';
import { Modification } from '../../src/intemptJs/types/choices.types.ts';

/**
 * INT-3821 — `elementGetterByIweId` builds a selector out of a pointer key that
 * arrived over `postMessage` from the web editor.
 *
 * It used to interpolate that key raw: `` `[${key}="true"]` ``. A key is supposed
 * to be a plain attribute name, but nothing enforced that, so a malformed one had
 * two failure modes, both silent from the visitor's point of view:
 *
 *  - **Broken** — `querySelector` throws `SyntaxError` on an unparseable
 *    selector, and the throw escapes `style`/`update`/`insert`/`remove` into
 *    whatever awaited them, so the rest of the experience never applies.
 *  - **Widened** — a key containing `],[` closes the attribute selector and opens
 *    a second one, e.g. `x],[y` becomes `[x],[y="true"]`, a selector list. The
 *    handler then mutates or removes an element the change never referred to.
 *
 * The fix runs the key through `CSS.escape`, with a
 * strip-everything-unexpected regex fallback for environments without it.
 *
 * The getter is private, so these go through `remove` — the thinnest of the four
 * public mutations, and the one whose effect (an element is gone, or is not) is
 * unambiguous.
 */

const handler = new WebEditorModificationHandler();

/** A change addressing an element by pointer key. */
const change = (key: string) => ({ iweId: key }) as unknown as Modification;

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('pointer-key escaping (INT-3821)', () => {
  it('still resolves an ordinary key', () => {
    // The escape must not change the common case: `CSS.escape` leaves
    // `[a-zA-Z0-9_-]` alone, so `iwe-id-1` is looked up exactly as before.
    document.body.innerHTML = '<div id="target" iwe-id-1="true"></div>';

    handler.remove(change('iwe-id-1'));

    expect(document.getElementById('target')).toBeNull();
  });

  it('resolves a key containing selector metacharacters instead of throwing', () => {
    // `[iwe:id.1="true"]` is not a parseable selector — `.` starts a class and
    // `:` a pseudo-class inside the attribute NAME position — so the raw
    // interpolation made `querySelector` throw straight out of the handler.
    // Escaped, the same key addresses the literal attribute.
    const el = document.createElement('div');
    el.id = 'target';
    el.setAttribute('iwe:id.1', 'true');
    document.body.appendChild(el);

    expect(() => handler.remove(change('iwe:id.1'))).not.toThrow();
    expect(document.getElementById('target')).toBeNull();
  });

  it('cannot be widened into a second selector by a key containing "],["', () => {
    // THE MUTANT: drop the escape and the selector becomes `[x],[y="true"]` — a
    // list — so `#bystander`, which the change never named, is removed instead.
    // Escaped, the whole thing is one attribute name that matches nothing, and
    // the handler early-returns on `null` exactly as it does for a stale pointer.
    document.body.innerHTML =
      '<div id="bystander" x="1"></div><div id="other" y="true"></div>';

    handler.remove(change('x],[y'));

    expect(document.getElementById('bystander')).not.toBeNull();
    expect(document.getElementById('other')).not.toBeNull();
  });

  it('falls back to stripping unexpected characters when CSS.escape is absent', () => {
    // Old WebViews and a few embedded browsers have no `CSS` global at all. The
    // fallback keeps only `[a-zA-Z0-9_-]`, so the safe key survives intact...
    vi.stubGlobal('CSS', undefined);
    document.body.innerHTML = '<div id="target" iwe-id-1="true"></div>';

    handler.remove(change('iwe-id-1'));

    expect(document.getElementById('target')).toBeNull();
  });

  it('strips the injection rather than widening it when CSS.escape is absent', () => {
    // ...and the hostile key is reduced to `xy`, which matches nothing. What it
    // must NOT do is reach `querySelector` as a selector list.
    vi.stubGlobal('CSS', undefined);
    document.body.innerHTML =
      '<div id="bystander" x="1"></div><div id="other" y="true"></div>';

    expect(() => handler.remove(change('x],[y'))).not.toThrow();
    expect(document.getElementById('bystander')).not.toBeNull();
    expect(document.getElementById('other')).not.toBeNull();
  });
});
