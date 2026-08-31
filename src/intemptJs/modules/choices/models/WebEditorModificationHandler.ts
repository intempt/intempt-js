import { Modification } from '../../../types/choices.types.ts';

/**
 * The attribute name a pointer is stamped with, and the attribute name it is looked up by.
 *
 * ONE function, called by BOTH sides. `ChoicesModule.markPointersFromChanges` stamps
 * `pointerAttr(p)` onto the element and this handler queries `[pointerAttr(p)="true"]`. When the
 * two were separate expressions they could disagree about precedence, and a disagreement is
 * invisible: the lookup resolves to `null` and the handler early-returns without throwing, so the
 * change vanishes with no error in dev or in production. Sharing the function makes the two
 * orderings identical by construction rather than by review.
 *
 * Prefers the page-scoped `iwePtrId` over `iweId`, because `iweId` is namespaced by variant id so
 * the same DOM element carries a different one in every variant.
 *
 * Accepts both shapes because a change carries `iweId`/`iwePtrId` while its `parent` and `refNode`
 * pointers carry `_iweId`/`_iwePtrId`.
 */
export function pointerAttr(
  p?: {
    iweId?: string;
    iwePtrId?: string;
    _iweId?: string;
    _iwePtrId?: string;
  } | null,
): string | undefined {
  if (!p) return undefined;
  return p._iwePtrId ?? p.iwePtrId ?? p._iweId ?? p.iweId;
}

export class WebEditorModificationHandler {
  style = async (change: Modification) => {
    const { attributes } = change;
    const targetEl = this.elementGetterByIweId(pointerAttr(change));

    const { style } = attributes;
    if (!targetEl || !style) return;

    targetEl.setAttribute('style', style);
  };

  update = async (change: Modification) => {
    const { html, parent, refNode } = change;
    const parentEl = this.elementGetterByIweId(pointerAttr(parent));
    const refEl = this.elementGetterByIweId(pointerAttr(refNode));
    const targetEl = this.elementGetterByIweId(pointerAttr(change));

    if (!parentEl || !targetEl) return;

    const { fragment } = this.htmlToFragment(html);
    parentEl.insertBefore(fragment, refEl);
    targetEl.remove();
  };

  insert = async (change: Modification) => {
    const { html, parent, refNode, blockId, js } = change;
    const parentEl = this.elementGetterByIweId(pointerAttr(parent));
    const refEl = this.elementGetterByIweId(pointerAttr(refNode));

    if (!parentEl) return;
    const { fragment } = this.htmlToFragment(html);
    parentEl.insertBefore(fragment, refEl);
    if (blockId === 'base') {
      const targetEl = this.elementGetterByIweId(pointerAttr(change));
      targetEl?.remove();
    }

    if (js && js.trim()) {
      this.appendInlineScriptAfter(js);
    }
  };

  remove = (change: Modification) => {
    const targetEl = this.elementGetterByIweId(pointerAttr(change));
    if (!targetEl) return;
    targetEl.remove();
  };

  private appendInlineScriptAfter(code: string, nonce?: string) {
    const s = document.createElement('script');
    s.type = 'text/javascript';
    if (nonce) s.setAttribute('nonce', nonce);
    s.textContent = code; // safe: textContent, not innerHTML

    document.body.append(s);
    // cleanup on next tick (inline scripts execute immediately on insertion)
    setTimeout(() => s.remove(), 40);
  }

  private elementGetterByIweId(key?: string): HTMLElement | null {
    if (!key) return null;

    const selector = `[${key}="true"]`;

    return document.querySelector(selector) || null;
  }

  private htmlToFragment(
    html: string,
    opts?: {
      wrapperTag?: string;
      wrapperAttrs?: Record<
        string,
        string | number | boolean | null | undefined
      >;
      /** Remove purely-whitespace text nodes at fragment root before counting elements */
      trimWhitespace?: boolean;
    },
  ): {
    fragment: DocumentFragment;
    rootEl: HTMLElement | null;
    wrapped: boolean;
  } {
    const {
      wrapperTag = 'div',
      wrapperAttrs = { 'data-iwe-block': '1' },
      trimWhitespace = false,
    } = opts || {};

    const range = document.createRange();
    const fragment = range.createContextualFragment(html);

    if (trimWhitespace) {
      // remove whitespace-only text nodes at root
      for (const n of Array.from(fragment.childNodes)) {
        if (n.nodeType === Node.TEXT_NODE && !/\S/.test(n.textContent || ''))
          fragment.removeChild(n);
      }
    }

    const elementChildren = Array.from(fragment.childNodes).filter(
      (n) => n.nodeType === Node.ELEMENT_NODE,
    ) as HTMLElement[];

    // 0 or 1 element child -> no wrap
    if (elementChildren.length <= 1) {
      return {
        fragment,
        rootEl: elementChildren[0] ?? null,
        wrapped: false,
      };
    }

    // >1 element children -> wrap all nodes
    const wrapper = document.createElement(wrapperTag);
    for (const [k, v] of Object.entries(wrapperAttrs)) {
      if (v != null) wrapper.setAttribute(k, String(v));
    }
    while (fragment.firstChild) wrapper.appendChild(fragment.firstChild);

    const df = document.createDocumentFragment();
    df.appendChild(wrapper);

    return {
      fragment: df,
      rootEl: wrapper,
      wrapped: true,
    };
  }
}
