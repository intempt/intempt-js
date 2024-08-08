import { ChoicesConfig } from '../choices.config.ts';
import { ChoicesService } from '../choices.service.ts';


export class ModificationHandler {
  style:  (change: any) => (void);
  delete: (change: any) => (void);
  insert: (change: any) => (void);
  typography: (change: any) => (void);
  replace: (change: any) => (void);
  move: (change: any) => (void);
  attribute: (change: any) => (void);

    constructor() {

        this.delete = this.deleteHandler;
        this.insert = this.insertHandler;
        this.style = this.stylesHandler;
        this.typography = this.typographyHandler;
        this.move = this.moveHandler;
        this.attribute = this.attributeHandler;
        this.replace = this.replaceHandler;
    }

  private deleteHandler(modification: any) {
    const element = this.elementGetterByXpath(modification);
    if(!element){
      throw new Error('Element not found');
    }
    element.remove();
  }

  private stylesHandler(modification: any) {
    console.log('stylesHandler modification: ',modification);


    const observer = new MutationObserver((mutations, observer) => {
      const element = this.elementGetterByXpath(modification);
      if (element) {
        observer.disconnect();
        element.setAttribute('iwe_id', modification.iwe_id);
      }
    });
    observer.observe(document.body, {
      attributes:true,
      childList: true,
      subtree: true,
      characterData: true,
    });

    const element = this.elementGetterByXpath(modification);

    if (element) {
      observer.disconnect();
      element.setAttribute('iwe_id', modification.iwe_id);
    } else {
      setTimeout(() => {
        observer.disconnect();
        const element = this.elementGetterByXpath(modification);
        if (!element) {
          throw new Error('Element not found after waiting for 1000ms');
        }
      }, 1000);
    }

    const selectorCssRule = this.getIweStyleRule(modification.cssSelector);

    if(!selectorCssRule){
      this.insertNewCssRule(modification.cssSelector, modification.current.modification);
    }
    else{
      this.updateCssRule(selectorCssRule, modification.current.modification.css);
    }



  }

  private typographyHandler(modification: any) {
    const element = this.elementGetterByXpath(modification);
    if(!element){
          throw new Error('Element not found');
    }
    element.innerHTML = modification.current.modification;

  }

  private insertHandler(modification: any) {
    const content = modification.current.modification;

    const tempElement = document.createElement('div');
          tempElement.innerHTML = content.html;
    const [elementToInsert] = tempElement.children;

    const parentElement = this.elementGetterByXpath(content.parent);

    if (!parentElement){
      throw new Error('PARENT ELEMENT NOT FOUND');
    }

    ChoicesService.insertResultHandler({
      content,
      parentElement,
      elementToInsert
    })
  }

  private replaceHandler(modification: any) {
    const element = this.elementGetterByXpath(modification);

    const tempElement = document.createElement('div');
    tempElement.innerHTML = modification.current.modification.html;
    const contentEl = tempElement.firstChild;

    element.replaceWith(contentEl as Element);

  }

  private moveHandler(action: any) {
    const { modification } = action.current;

    const targetElement = this.elementGetterByXpath(modification.targetElement);
    const parentElement = this.elementGetterByXpath(modification.parent);
    const moveToElement = modification.moveTo
      ? this.elementGetterByXpath(modification.moveTo)
      : null;

    if (!parentElement || !targetElement){
      throw new Error('PARENT OR TARGET ELEMENT NOT FOUND');
    }

    if (modification.isInside) {
      modification.isTop
        ? parentElement.prepend(targetElement)
        : parentElement.appendChild(targetElement);

    }
    else{
      moveToElement
        ? parentElement.insertBefore(targetElement, moveToElement)
        : parentElement.appendChild(targetElement);
    }

  }

  private attributeHandler(modification: any) {
    console.log('attribute',modification);

    const element = this.elementGetterByXpath(modification);
    if(!element){
      throw new Error('Element not found');
    }

    const { current:{ modification: { attributeValue, attributeName }} } = modification;

    if(!attributeValue ){
      element.removeAttribute(attributeName);
    }
    else{
      element.setAttribute(attributeName, attributeValue);
    }
  }



  private elementGetterByXpath(modification: any) {
    const { xPathSelector, xPathIndex } = modification;
    const matchingElements = document.evaluate(xPathSelector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    return (matchingElements.snapshotItem(xPathIndex) as Element) ?? null;
  }

  private getIweStyleSheet() {
    const {styleDataAttribute} = ChoicesConfig;
    const stylesTag = document.querySelector(`style[${styleDataAttribute}]`);
    const stylesheet = Array.from(document.styleSheets).find(sheet => sheet.ownerNode === stylesTag);

    if (!stylesheet) {
      throw new Error('Stylesheet associated with the styles tag not found');
    }

    return stylesheet
  }

  private getIweStyleRule(ruleName:string){
    const stylesheet = this.getIweStyleSheet();
    const rules = Array.from(stylesheet.cssRules);
    return rules.find((r) => r.cssText.includes(ruleName)) ?? null;
  }

  private insertNewCssRule(cssSelector:string, data:{ pseudoClass: '', css: Record<string, any>}) {
    const stylesheet = this.getIweStyleSheet();

    const cssProperties = Object.entries(data.css).reduce((acc, [key, value]) => {
      return `${acc}${key}: ${value}; `;
    }, '');

    const css = data.pseudoClass !== ''
      ? `${cssSelector}:${data.pseudoClass} { ${cssProperties} }`
      : `${cssSelector} { ${cssProperties} }`;

    stylesheet?.insertRule(css, stylesheet?.cssRules.length);

  }

  private updateCssRule(cssRule:CSSRule, styles:Record<string, any>) {
    let propertyValue = '';
    let importantFlag = '';

    for (const [key, value] of Object.entries(styles)) {
      if(value){
        const match = value.match(/(.*?)(\s*!important)?$/);
        propertyValue = match[1].trim();
        importantFlag = match[2] ? 'important' : '';
      }
      (cssRule as any).style.setProperty(key,  propertyValue, !!importantFlag ? 'important' : '');
    }
  }



}
