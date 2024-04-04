


export type IdType = 'pag' | 'ses' | 'ev' |'prof';

export type IntemptIdsParams = {
  sessionId?:string,
  profileId?:string,
  sourceId?:string,
}


export type IntemptConfig = {
  organization: string;
  sourceId: string;
  project: string;
  writeKey: string;
}

export type ConsentAction = 'accept' | 'reject';

export type ConsentParams = {
  action: ConsentAction,
  validUntil: number
  email?:string,
  message?: string
  category?: string
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
