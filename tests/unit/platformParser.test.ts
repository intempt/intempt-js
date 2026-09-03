import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlatformParser } from '../../src/intemptJs/platformParser.ts';
import { DeviceTypeName } from '../../src/intemptJs/types/constants.types.ts';

/**
 * `platformParser.ts` — the worst-tested file in the SDK on arrival
 * (27.8% lines, **7.36% mutation score**, 288 uncovered mutants — `AUDIT.md` §1c).
 *
 * Why it is worth this many tests: it labels **every** event with device, browser,
 * OS and geo attributes, and when it is wrong it is wrong *silently* — no throw, no
 * dropped request, just mislabelled data and dashboards that look fine. That is the
 * one failure mode no other tier catches.
 *
 * It is also nearly pure — user-agent string in, attribute out — which is exactly the
 * shape §3f-ii measured as high-yield for mutation testing (mutants in code that
 * *computes a value*, not in guard or reporting branches; see §3f-iii for why the
 * distinction matters). So these are table-driven over real UA strings.
 *
 * Two mechanics worth knowing before editing:
 *
 *  1. **`_userAgent` is a getter over `navigator.userAgent`, read live.** It is not
 *     snapshotted in the constructor, so the UA must be installed *before* the
 *     `PlatformParser` is constructed for `deviceType`/`browser`, but may be swapped
 *     at any time for the `protected` methods. `withUA()` handles both.
 *  2. **The interesting methods are `protected`.** `Probe` re-exposes them rather
 *     than casting through `any` — `no-explicit-any` is an ESLint error at zero here.
 */

class Probe extends PlatformParser {
  handleUserAgent() {
    return this._handleUserAgent();
  }
  handleEntropy() {
    return this._handleUserAgentEntropyValue();
  }
  getPlatform() {
    return this._getPlatform();
  }
}

const UA = {
  windows10Chrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipadSafari:
    'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  androidTablet:
    'Mozilla/5.0 (Linux; Android 12; SM-T870) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  linuxFirefox:
    'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.2478.51',
  edgeIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/124.0.2478.51 Mobile/15E148 Safari/605.1.15',
  ucBrowser:
    'Mozilla/5.0 (Linux; U; Android 10; en-US) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/78.0.3904.108 UCBrowser/13.4.0.1306 Mobile Safari/537.36',
  googleBot:
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  chromium:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chromium/120.0.6099.109 Chrome/120.0.6099.109 Safari/537.36',
  fxios:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/125.0 Mobile/15E148 Safari/605.1.15',
  seamonkey:
    'Mozilla/5.0 (X11; Linux x86_64; rv:91.0) Gecko/20100101 Firefox/91.0 SeaMonkey/2.53.17',
  ie11: 'Mozilla/5.0 (Windows NT 10.0; Trident/7.0; rv:11.0) like Gecko',
  ie10: 'Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.2; Trident/6.0)',
  crios:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.111 Mobile/15E148 Safari/604.1',
  opera:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 OPR/110.0.0.0',
  kindle:
    'Mozilla/5.0 (Linux; U; Android 5.1.1; en-us; KFAUWI Build/LVY48F) AppleWebKit/537.36 (KHTML, like Gecko) Silk/103.3.7098 like Chrome/103.0.5060.129 Safari/537.36',
  blackberry:
    'Mozilla/5.0 (BlackBerry; U; BlackBerry 9900; en) AppleWebKit/534.11+ (KHTML, like Gecko) Version/7.1.0.346 Mobile Safari/534.11+',
  unknown: 'SomeCompletelyUnknownAgent/1.0',
};

/** Install a UA for the duration of `run`, then restore. */
function withUA<T>(userAgent: string, run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(navigator),
    'userAgent',
  );
  Object.defineProperty(navigator, 'userAgent', {
    get: () => userAgent,
    configurable: true,
  });
  try {
    return run();
  } finally {
    delete (navigator as unknown as Record<string, unknown>).userAgent;
    if (original) {
      Object.defineProperty(navigator, 'userAgent', original);
    }
  }
}

/**
 * Screen width and touch capability are the *other* two inputs to
 * `detectDeviceType`, and jsdom's defaults (1024 wide, `maxTouchPoints` 0, no
 * `ontouchstart`) are a desktop. Anything asserting the touch branches has to set
 * all three deliberately.
 */
