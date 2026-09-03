import {
  GroupModelPayload,
  IdentifyModelPayload,
  ProductModelPayload,
  RecordModelPayload,
  TrackModelPayload,
} from '../types/autoTracker.types.ts';

interface BaseModel {
  readonly name: string;
  readonly type: string;
  /**
   * `unknown[]`, not `any[]`: every interface below narrows this to its own
   * payload type, so the base only needs to say "an array of entries". `any[]`
   * additionally made the *narrowed* members assignable in both directions, which
   * is how a `TrackModelPayload[]` could be handed to something expecting
   * identify entries without a complaint.
   */
  readonly payload: unknown[];
  get _name(): string;
}

export interface ModelIdentify extends BaseModel {
  readonly type: 'identify';
  readonly payload: IdentifyModelPayload[];
}

export interface ModelGroup extends BaseModel {
  readonly type: 'group';
  readonly payload: GroupModelPayload[];
}

export interface ModelProduct extends BaseModel {
  readonly type: 'product';
  readonly payload: ProductModelPayload[];
}

export interface ModelRecord extends BaseModel {
  readonly type: 'record';
  readonly payload: RecordModelPayload[];
}

export interface ModelTrack extends BaseModel {
  readonly type: 'track';
  readonly payload: TrackModelPayload[];
}

export interface ConsentTrack {
  readonly type: 'consent';
  get _name(): string;
}
