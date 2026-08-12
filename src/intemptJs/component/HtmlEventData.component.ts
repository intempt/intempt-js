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

  /**
   * The redaction marker. One constant, deliberately not derived from the value:
   * a length-preserving mask (`value.replace(/./g, '*')`) leaks the length, which
   * for a password is real information.
   */
  private static readonly REDACTED = '********';

  /**
   * Names of controls whose value must never leave the page, read off the form
   * itself: `type="password"` and anything the author marked `doNotCapture`.
   *
   * **This closes D-29.** The redaction used to exist on one of the two capture
   * paths only: `getHtmlElementText` masked a clicked password field, while
   * `getSubmittedData` read the form through `FormData` — which includes password
   * controls like any other named control and knows nothing about `doNotCapture`.
   * So clicking a password box was redacted and *submitting the form containing
   * it* was not, and the password shipped in `formDataText`.
   *
   * Redacted rather than dropped: an absent key is indistinguishable from a field
   * the user left empty, and "this form had a password" is legitimate analytics
   * while its value never is.
   */
  private redactedNames(form: HTMLFormElement): Set<string> {
    const selector = 'input[type="password"], [doNotCapture]';
    const names = new Set<string>();

    form.querySelectorAll(selector).forEach((control) => {
      const name = control.getAttribute('name');
      if (name) names.add(name);
    });

    return names;
  }

  private shouldRedact(element: HTMLElement): boolean {
    const control = element as HTMLElement & { type?: string };
    return element.hasAttribute('doNotCapture') || control.type === 'password';
  }

  private getSubmittedData(element: HTMLElement, domEventName: DomEventName) {
    if (element.tagName.toLowerCase() !== 'form' || domEventName !== 'submit') {
      return undefined;
    }
    const form = element as HTMLFormElement;
    const formEntries: { key: string; value: string }[] = [];
    let unnamedIndex = 0;
    const formData = new FormData(form);
    const unnamedInputs = element.querySelectorAll('input:not([name])');
    const redacted = this.redactedNames(form);

    for (const [key, value] of formData.entries()) {
      formEntries.push({
        key,
        value: redacted.has(key)
          ? HtmlElementDataComponent.REDACTED
          : value.toString(),
      });
    }

    Array.from(unnamedInputs).forEach((input: unknown) => {
      const inputElement = input as HTMLInputElement;
      if (inputElement.type !== 'submit' && inputElement.type !== 'hidden') {
        formEntries.push({
          key: `input-${unnamedIndex}`,
          // An unnamed control is matched directly rather than by name, since
          // there is no name to match on.
          value: this.shouldRedact(inputElement)
            ? HtmlElementDataComponent.REDACTED
            : inputElement.value,
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
    const redact = this.shouldRedact(element);

    return element
      .getAttributeNames()
      .filter((attr) => !notAllowedAttributes.includes(attr))
      .map((attr) => {
        // The hierarchy is the third path a value can escape through, after
        // `targetText` and `formDataText` (D-29). A `value` set in the markup is
        // a real attribute, so on a password or `doNotCapture` element it is
        // masked here too. The attribute is kept rather than dropped: the
        // selector should still describe the element's shape.
        const value =
          redact && attr === 'value'
            ? HtmlElementDataComponent.REDACTED
            : element.getAttribute(attr);
        return `[${attr}='${value}']`;
      })
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

    if (this.shouldRedact(element)) {
      return HtmlElementDataComponent.REDACTED;
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
