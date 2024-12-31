import { dispatchIntemptEvent } from '../../../../../shared/shared.utils.ts';
import { IntemptEventListenerName, IntemptEventName } from '../../../../types/constants.types.ts';
import { IntemptShopifyAutoTrackedEventNames } from '../../../../types/autoTracker.types.ts';

export class ShopifyTrackerModule {
  track() {
    const meta = window.meta ?? window.Shopify?.meta;

    if (!meta) return console.warn('Intempt: meta not found');
    else if (meta.page?.pageType && meta.page?.pageType === 'product') {
      const id = meta.product?.id;

      if (id) {
        this.dispatchProductEvent({id, eventTitle: IntemptEventName.PRODUCT_VIEW})
        this.handleAddToCartAction(id);
      }
    }
  }


  private dispatchProductEvent({id, quantity, eventTitle}:{id:string, quantity?:number, eventTitle:IntemptShopifyAutoTrackedEventNames}) {
    dispatchIntemptEvent(IntemptEventListenerName.SHOPIFY, {
      eventName: eventTitle,
      product: {
        productId: id.toString(),
        quantity: quantity && quantity > 0 ? quantity : undefined
      }
    })
  }

  private handleAddToCartAction(id:string) {
    const form = document.querySelector('form[action="/cart/add"]');
    const theme = window.theme;

    if(form){
       form.addEventListener('submit', (event) => {
        this.dispatchProductEvent({id, quantity: 1, eventTitle: IntemptEventName.PRODUCT_ADD});
      })
      return;
    }

    if(theme){
      const button = this.getAddToCartButton(theme.productStrings?.addToCart);
      if(button){
        button.addEventListener('click', () => this.dispatchProductEvent({id, quantity: 1, eventTitle: IntemptEventName.PRODUCT_ADD}));
      }
    }
  }

  private getAddToCartButton(btnText: string): HTMLButtonElement | null {
    const methods = [
      () => this.getBtnByXpath(`//button[contains(., '${btnText}')]`),
      () => this.getBtnByNameAttribute(),
      () => this.getBtnByTextContent(btnText),
    ];

    for (const method of methods) {
      const button = method();
      if (button) {
        return button;
      }
    }

    console.warn('Intempt: Add to cart button not found');
    return null;
  }

  private getBtnByXpath(xpathExpression: string): HTMLButtonElement | null {
    const result = document.evaluate(
      xpathExpression,
      document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null
    );

    return result.snapshotLength > 0 ? (result.snapshotItem(0) as HTMLButtonElement) : null;
  }

  private getBtnByNameAttribute(): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>('[name="add"]') ?? null;
  }

  private getBtnByTextContent(btnText: string): HTMLButtonElement | null {
    const buttons = document.querySelectorAll<HTMLButtonElement>('button');
    for (const button of buttons) {
      if (button.textContent?.trim().toLowerCase().includes(btnText)) {
        return button;
      }
    }
    return null;
  }
}
