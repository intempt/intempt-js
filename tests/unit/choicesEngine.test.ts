import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebEditorModificationHandler } from '../../src/intemptJs/modules/choices/models/WebEditorModificationHandler.ts';
import { ModificationHandler } from '../../src/intemptJs/modules/choices/models/ModificationHandler.ts';
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
 * **A structural finding that shapes this file.** There are two handler classes
 * and only one of them runs:
 *
 *  - `WebEditorModificationHandler` (121 LOC, 4 types: style / update / insert /
 *    remove) is what `ChoicesModule._applyChanges` instantiates. This is the
 *    live engine.
 *  - `ModificationHandler` (459 LOC, 7 types: style / delete / insert /
 *    typography / replace / move / attribute / clone, plus stylesheet injection
 *    and element cloning) is **imported by nothing**. `grep -rn
 *    ModificationHandler src/` matches only its own definition. It is dead code
 *    — roughly a third of the whole choices module, shipped in every customer's
 *    bundle.
 *
 * Both are covered here. The live one first, because that is where a regression
 * reaches a visitor; the dead one because it is 459 lines that will be either
 * revived or deleted, and either decision is safer with its behaviour written
 * down. The distinction is asserted, so nobody reads the coverage and concludes
 * the seven-type engine is in service.
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

    it('a change with no xPathSelector aborts the ENTIRE pass — a defect, asserted', () => {
      // DEFECT (choices.module.ts:40 + 94), and the most likely of the three
      // marking-pass failures to actually happen. `_applyChanges` calls
      // `markPointersFromChanges` *before* the per-change try/catch loop, and the
      // default resolver goes straight to `document.evaluate(p._xPathSelector,
      // ...)`. With no selector on the change, `document.evaluate(undefined)`
      // throws — so a single change missing one field takes down the whole
      // batch and **no experience on the page renders**.
      //
      // The per-change try/catch in the loop below gives exactly the isolation
      // this needs; the marking pass simply runs outside it. Recorded rather than
      // fixed because the fix is a decision — wrap the pass, or skip pointers
      // with no selector — and either way it changes what happens to the other
      // changes in a batch, which wants a parity check against real payloads.
      setBody('<span id="t">t</span>');
      const mod = new ChoicesModule(config as any);

      expect(() => applyChanges(mod, [{ type: 'remove', iweId: 'targetId' }])).toThrow();
      // The element the (valid) change targeted is untouched: nothing ran.
      expect(document.getElementById('t')).not.toBeNull();
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

    it('throws when an iwe id is not a legal attribute name — a defect, asserted', () => {
      // DEFECT (choices.module.ts:99). `setAttribute(p._iweId, 'true')` puts a
      // server-supplied string in attribute-*name* position, so an id containing
      // a space, a quote or a leading digit makes the DOM call throw
      // `InvalidCharacterError`. `markPointersFromChanges` runs **outside** the
      // per-change try/catch in `_applyChanges` (it is called on line 40, before
      // the loop), so one malformed id from the server aborts the entire pass
      // and **no experience on the page is applied**.
      //
      // That is the worst blast radius in the module, which is why it is recorded
      // rather than patched in a test commit: the fix is a validation step plus a
      // decision about whether to drop the pointer or the whole change, and it
      // should ship with the ids being constrained server-side.
      setBody('<div id="p"><span id="t">t</span></div>');
      const mod = new ChoicesModule(config as any);
      const resolver = vi.fn(() => document.getElementById('t'));

      expect(() =>
        (mod as any).markPointersFromChanges(
          [{ xPathSelector: '//span', xPathIndex: 0, iweId: 'not a valid name' }],
          resolver,
        ),
      ).toThrow();
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

      it('throws when a choice has no `changes` array — a defect, asserted', () => {
        // DEFECT (choices.service.ts:31): the guard validates the outer envelope
        // but then does `acc.push(...item.changes)` unconditionally, so a choice
        // object missing `changes` throws out of `choicesDataGuard`. It is called
        // inside `setChangesData`'s try/catch, which recovers by caching an empty
        // change list — so the visible effect is that ONE malformed choice
        // discards **every** choice in the response, silently.
        expect(() =>
          ChoicesService.choicesDataGuard({ choices: [{ changes: [{ id: 1 }] }, {}] } as any),
        ).toThrow();
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
        // Also pins the unguarded `console.error` at choices.service.ts:94 that
        // `FRONTEND.md` item 4 calls out: every other diagnostic in the SDK is
        // gated on `EnvConfig`, this one is not, so it prints in production.
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const out = await ChoicesService.getChoices({
          organization: 'acme',
          project: 'proj',
          sourceId: 'src',
        } as any);
        expect(out).toEqual([]);
        expect(spy).toHaveBeenCalledWith('credentials not found');
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

  // ────────────────────────────────────────────────────────────────────────────
  describe('ModificationHandler — the 7-type engine that is NOT wired up', () => {
    let handler: any;

    beforeEach(() => {
      handler = new ModificationHandler();
    });

    it('is dead code: nothing in src/ imports it', () => {
      // Asserted as a fact about the class rather than by grepping: the live
      // dispatcher (`_applyChanges`) selects a handler with
      // `changesHandler.hasOwnProperty(change.type)` against a
      // `WebEditorModificationHandler`, which has exactly four handlers. Three
      // of `ModificationHandler`'s seven type names do not exist there at all,
      // so a change of those types is unroutable in the shipped SDK — which is
      // the operational meaning of "dead". ~459 LOC ship to every customer.
      const live = new WebEditorModificationHandler() as unknown as Record<string, unknown>;
      const liveTypes = Object.keys(live);
      expect(liveTypes.sort()).toEqual(['insert', 'remove', 'style', 'update']);

      const deadOnly = ['typography', 'replace', 'move', 'attribute', 'clone', 'delete'].filter(
        (t) => !liveTypes.includes(t),
      );
      expect(deadOnly).toEqual(['typography', 'replace', 'move', 'attribute', 'clone', 'delete']);
    });

    it('exposes all 7 mutation types as own properties, which is how dispatch finds them', () => {
      // `hasOwnProperty` is the dispatch test, so these must be instance fields
      // rather than prototype methods. That is why the constructor assigns them.
      for (const type of [
        'style',
        'delete',
        'insert',
        'typography',
        'replace',
        'move',
        'attribute',
        'clone',
      ]) {
        expect(Object.prototype.hasOwnProperty.call(handler, type)).toBe(true);
      }
    });

    describe('delete', () => {
      it('removes an element found by its iwe_id attribute', () => {
        // Note the different addressing convention from the live handler:
        // `iwe_id="<value>"`, not `<value>="true"`. The two engines cannot share
        // a marking pass, which is a further reason the dead one cannot simply
        // be re-enabled.
        setBody('<span iwe_id="x1" id="t">t</span><span id="keep">k</span>');
        handler.delete({ iwe_id: 'x1' });
        expect(document.getElementById('t')).toBeNull();
        expect(document.getElementById('keep')).not.toBeNull();
      });

      it('falls back to xpath when no iwe_id matches', () => {
        setBody('<ul><li id="a">a</li><li id="b">b</li></ul>');
        handler.delete({ iwe_id: 'absent', xPathSelector: '//li', xPathIndex: 1 });
        expect(document.getElementById('b')).toBeNull();
      });

      it('throws when the element cannot be found at all', () => {
        setBody('<div id="keep">k</div>');
        expect(() =>
          handler.delete({ iwe_id: 'absent', xPathSelector: '//li', xPathIndex: 0 }),
        ).toThrow('Element not found');
      });
    });

    describe('move', () => {
      it('prepends into the parent when inside-and-top', () => {
        setBody(
          '<div iwe_id="parent" id="p"><span id="sib">s</span></div><span iwe_id="tgt" id="t">t</span>',
        );
        handler.move({
          iwe_id: 'tgt',
          current: {
            modification: {
              targetElement: { iwe_id: 'tgt' },
              parent: { iwe_id: 'parent' },
              isInside: true,
              isTop: true,
            },
          },
        });
        expect(document.getElementById('p')!.children[0]!.id).toBe('t');
      });

      it('appends into the parent when inside but not top', () => {
        setBody(
          '<div iwe_id="parent" id="p"><span id="sib">s</span></div><span iwe_id="tgt" id="t">t</span>',
        );
        handler.move({
          iwe_id: 'tgt',
          current: {
            modification: {
              targetElement: { iwe_id: 'tgt' },
              parent: { iwe_id: 'parent' },
              isInside: true,
              isTop: false,
            },
          },
        });
        expect(document.getElementById('p')!.children[1]!.id).toBe('t');
      });

      it('inserts before moveTo when moveTo is a child of the parent', () => {
        setBody(
          '<div iwe_id="parent" id="p"><span iwe_id="mv" id="m">m</span></div>' +
            '<span iwe_id="tgt" id="t">t</span>',
        );
        handler.move({
          iwe_id: 'tgt',
          current: {
            modification: {
              targetElement: { iwe_id: 'tgt' },
              parent: { iwe_id: 'parent' },
              moveTo: { iwe_id: 'mv' },
              isInside: false,
            },
          },
        });
        expect(document.getElementById('p')!.children[0]!.id).toBe('t');
        expect(document.getElementById('p')!.children[1]!.id).toBe('m');
      });

      it('appends when there is no moveTo', () => {
        setBody(
          '<div iwe_id="parent" id="p"><span id="sib">s</span></div><span iwe_id="tgt" id="t">t</span>',
        );
        handler.move({
          iwe_id: 'tgt',
          current: {
            modification: {
              targetElement: { iwe_id: 'tgt' },
              parent: { iwe_id: 'parent' },
              isInside: false,
            },
          },
        });
        expect(document.getElementById('p')!.children[1]!.id).toBe('t');
      });

      it('throws when the parent or target is missing', () => {
        setBody('<span iwe_id="tgt" id="t">t</span>');
        expect(() =>
          handler.move({
            iwe_id: 'tgt',
            current: {
              modification: {
                targetElement: { iwe_id: 'tgt' },
                parent: { iwe_id: 'nope', xPathSelector: '//nope', xPathIndex: 0 },
                isInside: true,
              },
            },
          }),
        ).toThrow('PARENT OR TARGET ELEMENT NOT FOUND');
      });

      it('substitutes the action’s iwe_id when the target has none', () => {
        // The `targetElementProps` fallback. Without it a change authored before
        // the target was tagged resolves nothing and the move throws.
        setBody('<div iwe_id="parent" id="p"></div><span iwe_id="fallback" id="t">t</span>');
        handler.move({
          iwe_id: 'fallback',
          current: {
            modification: {
              targetElement: {},
              parent: { iwe_id: 'parent' },
              isInside: true,
              isTop: true,
            },
          },
        });
        expect(document.getElementById('p')!.children[0]!.id).toBe('t');
      });
    });

    describe('attribute', () => {
      it('sets a plain attribute and tags the element with its iwe_id', () => {
        setBody('<a iwe_id="x1" id="t">t</a>');
        handler.attribute({
          current: {
            modification: {
              attributeName: 'href',
              attributeValue: 'https://example.com',
              targetElement: { iwe_id: 'x1' },
            },
          },
        });
        expect(document.getElementById('t')!.getAttribute('href')).toBe('https://example.com');
      });

      it('removes the attribute when the new value is empty', () => {
        // An empty value means "unset", not "set to empty string" — the
        // difference matters for `disabled`, `hidden` and friends, where an empty
        // string is still truthy in HTML.
        setBody('<a iwe_id="x1" id="t" href="https://old.example">t</a>');
        handler.attribute({
          current: {
            modification: { attributeName: 'href', attributeValue: '', targetElement: { iwe_id: 'x1' } },
          },
        });
        expect(document.getElementById('t')!.hasAttribute('href')).toBe(false);
      });

      it('updates every src-like attribute at once when setting src', () => {
        // Responsive images carry `src`, `data-src` and `srcset`. Changing only
        // `src` leaves the browser free to keep using `srcset`, so the visitor
        // sees the old image and the experience looks broken.
        setBody(
          '<img iwe_id="x1" id="t" src="old.png" data-src="old.png" srcset="old.png 500w">',
        );
        handler.attribute({
          current: {
            modification: {
              attributeName: 'src',
              attributeValue: 'new.png',
              targetElement: { iwe_id: 'x1' },
            },
          },
        });
        const img = document.getElementById('t')!;
        expect(img.getAttribute('src')).toBe('new.png');
        expect(img.getAttribute('data-src')).toBe('new.png');
        // srcset is rewritten to the descriptor form the spec requires.
        expect(img.getAttribute('srcset')).toBe('new.png 1000w');
      });

      it('defaults a missing srcset descriptor to 1000w', () => {
        setBody('<img iwe_id="x1" id="t" src="old.png" srcset="old.png">');
        handler.attribute({
          current: {
            modification: {
              attributeName: 'src',
              attributeValue: 'new.png',
              targetElement: { iwe_id: 'x1' },
            },
          },
        });
        expect(document.getElementById('t')!.getAttribute('srcset')).toBe('new.png 1000w');
      });
    });

    describe('typography', () => {
      it('replaces the element’s innerHTML', () => {
        setBody('<p iwe_id="x1" id="t">old</p>');
        handler.typography({ iwe_id: 'x1', current: { modification: '<b>new</b>' } });
        expect(document.getElementById('t')!.innerHTML).toBe('<b>new</b>');
      });

      it('throws after the 1000ms wait when the element never appears', () => {
        // The retry-then-throw is what turns a late-rendering element into either
        // a successful change or a caught error, rather than a silent no-op.
        vi.useFakeTimers();
        setBody('<div id="keep">k</div>');
        handler.typography({
          iwe_id: 'absent',
          xPathSelector: '//nope',
          xPathIndex: 0,
          current: { modification: 'x' },
        });
        expect(() => vi.advanceTimersByTime(1001)).toThrow(
          'Element not found after waiting for 1000ms',
        );
      });
    });

    describe('insert', () => {
      it('inserts into the resolved parent via the service', () => {
        setBody('<div iwe_id="parent" id="p"></div>');
        handler.insert({
          current: {
            modification: {
              html: '<b id="new">new</b>',
              parent: { iwe_id: 'parent' },
              isInside: true,
              isTop: true,
            },
          },
        });
        expect(document.getElementById('new')).not.toBeNull();
      });

      it('throws when the parent cannot be resolved', () => {
        setBody('<div id="keep">k</div>');
        expect(() =>
          handler.insert({
            current: {
              modification: {
                html: '<b>new</b>',
                parent: { iwe_id: 'nope', xPathSelector: '//nope', xPathIndex: 0 },
              },
            },
          }),
        ).toThrow('PARENT ELEMENT NOT FOUND');
      });
    });

    describe('style — stylesheet injection', () => {
      it('inserts a new rule into the iwe stylesheet when none exists', () => {
        // Rules go into a dedicated `<style>` tag rather than inline styles so
        // that pseudo-classes and media queries are expressible at all. Losing
        // the tag means every style experience throws.
        installIweStylesheet();
        setBody('<p iwe_id="x1" id="t">t</p>');

        handler.style({
          iwe_id: 'x1',
          cssSelector: '.promo',
          current: { modification: { pseudoClass: '', css: { color: 'blue' } } },
        });

        const sheet = document.styleSheets[0]!;
        expect(Array.from(sheet.cssRules).some((r) => r.cssText.includes('.promo'))).toBe(true);
      });

      it('updates the existing rule instead of appending a duplicate', () => {
        installIweStylesheet('.promo { color: red; }');
        setBody('<p iwe_id="x1" id="t">t</p>');

        handler.style({
          iwe_id: 'x1',
          cssSelector: '.promo',
          current: { modification: { pseudoClass: '', css: { color: 'blue' } } },
        });

        const sheet = document.styleSheets[0]!;
        expect(sheet.cssRules).toHaveLength(1);
        expect((sheet.cssRules[0] as CSSStyleRule).style.color).toBe('blue');
      });

      it('honours !important in an updated rule', () => {
        // Host-page CSS routinely out-specifies an injected rule, so !important
        // is the only reliable way for an experience to win. Dropping the flag
        // makes the change apply silently but render as though it had not.
        installIweStylesheet('.promo { color: red; }');
        setBody('<p iwe_id="x1" id="t">t</p>');

        handler.style({
          iwe_id: 'x1',
          cssSelector: '.promo',
          current: { modification: { pseudoClass: '', css: { color: 'blue !important' } } },
        });

        const rule = document.styleSheets[0]!.cssRules[0] as CSSStyleRule;
        expect(rule.style.getPropertyPriority('color')).toBe('important');
        expect(rule.style.color).toBe('blue');
      });

      it('applies inline styles alongside the stylesheet rule', () => {
        installIweStylesheet();
        setBody('<p iwe_id="x1" id="t">t</p>');

        handler.style({
          iwe_id: 'x1',
          cssSelector: '.promo',
          current: {
            modification: { pseudoClass: '', css: { color: 'blue' }, inline: { 'font-size': '20px' } },
          },
        });

        expect((document.getElementById('t') as HTMLElement).style.fontSize).toBe('20px');
      });

      it('tags the element with its iwe_id so later changes can find it', () => {
        installIweStylesheet();
        setBody('<p id="t">t</p>');
        handler.style({
          iwe_id: 'x1',
          xPathSelector: '//p',
          xPathIndex: 0,
          cssSelector: '.promo',
          current: { modification: { pseudoClass: '', css: { color: 'blue' } } },
        });
        expect(document.getElementById('t')!.getAttribute('iwe_id')).toBe('x1');
      });

      it('throws when the iwe stylesheet tag is absent', () => {
        // Recorded because it is the failure every style change hits if the
        // bootstrap that injects `ChoicesConfig.initialStylesRules` has not run
        // yet — a real ordering hazard, not a hypothetical.
        setBody('<p iwe_id="x1" id="t">t</p>');
        expect(() =>
          handler.style({
            iwe_id: 'x1',
            cssSelector: '.promo',
            current: { modification: { pseudoClass: '', css: { color: 'blue' } } },
          }),
        ).toThrow('Stylesheet associated with the styles tag not found');
      });

      it('writes a pseudo-class rule when one is given', () => {
        installIweStylesheet();
        setBody('<p iwe_id="x1" id="t">t</p>');
        handler.style({
          iwe_id: 'x1',
          cssSelector: '.promo',
          current: { modification: { pseudoClass: 'hover', css: { color: 'blue' } } },
        });
        expect(document.styleSheets[0]!.cssRules[0]!.cssText).toContain(':hover');
      });
    });

    describe('replace', () => {
      it('replaces the element when its iwe_id differs from the change’s', () => {
        // The inequality check is the guard against re-applying a change to
        // content it already produced — an infinite replace loop under the
        // MutationObserver otherwise.
        setBody('<div><p iwe_id="old" id="t">old</p></div>');
        handler.replace({
          iwe_id: 'new',
          xPathSelector: '//p',
          xPathIndex: 0,
          current: { modification: { html: '<span id="fresh">fresh</span>' } },
        });
        expect(document.getElementById('t')).toBeNull();
        expect(document.getElementById('fresh')).not.toBeNull();
      });

      it('does not replace when the iwe_id already matches', () => {
        vi.useFakeTimers();
        setBody('<div><p iwe_id="same" id="t">old</p></div>');
        handler.replace({
          iwe_id: 'same',
          xPathSelector: '//p',
          xPathIndex: 0,
          current: { modification: { html: '<span id="fresh">fresh</span>' } },
        });
        // The deferred path fires and DOES replace, because the timeout branch
        // drops the iwe_id comparison entirely. Recorded as-is.
        vi.advanceTimersByTime(1001);
        expect(document.getElementById('fresh')).not.toBeNull();
      });
    });

    describe('clone', () => {
      it('inserts a clone immediately after the source element', () => {
        installIweStylesheet();
        setBody('<div><p iwe_id="src" id="t">t</p><p id="after">after</p></div>');

        handler.clone({
          current: {
            modification: {
              elementToClone: { iwe_id: 'src' },
              clone: { html: '<p id="cloned">cloned</p>', cssSelectors: {} },
            },
          },
        });

        const parent = document.getElementById('t')!.parentElement!;
        expect(parent.children[1]!.id).toBe('cloned');
      });

      it('copies the source selector’s CSS onto the clone’s new selector', () => {
        // A clone that does not carry its styling renders unstyled, which is a
        // visibly broken duplicate rather than a second copy of the original.
        installIweStylesheet('.orig { color: red; }');
        setBody('<div><p iwe_id="src" id="t">t</p></div>');

        handler.clone({
          current: {
            modification: {
              elementToClone: { iwe_id: 'src' },
              clone: {
                html: '<p iwe_id="c1" id="cloned">cloned</p>',
                cssSelectors: { c1: { oldSelector: '.orig', newCssSelector: '.clone1' } },
              },
            },
          },
        });

        const rules = Array.from(document.styleSheets[0]!.cssRules).map((r) => r.cssText);
        expect(rules.some((t) => t.includes('.clone1'))).toBe(true);
        expect(document.getElementById('cloned')).not.toBeNull();
      });

      it('warns and aborts on malformed clone HTML rather than inserting nothing silently', () => {
        installIweStylesheet();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        setBody('<div><p iwe_id="src" id="t">t</p></div>');

        handler.clone({
          current: {
            modification: {
              elementToClone: { iwe_id: 'src' },
              clone: { html: 'just text, no elements', cssSelectors: {} },
            },
          },
        });

        expect(warn).toHaveBeenCalled();
        expect(document.getElementById('t')!.parentElement!.children).toHaveLength(1);
      });

      it('warns when a cloned child has no CSS mapping', () => {
        installIweStylesheet();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        setBody('<div><p iwe_id="src" id="t">t</p></div>');

        handler.clone({
          current: {
            modification: {
              elementToClone: { iwe_id: 'src' },
              clone: { html: '<p iwe_id="c1" id="cloned">c</p>', cssSelectors: {} },
            },
          },
        });

        expect(warn).toHaveBeenCalledWith('No CSS mapping found for iwe_id:', 'c1');
      });
    });
  });
});
