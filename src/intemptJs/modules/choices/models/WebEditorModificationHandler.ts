import { HTML_ATTRIBUTES } from '../../../types/constants.types.ts';
import { Modification } from '../../../types/choices.types.ts';







export class WebEditorModificationHandler {
  update = async (change: Modification)=> {
    const {html,  parent, refNode,  iweId} = change;
    const parentEl = this.elementGetterByIweId(parent?._iweId);
    const refEl = this.elementGetterByIweId(refNode?._iweId);
    const targetEl = this.elementGetterByIweId(iweId);

    if(!parentEl || !targetEl) return;

    const { fragment } = this.htmlToFragment(html);

    console.log('update',targetEl);
    parentEl.insertBefore(fragment, refEl);
    targetEl.remove()
  }

  insert = async (change: Modification) => {

      const {html, parent, refNode, blockId, iweId, js } = change;
      const parentEl = this.elementGetterByIweId(parent?._iweId);
      const refEl = this.elementGetterByIweId(refNode?._iweId);

      if(!parentEl) return;
      const {fragment} = this.htmlToFragment(html)
      parentEl.insertBefore( fragment, refEl);
      if(blockId === 'base'){
        const targetEl = this.elementGetterByIweId(iweId);
        targetEl?.remove()
      }

      if (js && js.trim()) {
        this.appendInlineScriptAfter(js);
      }

  }

  remove = (change: Modification) => {
    const {iweId} = change;
    const targetEl = this.elementGetterByIweId(iweId);
    if(!targetEl) return;
    targetEl.remove();
  }

  private appendInlineScriptAfter(code: string, nonce?: string) {
    const s = document.createElement('script');
    s.type = 'text/javascript';
    if (nonce) s.setAttribute('nonce', nonce);
    s.textContent = code; // safe: textContent, not innerHTML

    document.body.append(s);
    // cleanup on next tick (inline scripts execute immediately on insertion)
    setTimeout(() => s.remove(), 40);
  }

  private elementGetterByIweId(key?:string):HTMLElement | null {
    if(!key) return null;

    const selector = `[${key}="true"]`;

    return document.querySelector(selector) || null;
  }

  private htmlToFragment(
    html: string,
    opts?: {
      wrapperTag?: string
      wrapperAttrs?: Record<string, string | number | boolean | null | undefined>
      /** Remove purely-whitespace text nodes at fragment root before counting elements */
      trimWhitespace?: boolean
    }
  ): { fragment: DocumentFragment; rootEl: HTMLElement | null; wrapped: boolean } {
    const { wrapperTag = 'div', wrapperAttrs = { 'data-iwe-block': '1' }, trimWhitespace = false } = opts || {}

    const range = document.createRange()
    let fragment = range.createContextualFragment(html)

    if (trimWhitespace) {
      // remove whitespace-only text nodes at root
      for (const n of Array.from(fragment.childNodes)) {
        if (n.nodeType === Node.TEXT_NODE && !/\S/.test(n.textContent || '')) fragment.removeChild(n)
      }
    }

    const elementChildren = Array.from(fragment.childNodes).filter(n => n.nodeType === Node.ELEMENT_NODE) as HTMLElement[]

    // 0 or 1 element child -> no wrap
    if (elementChildren.length <= 1) {
      return {
        fragment,
        rootEl: elementChildren[0] ?? null,
        wrapped: false,
      }
    }

    // >1 element children -> wrap all nodes
    const wrapper = document.createElement(wrapperTag)
    for (const [k, v] of Object.entries(wrapperAttrs)) {
      if (v != null) wrapper.setAttribute(k, String(v))
    }
    while (fragment.firstChild) wrapper.appendChild(fragment.firstChild)

    const df = document.createDocumentFragment()
    df.appendChild(wrapper)

    return {
      fragment: df,
      rootEl: wrapper,
      wrapped: true,
    }
  }
}
