import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntemptJs } from '../../src/intemptJs/intemptJs.ts';
import type { DeliveryFailure } from '../../src/shared/queue/requestBatcher.ts';

// Ro-bot mcp-1794592985-70 n3:rules:F1: the SDK is configured only from its script src, so
// a hook passed in IntemptConfig cannot be set by an integrator. The listeners are registered
// on the live instance instead, after the SDK has built every module that reports through them.

const CTX = { profileId: 'p-1' };

function sdk() {
  return new IntemptJs({
    organization: 'acme',
    project: 'web',
    sourceId: '42',
    writeKey: 'pfx.sec',
  } as never);
}

const respond = (status: number) =>
  vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    headers: { get: () => null },
    json: async () => ({}),
  });

beforeEach(() => {
  vi.stubGlobal('btoa', (s: string) =>
    Buffer.from(s, 'binary').toString('base64'),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('listeners registered on a live instance', () => {
  it('onFlagError(listener) receives a failed flag request', async () => {
    vi.stubGlobal('fetch', respond(401));
    const client = sdk();
    const errors: unknown[] = [];
    client.onFlagError((e) => errors.push(e));

    await expect(client.variation('checkout', CTX, 'dflt')).resolves.toBe(
      'dflt',
    );
    expect(errors).toEqual([{ key: 'checkout', kind: 'auth', status: 401 }]);
  });

  it('onDeliveryFailure(listener) receives a consent record the server rejected', async () => {
    const client = sdk();
    const fetchMock = respond(400);
    vi.stubGlobal('fetch', fetchMock);
    const failures: DeliveryFailure[] = [];
    client.onDeliveryFailure((f) => failures.push(f));

    client.consent({ action: 'accept', validUntil: Date.now() + 1000 });

    await vi.waitFor(() => expect(failures).toHaveLength(1));
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('consents')),
    ).toBe(true);
    expect(failures[0]).toMatchObject({
      kind: 'terminal',
      status: 400,
      terminal: true,
      eventCount: 1,
      eventIds: [],
    });
  });

  it('a later registration replaces the earlier one, and null removes it', async () => {
    vi.stubGlobal('fetch', respond(500));
    const client = sdk();
    const first = vi.fn();
    const second = vi.fn();

    client.onFlagError(first);
    client.onFlagError(second);
    await client.variation('a', CTX, 1);
    client.onFlagError(null);
    await client.variation('a', CTX, 1);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
