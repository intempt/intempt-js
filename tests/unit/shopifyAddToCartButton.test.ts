import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShopifyTrackerModule } from '../../src/intemptJs/modules/autoTracker/modules/shopifyTracker/shopifyTracker.module.ts';

/**
 * INT-3814 — the add-to-cart button lookup by text content.
 *
 * `getBtnByTextContent` is the last of three strategies `getAddToCartButton`
 * tries, and it is the one that has to cope with a real theme: the needle comes
 * from `window.theme.productStrings.addToCart`, which themes publish in whatever
 * case they like ("Add to cart", "ADD TO CART", "Add To Cart") and which does
 * not have to match the button's own rendering. The comparison lowercased only
 * the button text, so a needle with any capital letter in it matched nothing and
 * the add-to-cart event silently stopped firing for that theme. It now lowercases
 * both sides.
 *
 * The empty-needle guard is the other half. With `btnText === ''`,
 * `''.includes('')` is true for the FIRST button on the page, so a theme that
 * ships an empty `addToCart` string wired the add-to-cart event to whatever
 * button happened to come first — a search toggle, a cookie banner. It returns
 * `null` instead.
 *
 * These call the private lookup directly rather than going through
 * `getAddToCartButton`, because the XPath strategy runs first and
 * `contains(., '')` is true for every node in XPath — so through the public path
 * the empty-needle case never reaches the function under test. Calling it
 * directly is what makes the guard observable at all.
 */

type Lookup = {
  getBtnByTextContent(btnText: string): HTMLButtonElement | null;
};

let lookup: Lookup;

beforeEach(() => {
  lookup = new ShopifyTrackerModule() as unknown as Lookup;
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('shopify add-to-cart lookup by text (INT-3814)', () => {
  it('matches regardless of how the theme cased its string', () => {
    // THE MUTANT: drop `.toLowerCase()` from the needle and this returns null —
    // the button renders "Add to Cart" while the theme string shouts.
    document.body.innerHTML =
      '<button id="other">Search</button><button id="atc">Add to Cart</button>';

    expect(lookup.getBtnByTextContent('ADD TO CART')?.id).toBe('atc');
  });

  it('matches when the button is the loud one and the theme string is not', () => {
    document.body.innerHTML = '<button id="atc">ADD TO CART</button>';

    expect(lookup.getBtnByTextContent('Add to cart')?.id).toBe('atc');
  });

  it('returns null for an empty needle instead of claiming the first button', () => {
    // THE MUTANT: remove the `if (!btnText) return null` guard and this returns
    // `#newsletter` — every button "contains" the empty string — so the SDK
    // reports an add-to-cart whenever a visitor opens the newsletter popup.
    document.body.innerHTML =
      '<button id="newsletter">Subscribe</button><button id="atc">Add to cart</button>';

    expect(lookup.getBtnByTextContent('')).toBeNull();
  });

  it('still returns null when nothing on the page matches', () => {
    document.body.innerHTML = '<button id="newsletter">Subscribe</button>';

    expect(lookup.getBtnByTextContent('Add to cart')).toBeNull();
  });
});