function setEnvironment({
  width,
  touch,
}: {
  width: number;
  touch: boolean;
}): void {
  Object.defineProperty(window.screen, 'width', {
    value: width,
    configurable: true,
  });
  Object.defineProperty(navigator, 'maxTouchPoints', {
    value: touch ? 5 : 0,
    configurable: true,
  });
  if (touch) {
    (window as unknown as Record<string, unknown>).ontouchstart = null;
  } else {
    delete (window as unknown as Record<string, unknown>).ontouchstart;
  }
}

function parserFor(userAgent: string): PlatformParser {
  return withUA(userAgent, () => new Probe());
}

beforeEach(() => {
  // A desktop, explicitly — not jsdom's default by luck.
  setEnvironment({ width: 1440, touch: false });
});

afterEach(() => {
  delete (navigator as unknown as Record<string, unknown>).userAgentData;
});

describe('detectDeviceType', () => {
  it.each([
    ['a desktop Windows UA', UA.windows10Chrome, DeviceTypeName.DESKTOP],
    ['a desktop Mac UA', UA.macSafari, DeviceTypeName.DESKTOP],
    ['an iPhone', UA.iphoneSafari, DeviceTypeName.MOBILE],
    ['an iPad', UA.ipadSafari, DeviceTypeName.TABLET],
    ['Android phone (has "mobile")', UA.androidChrome, DeviceTypeName.MOBILE],
    ['Android tablet (no "mobile")', UA.androidTablet, DeviceTypeName.TABLET],
    ['a Kindle/Silk tablet', UA.kindle, DeviceTypeName.TABLET],
    ['a BlackBerry', UA.blackberry, DeviceTypeName.MOBILE],
  ])('classifies %s as %s', (_label, userAgent, expected) => {
    expect(parserFor(userAgent).deviceType).toBe(expected);
  });

  it('prefers tablet over mobile when a UA matches both', () => {
    // The Android tablet regex is `android(?!.*mobile)`, so a UA carrying both
    // "android" and "mobile" is a phone — the negative lookahead is the whole
    // distinction, and it is one character away from inverting.
    expect(parserFor(UA.androidChrome).deviceType).toBe(DeviceTypeName.MOBILE);
    expect(parserFor(UA.androidTablet).deviceType).toBe(DeviceTypeName.TABLET);
  });

  it('falls back to screen size + touch when the UA says nothing', () => {
    setEnvironment({ width: 768, touch: true });
    expect(parserFor(UA.unknown).deviceType).toBe(DeviceTypeName.TABLET);

    setEnvironment({ width: 400, touch: true });
    expect(parserFor(UA.unknown).deviceType).toBe(DeviceTypeName.MOBILE);

    setEnvironment({ width: 400, touch: false });
    expect(parserFor(UA.unknown).deviceType).toBe(DeviceTypeName.DESKTOP);
  });

  it('treats the screen-width thresholds as inclusive upper bounds', () => {
    setEnvironment({ width: 480, touch: true });
    expect(parserFor(UA.unknown).deviceType).toBe(DeviceTypeName.MOBILE);

    setEnvironment({ width: 481, touch: true });
    expect(parserFor(UA.unknown).deviceType).toBe(DeviceTypeName.TABLET);

    setEnvironment({ width: 1024, touch: true });
    expect(parserFor(UA.unknown).deviceType).toBe(DeviceTypeName.TABLET);

    // Above the tablet ceiling a touch screen is a desktop again — a large
    // touch monitor, which is the correct answer.
    setEnvironment({ width: 1025, touch: true });
    expect(parserFor(UA.unknown).deviceType).toBe(DeviceTypeName.DESKTOP);
  });

  it('counts `ontouchstart` alone as touch capability', () => {
    setEnvironment({ width: 400, touch: false });
    (window as unknown as Record<string, unknown>).ontouchstart = null;
    expect(parserFor(UA.unknown).deviceType).toBe(DeviceTypeName.MOBILE);
  });
});

