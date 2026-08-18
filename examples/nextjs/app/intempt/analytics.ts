/**
 * The wrapper to put between the app and `window.intempt`.
 *
 * Two things it exists for in a Next app specifically:
 *
 *  - `window` does not exist during server rendering, so every call has to go
 *    through a guard. Reaching for `window.intempt` directly in a component is
 *    the failure this prevents.
 *  - the loader is async. A call made before it lands would otherwise be a
 *    silent no-op; here it throws with a message naming the cause.
 */

/** Narrowed to what this example calls. The full surface is in `intempt.d.ts`. */
function sdk(): NonNullable<Window["intempt"]> {
  if (typeof window === "undefined") {
    throw new Error(
      "Intempt was called during server rendering. Move the call into a client component.",
    );
  }
  if (!window.intempt) {
    throw new Error(
      "Intempt is not loaded yet. Check the next/script tag in app/layout.tsx.",
    );
  }
  return window.intempt;
}

export const analytics = {
  identify(userId: string, traits?: Record<string, unknown>) {
    sdk().identify({ userId, userAttributes: traits });
  },

  /** `data` is required and must be non-empty — the SDK throws on an empty object. */
  track(eventTitle: string, data: Record<string, unknown>) {
    sdk().track({ eventTitle, data });
  },

  group(accountId: string, accountAttributes?: Record<string, unknown>) {
    sdk().group({ accountId, accountAttributes });
  },
};
