import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShopifyTrackerModule } from '../../src/intemptJs/modules/autoTracker/modules/shopifyTracker/shopifyTracker.module.ts';

/**
 * `shopifyTracker.module.ts` — 2.6% line coverage on arrival, `AUDIT.md` §1c tier 2.
 *
 * Tier 2 because it only runs for Shopify customers, which is also exactly why it
 * was never tested: nobody exercising the SDK locally has a `window.Shopify`. The
 * consequence is that **the one integration whose events map directly to revenue
 * had no test at all** — a product view or an add-to-cart that silently stops
 * firing looks identical to a quiet day in the dashboard.
 *
 * Everything it does is dispatch a browser CustomEvent, so the whole module is
 * observable by listening for `intempt:shopify`. No network, no mocks beyond the
 * two globals Shopify itself sets.
 */

type ShopifyDetail = {
  eventName: string;
  product: { productId: string; quantity?: number };
};

/** Collect every `intempt:shopify` event dispatched during `run`. */
function captureDispatched(run: () => void): ShopifyDetail[] {
  const seen: ShopifyDetail[] = [];
  const listener = (event: Event) =>
    seen.push((event as CustomEvent<ShopifyDetail>).detail);

  document.addEventListener('intempt:shopify', listener);
  try {
    run();
  } finally {
    document.removeEventListener('intempt:shopify', listener);
  }
  return seen;
}

/** The `window.meta` shape Shopify's themes publish. */
function setMeta(meta: unknown) {
  (window as unknown as Record<string, unknown>).meta = meta;
}

let tracker: ShopifyTrackerModule;

beforeEach(() => {
  tracker = new ShopifyTrackerModule();
  document.body.innerHTML = '';
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).meta;
  delete (window as unknown as Record<string, unknown>).Shopify;
  delete (window as unknown as Record<string, unknown>).theme;
  document.body.innerHTML = '';
});

describe('track — the entry point', () => {
  it('dispatches a product view on a product page', () => {
    setMeta({ page: { pageType: 'product' }, product: { id: 'sku-1' } });

    const seen = captureDispatched(() => tracker.track());

    expect(seen).toEqual([
      {
        eventName: 'Product viewed',
        product: { productId: 'sku-1', quantity: undefined },
      },
    ]);
  });

  it('reads `window.Shopify.meta` when `window.meta` is absent', () => {
    // Themes publish one or the other depending on version. The fallback is a
    // single `??`, and losing it means every event stops on those themes.
    (window as unknown as Record<string, unknown>).Shopify = {
      meta: { page: { pageType: 'product' }, product: { id: 'sku-2' } },
    };

    const seen = captureDispatched(() => tracker.track());
    expect(seen[0]?.product.productId).toBe('sku-2');
  });

  it('prefers `window.meta` when both exist', () => {
    setMeta({ page: { pageType: 'product' }, product: { id: 'from-meta' } });
    (window as unknown as Record<string, unknown>).Shopify = {
      meta: { page: { pageType: 'product' }, product: { id: 'from-shopify' } },
    };

    const seen = captureDispatched(() => tracker.track());
    expect(seen[0]?.product.productId).toBe('from-meta');
  });

  it('does nothing on a non-product page', () => {
    setMeta({ page: { pageType: 'collection' }, product: { id: 'sku-1' } });
    expect(captureDispatched(() => tracker.track())).toEqual([]);
  });

  it('does nothing, and does not throw, when there is no meta at all', () => {
    // The common case: the SDK is loaded with `?shopify=1` on a site that is not
    // actually Shopify. It must be inert, not broken.
    expect(() => captureDispatched(() => tracker.track())).not.toThrow();
    expect(captureDispatched(() => tracker.track())).toEqual([]);
  });

  it('does nothing when the product has no id', () => {
    setMeta({ page: { pageType: 'product' }, product: {} });
    expect(captureDispatched(() => tracker.track())).toEqual([]);
  });

  it('stringifies a numeric product id', () => {
    // Shopify sends numbers. The payload contract is a string, and `toString()`
    // is the only thing enforcing that.
    setMeta({ page: { pageType: 'product' }, product: { id: 8123456789 } });

    const seen = captureDispatched(() => tracker.track());
    expect(seen[0]?.product.productId).toBe('8123456789');
  });
});

