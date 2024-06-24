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
        try {
          const changes = await changesPromise;

          if(changes.length === 0) return console.log('no changes');

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
          changesHandler[change.type as keyof ModificationHandler](change as any);
        } catch (error) {
          throw new Error(`Error applying change: ${error}`);
        }
      }
      else {
        console.log(change)
        console.log(`Handler for "${change?.type}" change type not found`)
      }
    }
  }


}
