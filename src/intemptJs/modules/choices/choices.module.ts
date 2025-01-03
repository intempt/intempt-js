import { ChoicesParams} from '../../types/choices.types.ts';
import { ChoicesService } from './choices.service.ts';
import { ModificationHandler } from './models/ModificationHandler.ts';
import { dummy } from '../../../../dummy.ts';





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

          if(changes.length === 0) {
            import.meta.env.VITE_ENV === 'development' && console.log('no changes');
            return;
          }



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
    this._service.createIntemptEditorStyleElement();
    const changesHandler = new ModificationHandler();

    if (!changes || changes.length === 0) {
      if(import.meta.env.VITE_ENV === 'development'){
        console.log('No changes to apply.');
      }

      return Promise.resolve();
    }

    for (let i = 0; i < changes.length; i++) {
      let change = changes[i];

      if (change && changesHandler.hasOwnProperty(change.type)) {
        try {
          changesHandler[change.type as keyof ModificationHandler](change as any);
        } catch (error) {
          if(import.meta.env.VITE_ENV === 'development'){
            console.warn(`Error applying change of type "${change.type}":`, error);
            console.warn(change);
          }

        }
      }
      else {
        if(import.meta.env.VITE_ENV === 'development'){
          console.log(change)
          console.log(`Handler for "${change?.type}" change type not found`)
        }
      }
    }
  }


}
