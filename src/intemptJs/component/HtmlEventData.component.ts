import { DomEventName } from '../types/autoTracker.types.ts';

export class HtmlElementDataComponent {
  href: string | undefined;
  targetTag: string;
  targetId: string;
  targetClass: string;
  targetText: string | undefined;
  formDataText: { key: string; value: string }[] | undefined;
  hierarchy: string;

  // `HTMLElement`, not `any`. Every read below is a DOM read, and the ones that are
  // not on `Element` — `value`, `type`, `action`, `classList` on a form — are
  // narrowed where they are used. `any` here meant a caller could pass a
  // non-element and the failure would surface as `tagName of undefined` inside
  // tracking, mid-event.
  constructor(element: HTMLElement, domEventName: DomEventName) {
    this.href = this.handleHref(element, domEventName);
    this.targetTag = element.tagName.toLowerCase();
    this.targetId = this.getHtmlElementId(element);
    this.targetClass = Array.from(element.classList).join(' ');
    this.targetText = this.getHtmlElementText(element, domEventName);
    this.hierarchy = this.generateHierarchy(element);
    this.formDataText = this.getSubmittedData(element, domEventName);
  }

  private getSubmittedData(element: HTMLElement, domEventName: DomEventName) {
    if (element.tagName.toLowerCase() !== 'form' || domEventName !== 'submit') {
      return undefined;
    }
    const formEntries: { key: string; value: string }[] = [];
    let unnamedIndex = 0;
    const formData = new FormData(element as HTMLFormElement);
    const unnamedInputs = element.querySelectorAll('input:not([name])');

    for (let [key, value] of formData.entries()) {
      formEntries.push({
        key,
        value: value.toString(),
      });
    }

    Array.from(unnamedInputs).forEach((input: unknown) => {
      const inputElement = input as HTMLInputElement;
      if (inputElement.type !== 'submit' && inputElement.type !== 'hidden') {
        formEntries.push({
          key: `input-${unnamedIndex}`,
          value: inputElement.value,
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

  private getHtmlElementText(
    element: HTMLElement,
    domEventName: DomEventName,
  ): string | undefined {
    if (element.tagName.toLowerCase() === 'form' || domEventName === 'submit') {
      return undefined;
    }

    // `type` and `value` exist only on form controls, so they are reached for
    // through a narrow shape rather than by widening `element`.
    const control = element as HTMLElement & { type?: string; value?: string };

    if (
      element.hasAttribute('doNotCapture') ||
      (control.type && control.type === 'password')
    ) {
      return '********';
    }

    return (element.textContent || control.value || '').trim();
  }

  private handleHref(element: HTMLElement, domEventName: DomEventName) {
    if (domEventName === 'change') {
      return undefined;
    } else if (
      element.tagName.toLowerCase() === 'form' &&
      domEventName === 'submit'
    ) {
      return (element as HTMLFormElement)?.action || '';
    }

    return element.getAttribute('href') || '';
  }
}
