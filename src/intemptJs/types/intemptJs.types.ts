
import { DiagnosticSink, LogThreshold } from '../../shared/logger/logger.ts';

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
  magento: boolean;
  /**
   * Verbose diagnostics, including in a production bundle.
   *
   * The support switch. Every diagnostic in the SDK used to be gated on the build
   * environment, so the production bundle every customer runs printed nothing and
   * there was no way to change that without shipping them a staging build. Set
   * this and the console gets `debug` and above.
   */
  debug?: boolean;
  /**
   * Explicit console threshold, overriding both `debug` and the environment
   * default. Use `'silent'` to quiet a development build, or `'warn'` to see only
   * real problems in production.
   */
  logLevel?: LogThreshold;
  /**
   * Receive SDK diagnostics for forwarding to your own telemetry (Sentry,
   * Datadog, a custom endpoint).
   *
   * Called synchronously with a structured record. Defaults to `warn` and above,
   * independently of `logLevel`, because a sink exists to catch problems in
   * production — where the console is silent. Raise it with `debug: true`.
   *
   * Exceptions thrown by this callback are swallowed: a broken sink must not
   * become an unhandled error on your page.
   */
  onDiagnostic?: DiagnosticSink;
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

export type EditorPayload = {
  experience: any,
  variantId: string,
  token: string,
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

export type RecommendationParams = {
  id:number,
  quantity:number
  fields:string[]
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