describe('_getBrowser', () => {
  it.each([
    ['Edge on Windows', UA.edge, 'Edge/124.0.2478.51'],
    ['Edge on iOS', UA.edgeIos, 'Edge/124.0.2478.51'],
    ['UC Browser', UA.ucBrowser, 'UCBrowser/13.4.0.1306'],
    ['Googlebot', UA.googleBot, 'GoogleBot/2.1'],
    ['Chromium', UA.chromium, 'Chromium/120.0.6099.109'],
    ['Firefox', UA.linuxFirefox, 'Firefox/125.0'],
    ['Firefox on iOS', UA.fxios, 'Firefox/125.0'],
    ['Chrome', UA.windows10Chrome, 'Chrome/124.0.0.0'],
    ['Chrome on iOS', UA.crios, 'Chrome/124.0.6367.111'],
    ['Safari', UA.macSafari, 'Safari/17.4.1'],
    ['Opera', UA.opera, 'Opera/110.0.0.0'],
  ])('identifies %s', (_label, userAgent, expected) => {
    expect(parserFor(userAgent).browser).toBe(expected);
  });

  it('returns Unknown/0.0.0.0 when nothing matches', () => {
    expect(parserFor(UA.unknown).browser).toBe('Unknown/0.0.0.0');
  });

  it('resolves the order Edge > Chrome > Safari on a UA that claims all three', () => {
    // Every Chromium browser's UA still ends "…Safari/537.36", and Edge's still
    // says "Chrome/…". The exclusion lists are the only thing separating them, so
    // this asserts precedence rather than any single regex.
    expect(parserFor(UA.edge).browser).toBe('Edge/124.0.2478.51');
    expect(parserFor(UA.opera).browser).toBe('Opera/110.0.0.0');
    expect(parserFor(UA.chromium).browser).toBe('Chromium/120.0.6099.109');
    expect(parserFor(UA.ucBrowser).browser).toBe('UCBrowser/13.4.0.1306');
  });

  it('excludes SeaMonkey from Firefox', () => {
    // SeaMonkey's UA contains "Firefox/91.0"; the `exclude` is the only guard, and
    // with it the UA falls through every remaining entry to the default.
    expect(parserFor(UA.seamonkey).browser).toBe('Unknown/0.0.0.0');
  });

  it('reports a null version rather than throwing when the version is absent', () => {
    // The name matches but the version regex does not, so the literal string
    // "null" reaches the payload. Pinned so a fix is a deliberate change.
    expect(parserFor('Mozilla/5.0 chromium').browser).toBe('Chromium/null');
  });

  /**
   * **D-28 — Safari and IE reported no version at all. Found by writing this file,
   * fixed in the same commit.**
   *
   * `browserVersion()` reads `match[2]` behind a `match.length > 2` guard, i.e. it
   * requires **two** capture groups — a name and a version — which is how nine of
   * the eleven entries were written. The Safari entry (`/version\/([\d\.]+).*safari/i`)
   * and the IE entry (`/trident\/([\d\.]+)/i`) had **one**, so the version landed in
   * `match[1]`, the guard failed, and the helper returned `null`.
   *
   * Consequence, for as long as the file has existed: **every Safari event was
   * labelled `Safari/null`**, and the IE branch's `parseFloat(version) + 4.0` — the
   * whole Trident→IE version mapping — never executed once, because `version` was
   * always null. Exactly the failure mode `AUDIT.md` §1c names as the reason this
   * file is the worst risk in the SDK: silent mislabelling, no error, no dropped
   * request, dashboards that look fine.
   *
   * Fixed by capturing the name in both regexes rather than by loosening the helper,
   * so the "two groups" contract holds for all eleven entries instead of the helper
   * silently tolerating either shape.
   */
  describe('D-28 regression: the two one-group regexes', () => {
    it('reports the real Safari version', () => {
      expect(parserFor(UA.macSafari).browser).toBe('Safari/17.4.1');
    });

    it('maps the Trident version to an IE version by adding 4', () => {
      // Trident/7.0 is IE 11 and Trident/6.0 is IE 10. This assertion is what was
      // unreachable before the fix.
      expect(parserFor(UA.ie11).browser).toBe('IE/11');
      expect(parserFor(UA.ie10).browser).toBe('IE/10');
    });
  });
});

