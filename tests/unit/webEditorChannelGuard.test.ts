import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * INT-3930 — the opener-channel guard in `src/loaders/webEditorLoader.ts`.
 *
 * The web editor opens the customer's own page in a new tab with
 * `?channel=<nonce>` and then drives it over `postMessage`. `CHANNEL` is read
 * from that query string, and the guard decides whether an INIT message is
 * allowed to mount the editor into the page.
 *
 * The guard was:
 *
 *     if (this.CHANNEL && msg.channel && msg.channel !== this.CHANNEL)
 *
 * The middle term made the nonce **optional**: a message that simply omitted
 * `channel` short-circuited the whole condition and was accepted, so any script
 * on an allowed origin could mount the editor by leaving the field out. It is
 * now `this.CHANNEL && msg.channel !== this.CHANNEL`, i.e. once the page was
 * opened with a channel, the message must carry that exact channel.
 *
 * **How acceptance is observed.** `handleMessageFromOpener` has no return value.
 * A REJECTED message returns before anything else happens; an ACCEPTED one falls
 * through to the payload check, which replies to `event.source` with
 * `{type:'ACK', ok:false, error:'invalid_payload'}` for the deliberately empty
 * payload used here. So "did `source.postMessage` get called" is exactly "did the
 * channel guard let this message through", with no editor mounted and no remote
 * module fetched either way.
 *
 * The method is called directly rather than through `WEB_EDITOR.init()` because
 * `init()` also starts the ready-ping interval, which has nothing to do with the
 * guard and would leave a timer running per test.
 */

const OPENER = 'https://editor.example.com';

type Handler = { handleMessageFromOpener: (event: MessageEvent) => void };

/**
 * Loads a FRESH `WEB_EDITOR` for a given page URL.
 *
 * `CHANNEL` and `ALLOWED_ORIGINS` are both read in the constructor of the
 * module-level singleton, so the query string and `EnvConfig` have to be in
 * place before the module is evaluated — hence `resetModules` plus dynamic
 * import, and hence `EnvConfig` imported from the same fresh graph (the static
 * copy would be a different module instance after the reset).
 */
async function loadEditor(search: string): Promise<Handler> {
  window.history.replaceState({}, '', search);
  vi.resetModules();

  const { EnvConfig } = await import('../../src/shared/envConfig.ts');
  EnvConfig.reset();
  EnvConfig.initFromValues({ VITE_OPENER_LINKS: OPENER });

  const { WEB_EDITOR } = await import('../../src/loaders/webEditorLoader.ts');
  return WEB_EDITOR as unknown as Handler;
}

/** An INIT message from the opener. `channel: undefined` omits the field entirely. */
function initMessage(channel: string | undefined) {
  const postMessage = vi.fn();
  const data: Record<string, unknown> = { type: 'INIT', payload: {} };
  if (channel !== undefined) data.channel = channel;

  const event = new MessageEvent('message', { data, origin: OPENER });
  // jsdom will not accept a plain object as `source` through the constructor.
  Object.defineProperty(event, 'source', { value: { postMessage } });

  return { event, postMessage };
}

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

describe('web editor — INIT channel guard (INT-3930)', () => {
  it('accepts a message whose channel matches the one in the page URL', async () => {
    const editor = await loadEditor('/?channel=nonce-1');
    const { event, postMessage } = initMessage('nonce-1');

    editor.handleMessageFromOpener(event);

    // Got past the guard and reached the payload check.
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0]).toMatchObject({
      type: 'ACK',
      ok: false,
      error: 'invalid_payload',
      channel: 'nonce-1',
    });
  });

  it('rejects a message whose channel does not match', async () => {
    const editor = await loadEditor('/?channel=nonce-1');
    const { event, postMessage } = initMessage('someone-elses-nonce');

    editor.handleMessageFromOpener(event);

    // Returned at the guard: no reply, and nothing downstream ran.
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('rejects a message that omits the channel — the nonce is not optional', async () => {
    // THE MUTANT: restoring the `msg.channel &&` term makes this message pass,
    // because an absent field short-circuits the mismatch test. That was the
    // defect: the channel check could be skipped simply by not sending one.
    const editor = await loadEditor('/?channel=nonce-1');
    const { event, postMessage } = initMessage(undefined);

    editor.handleMessageFromOpener(event);

    expect(postMessage).not.toHaveBeenCalled();
  });

  it('is inert when the page was not opened with a channel at all', async () => {
    // `this.CHANNEL` is `''` here, so the guard cannot apply — there is no nonce
    // to compare against. The origin allow-list is the only gate in that case,
    // and the tightened mismatch test must not start rejecting on an empty
    // `CHANNEL`.
    const editor = await loadEditor('/');
    const { event, postMessage } = initMessage('anything-at-all');

    editor.handleMessageFromOpener(event);

    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it('rejects a message from an origin that is not on the allow-list', async () => {
    const editor = await loadEditor('/?channel=nonce-1');
    const postMessage = vi.fn();
    const event = new MessageEvent('message', {
      data: { type: 'INIT', channel: 'nonce-1', payload: {} },
      origin: 'https://attacker.example.com',
    });
    Object.defineProperty(event, 'source', { value: { postMessage } });

    editor.handleMessageFromOpener(event);

    expect(postMessage).not.toHaveBeenCalled();
  });
});
