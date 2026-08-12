/**
 * Single source of truth for the SDK version at runtime.
 *
 * `__SDK_VERSION__` is replaced at build time by vite (`define:` in
 * `vite.config.ts`) with the `version` field of `package.json`. Never hardcode a
 * version literal anywhere else — the value has to match the published package
 * for incident forensics to be possible.
 *
 * The `typeof` guard keeps non-vite consumers (tsc-only runs, cypress specs that
 * import modules directly) from throwing on an undefined global.
 */
declare const __SDK_VERSION__: string | undefined;

export const SDK_VERSION: string =
  typeof __SDK_VERSION__ === 'string' ? __SDK_VERSION__ : '0.0.0-dev';
