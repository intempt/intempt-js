/**
 * Types for the `CustomEvent`s the SDK dispatches on `window`.
 *
 * Augmenting `WindowEventMap` is what makes `e.detail` usable in a listener without a
 * cast. The full list is in docs/API.md.
 */

export interface IntemptEventDetail {
  eventName: string;
}

export interface IntemptPayloadDetail {
  /**
   * The outbound payload. Left `unknown` on purpose: the shape is internal to the SDK and
   * has changed inside the 6.x line. Narrow it yourself if you depend on a field, and
   * expect to revisit that narrowing.
   */
  event: unknown;
}

declare global {
  interface WindowEventMap {
    /** Fires for every event, automatic and manual. Carries the payload. */
    'intempt:event': CustomEvent<IntemptPayloadDetail>;

    'intempt:track': CustomEvent<IntemptEventDetail>;
    'intempt:identify': CustomEvent<IntemptEventDetail>;
    'intempt:group': CustomEvent<IntemptEventDetail>;
    'intempt:record': CustomEvent<IntemptEventDetail>;
    'intempt:consent': CustomEvent<IntemptEventDetail>;
    'intempt:product': CustomEvent<IntemptEventDetail>;
    'intempt:logOut': CustomEvent<IntemptEventDetail>;

    /** Emitted by the automatic trackers. */
    'intempt:page': CustomEvent<IntemptEventDetail>;
    'intempt:session': CustomEvent<IntemptEventDetail>;
    'intempt:html': CustomEvent<IntemptEventDetail>;
    'intempt:shopify': CustomEvent<IntemptEventDetail>;
  }
}
