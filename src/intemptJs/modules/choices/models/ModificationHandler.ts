import { ChoicesConfig } from '../choices.config.ts';


export class ModificationHandler {
  style:  (change: any) => (void);
  delete: (change: any) => (void);
  insert: (change: any) => (void);
  typography: (change: any) => (void);

  move: (change: any) => (void);
  attribute: (change: any) => (void);

    constructor() {

        this.delete = this.deleteHandler;
        this.insert = this.insertHandler;
        this.style = this.stylesHandler;
        this.typography = this.typographyHandler;
        this.move = this.moveHandler;
        this.attribute = this.attributeHandler;
    }

  private deleteHandler(modification: any) {
    const element = this.elementGetterByXpath(modification);
    if(!element){
      throw new Error('Element not found');
    }
    element.remove();
  }

  private stylesHandler(modification: any) {
    const selectorCssRule = this.getIweStyleRule(modification.cssSelector);

    if(!selectorCssRule){
      this.insertNewCssRule(modification.cssSelector, modification.current.modification);
    }
    else{
      this.updateCssRule(selectorCssRule, modification.current.modification.css);
    }





    // let css = '';
    //
    // const {styleDataAttribute} = ChoicesConfig;
    // const stylesTag = document.querySelector(`[${styleDataAttribute}]`);
    //
    // if(!stylesTag) {
    //   throw new Error('IweStylesElement:writeStyles - stylesTag not found');
    // }
    // const cssProperties = Object.entries(style.css).reduce((acc, [key, value]) => {
    //   return `${acc}${key}: ${value}; `;
    // }, '');
    //
    // css += `${cssSelector}${style.pseudoClass} { ${cssProperties} }`;
    // stylesTag!.appendChild(document.createTextNode(css));
  }

  private typographyHandler(modification: any) {
    const element = this.elementGetterByXpath(modification);

    const tempElement = document.createElement('div');
    tempElement.innerHTML = modification.current.modification;
    const contentEl = tempElement.firstChild;

    element.replaceWith(contentEl as Element);

  }

  private insertHandler(modification: any) {
    const content = modification.current.modification;

    const tempElement = document.createElement('div');
          tempElement.innerHTML = content.html;

    const parentElement = this.elementGetterByXpath(content.parent);

    if (!parentElement){
      throw new Error('PARENT ELEMENT NOT FOUND');
    }

    if(content.nextSibling){
      const element = this.elementGetterByXpath(content.nextSibling);

      if (!element){
        throw new Error('NEXT SIBLING ELEMENT NOT FOUND');
      }

      parentElement.insertBefore(tempElement.firstElementChild as Element, element);

    }
    else{
      parentElement.appendChild(tempElement.firstElementChild as Element);
    }
  }






  private moveHandler(modification: any) {
    const content = modification.current.modification;
    const targetElement = this.elementGetterByXpath(modification);
    const parentElement = this.elementGetterByXpath(content.parent);

    if (!parentElement || !targetElement){
      throw new Error('PARENT OR TARGET ELEMENT NOT FOUND');
    }

    if(content.nextSibling){
      const nextSibling = this.elementGetterByXpath(content.nextSibling);

      if (!nextSibling){
        throw new Error('NEXT SIBLING ELEMENT NOT FOUND');
      }

      parentElement.insertBefore(targetElement, nextSibling);
    }
    else{
      parentElement.appendChild(targetElement);
    }



  }

  private attributeHandler(change: any) {
    console.log('attribute',change);
  }




    private elementGetterByXpath(modification: any) {
      const { xPathSelector, xPathIndex } = modification;
      const matchingElements = document.evaluate(xPathSelector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return (matchingElements.snapshotItem(xPathIndex) as Element) ?? null;
    }

    private  getIweStyleSheet() {
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

      const css = `${cssSelector}${data.pseudoClass} { ${cssProperties} }`;

      stylesheet?.insertRule(css, stylesheet?.cssRules.length);

    }

    private updateCssRule(cssRule:CSSRule, styles:Record<string, any>) {
      for (const [key, value] of Object.entries(styles)) {
        (cssRule as any).style.setProperty(key, value);
      }

    }
}
