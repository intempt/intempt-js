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
import { EnvConfig } from '../../../shared/envConfig.ts';

import { createLogger } from '../../../shared/logger/logger.ts';

const log = createLogger('ChoicesService');

export const ChoicesService = {
  get _api() {
    return EnvConfig.getApi();
  },

  choicesDataGuard: function (data: { choices: unknown[] }): MergedChoices[] {
    if (
      !data ||
      !data.choices ||
      !Array.isArray(data.choices) ||
      data.choices.length === 0
    ) {
      log.debug(
        'response or first element of choices array is null, undefined, or not an array with at least one element',
      );

      return [];
    }

    const choices = data.choices as Array<{
      changes?: Choice[];
      mergedChanges?: MergedChoices[];
    }>;

    return choices.reduce((acc, item) => {
      // D-6: one malformed choice (e.g. missing/non-array `changes`) must not
      // discard every other choice in the response — the visitor still gets
      // whatever DID parse. Isolated per item rather than per field.
      try {
        if (item && Array.isArray(item.changes)) {
          acc.push(...(item.changes as unknown as MergedChoices[]));
        } else {
          log.warn(
            'a choice item has no `changes` array — skipping that choice',
            item,
          );
        }
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
      } catch (error) {
        log.warn('failed to process a choice item — skipping that choice', {
          item,
          error,
        });
      }

      return acc;
    }, [] as MergedChoices[]);
  },

  getIntemptSessionVariables: function (
    config: ChoicesParams,
  ): IntemptVariables {
    const { profileId, sessionId } = config;
    const orgName = config.organization;
    const project = config.project;
    const sourceId = config.sourceId;
    const url = location.href;
    const deviceCondition =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent,
      );
    const device = deviceCondition ? 'MOBILE' : 'DESKTOP';
    const [username, password] = config.writeKey
      ? config.writeKey.split('.')
      : [null, null];

    return {
      orgName,
      project,
      sourceId,
      profileId,
      sessionId,
      device,
      username,
      password,
      url,
    };
  },

  getChoices: async function (config: ChoicesParams): Promise<MergedChoices[]> {
    /**
     * Get variables stored in SessionStorage
     * */
    try {
      const {
        orgName,
        project,
        sourceId,
        profileId,
        sessionId,
        device,
        username,
        password,
        url,
      } = this.getIntemptSessionVariables(config);

      /**
       * Return an empty array if the credentials not found
       * */
      if (!username || !password) {
        log.error('credentials not found');
        return [];
      }

      let productId = undefined;
      if (config.shopify) {
        productId = await this.handleShopifyProductId();
      } else if (config.magento) {
        productId = await this.handleMagentoProductId();
      }

      if (productId) {
        localStorageCache.set('productId', productId);
      } else {
        localStorageCache.remove('productId');
      }

      const changesRequest = new ChoicesRequestModel({
        sourceId,
        profileId,
        url,
        device,
        sessionId,
        productId,
      });
      const authRequest = new AuthRequest({ username, password });

      return this.getChoicesData({
        changesRequest,
        authRequest,
        orgName,
        project,
      });
    } catch (error) {
      log.error('getChoices failed', error);
      return [];
    }
  },

  getChoicesData: async function (
    args: FetchChoicesData,
  ): Promise<MergedChoices[]> {
    const { changesRequest, orgName, project, authRequest } = args;
    const url = `${orgName}/projects/${project}/optimization/choose-web`;
    const key = `changes_${window.location.pathname}`;

    /**
     * Http Call to get The Change
     * Wait 320ms and Set Experiment Data in localStorage,
     * */
    await this.setChangesData({
      key,
      url,
      body: changesRequest,
      auth_config: authRequest,
    });

    const storedData: StoredData = localStorageCache.get(key);

    return storedData?.changes ?? [];
  },

  setChangesData: async function ({
    key,
    url,
    body,
    auth_config,
  }: SetChoicesData) {
    const responseMaxTime = 320;
    try {
      // D-22: an `async` function passed as a Promise executor never calls
      // `reject` on throw — the executor's own returned (rejected) promise is
      // discarded, so the throw was swallowed and `changesPromise` hung
      // forever instead of surfacing to this `catch`. An async IIFE returns a
      // real promise that rejects like any other.
      const changesPromise = (async (): Promise<void> => {
        const data = await this.fetchChoices(url, body, auth_config.auth);

        const changes = this.choicesDataGuard(data);
        localStorageCache.set(key, { changes });
      })();
      const timeoutPromise = new Promise((resolve) =>
        setTimeout(resolve, responseMaxTime),
      );

      await Promise.race([timeoutPromise, await changesPromise]);
    } catch (error) {
      log.error('setChangesData failed', error);
      localStorageCache.set(key, { changes: [] });
    }
  },

  fetchChoices: async function (
    path: string,
    body: ChoicesRequestModel,
    auth: AuthConfig,
  ) {
    try {
      const { username, password } = auth;

      const requestURL = `${this._api}/${path}`;

      const encodedCredentials = btoa(`${username}:${password}`);

      const response = await fetch(requestURL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${encodedCredentials}`,
        },
        body: JSON.stringify({ ...body }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      return response.json();
    } catch (error) {
      log.error('fetchChoices failed', error);
      return [];
    }
  },

  elementGetterByXpath({
    xPathSelector,
    xPathIndex,
  }: {
    xPathSelector: string;
    xPathIndex: number;
  }) {
    const matchingElements = document.evaluate(
      xPathSelector,
      document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );
    return (matchingElements.snapshotItem(xPathIndex) as Element) ?? null;
  },

  insertResultHandler({
    content,
    parentElement,
    elementToInsert,
  }: {
    content: {
      isInside?: boolean;
      isTop?: boolean;
      nextSibling?: { xPathSelector: string; xPathIndex: number };
    };
    parentElement: Element;
    elementToInsert: Element;
  }) {
    if (content.isInside) {
      if (content.isTop) {
        parentElement.prepend(elementToInsert);
      } else {
        parentElement.appendChild(elementToInsert);
      }
    } else {
      if (content.nextSibling) {
        const nextSibling = this.elementGetterByXpath(content.nextSibling);
        if (!nextSibling) {
          throw new Error('NEXT SIBLING ELEMENT NOT FOUND');
        }

        parentElement.insertBefore(elementToInsert, nextSibling);
      } else {
        parentElement.appendChild(elementToInsert);
      }
    }
  },

  handleShopifyProductId(): Promise<string | undefined> {
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

  handleMagentoProductId(): Promise<string | undefined> {
    return new Promise((resolve) => {
      setTimeout(() => {
        if (document.body.classList.contains('catalog-product-view')) {
          resolve(
            document
              .querySelector('[data-product-id]')
              ?.getAttribute('data-product-id') ||
              document
                .querySelector('[product-id]')
                ?.getAttribute('product-id') ||
              undefined,
          );
        } else {
          resolve(undefined);
        }
      }, 320);
    });
  },
};
