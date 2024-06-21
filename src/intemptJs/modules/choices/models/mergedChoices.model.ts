import { MergedChoices } from '../../../types/choices.types.ts';
import { ChoicesConfig } from '../choices.config.ts';


export class MergedChoicesModel {
  insert: (change: MergedChoices) => (void);
  move: (change: MergedChoices) => (void);
  modify: (change: MergedChoices) => (void);
  replace: (change: MergedChoices & { oldSelector: string }) => (void);
  delete: (change: MergedChoices) => (void);
  // clone: (change: MergedChanges) => (void);

  constructor(){
    this.insert = this.insertHandler
    this.modify = this.modifyHandler
    this.replace = this.replaceHandler
    this.delete = this.deleteHandler
    this.move = this.moveHandler
    // this.clone = this.cloneHandler

  }

  //TODO: ?? remove ?? --->
  private onClone(change:MergedChoices){
    const {
      location,
      selector,
      oldSelector,
      html,
      attributes,
      styles,
      textContent
    } = change;

    const parentElement = this.getElementBySelector(location.parent_selector);

    if(!parentElement) return console.error('parentElement not found in insertHandler');

    const fullSelector = this.getFullSelector(selector, location.parent_selector!);

    const clonedElement = this.getElementBySelector(fullSelector);

    if(!!clonedElement) return console.log('Element already exists in cloneHandler');

    const newNode =  this.createNodeElementFromHtmlString(html);


    this.applyAttributes(newNode, attributes);
    this.applyTextContent(newNode, textContent);

    const nextSiblingElement = this.getElementBySelector(location.nextSibling_selector);

    if(nextSiblingElement){
      parentElement.insertBefore(newNode, nextSiblingElement)
    }
    else{
      parentElement.appendChild(newNode);
    }

    const clonedElementSelector = this.getFullSelector(selector, location.parent_selector!);

    this.applyStyles(clonedElementSelector, styles);
  }

  private cloneHandler(change:MergedChoices){
    console.log('use clone handler', change);
    const {
      location,
      selector,
      oldSelector,
      html,
      attributes,
      styles,
      textContent
    } = change;

    // const parentElement = this.getElementBySelector(location.parent_selector);

    // if(!parentElement) return console.error('parentElement not found in insertHandler');
    // this.onClone(change)
    //this.mutationObserverOnInsert(document.body,location.parent_selector!, () => this.onClone(change));

  }

  //TODO: ?? remove ?? ---<


  private moveHandler(change:MergedChoices) {
    console.log('use move handler', change);

    const {
      location,
      selector,
      oldSelector,
      attributes,
      textContent,
      styles
    } = change;

    const parentElement = this.getElementBySelector(location.parent_selector);

    console.log(parentElement);

    //this.mutationObserverHandler(document.body, () => {
    const selectedElement = this.getElementBySelector(oldSelector);

    if(!selectedElement) return console.error('selectedElement not found in moveHandler');

    this.applyAttributes(selectedElement, attributes);

    const newParentElement = this.getElementBySelector(location.parent_selector);

    if(!newParentElement) return console.error('newParentElement not found in moveHandler');

    const newNextSiblingElement = this.getElementBySelector(location.nextSibling_selector);

    if(newNextSiblingElement){
      newParentElement.insertBefore(selectedElement, newNextSiblingElement)
    }
    else{
      newParentElement.appendChild(selectedElement);
    }

    const movedElement = newParentElement.querySelector(selector)!;

    this.applyTextContent(movedElement, textContent);

    this.applyStyles( selector, styles);
    //})





  }

  private insertHandler(change:MergedChoices){
    console.log('use insert handler', change);
    const {
      location,
    } = change;

    const parentElement = this.getElementBySelector(location.parent_selector);

    if(parentElement) return this.onInsert(change);


    this.mutationObserverOnInsert(
      document.body,
      location.parent_selector,
      () => this.onInsert(change)
    )
  }






  private modifyHandler(change:MergedChoices){
    // console.log('use modify handler', change);

    const {
      selector,
      attributes,
      textContent,
      styles,
      location
    } = change;

    // const parentElement = this.getElementBySelector(location.parent_selector);
    //
    // if(!parentElement) return console.error('parentElement not found in insertHandler');

    this.mutationObserverHandler(document.body, () =>  this.applyAllModifications({
      attributes,
      textContent,
      styles,
      selector
    }))
  }

  private replaceHandler(change:MergedChoices & { oldSelector: string }){
    console.log('use replace handler', change);

    const {
      selector,
      oldSelector,
      attributes,
      textContent,
      styles,
      html
    } = change;


    this.mutationObserverHandler(document.body, () => {
      const selectedElement = this.getElementBySelector(oldSelector);

      if(!selectedElement) return console.error('selectedElement not found in replaceHandler');

      const newNode =  this.createNodeElementFromHtmlString(html);

      this.applyAttributes(newNode, attributes);
      this.applyTextContent(newNode, textContent);

      selectedElement.replaceWith(newNode);

      this.applyStyles(selector, styles);
    });




  }

  private deleteHandler(change:MergedChoices){
    console.log('use delete handler', change);
    const selectedElement = this.getElementBySelector(change.selector);

    if(!selectedElement) return console.log('Element not found in deleteHandler');

    selectedElement.remove();
    // this.mutationObserverHandler(document.body, () => {
    //     console.log('use delete handler', change);
    //     const selectedElement = this.getElementBySelector(change.selector);
    //
    //     if(!selectedElement) return console.log('Element not found in deleteHandler');
    //
    //     selectedElement.remove();
    // });

  }





