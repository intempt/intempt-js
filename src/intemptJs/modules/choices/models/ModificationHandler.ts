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
  clone: (modification: any) => void;

  private readonly timeout= 1000;

    constructor() {

        this.delete = this.deleteHandler;
        this.insert = this.insertHandler;
        this.style = this.stylesHandler;
        this.typography = this.typographyHandler;
        this.move = this.moveHandler;
        this.attribute = this.attributeHandler;
        this.replace = this.replaceHandler;
        this.clone = this.cloneHandler;
    }

  private cloneHandler(action: any) {
    const { modification } = action.current;
    const elementToClone = this.elementGetterByXpath(modification.elementToClone);

    const tempElement = document.createElement('div');
    tempElement.innerHTML = modification.clone.html;
    if (!tempElement.children.length) {
      console.warn('No valid children in tempElement, HTML may be malformed:', modification.clone.html);
      return;
    }
    else{
      const clonedElementChildren = tempElement.querySelectorAll('[iwe_id]');

      Array.from(clonedElementChildren).forEach((element, index) => {
        const iweId = element.getAttribute('iwe_id');

        if(iweId){
          const cssMapping = modification.clone.cssSelectors[iweId];
          if (cssMapping) {
            const {oldSelector, newCssSelector} = cssMapping;
            const oldCssRule = this.getIweStyleRule(oldSelector);
            if(oldCssRule){
              const cssStyles = Array.from(oldCssRule.style).reduce((acc, key) => {
                const style = oldCssRule.style as unknown as Record<string, string>;
                acc[key] = style[key];
                return acc;
              }, {} as Record<string, string>);


              this.insertNewCssRule(newCssSelector, {
                pseudoClass: '',
                css: cssStyles
              })
            }
          }
          else {
            console.warn('No CSS mapping found for iwe_id:', iweId);
          }

        }
      })

      const [clonedElement] = tempElement.children;

      if (!clonedElement) {
        console.warn('Cloned element is undefined. Possible issue with HTML:', tempElement.innerHTML);
        return;
      }

      elementToClone?.insertAdjacentElement('afterend', clonedElement);
    }

    }

  private deleteHandler(modification: any) {
    const element = this.elementGetterByXpath(modification);
    if(!element){
      throw new Error('Element not found');
    }
    element.remove();
  }

  private stylesHandler(modification: any) {
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
      if(!element.hasAttribute('iwe_id')){
        element.setAttribute('iwe_id', modification.iwe_id);
      }

    } else {
      setTimeout(() => {
        observer.disconnect();
        const element = this.elementGetterByXpath(modification);
        if (!element) {
          throw new Error('Element not found after waiting for 1000ms');
        }
      }, this.timeout);
    }

    const selectorCssRule = this.getIweStyleRule(modification.cssSelector);

    if(!selectorCssRule){
      this.insertNewCssRule(modification.cssSelector, modification.current.modification);
    }
    else{
      this.updateCssRule(selectorCssRule, modification.current.modification.css);
    }

    if(!!modification.current.modification.inline){
      const inlineStyles = modification.current.modification.inline as Record<string, any>;

      Object.entries(inlineStyles).forEach(([key, value]) => {
        (element as HTMLElement).style.setProperty(key, value);
      })
    }

  }

  private typographyHandler(modification: any) {
    let observer:MutationObserver;

    const handleTypographyChange = (element:Element) => {
      if (!observer) return;

      observer.disconnect();
      element.innerHTML = modification.current.modification;
    }

    observer = new MutationObserver((mutations, observer) => {
      const element = this.elementGetterByXpath(modification);

      if (element) {
        handleTypographyChange(element);
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
      handleTypographyChange(element);
    }
    else{
      setTimeout(() => {
        if (observer) {
          observer.disconnect();
        }
        const element = this.elementGetterByXpath(modification);
        if (!element) {
          throw new Error('Element not found after waiting for 1000ms');
        }
      }, this.timeout);
    }

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
    const contentEl = tempElement.firstChild as HTMLElement;

    element.replaceWith(contentEl);


    const iweId = contentEl!.getAttribute('iwe_id');
    this.updateProductScriptTag(iweId);

  }

  private moveHandler(action: any) {
    const { modification } = action.current;

    const targetElementProps = !!modification.targetElement.iwe_id
      ? modification.targetElement
      : {...modification.targetElement, iwe_id: action.iwe_id};

    const targetElement = this.elementGetterByXpath(targetElementProps);
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
      if(!!moveToElement){
        if(parentElement.contains(moveToElement)){
          parentElement.insertBefore(targetElement, moveToElement)
        }
        else{
          const nextValidElement = this.getNextValidSibling(moveToElement as HTMLElement, parentElement as HTMLElement);

          nextValidElement
              ? parentElement.insertBefore(targetElement, nextValidElement)
              : parentElement.appendChild(targetElement);
        }
      }
      else{
        parentElement.appendChild(targetElement);
      }
    }

  }

  private attributeHandler(action: any) {
    let observer:MutationObserver;
    const {
      current:{
        modification: {
          attributeValue,
          attributeName,
          targetElement
        }
      }
    } = action;

    const handleAttributeChange = (element:Element) => {
      if (!observer) return;
      observer.disconnect();

      if(!attributeValue ){
        element.removeAttribute(attributeName);
      }
      else{
        if(attributeName === 'src'){
          Array.from(element.attributes).forEach(attr => {
            if (attr.name.toLowerCase().includes('src')) {
              element.setAttribute(attr.name, attributeValue);

              if (attr.name === 'srcset') {
                // Adjust the srcset to the correct format
                const srcset = attr.value.split(',').map(set => {
                  let [url, descriptor] = set.trim().split(' ');

                  // Ensure descriptor is provided (e.g., 1000w)
                  if (!descriptor) descriptor = "1000w"; // Default descriptor

                  return `${url.trim()} ${descriptor}`;
                }).join(', ');

                // Set the correctly formatted srcset back on the element
                element.setAttribute('srcset', srcset);
              }
            }
          });
        }
        else{
          element.setAttribute(attributeName,attributeValue);
        }
      }

     if(!element.hasAttribute('iwe_id')){
       element.setAttribute('iwe_id', targetElement.iwe_id);
     }
    }

    observer = new MutationObserver((mutations, observer) => {
      const element = this.elementGetterByXpath(targetElement);

      if (element) {
        handleAttributeChange(element);
      }
    });

    observer.observe(document.body, {
      attributes:true,
      childList: true,
      subtree: true,
      characterData: true,
    });

    const element = this.elementGetterByXpath(targetElement);
    if (element) {
      handleAttributeChange(element);
    }
    else{
      setTimeout(() => {
        if (observer) {
          observer.disconnect();
        }
        const element = this.elementGetterByXpath(targetElement);
        if (!element) {
          throw new Error('Element not found after waiting for 1000ms');
        }
      }, this.timeout);
    }
  }


  private elementGetterByXpath(iweElement: any) {
    const { xPathSelector, xPathIndex, iwe_id } = iweElement;
    const element = document.querySelector(`[iwe_id='${iwe_id}']`);

    if (element) return element;

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
    return rules.find((r) => r.cssText.includes(ruleName)) as CSSStyleRule ?? null;
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

  private getNextValidSibling(element: HTMLElement | null, parentElement: HTMLElement | null): HTMLElement | null {
      while (element && !parentElement?.contains(element)) {
        element = element.nextElementSibling as HTMLElement | null;
      }

      return element;
  };

  private updateProductScriptTag(iweId:string|null){
    const oldScriptTag = document.querySelector(`[data-product-slider-id="${iweId}"]`)
    if (!oldScriptTag) {
      return;
    }

    const newScriptTag = document.createElement('script');
    newScriptTag.setAttribute('src', oldScriptTag.getAttribute('src') ?? '');
    newScriptTag.setAttribute('data-product-slider-id', oldScriptTag.getAttribute('data-product-slider-id') ?? '');
    newScriptTag.setAttribute('type', oldScriptTag.getAttribute('text/javascript') ?? '');

    oldScriptTag.replaceWith(newScriptTag)

  }

}
