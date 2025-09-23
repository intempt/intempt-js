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


export const ChoicesService = {
  _api: import.meta.env.VITE_API,

  choicesDataGuard: function(data:{choices:any[]}):MergedChoices[] {
    if (!data || !data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
      import.meta.env.VITE_ENV === 'development' && console.log("response or first element of choices array is null, undefined, or not an array with at least one element");

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

  getChoices: async function(config:ChoicesParams):Promise<MergedChoices[]> {
    /**
     * Get variables stored in SessionStorage
     * */
    try{
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

      let productId = undefined;
      if(config.shopify){
        productId = await this.handleShopifyProductId();
      }
      else if(config.magento){
        productId = await this.handleMagentoProductId();
      }

      if(productId){
        localStorageCache.set('productId', productId);
      }
      else{
        localStorageCache.remove('productId');
      }


      const changesRequest = new ChoicesRequestModel({
        sourceId,
        profileId,
        url,
        device,
        sessionId,
        productId
      });
      const authRequest = new AuthRequest({username, password});

      return this.getChoicesData({
        changesRequest,
        authRequest,
        orgName,
        project
      })}
    catch(error){
      console.log('[getChoices] ERROR', error);
      return []
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



    return storedData?.changes ?? []
  },


  setChangesData: async function({ key, url, body, auth_config }:SetChoicesData){
    const responseMaxTime = 320;
    try{
      const changesPromise = new Promise<void>(async ( resolve ) => {
        const data = await this.fetchChoices(url, body, auth_config.auth)

        const changes = this.choicesDataGuard(data);
        localStorageCache.set(key, {changes});
        resolve();

      })
      const timeoutPromise = new Promise(resolve => setTimeout(resolve, responseMaxTime));

      await Promise.race([
        timeoutPromise,
        await changesPromise
      ])
    }
    catch(error:any){
      console.log('[setChangesData] ERROR', error);
      localStorageCache.set(key, {changes:[]});
    }
  },

  fetchChoices: async function(path:string, body:ChoicesRequestModel, auth:AuthConfig) {

    try{
      const { username, password } = auth;

      const requestURL = `${this._api}/${path}`;

      const encodedCredentials = btoa(`${username}:${password}`);

      const response = await fetch(requestURL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${encodedCredentials}`,
        },
        body: JSON.stringify({...body}),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      return response.json()
    }
    catch(error){
      console.log('[fetchChoices] ERROR', error);
      return []
    }
  },

  elementGetterByXpath({ xPathSelector, xPathIndex }:{xPathSelector:string, xPathIndex:number}) {
    const matchingElements = document.evaluate(xPathSelector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    return (matchingElements.snapshotItem(xPathIndex) as Element) ?? null;
  },

  insertResultHandler({ content, parentElement, elementToInsert}:any){
    if (content.isInside) {
        if(content.isTop) {
          parentElement.prepend(elementToInsert);
        }
        else{
          parentElement.appendChild(elementToInsert);
        }
    }
    else{
      if(content.nextSibling){
        const nextSibling = this.elementGetterByXpath(content.nextSibling);
        if (!nextSibling){
          throw new Error('NEXT SIBLING ELEMENT NOT FOUND');
        }

        parentElement.insertBefore(elementToInsert, nextSibling);
      }
      else{
        parentElement.appendChild(elementToInsert);
      }
    }
  },

  handleShopifyProductId():Promise<string|undefined>{
    return new Promise((resolve) => {
      setTimeout(() => {
        const meta = window.meta ?? window.Shopify?.meta;

        if (!meta) return resolve(undefined);

        if (meta.page?.pageType === 'product') {
          resolve(meta.product?.id?.toString());
        } else {
          resolve(undefined);
        }
      }, 320);
    });



    // const meta = window.meta ?? window.Shopify?.meta;
    // if (!meta) return undefined;
    // else if (meta.page?.pageType && meta.page?.pageType === 'product') {
    //   return  meta.product?.id?.toString();
    // }
    // else{
    //   return undefined;
    // }
  },

  handleMagentoProductId():Promise<string|undefined>{
    return new Promise((resolve) => {
      setTimeout(() => {
        if (document.body.classList.contains('catalog-product-view')) {
          resolve(
            document.querySelector('[data-product-id]')?.getAttribute('data-product-id') ||
            document.querySelector('[product-id]')?.getAttribute('product-id') ||
            undefined
          );
        } else {
          resolve(undefined);
        }
      }, 320);
    });
  },

}
