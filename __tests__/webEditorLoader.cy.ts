// Ensure EnvConfig (with VITE_OPENER_LINKS) is set before loader is instantiated
import './support/index.ts';
import { WEB_EDITOR } from '../src/loaders/webEditorLoader.ts';

describe('WebEditorLoader - allowed origins', () => {
  let postMessageStub: ReturnType<typeof cy.stub>;

  beforeEach(() => {
    postMessageStub = cy.stub(window, 'postMessage');
    (window as any).opener = window;
    WEB_EDITOR.init();
  });

  afterEach(() => {
    postMessageStub.restore();
    (window as any).opener = null;
  });

  it('ignores message when origin is not in allowed list', () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://evil.com',
        data: { type: 'INIT', payload: { experience: {}, variantId: 'v', token: 't' } },
        source: window,
      })
    );
    expect(postMessageStub).not.to.have.been.called;
  });

  it('accepts message when origin is in allowed list and replies with that origin as targetOrigin', () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://opener.test.com',
        data: { type: 'INIT', payload: {} },
        source: window,
      })
    );
    expect(postMessageStub).to.have.been.called;
    const [payload, targetOrigin] = postMessageStub.getCall(0).args;
    expect(payload).to.deep.include({ type: 'ACK', ok: false, error: 'invalid_payload' });
    expect(targetOrigin).to.equal('https://opener.test.com');
  });
});