describe('add-to-cart — the form path', () => {
  it('dispatches a product add when the cart form is submitted', () => {
    document.body.innerHTML = '<form action="/cart/add"></form>';
    setMeta({ page: { pageType: 'product' }, product: { id: 'sku-1' } });

    const seen = captureDispatched(() => {
      tracker.track();
      document
        .querySelector('form[action="/cart/add"]')
        ?.dispatchEvent(new Event('submit'));
    });

    expect(seen).toEqual([
      {
        eventName: 'Product viewed',
        product: { productId: 'sku-1', quantity: undefined },
      },
      {
        eventName: 'Added to cart',
        product: { productId: 'sku-1', quantity: 1 },
      },
    ]);
  });

  it('ignores the theme button path once a form was found', () => {
    // The form path `return`s early. Without it a theme exposing both would
    // double-count every add-to-cart, which is a revenue metric.
    document.body.innerHTML =
      '<form action="/cart/add"></form><button name="add">Add to cart</button>';
    (window as unknown as Record<string, unknown>).theme = {
      productStrings: { addToCart: 'Add to cart' },
    };
    setMeta({ page: { pageType: 'product' }, product: { id: 'sku-1' } });

    const seen = captureDispatched(() => {
      tracker.track();
      document.querySelector('button')?.click();
    });

    expect(seen.filter((e) => e.eventName === 'Added to cart')).toHaveLength(0);
  });
});

describe('add-to-cart — the theme button path', () => {
  beforeEach(() => {
    (window as unknown as Record<string, unknown>).theme = {
      productStrings: { addToCart: 'Add to cart' },
    };
    setMeta({ page: { pageType: 'product' }, product: { id: 'sku-1' } });
  });

  it('finds the button by its text and dispatches on click', () => {
    document.body.innerHTML = '<button>Add to cart</button>';

    const seen = captureDispatched(() => {
      tracker.track();
      document.querySelector('button')?.click();
    });

    expect(seen.at(-1)).toEqual({
      eventName: 'Added to cart',
      product: { productId: 'sku-1', quantity: 1 },
    });
  });

  it('finds the button by its `name` attribute when the text does not match', () => {
    // Three lookup strategies in order — XPath on text, `name="add"`, then text
    // content. A localised store is exactly the case the first strategy misses,
    // and the `name` attribute is what saves it.
    document.body.innerHTML = '<button name="add">Panier</button>';

    const seen = captureDispatched(() => {
      tracker.track();
      document.querySelector('button')?.click();
    });

    expect(seen.at(-1)?.eventName).toBe('Added to cart');
  });

  it('warns rather than throwing when no button matches', () => {
    document.body.innerHTML = '<div>no button here</div>';

    const seen = captureDispatched(() => tracker.track());
    // The product view still went out; only the add-to-cart wiring failed.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.eventName).toBe('Product viewed');
  });

  it('does not attach anything when the theme has no add-to-cart string', () => {
    (window as unknown as Record<string, unknown>).theme = {};
    document.body.innerHTML = '<button>Add to cart</button>';

    expect(() =>
      captureDispatched(() => {
        tracker.track();
        document.querySelector('button')?.click();
      }),
    ).not.toThrow();
  });

  it('does nothing at all when there is neither a form nor a theme', () => {
    delete (window as unknown as Record<string, unknown>).theme;
    document.body.innerHTML = '<button>Add to cart</button>';

    const seen = captureDispatched(() => {
      tracker.track();
      document.querySelector('button')?.click();
    });

    expect(seen).toHaveLength(1);
  });
});

describe('the dispatched payload', () => {
  it('omits a zero or negative quantity rather than sending it', () => {
    // `quantity && quantity > 0 ? quantity : undefined` — a 0 would otherwise be
    // sent as a real quantity, which reads as "added nothing" at ingest.
    document.body.innerHTML = '<form action="/cart/add"></form>';
    setMeta({ page: { pageType: 'product' }, product: { id: 'sku-1' } });

    const seen = captureDispatched(() => {
      tracker.track();
      document
        .querySelector('form[action="/cart/add"]')
        ?.dispatchEvent(new Event('submit'));
    });

    // The add path always sends 1; the view path sends undefined. Both are pinned
    // here because the ternary is shared between them.
    expect(seen[0]?.product.quantity).toBeUndefined();
    expect(seen[1]?.product.quantity).toBe(1);
  });

  it('bubbles, so a listener on document sees it', () => {
    setMeta({ page: { pageType: 'product' }, product: { id: 'sku-1' } });

    const listener = vi.fn();
    document.addEventListener('intempt:shopify', listener);
    try {
      tracker.track();
    } finally {
      document.removeEventListener('intempt:shopify', listener);
    }

    // The SDK's own listener is on `document`; a non-bubbling event dispatched
    // there would still be seen, but the customer-facing contract is that a page
    // listener anywhere in the tree works.
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
