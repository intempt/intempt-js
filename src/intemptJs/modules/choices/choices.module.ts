import { ChoicesParams, XPtr } from '../../types/choices.types.ts';
import { ChoicesService } from './choices.service.ts';
import { WebEditorModificationHandler } from './models/WebEditorModificationHandler.ts';
import { EnvConfig } from '../../../shared/envConfig.ts';



export class ChoicesModule {
  private readonly _config:ChoicesParams;
  private readonly _service= ChoicesService;

  constructor(config: ChoicesParams) {
    this._config = { ...config };
  }

  async init(){
    try{
      const changesPromise = this._service.getChoices(this._config);
      document.addEventListener('DOMContentLoaded', async () => {
        try {
          const changes = await changesPromise;

          if(changes.length === 0)  return;
          

          await this._applyChanges(changes);

        } catch (error) {
          throw new Error(`An error occurred: ${error}`);
        }
      })
    }
    catch (error) {
      console.log("An error occurred:", error);
    }

  }

  private _applyChanges(changes:any[]){
    this.markPointersFromChanges(changes);

    const changesHandler = new WebEditorModificationHandler();

    if (!changes || changes.length === 0) {
      return Promise.resolve();
    }


    for (let i = 0; i < changes.length; i++) {
      let change = changes[i];

      if (change && changesHandler.hasOwnProperty(change.type)) {
        try {

          (changesHandler as any)[change.type](change as any);
        } catch (error) {
          if(EnvConfig.isDevelopment()){
            console.warn(`Error applying change of type "${change.type}":`, error);
            console.warn(change);
          }
        }
      }
      else {
        if(EnvConfig.isDevelopment()){
          console.log(change)
          console.log(`Handler for "${change?.type}" change type not found`)
        }
      }
    }
  }

  private markPointersFromChanges(
    changes: any[],
    resolver = ChoicesService.elementGetterByXpath
  ): Array<{ el: HTMLElement; iweId: string }> {
    const cache = new Map<string, HTMLElement | null>();
    const seen  = new Set<string>();
    const out: Array<{ el: HTMLElement; iweId: string }> = [];

    for (const c of changes) {
      // Build a flat list of pointers: parent, refNode, self
      const pointers: XPtr[] = [
        c.parent as XPtr,
        c.refNode as XPtr,
        { _xPathSelector: c.xPathSelector, _xPathIndex: c.xPathIndex, _iweId: c.iweId } as XPtr,
      ].filter(Boolean);

      for (const p of pointers) {
        const key = `${p._xPathSelector}|${p._xPathIndex}`;
        if (seen.has(key)) continue;

        let el = cache.get(key);
        if (el === undefined) {
          el = resolver({ xPathSelector: p._xPathSelector, xPathIndex: p._xPathIndex }) as HTMLElement | null;
          cache.set(key, el ?? null);
        }
        if (!el) continue;

        el.setAttribute(p._iweId,'true')
        out.push({ el, iweId: p._iweId });
        seen.add(key);
      }
    }

    return out;
  }
}
