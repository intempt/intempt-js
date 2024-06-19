import {
  Choice,
  ChoicesParams,
  FetchChoicesData,
  MergedChoices,
  SetChoicesData,
  StoredData,
} from '../../types/choices.types.ts';
import { ChoicesRequestModel } from './models/choicesRequest.model.ts';
import { AuthRequest } from '../../models/auth.model.ts';
import { AuthConfig, IntemptVariables } from '../../types/intemptJs.types.ts';
import { localStorageCache } from '../../../shared/storageHandler.ts';
import { ChoicesConfig } from './choices.config.ts';


export const ChoicesService = {
  _api: import.meta.env.VITE_CHOICES_API,

  choicesDataGuard: function(data:{choices:any[]}):MergedChoices[] {
    if (!data || !data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
      console.log("response or first element of choices array is null, undefined, or not an array with at least one element");
      return [];
    }

    const { choices} = data;

    return choices.reduce((acc, item:{changes:Choice[], mergedChanges:MergedChoices[]}) => {
      acc.push(...item.changes);
      // if (item && Array.isArray(item.mergedChanges) && item.mergedChanges.length > 0) {
      //   acc.push(...item.mergedChanges);
      // }
      // else if (item && !item.mergedChanges && Array.isArray(item.changes) && item.changes.length > 0) {
      //   const activeChanges = item.changes.filter((change: Choice) => change.active);
      //   acc.push(...activeChanges);
      // }
      // else {
      //   console.log("Either 'changes' or 'mergedChanges' in an item of data is null, undefined, or empty.");
      // }

      return acc;
    }, [])
  },

  getIntemptSessionVariables: function (config:ChoicesParams):IntemptVariables {

    const { profileId, sessionId } = config;
    const orgName = config.organization;
    const project = config.project;
    const sourceId = config.sourceId;
    const url = location.href;
    const deviceCondition = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const device = deviceCondition ? 'MOBILE' : 'DESKTOP';
    const [username, password] =!!config.writeKey
      ? config.writeKey.split(".")
      : [null, null];

    return {
      orgName ,
      project,
      sourceId,
      profileId,
      sessionId,
      device,
      username,
      password,
      url
    }
  },

  getChoicesData: async function (args: FetchChoicesData):Promise<MergedChoices[]>{
    const {changesRequest, orgName, project, authRequest} = args;
    const url =`${orgName}/projects/${project}/optimization/choose-web`;
    const key = `changes_${window.location.pathname}`;

    /**
     * Http Call to get The Change
     * Wait 320ms and Set Experiment Data in localStorage,
     * */
    await this.setChangesData({
      key,
      url,
      body: changesRequest,
      auth_config: authRequest
    });

    const storedData:StoredData = localStorageCache.get(key);



    return storedData?.changes??[]
  },

  getChoices: async function(config:ChoicesParams):Promise<MergedChoices[]> {
    /**
     * Get variables stored in SessionStorage
     * */
    const {
      orgName,
      project,
      sourceId,
      profileId,
      sessionId,
      device,
      username,
      password,
      url
    } = this.getIntemptSessionVariables(config);

    /**
     * Return an empty array if the credentials not found
     * */
    if(!username || !password) {
      console.error('credentials not found')
      return []
    }

    const changesRequest = new ChoicesRequestModel({
      sourceId,
      profileId,
      url,
      device,
      sessionId
    });
    const authRequest = new AuthRequest({username, password});

    return this.getChoicesData({
      changesRequest,
      authRequest,
      orgName,
      project
    })
  },

  setChangesData: async function({ key, url, body, auth_config }:SetChoicesData){
    const responseMaxTime = 320;
    try{
      const changesPromise = new Promise<void>(resolve =>
        this.fetchChoices(url, body, auth_config.auth)
          .then( async ( data:any) => {
            const changes = this.choicesDataGuard(data);
            localStorageCache.set(key, {changes});
            resolve();
          })
      )
      const timeoutPromise = new Promise(resolve => setTimeout(resolve, responseMaxTime));

      await Promise.race([
        timeoutPromise,
        await changesPromise
      ])
    }
    catch(error:any){
      console.log('--EXPERIMENT ERROR--', error);
      localStorageCache.set(key, {changes:[]});
    }
  },

  fetchChoices: async function(path:string, body:ChoicesRequestModel, auth:AuthConfig) {

    const { username, password } = auth;

    const requestURL = `${this._api}/${path}`;

    const encodedCredentials = btoa(`${username}:${password}`);

    return fetch(requestURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${encodedCredentials}`,
      },
      body: JSON.stringify({...body}),
    }).then((response) => response.json())
  },

  createIntemptEditorStyleElement: function() {
    const {styleDataAttribute, initialStylesRules} = ChoicesConfig;
    const style = document.createElement('style');
    style.setAttribute(styleDataAttribute, '');
    style.textContent = initialStylesRules;
    document.head.appendChild(style);
  }

}
