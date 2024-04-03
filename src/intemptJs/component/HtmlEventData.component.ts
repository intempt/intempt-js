

export class HtmlElementDataComponent {
  href: string;
  targetTag: string;
  targetId: string;
  targetClass: string;
  targetText: string;
  hierarchy: string;

  constructor(element: any) {
    this.href = element.getAttribute('href') || '';
    this.targetTag = element.tagName.toLowerCase();
    this.targetId = this.getHtmlElementId(element);
    this.targetClass = Array.from(element.classList).join(' ');
    this.targetText = (element.textContent || element.value || '').trim() ;
    this.hierarchy = this.generateHierarchy(element);
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
}