describe('_handleUserAgent — OS and version from the UA string', () => {
  const platformFor = (userAgent: string) =>
    withUA(userAgent, () => new Probe().handleUserAgent());

  it.each([
    ['Windows 10', UA.windows10Chrome, 'Windows 10.0'],
    ['macOS, underscores converted to dots', UA.macSafari, 'Mac OS X 10.15.7'],
    ['iOS, underscores converted to dots', UA.iphoneSafari, 'iOS 17.5'],
    ['iPadOS', UA.ipadSafari, 'iOS 16.6'],
    ['Android', UA.androidChrome, 'Android 13'],
    ['Linux, which carries no version', UA.linuxFirefox, 'Linux'],
  ])('derives %s', (_label, userAgent, expected) => {
    expect(platformFor(userAgent)).toBe(expected);
  });

  it('returns the default platform for a UA matching no OS regex', () => {
    expect(platformFor(UA.unknown)).toBe('Unknown');
  });

  it('prefers Android over Linux on a UA containing both', () => {
    // Every Android UA also says "Linux". Key order in `osRegexes` is what decides
    // it — reorder that object and every Android event silently becomes Linux.
    expect(platformFor(UA.androidChrome)).toBe('Android 13');
  });

  it('does not read "like Mac OS X" on an iOS UA as macOS', () => {
    // The mac regex requires a version right after "mac os x"; on iOS UAs the next
    // character is ")". Both the regex and the key ordering protect this.
    expect(platformFor(UA.iphoneSafari)).toBe('iOS 17.5');
  });

  it('defaults the iOS minor version to 0 when the UA gives only a major', () => {
    expect(
      platformFor('Mozilla/5.0 (iPhone; CPU iPhone OS 18 like Mac OS X)'),
    ).toBe('iOS 18.0');
  });

  it('keeps a single-segment Android version whole', () => {
    expect(platformFor('Mozilla/5.0 (Linux; Android 9.1; Pixel)')).toBe(
      'Android 9.1',
    );
  });
});

describe('_handleUserAgentEntropyValue — the Client Hints path', () => {
  /** Install a `navigator.userAgentData` stub for one assertion. */
  function withUserAgentData(
    platform: string,
    platformVersion: string | undefined,
    { reject = false }: { reject?: boolean } = {},
  ) {
    Object.defineProperty(navigator, 'userAgentData', {
      value: {
        platform,
        getHighEntropyValues: reject
          ? () => Promise.reject(new Error('blocked'))
          : () => Promise.resolve({ platform, platformVersion }),
      },
      configurable: true,
    });
    return new Probe().handleEntropy();
  }

  it.each([
    ['14.0.0', 'macOS 14 Sonoma or later'],
    ['15.3.1', 'macOS 14 Sonoma or later'],
    ['13.6.0', 'macOS 13 Ventura'],
    ['12.0.0', 'macOS 12 Monterey'],
    ['11.7.0', 'macOS 11 Big Sur'],
    ['10.15.7', 'macOS 10 Catalina or earlier'],
    ['9.0.0', 'Unknown macOS version'],
  ])('maps macOS platformVersion %s to %s', async (version, expected) => {
    await expect(withUserAgentData('macOS', version)).resolves.toBe(expected);
  });

  it.each([
    ['13.0.0', 'Windows 11'],
    ['15.0.0', 'Windows 11'],
    ['10.0.0', 'Windows 10'],
    ['6.1.0', 'Windows 7'],
    ['6.0.0', 'Windows Vista'],
    ['5.1.0', 'Windows XP'],
  ])('maps Windows platformVersion %s to %s', async (version, expected) => {
    await expect(withUserAgentData('Windows', version)).resolves.toBe(expected);
  });

  it('falls through to a raw Windows version outside every bucket', async () => {
    await expect(withUserAgentData('Windows', '4.9.9')).resolves.toBe(
      'Windows 4.9.9',
    );
  });

  it.each([
    ['14.0.0', 'Android 14 or later'],
    ['13.0.0', 'Android 13'],
    ['12.0.0', 'Android 12'],
    ['11.0.0', 'Android 11'],
    ['10.0.0', 'Android 10'],
    ['9.0.0', 'Android 9 Pie'],
    ['8.1.0', 'Android 8 Oreo'],
    ['7.0.0', 'Android 7 Nougat'],
    ['6.0.1', 'Android 6 Marshmallow'],
    ['5.0.0', 'Android 5 Lollipop'],
    ['4.4.4', 'Android version earlier than 5'],
  ])('maps Android platformVersion %s to %s', async (version, expected) => {
    await expect(withUserAgentData('Android', version)).resolves.toBe(expected);
  });

  it('maps iOS to major.minor, defaulting the minor to 0', async () => {
    await expect(withUserAgentData('iOS', '17.5.1')).resolves.toBe('iOS 17.5');
    await expect(withUserAgentData('iOS', '18')).resolves.toBe('iOS 18.0');
  });

  it.each([
    ['ubuntu.22.04', 'Ubuntu ubuntu'],
    ['fedora.39', 'Fedora fedora'],
    ['debian.12', 'Debian debian'],
    ['arch.rolling', 'Arch Linux arch'],
    ['6.8.0', 'Linux 6'],
  ])('maps Linux platformVersion %s to %s', async (version, expected) => {
    // Pinned as-is, including the oddity that the distro name comes out as the
    // "version": the code splits on "." and then re-tests the *first segment* for
    // the distro name it already matched. Real Chromium never sends a distro here
    // — `platformVersion` on Linux is "" — so this branch is effectively dead, and
    // it is pinned rather than fixed so a fix is a deliberate change (D-x style).
    await expect(withUserAgentData('Linux', version)).resolves.toBe(expected);
  });

  it('returns the default platform for a platform outside the switch', async () => {
    await expect(withUserAgentData('Chrome OS', '14541.0.0')).resolves.toBe(
      'Unknown',
    );
  });

  it('returns the default platform when the version is missing', async () => {
    await expect(withUserAgentData('macOS', undefined)).resolves.toBe(
      'Unknown',
    );
  });

  it('never rejects when the Client Hints call is refused', async () => {
    // Permissions-Policy can block `getHighEntropyValues`. This must degrade to
    // a label, not to a rejected promise on the event path.
    await expect(
      withUserAgentData('macOS', '14.0.0', { reject: true }),
    ).resolves.toBe('Unknown');
  });
});

