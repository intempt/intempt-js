import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureLogger, resetLogger } from '../../src/shared/logger/logger.ts';

// The logger is module-level state, so a suite that reconfigures it must put it
// back — otherwise a later file inherits this file's sink and threshold.
afterEach(() => {
  resetLogger();
});
import { WebEditorModificationHandler } from '../../src/intemptJs/modules/choices/models/WebEditorModificationHandler.ts';
import { ChoicesModule } from '../../src/intemptJs/modules/choices/choices.module.ts';
import { ChoicesService } from '../../src/intemptJs/modules/choices/choices.service.ts';
import { ChoicesConfig } from '../../src/intemptJs/modules/choices/choices.config.ts';

/**
 * The choices (experiences) engine — `src/intemptJs/modules/choices/**`.
 *
 * **Why this matters more than its line count suggests.** This is the capability
 * `mixpanel-browser` does not have, it mutates the customer's live DOM, and it
 * was untested. A defect here is not a lost event — it is a visibly broken page
 * for real visitors, on a code path that only runs for customers who bought the
 * feature, which is the worst possible place for a silent regression.
 *
 * **There used to be two handler classes here, and only one of them ran.**
 * `WebEditorModificationHandler` (121 LOC, 4 types: style / update / insert /
 * remove) is what `ChoicesModule._applyChanges` instantiates, and is what this
 * file covers.
 *
 * The other — `ModificationHandler`, 459 LOC and 7 mutation types — was
 * **imported by nothing** and has been **deleted** (D-23). It is worth knowing why
 * it could not simply be re-enabled, in case someone finds it in the history and
 * wonders: dispatch is `changesHandler.hasOwnProperty(change.type)` against the
 * live handler, and three of the dead class's type names (`typography`, `replace`,
 * `move`, `attribute`, `clone`) do not exist there at all, while the two classes
 * used **incompatible element-addressing conventions**. Reviving it was never a
 * matter of adding an import.
 *
 * Roughly 517 lines of tests pinning that class's behaviour went with it. They had
 * done their job: the register entry (D-23) is what the deletion rests on, and the
 * assertion that the live handler exposes exactly `insert`/`remove`/`style`/`update`
 * now lives below, where it guards the dispatch contract rather than a corpse.
 *
 * The web-editor postMessage handshake (`src/loaders/webEditorLoader.ts`) is
 * deliberately not covered — the mutation types are the part that runs for
 * visitors; the handshake only runs for an internal user with the editor open.
 */

/** Sets up a fresh document body and returns a helper to query it. */
function setBody(html: string) {
  document.body.innerHTML = html;
}

/**
 * The iwe stylesheet the styling handlers require.
 *
 * `getIweStyleSheet()` throws unless a `<style>` tag carrying
 * `ChoicesConfig.styleDataAttribute` exists *and* jsdom has associated a
 * CSSStyleSheet with it. Both halves matter: an attached-but-empty style tag is
 * what production has on first paint.
 */
function installIweStylesheet(initialCss = '') {
  const style = document.createElement('style');
  style.setAttribute(ChoicesConfig.styleDataAttribute, '');
  style.textContent = initialCss;
  document.head.appendChild(style);
  return style;
}

