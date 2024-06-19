import { ChoicesConfig } from '../choices.config.ts';


export class ModificationHandler {
  style:  (change: any) => (void);
  delete: (change: any) => (void);
  clone: (change: any) => (void);
  typography: (change: any) => (void);
  move: (change: any) => (void);
  attribute: (change: any) => (void);

    constructor() {

        this.delete = this.deleteHandler;
        this.clone = this.cloneHandler;

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

  private cloneHandler(modification: any) {
    const element = this.elementGetterByXpath(modification);

    const tempElement = document.createElement('div');
    tempElement.innerHTML = modification.content;
    const clonedElement = tempElement.firstElementChild as Element;

    element?.insertAdjacentElement('afterend', clonedElement);
  }


  private stylesHandler(change: any) {
      const { cssSelector, current:{style} } = change;

      let css = '';

      const {styleDataAttribute} = ChoicesConfig;
      const stylesTag = document.querySelector(`[${styleDataAttribute}]`);

      if(!stylesTag) {
        throw new Error('IweStylesElement:writeStyles - stylesTag not found');
      }
      const cssProperties = Object.entries(style.css).reduce((acc, [key, value]) => {
        return `${acc}${key}: ${value}; `;
      }, '');

      css += `${cssSelector}${style.pseudoClass} { ${cssProperties} }`;
      stylesTag!.appendChild(document.createTextNode(css));
    }



  private typographyHandler(modification: any) {
      const element = this.elementGetterByXpath(modification);

      const tempElement = document.createElement('div');
      tempElement.innerHTML = modification.current.modification;
      const contentEl = tempElement.firstChild;

      element.replaceWith(contentEl as Element);

    }

    private moveHandler(change: any) {
      console.log('move',change);
    }

    private attributeHandler(change: any) {
      console.log('attribute',change);
    }

    private elementGetterByXpath(modification: any) {
      const { xPathSelector, xPathIndex } = modification;
      const matchingElements = document.evaluate(xPathSelector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return (matchingElements.snapshotItem(xPathIndex) as Element) ?? null;
    }

}