  /**
   * Helpers
   * */

  private onInsert(change:MergedChoices){
    const {
      location,
      selector,
      html,
      attributes,
      styles,
      textContent
    } = change;

    const parentElement = this.getElementBySelector(location.parent_selector);

    if(!parentElement) return console.error('parentElement not found in insertHandler');

    const fullSelector = this.getFullSelector(selector, location.parent_selector!);

    // const elementToInsert = this.getElementBySelector(fullSelector);
    //
    // if(!!elementToInsert) return console.log('Element already exists in insertHandler');


    const newNode =  this.createNodeElementFromHtmlString(html);
    console.log('fullSelector',fullSelector);
    console.log('id',change.id);
    console.log('parentElement',parentElement);

    this.applyAttributes(newNode, attributes);
    this.applyTextContent(newNode, textContent);


    const nextSiblingFullSelector = this.getFullSelector(location.nextSibling_selector!, location.parent_selector!);
    const previousSiblingFullSelector = this.getFullSelector(location.previousSibling_selector!, location.parent_selector!);

    const nextSiblingElement = this.getElementBySelector(nextSiblingFullSelector);
    const previousSiblingElement = this.getElementBySelector(previousSiblingFullSelector);





    if(nextSiblingElement){
      parentElement.insertBefore(newNode, nextSiblingElement);
    }
    else if(!nextSiblingElement && previousSiblingElement){
      const nextElement = previousSiblingElement.nextElementSibling;

      parentElement.insertBefore(newNode, nextElement);

    }
    else if(!nextSiblingElement && !previousSiblingElement){
      parentElement.prepend(newNode);
    }

    else{
      parentElement.appendChild(newNode);
    }

    /**
     * Add styles after inserting element
     * */

    this.applyStyles(fullSelector, styles);
  }

  private getFullSelector(selector:string, parentSelector:string){
    if(!selector) return '';
    const selectorToArr = selector!.split(' > ');
    const actualElementSelector = selectorToArr[selectorToArr.length - 1];
    return `${parentSelector} > ${actualElementSelector}`;
  }

  private createNodeElementFromHtmlString(html:string){
    const tempContainer = document.createElement('div');
    tempContainer.innerHTML = html;

    return tempContainer.firstElementChild!;
  }

  private mutationObserverOnInsert(element: HTMLElement,selector:string, callback: () => void){

    const observer = new MutationObserver((_mutationsList:MutationRecord[], _observer:MutationObserver) => {

      _mutationsList.forEach((mutation) => {
        mutation.addedNodes.forEach((node) =>{
          if (node.nodeType === 1 && (node as Element).matches(selector)) {
            _observer.disconnect();
            callback();
          }
        })
      })
    })

    observer.observe(element, {
      attributes:true,
      childList: true,
      subtree: true,
      characterData: true,
    });

  }

  private mutationObserverHandler(element: HTMLElement, callback: () => void ){

    const observer = new MutationObserver((_mutationsList:MutationRecord[], _observer:MutationObserver) => {
      _observer.disconnect();
      callback();
    })

    observer.observe(element, {
      attributes:true,
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  private getElementBySelector(selector:string|undefined):HTMLElement|null{
    if(!selector) return null;

    try {
      return document.querySelector(selector) as HTMLElement;
    }
    catch(error){
      console.error('Invalid selector:', error);
      return null;
    }
  }

  private applyAllModifications({ attributes, textContent, styles, selector }:any){
    const selectedElement = this.getElementBySelector(selector);

    if(!selectedElement) return console.error('selectedElement not found in applyAllModifications');

    this.applyAttributes(selectedElement, attributes);
    this.applyTextContent(selectedElement, textContent);
    this.applyStyles(selector, styles);

  }

  private applyTextContent(element:Element, textContent?:string){
    if(!textContent) return console.log('TEXT_CONTENT NOT FOUND');
    element.innerHTML = textContent;
  }

  private applyAttributes(element:Element, attributes?:Record<string, any>){
    if(!attributes) return console.error('attributes not found');

    Array.from(element.attributes).forEach(attr => element.removeAttribute(attr.name));


    Object.keys(attributes).forEach((key) => element.setAttribute(key, attributes[key]));


  }

  private applyStyles(selector:string, styles?:Record<string, any>){
    if(!styles) return console.error(`STYLES NOT FOUND`);
    if(!selector) return console.log(`SELECTOR ${selector} FOR STYLES NOT FOUND`);



    const {styleDataAttribute} = ChoicesConfig;
    const stylesTag = document.querySelector(`[${styleDataAttribute}]`);

    const pseudoClassNames = Object.keys(styles);

    let css = ''

    pseudoClassNames.forEach((pseudoClassName:string) => {
      const pseudoClass = pseudoClassName === 'state' ? '' : `:${pseudoClassName}`;
      const cssProperties = Object.entries(styles[pseudoClassName]).reduce((acc, [key, value]) => {
        return `${acc}${key}: ${value}; `;
      }, '');

      css += `${selector}${pseudoClass} { ${cssProperties} } `;
    });

    console.log('apply css', css);

    stylesTag!.appendChild(document.createTextNode(css));

  }

}
