import { DomEventName } from '../types/autoTracker.types.ts';


export class HtmlElementDataComponent {
  href: string | undefined;
  targetTag: string;
  targetId: string;
  targetClass: string;
  targetText: string | undefined;
  formDataText: {key:string, value:string}[] | undefined;
  hierarchy: string;

  constructor(element: any,domEventName: DomEventName) {
    this.href = this.handleHref(element, domEventName)
    this.targetTag = element.tagName.toLowerCase();
    this.targetId = this.getHtmlElementId(element);
    this.targetClass = Array.from(element.classList).join(' ');
    this.targetText = this.getHtmlElementText(element, domEventName);
    this.hierarchy = this.generateHierarchy(element);
    this.formDataText = this.getSubmittedData(element,domEventName);
  }

  private getSubmittedData(element: any, domEventName:DomEventName) {
    if(element.tagName.toLowerCase() !== 'form' || domEventName !== 'submit'){
      return undefined;
    }
      const formEntries:{key:string, value:string}[] = [];
      let unnamedIndex = 0;
      const formData = new FormData(element);
      const unnamedInputs = element.querySelectorAll('input:not([name])');

      for (let [key, value] of formData.entries()) {
        formEntries.push({
          key,
          value: value.toString()
        });
      }

      Array.from(unnamedInputs).forEach( (input:unknown) => {
        const inputElement = input as HTMLInputElement;
        if (inputElement.type !== 'submit' && inputElement.type !== 'hidden') {
          formEntries.push({
            key: `input-${unnamedIndex}`,
            value : inputElement.value
          });
          unnamedIndex++;
        }
      });

      return formEntries;
  }


  private generateHierarchy(element: HTMLElement) {
    const stack: string[] = [];
    let currentElement: HTMLElement | null = element;

    while (currentElement && currentElement.tagName.toLowerCase() !== 'html') {
      const selector = this.getHtmlElementSelector(currentElement);
      stack.push(selector);
      currentElement = currentElement.parentElement;
    }

    return stack.reverse().join(' > ');
  }

  private getHtmlElementSelector(element: HTMLElement) {
    const tag = this.getHtmlElementTagName(element);
    const classes = this.getHtmlElementClasses(element);
    const id = this.getHtmlElementId(element);
    const attributes = this.getHtmlElementAttributes(element);

    return `${tag}${id}${classes}${attributes}`;
  }

  private getHtmlElementId(element: HTMLElement) {
    return element.id ? `#${element.id}` : '';
  }

  private getHtmlElementTagName(element: HTMLElement) {
    return element.tagName.toLowerCase();
  }

  private getHtmlElementClasses(element: HTMLElement) {
    const classes = Array.from(element.classList);

    return classes.length ? `.${classes.join('.')}` : '';
  }

  private getHtmlElementAttributes(element: HTMLElement) {
    const notAllowedAttributes = ['class', 'id', 'style'];

    return element
      .getAttributeNames()
      .filter((attr) => !notAllowedAttributes.includes(attr))
      .map((attr) => `[${attr}='${element.getAttribute(attr)}']`)
      .join('');
  }

  private getHtmlElementText(element: any, domEventName: DomEventName):string | undefined {

    if(element.tagName.toLowerCase() === 'form' || domEventName === 'submit'){
      return undefined;
    }


    if (element.hasAttribute('doNotCapture') || element.type && element.type === 'password') {
      return '********';
    }

    return (element.textContent || element.value || '').trim();
  }

  private handleHref(element: any, domEventName: DomEventName) {
    if(domEventName === 'change'){
      return undefined

    }

    else if (element.tagName.toLowerCase() === 'form' && domEventName === 'submit') {
      return element?.action || '';
    }

    return element.getAttribute('href') || '';
  }

}
