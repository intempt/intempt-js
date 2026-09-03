import {
  ChoicesParams,
  Modification,
  XPtr,
} from '../../types/choices.types.ts';
import { ChoicesService } from './choices.service.ts';
import {
  pointerAttr,
  WebEditorModificationHandler,
} from './models/WebEditorModificationHandler.ts';

import { createLogger } from '../../../shared/logger/logger.ts';

const log = createLogger('Choices');

export class ChoicesModule {
  private readonly _config: ChoicesParams;
  private readonly _service = ChoicesService;

  constructor(config: ChoicesParams) {
    this._config = { ...config };
  }

  async init() {
    try {
      const changesPromise = this._service.getChoices(this._config);
      document.addEventListener('DOMContentLoaded', async () => {
        try {
          const changes = await changesPromise;

          if (changes.length === 0) return;

          await this._applyChanges(changes);
        } catch (error) {
          throw new Error(`An error occurred: ${error}`);
        }
      });
    } catch (error) {
      log.error('failed to apply choices', error);
    }
  }

  private async _applyChanges(changes: unknown[]): Promise<void> {
    this.markPointersFromChanges(changes);

    const changesHandler = new WebEditorModificationHandler();

    if (!changes || changes.length === 0) {
      return;
    }

    // D-8: `style`/`update`/`insert` on the handler are `async`; calling them
    // without `await` means the `try/catch` below can never observe their
    // failures — the rejection surfaces as an unhandled rejection in the
    // customer's page instead of the "error applying change" diagnostic.
    // Awaited sequentially (not `Promise.all`) so changes are applied in the
    // order the server sent them — applying them out of order or in parallel
    // is visible to a visitor as flicker on the live page.
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i] as Modification;

      if (
        change &&
        Object.prototype.hasOwnProperty.call(changesHandler, change.type)
      ) {
        try {
          type Handler = (c: Modification) => Promise<void> | void;
          const handlerFn = (
            changesHandler as unknown as Record<string, Handler>
          )[change.type];
          await handlerFn(change);
        } catch (error) {
          log.warn(`error applying change of type "${change.type}"`, {
            change,
            error,
          });
        }
      } else {
        log.warn(
          `handler for "${(change as Modification)?.type}" change type not found`,
          change,
        );
      }
    }
  }

  /**
   * Returns nothing on purpose. It used to hand back the `{ el, iweId }` pairs it stamped and
   * `_applyChanges`, its only caller, discarded them — so the list existed solely for tests to
   * assert on, and a test asserting a value production never reads proves nothing about
   * production. The stamped DOM is the output; that is what the assertions read now.
   */
  private markPointersFromChanges(
    changes: unknown[],
    resolver = ChoicesService.elementGetterByXpath,
  ): void {
    const cache = new Map<string, HTMLElement | null>();
    const seen = new Set<string>();

    for (const change of changes) {
      // D-7: this pass used to run entirely outside the per-change try/catch
      // in `_applyChanges`, so one malformed change (no `xPathSelector`, or an
      // `iweId` that is not a legal attribute name) threw out of the whole
      // loop and no experience on the page applied at all. Isolated per
      // change here — that change's pointers are skipped, everything else
      // still marks and applies.
      try {
        const c = change as Modification;
        // Build a flat list of pointers: parent, refNode, self
        const pointers: XPtr[] = [
          c.parent as unknown as XPtr,
          c.refNode as unknown as XPtr,
          {
            _xPathSelector: c.xPathSelector,
            _xPathIndex: c.xPathIndex,
            _iweId: c.iweId,
            _iwePtrId: c.iwePtrId,
          } as XPtr,
        ].filter(Boolean);

        for (const p of pointers) {
          // The attribute we are about to stamp, resolved by the SAME function the handler
          // looks it up with. Not a second expression that happens to agree — see
          // `pointerAttr`.
          const attr = pointerAttr(p);

          // A pointer with no usable attribute name cannot be stamped or looked up. The
          // self-pointer built above is always truthy even when `iweId` is undefined, so
          // `.filter(Boolean)` does not catch this; without the guard it stamped a literal
          // attribute called "undefined" that every such change then shared.
          //
          // Logged, not skipped in silence: an unstampable pointer means that change will not
          // apply, and a change vanishing with no trace is the exact defect class this commit
          // exists to remove.
          if (!attr) {
            log.warn(
              'pointer has no iwePtrId or iweId; its change cannot be applied',
              { change: c, pointer: p },
            );
            continue;
          }

          // The element cache is keyed by POSITION - resolving the same xPath twice is
          // wasted work.
          const posKey = `${p._xPathSelector}|${p._xPathIndex}`;

          // Dedupe is keyed by POSITION + ATTRIBUTE, and that distinction is the whole fix.
          //
          // `seen` exists to avoid stamping the same attribute on the same element twice. It
          // was keyed on position alone, which silently meant "one attribute per element per
          // page". Two changes pointing at the same element with different `iweId`s - which
          // is every pair of variants, and every pair of live experiences sharing a container
          // - stamped only the first. The second's handler then resolved `[attr="true"]` to
          // null and early-returned without throwing, so the change vanished with no error
          // in dev or production.
          const stampKey = `${posKey}|${attr}`;
          if (seen.has(stampKey)) continue;

          let el = cache.get(posKey);
          if (el === undefined) {
            el = resolver({
              xPathSelector: p._xPathSelector,
              xPathIndex: p._xPathIndex,
            }) as HTMLElement | null;
            cache.set(posKey, el ?? null);
          }
          if (!el) continue;

          el.setAttribute(attr, 'true');
          seen.add(stampKey);
        }
      } catch (error) {
        log.warn(
          'failed to mark pointers for a change — skipping that change',
          { change, error },
        );
      }
    }
  }
}
