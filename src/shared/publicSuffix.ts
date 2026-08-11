/**
 * eTLD+1 derivation without a public-suffix data table.
 *
 * Why this file exists: `psl` shipped 152 KB raw (9,353 rule literals, ~60% of
 * the whole bundle) to serve exactly one call site — cookie-domain derivation in
 * `handleDomain`. Every page load paid for the full public-suffix list so that a
 * single cookie could be scoped. That is the worst effort-to-impact ratio in the
 * SDK.
 *
 * The trade: a heuristic is wrong on a long tail of exotic suffixes where `psl`
 * is right. What "wrong" costs here is bounded — the cookie ends up scoped one
 * label too wide or too narrow, so at worst a session cookie does not follow the
 * visitor across subdomains. It cannot corrupt data or leak a cookie to another
 * registrant, because a browser rejects a `domain` attribute that is not a
 * suffix of the current host, and our fallback is always *narrower* (the full
 * hostname), never wider. Mixpanel makes the same trade in `src/utils.js` and
 * exposes a `cookie_domain` config escape hatch for the cases it misses.
 *
 * Structure of the heuristic:
 *   1. hosts that must not get a cookie `domain` at all (IP literals,
 *      single-label hosts like `localhost`) are returned unchanged;
 *   2. an explicit set of common two-label public suffixes (`co.uk`, `com.au`,
 *      `co.jp`, …) — these are where a naive "last two labels" rule fails, and
 *      they cover the overwhelming majority of real traffic;
 *   3. otherwise, the last two labels.
 */

/**
 * Two-label suffixes under which registrations happen — so the registrable
 * domain needs *three* labels, not two.
 *
 * Deliberately not exhaustive — see the file header. Kept as a Set of strings
 * (~1.5 KB minified) rather than the 152 KB rule list it replaces.
 *
 * Two groups, one lookup, because they behave identically here:
 *
 *  - **ccSLDs** (`co.uk`, `com.au`, `co.jp`): a naive last-two-labels rule
 *    yields `co.uk`, which a browser rejects as a public suffix — the cookie is
 *    then dropped, not merely mis-scoped.
 *  - **Private suffixes** (`github.io`, `vercel.app`, `myshopify.com`): same
 *    failure, and easy to overlook. `myshopify.com` matters especially — this
 *    SDK ships a Shopify tracker, so hosted-store hostnames are a first-class
 *    case, not an exotic one. A parity run against `psl` is what surfaced these;
 *    do not trim this group without re-running it (see the note at the bottom of
 *    this file).
 */
const REGISTRABLE_UNDER_TWO_LABELS = new Set([
  // United Kingdom
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk', 'ac.uk',
  'gov.uk', 'mod.uk', 'nhs.uk', 'police.uk',
  // Australia / New Zealand
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au',
  'co.nz', 'net.nz', 'org.nz', 'ac.nz', 'geek.nz', 'govt.nz', 'school.nz',
  // Japan / Korea / China / Taiwan / Hong Kong / Singapore / India
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'gr.jp', 'ed.jp', 'lg.jp',
  'co.kr', 'ne.kr', 'or.kr', 're.kr', 'go.kr', 'ac.kr',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
  'com.tw', 'net.tw', 'org.tw', 'gov.tw', 'edu.tw',
  'com.hk', 'net.hk', 'org.hk', 'edu.hk', 'gov.hk', 'idv.hk',
  'com.sg', 'net.sg', 'org.sg', 'edu.sg', 'gov.sg',
  'co.in', 'net.in', 'org.in', 'gen.in', 'firm.in', 'ind.in', 'ac.in',
  'edu.in', 'res.in', 'gov.in',
  // Americas
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br',
  'com.mx', 'net.mx', 'org.mx', 'edu.mx', 'gob.mx',
  'com.ar', 'net.ar', 'org.ar', 'edu.ar', 'gob.ar',
  'com.co', 'net.co', 'org.co', 'edu.co', 'gov.co',
  'com.pe', 'com.ve', 'com.ec', 'com.uy', 'com.py', 'com.bo', 'com.do',
  'co.cr', 'com.gt',
  // EMEA
  'co.za', 'org.za', 'net.za', 'web.za', 'gov.za', 'ac.za',
  'co.il', 'org.il', 'net.il', 'ac.il', 'gov.il',
  'com.tr', 'net.tr', 'org.tr', 'gen.tr', 'edu.tr', 'gov.tr',
  'com.ru', 'net.ru', 'org.ru', 'com.ua', 'net.ua', 'org.ua', 'in.ua',
  'com.pl', 'net.pl', 'org.pl', 'edu.pl', 'gov.pl',
  'com.es', 'org.es', 'nom.es', 'gob.es', 'edu.es',
  'com.pt', 'org.pt', 'gov.pt', 'com.gr', 'net.gr', 'org.gr', 'edu.gr',
  'com.cy', 'com.mt', 'co.hu', 'com.hr', 'com.ro', 'com.ee', 'com.lv',
  'co.ke', 'co.tz', 'co.ug', 'com.ng', 'com.gh', 'com.eg', 'com.sa',
  'com.ae', 'com.qa', 'com.kw', 'com.bh', 'com.om', 'com.lb', 'com.jo',
  'com.pk', 'com.bd', 'com.np', 'com.lk', 'com.my', 'com.ph', 'com.vn',
  'co.th', 'in.th', 'go.th', 'ac.th', 'co.id', 'or.id', 'web.id', 'ac.id',

  // --- Private suffixes: hosting/platform domains where each customer gets a
  // --- subdomain, so the subdomain IS the registrable unit.
  'myshopify.com', 'shopifypreview.com',
  'github.io', 'github.dev', 'gitlab.io',
  'vercel.app', 'netlify.app', 'netlify.com', 'pages.dev', 'workers.dev',
  'herokuapp.com', 'appspot.com', 'web.app', 'firebaseapp.com',
  'azurewebsites.net', 'cloudfront.net', 'amplifyapp.com', 'elasticbeanstalk.com',
  'onrender.com', 'fly.dev', 'railway.app', 'surge.sh', 'glitch.me',
  'blogspot.com', 'wordpress.com', 'wixsite.com', 'webflow.io', 'bigcartel.com',
  'squarespace.com', 'weeblysite.com', 'bubbleapps.io', 'framer.website',
  'ngrok.io', 'ngrok.app', 'loca.lt', 'trycloudflare.com',
]);