describe('_getPlatform — which of the two paths runs', () => {
  it('uses Client Hints when `userAgentData` is present', async () => {
    Object.defineProperty(navigator, 'userAgentData', {
      value: {
        platform: 'Windows',
        getHighEntropyValues: () =>
          Promise.resolve({ platform: 'Windows', platformVersion: '13.0.0' }),
      },
      configurable: true,
    });
    // The UA string says Mac; Client Hints say Windows. Client Hints must win, or
    // the branch is not being taken.
    await expect(
      withUA(UA.macSafari, () => new Probe().getPlatform()),
    ).resolves.toBe('Windows 11');
  });

  it('falls back to the UA string when `userAgentData` is absent', async () => {
    await expect(
      withUA(UA.macSafari, () => new Probe().getPlatform()),
    ).resolves.toBe('Mac OS X 10.15.7');
  });

  it('returns the default platform when there is no UA at all', async () => {
    await expect(withUA('', () => new Probe().getPlatform())).resolves.toBe(
      'Unknown',
    );
  });
});

describe('geolocation', () => {
  // The SDK used to call ipapi.co from the end user's browser on every session start.
  // It is gone: Intempt derives country, region and city server-side from the address the
  // request already arrives on. Pinned as an absence so re-adding a browser-side lookup is a
  // deliberate act with a failing test in front of it.
  //
  // Two earlier versions of this block did not do that job, and both are worth naming because
  // they looked fine:
  //
  //  - `expect(probe._getLocation).toBeUndefined()` on its own passes for a MISSPELLED key just
  //    as happily as for a removed method, so it could never fail. The check below anchors on
  //    the surface rather than one name: it fails if ANY method appears whose name suggests a
  //    location lookup, which a typo cannot satisfy.
  //  - A fetch spy around `getPlatform()` asserted nothing, because `getPlatform` never called
  //    the lookup even before the removal — `_getLocation` was called from the session tracker.
  //    A spy on the wrong path is green on the old code and the new one alike.
  it('exposes no location-shaped method on the platform surface', () => {
    const probe = new Probe() as unknown as Record<string, unknown>;

    const names = new Set<string>();
    for (
      let proto = Object.getPrototypeOf(probe);
      proto && proto !== Object.prototype;
      proto = Object.getPrototypeOf(proto)
    ) {
      Object.getOwnPropertyNames(proto).forEach((n) => names.add(n));
    }

    // The set is non-empty, so an assertion over it cannot pass by looking at nothing.
    expect(names.size).toBeGreaterThan(0);

    const locationish = [...names].filter((n) => /location|geo|ipapi/i.test(n));
    expect(locationish).toEqual([]);
  });

  // REMOVED, deliberately, rather than repaired: a fetch spy around the parser's own
  // methods is green on `staging` too. The only `fetch(` in this file was inside
  // `_getLocation`, and none of `_getPlatform`, `_handleUserAgent` or
  // `_handleUserAgentEntropyValue` ever reached it -- `_getLocation` was called from
  // the session tracker. A spy that passes identically before and after the change it
  // claims to guard is not a weaker test, it is not a test, and leaving it in place
  // would say this behaviour is covered when it is not.
  //
  // What actually guards the removal:
  //   - the surface check above, proven to fail by planting `_getLocation` back
  //   - `sdkSmoke.spec.ts` asserting zero third-party geo calls from the built bundle
});
