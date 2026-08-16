import {
  ChoicesParams,
  Modification,
  XPtr,
} from '../../types/choices.types.ts';
import { ChoicesService } from './choices.service.ts';
import { WebEditorModificationHandler } from './models/WebEditorModificationHandler.ts';

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

  private markPointersFromChanges(
    changes: unknown[],
    resolver = ChoicesService.elementGetterByXpath,
  ): Array<{ el: HTMLElement; iweId: string }> {
    const cache = new Map<string, HTMLElement | null>();
    const seen = new Set<string>();
    const out: Array<{ el: HTMLElement; iweId: string }> = [];

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
          } as XPtr,
        ].filter(Boolean);

        for (const p of pointers) {
          const key = `${p._xPathSelector}|${p._xPathIndex}`;
          if (seen.has(key)) continue;

          let el = cache.get(key);
          if (el === undefined) {
            el = resolver({
              xPathSelector: p._xPathSelector,
              xPathIndex: p._xPathIndex,
            }) as HTMLElement | null;
            cache.set(key, el ?? null);
          }
          if (!el) continue;

          el.setAttribute(p._iweId, 'true');
          out.push({ el, iweId: p._iweId });
          seen.add(key);
        }
      } catch (error) {
        log.warn(
          'failed to mark pointers for a change — skipping that change',
          { change, error },
        );
      }
    }

    return out;
  }
}
