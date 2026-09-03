import { PiiScrubberOptions } from '../../shared/privacy/piiScrubber.ts';

import { DiagnosticSink, LogThreshold } from '../../shared/logger/logger.ts';

/**
 * A bag of customer-supplied attributes — event data, user traits, account traits.
 *
 * `unknown` rather than `any` for the values, deliberately: these bags are only
 * ever passed through to `JSON.stringify` on the way to ingest, never read
 * field-by-field by the SDK, so nothing here needs to dereference them — and
 * `unknown` means a future reader is forced to narrow instead of silently
 * inheriting `any`. It is NOT a stricter public contract: assigning any value to
 * `unknown` is always allowed, so every call that typechecks today still does.
 * A `JsonValue` union would have been stricter and would reject the `Date` and
 * `undefined` values customers do pass, so it is deliberately not used.
 */
export type AttributeBag = { [key: string]: unknown };

export type LocalStorageCache = {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  remove: (key: string) => void;
  getAllKeys: () => string[];
  clear: () => void;
};

export type IdType = 'pag' | 'ses' | 'ev' | 'prof';

export type IntemptIdsParams = {
  sessionId?: string;
  profileId?: string;
  pageId?: string;
  sourceId?: string;
};

export type IntemptConfig = {
  organization: string;
  sourceId: string;
  project: string;
  writeKey: string;
  shopify: boolean;
  magento: boolean;

  /**
   * Let Intempt derive country, region and city from the address the event arrives on.
   *
   * Default `true`. The SDK sends this as `?ip=1` or `?ip=0` on the events endpoint; the browser
   * never handles its own address and no third party is involved. Set `false` to store no location
   * at all. Named to match Mixpanel's `UseIpAddressForGeolocation`, so a customer migrating does
   * not have to look it up.
   *
   * This is the one privacy switch of the three that defaults ON, so it stays tri-state
   * (`?`) on purpose: `undefined` means "unset, derive" both here and on the wire
   * (`autoTracker.url.ts`'s `buildTrackUrl` sends `?ip=1` unless this is exactly `false`).
   * Do NOT read it with `!config.useIpAddressForGeolocation` — `!undefined === true` would
   * silently disable derivation for every customer who never set it. Always compare with
   * `=== false`, as the two send sites and `sdkLoader.ts`'s parser already do.
   */
  useIpAddressForGeolocation?: boolean;

  /**
   * Ignore the browser's Do Not Track **and Global Privacy Control** signals.
   *
   * Default `false` — the SDK honours both. Set this only if you operate your own
   * consent gate whose explicit, logged consent should outrank a browser default;
   * doing so moves the CCPA/CPRA obligation for GPC onto you.
   *
   * Snake_case to match the name Mixpanel and Segment use for the same option, so
   * a customer migrating does not have to look it up.
   */
  ignore_dnt?: boolean;

  /**
   * PII redaction on outbound event payloads. **Off unless set**, because turning
   * redaction on rewrites data irreversibly before it leaves the browser — there
   * is no server-side undo, so it can never be a default.
   *
   * `true` uses the default rules (email / phone / Luhn-verified card shapes, plus
   * a list of sensitive field names). Pass an object to tune them.
   */
  piiScrubbing?: boolean | PiiScrubberOptions;

  /**
   * Ingest base URL override, for data residency.
   *
   * Overrides the build-time `VITE_API` for **event and consent ingest only**.
   * Supply the full base URL including any version path, e.g.
   * `https://api.eu.example.com/v1`. Invalid or non-https values are ignored and
   * the build-time default is used — silently routing data to an unusable host
   * would look like a residency guarantee while dropping every event.
   *
   * See `resolveIngestBaseUrl` for why there is no `region: 'eu'` shorthand.
   */
  apiHost?: string;
  /**
   * Verbose diagnostics, including in a production bundle.
   *
   * The support switch. Every diagnostic in the SDK used to be gated on the build
   * environment, so the production bundle every customer runs printed nothing and
   * there was no way to change that without shipping them a staging build. Set
   * this and the console gets `debug` and above.
   */
  debug?: boolean;
  /**
   * Explicit console threshold, overriding both `debug` and the environment
   * default. Use `'silent'` to quiet a development build, or `'warn'` to see only
   * real problems in production.
   */
  logLevel?: LogThreshold;
  /**
   * Receive SDK diagnostics for forwarding to your own telemetry (Sentry,
   * Datadog, a custom endpoint).
   *
   * Called synchronously with a structured record. Defaults to `warn` and above,
   * independently of `logLevel`, because a sink exists to catch problems in
   * production — where the console is silent. Raise it with `debug: true`.
   *
   * Exceptions thrown by this callback are swallowed: a broken sink must not
   * become an unhandled error on your page.
   */
  onDiagnostic?: DiagnosticSink;
};

export type IntemptVariables = {
  orgName: string;
  project: string;
  sourceId: string;
  profileId: string;
  sessionId: string;
  device: string;
  username: string | null;
  password: string | null;
  url: string;
};

export type EditorPayload = {
  /** Opaque here: the web editor round-trips it untouched. */
  experience: unknown;
  variantId: string;
  token: string;
};

export type ConsentAction = 'accept' | 'reject';

export type ConsentParams = {
  action: ConsentAction;
  validUntil: number;
  email?: string;
  message?: string;
  category?: string;
};

export type ProductParams = {
  productId: string;
  quantity?: number;
};

/**
 * Why an evaluation returned the value it did.
 *
 * Without a reason a caller cannot tell a deliberate off state from a request the service never
 * answered. These strings are the wire contract, shared with every Intempt SDK.
 */
export type FlagReason = 'targeted' | 'holdout' | 'not_targeted' | 'off';

/**
 * Who is being evaluated.
 *
 * Both are optional: the SDK fills in the profile id it already holds when neither is given. That
 * identifier is present before and after someone signs in, which is what keeps their assignment
 * stable across the transition.
 */
export type FlagContext = {
  userId?: string;
  profileId?: string;
};

/** A value and why it was returned. `variant` is absent when nothing was served. */
export type FlagDetail<T = unknown> = {
  value: T;
  reason: FlagReason;
  variant?: string;
};

export type RecommendationParams = {
  id: number;
  quantity: number;
  fields: string[];
};

export type IdentifyParams = {
  userId: string;
  eventTitle?: string;
  userAttributes?: AttributeBag;
  data?: AttributeBag;
};

export type GroupParams = {
  accountId: string;
  eventTitle?: string;
  accountAttributes?: AttributeBag;
};

export type TrackParams = {
  eventTitle: string;
  data: AttributeBag;
};

export type RecordParams = {
  eventTitle: string;
  accountId?: string;
  userId?: string;
  accountAttributes?: AttributeBag;
  userAttributes?: AttributeBag;
  data?: AttributeBag;
};

export type AuthConfig = {
  username: string;
  password: string;
};