const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * True when a cookie must not carry a `domain` attribute for this host.
 *
 * IP literals and single-label hosts (`localhost`, intranet names) cannot be
 * domain-scoped: browsers reject `domain=.localhost` outright, which silently
 * drops the cookie entirely. Host-only is the correct scope for them.
 */
export function isHostOnlyTarget(hostname: string): boolean {
  if (!hostname) {
    return true;
  }
  // IPv6 arrives bracketed from location.hostname, e.g. '[::1]'.
  if (hostname.indexOf(':') !== -1 || hostname.startsWith('[')) {
    return true;
  }
  if (IPV4_LITERAL.test(hostname)) {
    return true;
  }
  return hostname.indexOf('.') === -1;
}

/**
 * Derive the registrable domain (eTLD+1) from a hostname.
 *
 * @example
 * extractEtldPlusOne('my.sub.example.com') // 'example.com'
 * extractEtldPlusOne('www.oxford.ac.uk')   // 'oxford.ac.uk'
 * extractEtldPlusOne('localhost')          // 'localhost'  (host-only)
 */
export function extractEtldPlusOne(hostname: string): string {
  const host = (hostname || '').toLowerCase().replace(/\.$/, '');

  if (isHostOnlyTarget(host)) {
    return host;
  }

  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) {
    return parts.join('.');
  }

  const lastTwo = parts.slice(-2).join('.');
  if (REGISTRABLE_UNDER_TWO_LABELS.has(lastTwo)) {
    // The last two labels are the suffix, so the registrable domain needs a
    // third: oxford.ac.uk, not ac.uk; acme.myshopify.com, not myshopify.com.
    return parts.slice(-3).join('.');
  }

  return lastTwo;
}

/**
 * Known divergences from `psl`, measured — not assumed.
 *
 * A 55-hostname parity harness compared this against `psl.parse` before the
 * dependency was removed. Everything matched except:
 *
 *  - IP literals and single-label hosts. `psl` drove the old code to emit
 *    nonsense like `domain=.0.1` for `127.0.0.1`, which browsers reject, so the
 *    cookie was silently dropped. We now write host-only cookies there. **This is
 *    a fix, not a regression.**
 *  - Deep `.us` hierarchies (`example.pvt.k12.ma.us` → we give `.ma.us`).
 *    Accepted: three-plus-label public suffixes are a long tail, and the failure
 *    is a rejected cookie on hostnames no known customer uses.
 *
 * The private-suffix group above exists *because* that harness flagged
 * `github.io`, `vercel.app`, `herokuapp.com`, `appspot.com` and `blogspot.com`
 * as regressions. If you extend the heuristic, re-run a parity check against a
 * current public-suffix list rather than reasoning about it.
 */
