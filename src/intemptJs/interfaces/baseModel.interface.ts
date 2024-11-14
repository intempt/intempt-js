import {
  AliasModelPayload,
  GroupModelPayload,
  IdentifyModelPayload, ProductModelPayload,
  RecordModelPayload,
  TrackModelPayload,
} from '../types/autoTracker.types.ts';



interface BaseModel {
  readonly name: string;
  readonly type: string;
  readonly payload: any[];
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

export interface ModelAlias extends BaseModel {
  readonly type: 'alias';
  readonly payload: AliasModelPayload[];
}

export interface ModelRecord extends BaseModel {
  readonly type: 'record';
  readonly payload: RecordModelPayload[];
}

export interface ModelTrack extends BaseModel {
  readonly type: 'track';
  readonly payload: TrackModelPayload[];
}

export interface ConsentTrack  {
  readonly type: 'consent';
  get _name(): string;
}
