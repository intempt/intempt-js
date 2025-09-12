
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

export type ModificationType = 'insert' | 'remove' | 'update';
export type BlockId = 'base' | 'carousel' | 'grid' | 'image' | 'divider' | 'content' | 'spacer' | 'paragraph' | 'heading' | 'button';
export type  SelectionPtr = {
  _tagName: string
  _cssSelector: string
  _attributes: Record<string, string>
  _name: string
  _blockId: BlockId
  _iweId: string
  _xPathSelector: string
  _xPathIndex: number
  _text: string | null
}
export type  Modification = {
  type: ModificationType;
  blockId: BlockId;
  t: number;
  parent: SelectionPtr | null;
  refNode: SelectionPtr | null;
  style: Record<string, string>;
  attributes: {
    [p
    :
    string
      ]:
      string
  }
  ;
  iweId: string;
  tag: string;
  html: string;
  js: string | undefined;
  xPathSelector: string;
  xPathIndex: number;
  text: string | null;
  params:  Record<string, any>
}
export type XPtr = {
  _xPathSelector: string;
  _xPathIndex: number;
  _iweId: string;
};