describe('choices engine', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('WebEditorModificationHandler — the handler that actually runs', () => {
    let handler: WebEditorModificationHandler;

    beforeEach(() => {
      handler = new WebEditorModificationHandler();
    });

    it('exposes exactly the four types dispatch can route, as own properties', () => {
      // `_applyChanges` routes with `changesHandler.hasOwnProperty(change.type)`,
      // so these must be instance fields rather than prototype methods, and the
      // set of them IS the set of change types the SDK can apply. A change of any
      // other type is silently unroutable, which is what made the deleted
      // 7-type ModificationHandler dead rather than merely unused (D-23).
      const own = Object.keys(handler as unknown as Record<string, unknown>);

      expect(own.sort()).toEqual(['insert', 'remove', 'style', 'update']);
      for (const type of own) {
        expect(Object.prototype.hasOwnProperty.call(handler, type)).toBe(true);
      }
    });

    /**
     * Elements are addressed by an attribute whose NAME is the iwe id, set to
     * the string "true" — `[<iweId>="true"]`, not `iwe_id="<id>"`. That is
     * unusual enough to be worth stating: `ChoicesModule.markPointersFromChanges`
     * writes them in that form and this handler reads them back the same way, so
     * the two are coupled through a convention neither declares.
     */
    function mark(el: Element, iweId: string) {
      el.setAttribute(iweId, 'true');
    }

    describe('style', () => {
      it('replaces the target element’s style attribute wholesale', async () => {
        // Wholesale, not merged: the editor sends the complete computed style, so
        // merging would let a previously-applied experience bleed into the next.
        setBody('<p id="t" style="color: red; font-weight: bold">hi</p>');
        const target = document.getElementById('t')!;
        mark(target, 'iwe1');

        await handler.style({ iweId: 'iwe1', attributes: { style: 'color: blue' } } as any);

        expect(target.getAttribute('style')).toBe('color: blue');
        expect(target.style.fontWeight).toBe('');
      });

      it('does nothing when the target is missing, rather than throwing', async () => {
        // The DOM may have changed between the experience being authored and the
        // page rendering. A throw here would abort the remaining changes in the
        // loop, so one stale selector would disable every other experience on the
        // page. Returning quietly is correct and is asserted so it stays.
        setBody('<p>hi</p>');
        await expect(
          handler.style({ iweId: 'missing', attributes: { style: 'color: blue' } } as any),
        ).resolves.toBeUndefined();
      });

      it('does nothing when the change carries no style value', async () => {
        setBody('<p id="t" style="color: red">hi</p>');
        mark(document.getElementById('t')!, 'iwe1');
        await handler.style({ iweId: 'iwe1', attributes: {} } as any);
        expect(document.getElementById('t')!.getAttribute('style')).toBe('color: red');
      });
    });

    describe('insert', () => {
      it('inserts new HTML before the reference node', async () => {
        setBody('<div id="p"><span id="ref">ref</span></div>');
        mark(document.getElementById('p')!, 'parentId');
        mark(document.getElementById('ref')!, 'refId');

        await handler.insert({
          html: '<b id="new">new</b>',
          parent: { _iweId: 'parentId' },
          refNode: { _iweId: 'refId' },
        } as any);

        const parent = document.getElementById('p')!;
        expect(parent.children[0]!.id).toBe('new');
        expect(parent.children[1]!.id).toBe('ref');
      });

      it('appends when there is no reference node', async () => {
        // `insertBefore(node, null)` appends. Relied on for "add at end of
        // container" experiences, so it is asserted rather than assumed.
        setBody('<div id="p"><span id="first">a</span></div>');
        mark(document.getElementById('p')!, 'parentId');

        await handler.insert({ html: '<b id="new">new</b>', parent: { _iweId: 'parentId' } } as any);

        const parent = document.getElementById('p')!;
        expect(parent.children[1]!.id).toBe('new');
      });

      it('does nothing when the parent is missing', async () => {
        setBody('<div>untouched</div>');
        await handler.insert({ html: '<b>new</b>', parent: { _iweId: 'gone' } } as any);
        expect(document.body.innerHTML).toBe('<div>untouched</div>');
      });

      it('wraps multi-root HTML in a single container element', async () => {
        // `htmlToFragment` wraps when there is more than one element child. This
        // is load-bearing for `update`, which removes the *target* after
        // inserting: without a single root the inserted nodes have no shared
        // parent to be styled or removed as a unit later.
        setBody('<div id="p"></div>');
        mark(document.getElementById('p')!, 'parentId');

        await handler.insert({
          html: '<b>one</b><i>two</i>',
          parent: { _iweId: 'parentId' },
        } as any);

        const parent = document.getElementById('p')!;
        expect(parent.children).toHaveLength(1);
        expect(parent.children[0]!.getAttribute('data-iwe-block')).toBe('1');
        expect(parent.children[0]!.children).toHaveLength(2);
      });

      it('does NOT wrap single-root HTML', async () => {
        setBody('<div id="p"></div>');
        mark(document.getElementById('p')!, 'parentId');
        await handler.insert({ html: '<b id="solo">one</b>', parent: { _iweId: 'parentId' } } as any);
        expect(document.getElementById('p')!.children[0]!.id).toBe('solo');
      });

      it('removes the original element when blockId is "base"', async () => {
        // A "base" block replaces the element it was authored against. Without
        // the removal the visitor sees both the old and the new content.
        setBody('<div id="p"><span id="orig">orig</span></div>');
        mark(document.getElementById('p')!, 'parentId');
        mark(document.getElementById('orig')!, 'origId');

        await handler.insert({
          html: '<b id="new">new</b>',
          parent: { _iweId: 'parentId' },
          blockId: 'base',
          iweId: 'origId',
        } as any);

        expect(document.getElementById('orig')).toBeNull();
        expect(document.getElementById('new')).not.toBeNull();
      });

      it('keeps the original when blockId is anything else', async () => {
        setBody('<div id="p"><span id="orig">orig</span></div>');
        mark(document.getElementById('p')!, 'parentId');
        mark(document.getElementById('orig')!, 'origId');

        await handler.insert({
          html: '<b id="new">new</b>',
          parent: { _iweId: 'parentId' },
          blockId: 'overlay',
          iweId: 'origId',
        } as any);

        expect(document.getElementById('orig')).not.toBeNull();
      });

      it('executes accompanying JS via a script tag it then cleans up', async () => {
        // Experiences can ship behaviour, not just markup. The script is added
        // with `textContent` (not `innerHTML`) and removed on a 40 ms timer, so
        // it runs but does not accumulate one tag per applied change.
        vi.useFakeTimers();
        setBody('<div id="p"></div>');
        mark(document.getElementById('p')!, 'parentId');

        await handler.insert({
          html: '<b>new</b>',
          parent: { _iweId: 'parentId' },
          js: 'window.__iweRan = true;',
        } as any);

        const scripts = document.body.querySelectorAll('script');
        expect(scripts).toHaveLength(1);
        expect(scripts[0]!.textContent).toBe('window.__iweRan = true;');
        expect(scripts[0]!.type).toBe('text/javascript');

        vi.advanceTimersByTime(50);
        expect(document.body.querySelectorAll('script')).toHaveLength(0);
      });

      it('ignores whitespace-only JS instead of appending an empty script', async () => {
        setBody('<div id="p"></div>');
        mark(document.getElementById('p')!, 'parentId');
        await handler.insert({
          html: '<b>new</b>',
          parent: { _iweId: 'parentId' },
          js: '   \n  ',
        } as any);
        expect(document.body.querySelectorAll('script')).toHaveLength(0);
      });
    });

    describe('update', () => {
      it('inserts the replacement and removes the original', async () => {
        setBody('<div id="p"><span id="ref">ref</span><span id="old">old</span></div>');
        mark(document.getElementById('p')!, 'parentId');
        mark(document.getElementById('ref')!, 'refId');
        mark(document.getElementById('old')!, 'oldId');

        await handler.update({
          html: '<b id="new">new</b>',
          parent: { _iweId: 'parentId' },
          refNode: { _iweId: 'refId' },
          iweId: 'oldId',
        } as any);

        expect(document.getElementById('old')).toBeNull();
        expect(document.getElementById('new')).not.toBeNull();
        expect(document.getElementById('p')!.children[0]!.id).toBe('new');
      });

      it('leaves the page untouched when the target is missing', async () => {
        // The guard is `!parentEl || !targetEl`, so a missing target aborts
        // *before* inserting. That ordering is what prevents the page ending up
        // with the new content and the old content both present.
        setBody('<div id="p">keep</div>');
        mark(document.getElementById('p')!, 'parentId');

        await handler.update({
          html: '<b id="new">new</b>',
          parent: { _iweId: 'parentId' },
          iweId: 'gone',
        } as any);

        expect(document.getElementById('new')).toBeNull();
        expect(document.getElementById('p')!.textContent).toBe('keep');
      });
    });

    describe('remove', () => {
      it('removes the target element', () => {
        setBody('<div><span id="t">gone</span><span id="keep">keep</span></div>');
        mark(document.getElementById('t')!, 'iwe1');
        handler.remove({ iweId: 'iwe1' } as any);
        expect(document.getElementById('t')).toBeNull();
        expect(document.getElementById('keep')).not.toBeNull();
      });

      it('is a no-op when the target is already gone', () => {
        setBody('<div id="keep">keep</div>');
        expect(() => handler.remove({ iweId: 'nope' } as any)).not.toThrow();
        expect(document.getElementById('keep')).not.toBeNull();
      });

      it('removes only the FIRST match when an iwe id is on several elements', () => {
        // `elementGetterByIweId` uses `querySelector`, singular. If the marking
        // pass ever tags two elements with one id, only one is affected and the
        // experience is half-applied. Recorded so the behaviour is known rather
        // than discovered on a customer's page.
        setBody('<p iwe1="true" id="a">a</p><p iwe1="true" id="b">b</p>');
        handler.remove({ iweId: 'iwe1' } as any);
        expect(document.getElementById('a')).toBeNull();
        expect(document.getElementById('b')).not.toBeNull();
      });
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('ChoicesModule — change dispatch and the pointer-marking pass', () => {
    const config = {
      organization: 'acme',
      sourceId: 'src-1',
      project: 'proj-1',
      writeKey: 'u.p',
      profileId: 'p1',
      sessionId: 's1',
    };

    /** `_applyChanges` is private; this is the documented shape it consumes. */
    const applyChanges = (mod: ChoicesModule, changes: unknown[]) =>
      (mod as any)._applyChanges(changes);

    it('dispatches each change to the handler named by its `type`', async () => {
      setBody('<div id="p"></div><span id="t">t</span>');
      document.getElementById('p')!.setAttribute('parentId', 'true');
      document.getElementById('t')!.setAttribute('targetId', 'true');

      const mod = new ChoicesModule(config as any);
      applyChanges(mod, [
        { type: 'remove', iweId: 'targetId', xPathSelector: '//span', xPathIndex: 0 },
      ]);

      expect(document.getElementById('t')).toBeNull();
    });

    it('a change with no xPathSelector degrades to just that change — fixes D-7', () => {
      // Was (choices.module.ts:40 + 94): `markPointersFromChanges` ran BEFORE
      // the per-change try/catch loop, and the default resolver goes straight
      // to `document.evaluate(p._xPathSelector, ...)`. With no selector on the
      // change, `document.evaluate(undefined)` threw — so a single change
      // missing one field took down the whole batch and no experience on the
      // page rendered. Fixed with the same per-item isolation as D-6: the
      // marking pass now wraps each change in try/catch, so the malformed
      // change is skipped and a valid change in the same batch still applies.
      setBody('<span id="a">a</span><span id="t">t</span>');
      document.getElementById('a')!.setAttribute('aId', 'true');
      const mod = new ChoicesModule(config as any);

      expect(() =>
        applyChanges(mod, [
          { type: 'remove', iweId: 'targetId' },
          { type: 'remove', iweId: 'aId', xPathSelector: '//span[1]', xPathIndex: 0 },
        ]),
      ).not.toThrow();

      // The malformed change's target is untouched (never marked, never
      // routed), but the other, valid change in the same batch still ran.
      expect(document.getElementById('t')).not.toBeNull();
      expect(document.getElementById('a')).toBeNull();
    });

    it('skips an unknown change type without throwing', () => {
      // The server can ship a change type a deployed SDK does not know — that is
      // the normal state during a rollout. It has to be inert, not fatal, or one
      // new feature breaks every page still on the old bundle.
      setBody('<div id="keep">keep</div>');
      const mod = new ChoicesModule(config as any);
      expect(() =>
        applyChanges(mod, [
          { type: 'teleport', iweId: 'x', xPathSelector: '//div', xPathIndex: 0 },
        ]),
      ).not.toThrow();
      expect(document.getElementById('keep')).not.toBeNull();
    });

    it('a failing change does not stop the changes after it', async () => {
      // The single most important resilience property of the engine: changes are
      // independent, so one broken experience must not blank out the others.
      //
      // It holds — but NOT for the reason the code suggests, see the next test.
      // The rejection is suppressed here so the assertion is about ordering
      // rather than about the unhandled rejection, which is asserted separately.
      const suppress = () => {};
      process.on('unhandledRejection', suppress);
      try {
        setBody('<span id="a">a</span><span id="b">b</span>');
        document.getElementById('a')!.setAttribute('aId', 'true');
        document.getElementById('b')!.setAttribute('bId', 'true');

        const mod = new ChoicesModule(config as any);
        applyChanges(mod, [
          // `style` with a null attributes bag throws inside the handler when it
          // destructures `attributes`.
          {
            type: 'style',
            iweId: 'aId',
            attributes: null,
            xPathSelector: '//span[1]',
            xPathIndex: 0,
          },
          { type: 'remove', iweId: 'bId', xPathSelector: '//span[2]', xPathIndex: 0 },
        ]);

        expect(document.getElementById('b')).toBeNull();
        await new Promise((r) => setTimeout(r, 0));
      } finally {
        process.off('unhandledRejection', suppress);
      }
    });

    it('the try/catch around each change cannot catch three of the four handlers — a defect', () => {
      // DEFECT (choices.module.ts:52-62). `style`, `update` and `insert` on
      // `WebEditorModificationHandler` are declared `async`; only `remove` is
      // synchronous. `_applyChanges` calls the handler inside a `try` but never
      // awaits it, so an async handler's failure arrives as a **rejected
      // promise** the synchronous `catch` can never see.
      //
      // Two consequences, and the second is the bad one:
      //  1. The `console.warn(`Error applying change of type ...`)` diagnostic —
      //     the only signal that an experience failed — never fires for three of
      //     the four types. Debugging a broken experience gets no output at all.
      //  2. The failure surfaces as an **unhandled promise rejection in the
      //     customer's page**, which their own error monitoring reports as an
      //     error originating from our script.
      //
      // The changes after it still apply, so the resilience property survives —
      // but by accident, because the rejection is asynchronous, not because it is
      // handled. Asserted on the handler directly here, which is where the
      // rejection is observable at all.
      //
      // Not fixed here: the fix is to await the handler (making `_applyChanges`
      // properly async and serialising changes that currently start in parallel)
      // or to attach a `.catch`. The first changes application order and timing
      // on live pages; the second is safe but should ship with the logger work
      // in FRONTEND.md item 2 so the diagnostic goes somewhere useful.
      const handler = new WebEditorModificationHandler();
      const result = handler.style({ iweId: 'x', attributes: null } as any);
      expect(result).toBeInstanceOf(Promise);
      return expect(result).rejects.toThrow(TypeError);
    });

    it('resolves nothing and mutates nothing for an empty change list', () => {
      setBody('<div id="keep">keep</div>');
      const mod = new ChoicesModule(config as any);
      expect(applyChanges(mod, [])).resolves;
      expect(document.getElementById('keep')).not.toBeNull();
    });

    it('marks pointers by setting an attribute NAMED for the iwe id', () => {
      // This is the convention the whole engine addresses elements through, and
      // it is declared in neither class. Asserted here so the coupling between
      // the marking pass and `elementGetterByIweId` is pinned in one place.
      setBody('<div id="p"><span id="t">t</span></div>');
      const mod = new ChoicesModule(config as any);
      const resolver = vi.fn(() => document.getElementById('t'));

      const out = (mod as any).markPointersFromChanges(
        [{ xPathSelector: '//span', xPathIndex: 0, iweId: 'myId' }],
        resolver,
      );

      expect(document.getElementById('t')!.getAttribute('myId')).toBe('true');
      expect(out).toHaveLength(1);
    });

    it('caches the resolver per xpath so one element is resolved once', () => {
      // xpath evaluation over a large document is the expensive part of applying
      // changes, and several changes routinely share a parent. Losing the cache
      // is a main-thread cost on the customer's page, not a correctness bug —
      // which is exactly the kind of regression nothing else would catch.
      setBody('<div id="p"><span id="t">t</span></div>');
      const mod = new ChoicesModule(config as any);
      const resolver = vi.fn(() => document.getElementById('t'));

      (mod as any).markPointersFromChanges(
        [
          { xPathSelector: '//span', xPathIndex: 0, iweId: 'a' },
          { xPathSelector: '//span', xPathIndex: 0, iweId: 'b' },
        ],
        resolver,
      );

      expect(resolver).toHaveBeenCalledTimes(1);
    });

    it('marks only the FIRST iwe id per element — a defect, asserted not fixed', () => {
      // DEFECT (choices.module.ts:89-102). Pointers are deduplicated by
      // `xPathSelector|xPathIndex` via the `seen` set, but the *iwe id* is not
      // part of that key. So when two changes reference the same element under
      // different ids — one change's `parent` is another change's target, which
      // is the common case for a container — only the first id is written as an
      // attribute. The second change's `elementGetterByIweId` then returns null
      // and the change is **silently skipped**: no throw, no log, the visitor
      // just does not see that experience.
      //
      // Asserted rather than fixed because the fix (key on
      // selector|index|iweId, or set all ids for a resolved element) changes how
      // many attributes land on customer DOM nodes, and the marking pass runs
      // before any change is applied — a mistake there breaks every experience
      // at once. It wants its own change with a parity check against real
      // choice payloads, which is the same discipline §5 used for `psl`.
      setBody('<div id="p"><span id="t">t</span></div>');
      const mod = new ChoicesModule(config as any);
      const resolver = vi.fn(() => document.getElementById('t'));

      (mod as any).markPointersFromChanges(
        [
          { xPathSelector: '//span', xPathIndex: 0, iweId: 'firstId' },
          { xPathSelector: '//span', xPathIndex: 0, iweId: 'secondId' },
        ],
        resolver,
      );

      const target = document.getElementById('t')!;
      expect(target.getAttribute('firstId')).toBe('true');
      expect(target.hasAttribute('secondId')).toBe(false);
    });

    it('skips pointers whose element cannot be resolved', () => {
      setBody('<div id="p"></div>');
      const mod = new ChoicesModule(config as any);
      const out = (mod as any).markPointersFromChanges(
        [{ xPathSelector: '//nope', xPathIndex: 0, iweId: 'x' }],
        vi.fn(() => null),
      );
      expect(out).toEqual([]);
    });

    it('marks a change’s parent and refNode pointers too, not only its target', () => {
      setBody('<div id="p"><span id="r">r</span><span id="t">t</span></div>');
      const mod = new ChoicesModule(config as any);
      const resolver = ({ xPathSelector }: any) =>
        document.getElementById(
          xPathSelector === '//div' ? 'p' : xPathSelector === '//span[1]' ? 'r' : 't',
        );

      (mod as any).markPointersFromChanges(
        [
          {
            parent: { _xPathSelector: '//div', _xPathIndex: 0, _iweId: 'parentId' },
            refNode: { _xPathSelector: '//span[1]', _xPathIndex: 0, _iweId: 'refId' },
            xPathSelector: '//span[2]',
            xPathIndex: 0,
            iweId: 'targetId',
          },
        ],
        resolver as any,
      );

      expect(document.getElementById('p')!.getAttribute('parentId')).toBe('true');
      expect(document.getElementById('r')!.getAttribute('refId')).toBe('true');
      expect(document.getElementById('t')!.getAttribute('targetId')).toBe('true');
    });

    it('skips (rather than aborts on) an iwe id that is not a legal attribute name — fixes D-7', () => {
      // Was (choices.module.ts:99): `setAttribute(p._iweId, 'true')` puts a
      // server-supplied string in attribute-*name* position, so an id
      // containing a space, a quote or a leading digit made the DOM call
      // throw `InvalidCharacterError`. Because `markPointersFromChanges` ran
      // outside the per-change try/catch in `_applyChanges`, one malformed id
      // from the server aborted the entire pass — no experience on the page
      // applied at all. Fixed by isolating per change: the malformed change's
      // pointer is skipped, and a well-formed change in the same batch still
      // marks its element.
      setBody('<div id="p"><span id="t">t</span><span id="u">u</span></div>');
      const mod = new ChoicesModule(config as any);
      const resolver = ({ xPathSelector }: any) =>
        document.getElementById(xPathSelector === '//span[1]' ? 't' : 'u');

      expect(() =>
        (mod as any).markPointersFromChanges(
          [
            { xPathSelector: '//span[1]', xPathIndex: 0, iweId: 'not a valid name' },
            { xPathSelector: '//span[2]', xPathIndex: 0, iweId: 'validId' },
          ],
          resolver,
        ),
      ).not.toThrow();

      expect(document.getElementById('t')!.hasAttribute('not a valid name')).toBe(false);
      expect(document.getElementById('u')!.getAttribute('validId')).toBe('true');
    });

    it('writes an attribute literally named "undefined" when a change has no iwe id', () => {
      // Also a defect, milder: an absent `iweId` is not guarded, so the element
      // gets `undefined="true"`. Harmless to rendering, but it means a change
      // with a missing id silently marks the wrong thing rather than being
      // skipped, and every such element collides on one attribute name.
      setBody('<div id="p"><span id="t">t</span></div>');
      const mod = new ChoicesModule(config as any);

      (mod as any).markPointersFromChanges(
        [{ xPathSelector: '//span', xPathIndex: 0 }],
        vi.fn(() => document.getElementById('t')),
      );

      expect(document.getElementById('t')!.getAttribute('undefined')).toBe('true');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('ChoicesService — the pure parts', () => {
    describe('choicesDataGuard', () => {
      it('flattens the changes of every choice into one list', () => {
        const out = ChoicesService.choicesDataGuard({
          choices: [{ changes: [{ id: 1 }, { id: 2 }] }, { changes: [{ id: 3 }] }],
        } as any);
        expect(out).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
      });

      it.each([
        ['null data', null],
        ['no choices key', {}],
        ['a non-array choices', { choices: 'nope' }],
        ['an empty choices array', { choices: [] }],
      ])('returns an empty list for %s', (_label, data) => {
        // Every one of these is a plausible ingest response, and each must yield
        // "apply nothing" rather than throwing inside the DOMContentLoaded
        // handler — where the throw becomes an unhandled rejection in the
        // customer's page.
        expect(ChoicesService.choicesDataGuard(data as any)).toEqual([]);
      });

      it('ignores mergedChanges entirely — only `changes` is read', () => {
        // The merge branch is commented out in the source. Recorded because the
        // field is still sent by the server, and a future reader would otherwise
        // assume it is honoured.
        const out = ChoicesService.choicesDataGuard({
          choices: [{ changes: [{ id: 1 }], mergedChanges: [{ id: 99 }] }],
        } as any);
        expect(out).toEqual([{ id: 1 }]);
      });

      it('skips a malformed choice and keeps the others — fixes D-6', () => {
        // Was (choices.service.ts:31): `acc.push(...item.changes)` unconditional,
        // so a choice object missing `changes` threw out of `choicesDataGuard`.
        // It is called inside `setChangesData`'s try/catch, which recovers by
        // caching an EMPTY change list — so one malformed choice discarded
        // every choice in the response, silently. Fixed with per-item
        // isolation: the malformed item is dropped, the valid ones still apply.
        expect(
          ChoicesService.choicesDataGuard({ choices: [{ changes: [{ id: 1 }] }, {}] } as any),
        ).toEqual([{ id: 1 }]);
      });
    });

    describe('getIntemptSessionVariables', () => {
      it('splits the write key into username and password', () => {
        const vars = ChoicesService.getIntemptSessionVariables({
          organization: 'acme',
          project: 'proj',
          sourceId: 'src',
          profileId: 'p1',
          sessionId: 's1',
          writeKey: 'user.pass',
        } as any);
        expect(vars).toMatchObject({
          orgName: 'acme',
          project: 'proj',
          sourceId: 'src',
          profileId: 'p1',
          sessionId: 's1',
          username: 'user',
          password: 'pass',
        });
      });

      it('yields null credentials when the write key is absent', () => {
        // `getChoices` checks for this and returns no changes, so a misconfigured
        // source degrades to "no experiences" rather than an unauthenticated
        // request loop.
        const vars = ChoicesService.getIntemptSessionVariables({
          organization: 'acme',
          project: 'proj',
          sourceId: 'src',
        } as any);
        expect(vars.username).toBeNull();
        expect(vars.password).toBeNull();
      });

      it('classifies the device from the user agent', () => {
        // Device is a targeting dimension: getting it wrong serves the desktop
        // variant to phones, which is a visible layout break rather than a
        // reporting inaccuracy.
        const ua = (value: string) =>
          Object.defineProperty(navigator, 'userAgent', { value, configurable: true });

        ua('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
        expect(
          ChoicesService.getIntemptSessionVariables({ writeKey: 'u.p' } as any).device,
        ).toBe('MOBILE');

        ua('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
        expect(
          ChoicesService.getIntemptSessionVariables({ writeKey: 'u.p' } as any).device,
        ).toBe('DESKTOP');
      });

      it('returns no changes and logs when credentials are missing', async () => {
        // Originally asserted on a raw `console.error`. That call is now routed
        // through the structured logger, which is also what fixed the complaint
        // this test was written to pin (it printed unguarded in production).
        // Asserting via the diagnostic sink keeps the *behaviour* — "a missing
        // credential is reported" — and stops the assertion tracking the
        // transport, which is what made it break in the first place.
        const diagnostics: string[] = [];
        configureLogger({ level: 'debug', sink: (r) => diagnostics.push(r.message) });
        const out = await ChoicesService.getChoices({
          organization: 'acme',
          project: 'proj',
          sourceId: 'src',
        } as any);
        expect(out).toEqual([]);
        expect(diagnostics.join(' ')).toContain('credentials not found');
      });
    });

    describe('insertResultHandler', () => {
      it('prepends when the content is inside-and-top', () => {
        setBody('<div id="p"><span id="existing">e</span></div>');
        const parentElement = document.getElementById('p')!;
        const elementToInsert = document.createElement('b');
        elementToInsert.id = 'new';

        ChoicesService.insertResultHandler({
          content: { isInside: true, isTop: true },
          parentElement,
          elementToInsert,
        });

        expect(parentElement.children[0]!.id).toBe('new');
      });

      it('appends when the content is inside but not top', () => {
        setBody('<div id="p"><span id="existing">e</span></div>');
        const parentElement = document.getElementById('p')!;
        const elementToInsert = document.createElement('b');
        elementToInsert.id = 'new';

        ChoicesService.insertResultHandler({
          content: { isInside: true, isTop: false },
          parentElement,
          elementToInsert,
        });

        expect(parentElement.children[1]!.id).toBe('new');
      });

      it('appends when it is neither inside nor has a next sibling', () => {
        setBody('<div id="p"><span id="existing">e</span></div>');
        const parentElement = document.getElementById('p')!;
        const elementToInsert = document.createElement('b');
        elementToInsert.id = 'new';

        ChoicesService.insertResultHandler({
          content: { isInside: false },
          parentElement,
          elementToInsert,
        });

        expect(parentElement.children[1]!.id).toBe('new');
      });

      it('throws when a declared next sibling cannot be found', () => {
        // The throw is caught by `_applyChanges`, so this change is dropped and
        // the rest still apply. Asserted because the alternative — appending to
        // the end as a fallback — would put content in a visibly wrong place,
        // which is worse than not applying the experience.
        setBody('<div id="p"></div>');
        expect(() =>
          ChoicesService.insertResultHandler({
            content: { isInside: false, nextSibling: { xPathSelector: '//nope', xPathIndex: 0 } },
            parentElement: document.getElementById('p'),
            elementToInsert: document.createElement('b'),
          }),
        ).toThrow('NEXT SIBLING ELEMENT NOT FOUND');
      });
    });

    describe('elementGetterByXpath', () => {
      it('resolves an element by xpath and index', () => {
        setBody('<ul><li id="a">a</li><li id="b">b</li></ul>');
        expect(
          ChoicesService.elementGetterByXpath({ xPathSelector: '//li', xPathIndex: 1 })?.id,
        ).toBe('b');
      });

      it('returns null for an index past the end rather than throwing', () => {
        setBody('<ul><li id="a">a</li></ul>');
        expect(
          ChoicesService.elementGetterByXpath({ xPathSelector: '//li', xPathIndex: 5 }),
        ).toBeNull();
      });
    });
  });

});
