
export type LocalStorageCache = {
  get: (key: string) => any;
  set: (key: string, value: any) => any;
  remove: (key: string) => void;
  getAllKeys: () => string[];
  clear: () => void;
};

export type IdType = 'pag' | 'ses' | 'ev' |'prof';

export type IntemptIdsParams = {
  sessionId?:string,
  profileId?:string,
  pageId?:string,
  sourceId?:string,
}


export type IntemptConfig = {
  organization: string;
  sourceId: string;
  project: string;
  writeKey: string;
  shopify: boolean;
}

export type IntemptVariables = {
  orgName: string,
  project: string,
  sourceId: string,
  profileId: string,
  sessionId: string,
  device: string,
  username: string | null,
  password: string | null,
  url: string
}

export type ConsentAction = 'accept' | 'reject';

export type ConsentParams = {
  action: ConsentAction,
  validUntil: number
  email?:string,
  message?: string
  category?: string
}

export type ProductParams = {
  productId:string,
  quantity?:number
}


export type IdentifyParams = {
   userId: string,
   eventTitle?: string,
   userAttributes?:{[key:string]:any}
   data?:{[key:string]:any}
}

export type GroupParams = {
  accountId: string,
  eventTitle?: string,
  accountAttributes?: {[key:string]:any}
}

export type TrackParams = {
  eventTitle: string,
  data: {[key:string]:any}
}

export type RecordParams = {
  eventTitle: string,
  accountId?: string,
  userId?: string,
  accountAttributes?: {[key:string]:any}
  userAttributes?: {[key:string]:any}
  data?: {[key:string]:any}
}

export type AliasParams = {
  userId: string,
  anotherUserId: string,
}

export type AuthConfig = {
  username: string,
  password: string
}






