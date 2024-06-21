import { ChoicesParams, HtmlElementLocationStack, MergedChoices } from '../../types/choices.types.ts';
import { ChoicesService } from './choices.service.ts';
import { ChoicesConfig } from './choices.config.ts';
import { MergedChoicesModel } from './models/mergedChoices.model.ts';
import { ModificationHandler } from './models/ModificationHandler.ts';


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
        console.log('DOMContentLoaded');
        try {
          console.time('CHANGES APPLY TIME');
          const changes = await changesPromise;

          if(changes.length === 0) return console.log('no changes');

          await this._applyChanges(changes);
          console.timeEnd('CHANGES APPLY TIME');
          console.log("Changes applied successfully");
        } catch (error) {
          throw new Error(`An error occurred: ${error}`);
        }
      })
    }
    catch (error) {
      console.error("An error occurred:", error);
     // this._htmlVisibilityHandler('visible');
    }
    finally {
     // this._htmlVisibilityHandler('visible');
    }
  }

  private _applyIntemptId(){
    const { intemptId } = ChoicesConfig;
    const TEXT_NODE = 3;
    const COMMENT_NODE = 8;
    const ELEMENT_NODE = 1;

    const stack: HtmlElementLocationStack[] = [
      {
        element: document.body,
        parentId: '0',
        index: 1,
      }
    ];


    while (stack.length > 0) {
      const { element, parentId, index }:HtmlElementLocationStack = stack.pop()!;
      const selfId = `${parentId}${index}`;
      if (element.nodeType === ELEMENT_NODE) {
        const attributeQualifiedName = intemptId(selfId);
        (element as HTMLElement).setAttribute( attributeQualifiedName,'');
      }

      const children = Array.from(element.childNodes);

      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i];
        if(child){
          stack.push({ element: child, parentId: selfId, index: i });
        }

      }
    }
  }


  private _applyChanges(changes:any[]){
    console.log('_applyChanges: ',changes);
    this._service.createIntemptEditorStyleElement();


    const changesHandler = new ModificationHandler();

    if (!changes || changes.length === 0) {
      console.log('No changes to apply.');
      return Promise.resolve(); // Return a resolved promise for consistency
    }

    for (let i = 0; i < changes.length; i++) {
      let change = changes[i];

      if (change && changesHandler.hasOwnProperty(change.type)) {
        try {
          // @ts-ignore
          changesHandler[change.type ](change as any);
        } catch (error) {
          console.error('Error', error);
          throw new Error(`Error applying change: ${error}`);
        }
      } else {
        console.log(change)
        console.log(`Handler for "${change?.type}" change type not found`)
      }
    }
  }

  private _htmlVisibilityHandler(type:'hide' | 'visible'){
    const currentLocation = window.location.href;
    const { host } = new URL(currentLocation);

    if( host === 'www.intempt.com' ||
      host === 'intempt.webflow.io' ||
      host === 'https://www.troliunamas.lt'){
      return
    }


    switch (type) {
      case 'hide':
        console.log("html hidden");
        document.documentElement.style.visibility = 'hidden';
        //document.documentElement.style.display = 'none';
        document.documentElement.style.opacity = '0';
        document.documentElement.style.transition = 'opacity 300ms ease-in-out';
        break;

      case 'visible':
        console.log("html visible");
        document.documentElement.style.visibility = '';
        //document.documentElement.style.display = '';
        document.documentElement.style.opacity = '1';
        setTimeout(() => {
          document.documentElement.style.transition = '';
          document.documentElement.style.opacity = '';
        }, 350);
        break;

      default:
        break
    }
  }
}
