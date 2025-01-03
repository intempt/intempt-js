
import { IntemptConfig } from './intemptJs.types.ts';
import { AuthRequest } from '../models/auth.model.ts';
import { ChoicesRequestModel } from '../modules/choices/models/choicesRequest.model.ts';



type EditorElementType = {
  tagName:string,
  classes: string[],
  docIndex: number
  cmp_id: string
  generalIndex:number;
  intemptId:string
}


type ElementLocationType = {
  docIndex: number;
  parent: EditorElementType | null;
  generalIndex:number;
  previousSibling: EditorElementType | null;
  nextSibling: EditorElementType | null ;
  intemptId:string
};

export type ChoicesParams = IntemptConfig & {
  profileId:string,
  sessionId:string
}

export type FetchChoicesData = {
  changesRequest: ChoicesRequestModel,
  authRequest: AuthRequest,
  orgName:string,
  project:string,
}


export type ChoiceTypes = "attribute" | "delete" | "edit" | "insert" | "move" | "styles" | 'clone';
export type MergedChoiceTypes = 'insert' | 'modify' | 'replace' | 'delete';

export type Choice = {
  active: boolean;
  change_title: string;
  attributes: Record<string, any>;
  changedAttribute: string;
  classes: string[];
  id: string;
  newValue: Record<string, any> | string;
  oldValue: Record<string, any> | string;
  isPublished: boolean;
  oldLocation: ElementLocationType | null;
  newLocation: ElementLocationType | null;
  property: string;
  selector: string;
  tagName: string;
  type: ChoiceTypes;
  stylesToAdd?: any
};

export type ChoicesRequestData = {
  sourceId:string,
  device:string,
  profileId:string,
  productId:string | null | undefined,
  sessionId:string,
  url:string,
}

export type SetChoicesData = {
  key: string,
  url: string,
  auth_config: AuthRequest,
  body: ChoicesRequestModel
}


export type HtmlElementLocationStack = {
  element: HTMLElement | ChildNode;
  parentId: string;
  index: number;
}



export type StoredData = {changes:MergedChoices[]} | undefined | null;

export type MergedChoices = {
  id: string;
  html: string
  selector: string;
  oldSelector?: string;
  attributes:{[key:string]:string}
  location: {
    parent_selector:string;
    nextSibling_selector:string | undefined;
    previousSibling_selector:string | undefined;
  }
  textContent: string|undefined;
  styles:{[key:string]:string|number}| undefined;
  type: MergedChoiceTypes;
};
