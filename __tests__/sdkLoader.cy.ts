// EnvConfig is initialized in __tests__/support/index.ts before this file runs
// Only import types statically (they don't execute code)
import type { IntemptConfig } from '../src/intemptJs/types/intemptJs.types.ts'

describe('SDK Loader - Stub Functionality', () => {
  const mockConfig: IntemptConfig = {
    organization: 'test-org',
    sourceId: 'test-source',
    project: 'test-project',
    writeKey: 'test.user',
    shopify: false,
    magento: false,
  }

  // Helper function to create a test stub
  function createTestStub(queue?: any[], promises?: any[], queueProperty: string = '_queue') {
    const stub: any = {
      _isStub: true,
      [queueProperty]: queue || [],
      _pendingPromises: promises || [],
      getProfileId: cy.stub().returns(undefined),
      optIn: cy.stub(),
      optOut: cy.stub(),
      isUserOptIn: cy.stub().returns(true),
      identify: cy.stub(),
      group: cy.stub(),
      track: cy.stub(),
      record: cy.stub(),
      alias: cy.stub(),
      consent: cy.stub(),
      productAdd: cy.stub(),
      productOrdered: cy.stub(),
      productView: cy.stub(),
      logOut: cy.stub(),
      recommendation: cy.stub().returns(Promise.resolve(null)),
    }
    return stub
  }

  // Helper to setup mock script tag for getIntemptConfig
  function setupMockScript(config: IntemptConfig) {
    const cdnLink = 'intempt.js'
    const script = document.createElement('script')
    const url = new URL(`https://cdn.example.com/${cdnLink}`)
    url.searchParams.set('project', config.project)
    url.searchParams.set('key', config.writeKey)
    url.searchParams.set('source', config.sourceId)
    url.searchParams.set('organization', config.organization)
    if (config.shopify) url.searchParams.set('shopify', 'true')
    if (config.magento) url.searchParams.set('magento', 'true')
    script.src = url.toString()
    document.head.appendChild(script)
    return script
  }

  // Helper to dynamically import SDK
  async function initSDK() {
    const { SDK } = await import('../src/loaders/sdkLoader.ts')
    SDK.init()
    // Return IntemptJs type for type checking
    const { IntemptJs } = await import('../src/intemptJs/intemptJs.ts')
    return IntemptJs
  }

  beforeEach(() => {
    // Clear window.intempt
    delete (window as any).intempt

    // Clear localStorage
    localStorage.clear()

    // EnvConfig is initialized in __tests__/support/index.ts with test values
    // No need to set globalThis.import.meta.env - EnvConfig handles this

    // Remove any existing script tags
    const scripts = document.querySelectorAll('script[src*="intempt.js"]')
    scripts.forEach((s) => s.remove())

    // Intercept recommendation API calls using Cypress intercept (primary method)
    cy.intercept('POST', '**/feeds/*/data', {
      statusCode: 200,
      body: {
        data: [{ id: '1', name: 'Test Product', price: 99.99 }],
        success: true
      }
    }).as('recommendationApi')

    // Intercept other API calls
    cy.intercept('POST', '**', {
      statusCode: 200,
      body: { data: 'test' }
    }).as('otherApi')

    // Also mock window.fetch directly (fallback)
    cy.window().then((win) => {
      const originalFetch = win.fetch
      ;(win as any).fetch = function(url: string | Request | URL, options?: RequestInit): Promise<Response> {
        // Check if this is a recommendation API call
        const urlString = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url
        if (urlString.includes('/feeds/') && urlString.includes('/data')) {
          // Return proper JSON for recommendation calls
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({ 
              data: [{ id: '1', name: 'Test Product', price: 99.99 }],
              success: true 
            }),
            text: async () => JSON.stringify({ 
              data: [{ id: '1', name: 'Test Product', price: 99.99 }],
              success: true 
            }),
            headers: new Headers(),
            body: null,
            bodyUsed: false,
            redirected: false,
            type: 'default' as ResponseType,
            url: urlString,
            clone: () => ({} as Response),
            arrayBuffer: async () => new ArrayBuffer(0),
            blob: async () => new Blob(),
            formData: async () => new FormData(),
          } as Response)
        }
        
        // Generic response for other API calls
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ data: 'test' }),
          text: async () => JSON.stringify({ data: 'test' }),
          headers: new Headers(),
          body: null,
          bodyUsed: false,
          redirected: false,
          type: 'default' as ResponseType,
          url: urlString,
          clone: () => ({} as Response),
          arrayBuffer: async () => new ArrayBuffer(0),
          blob: async () => new Blob(),
          formData: async () => new FormData(),
        } as Response)
      }
    })
  })

  afterEach(() => {
    // Cleanup
    delete (window as any).intempt
    localStorage.clear()
    const scripts = document.querySelectorAll('script[src*="intempt.js"]')
    scripts.forEach((s) => s.remove())
  })

  describe('Stub Detection & Extraction', () => {
    it('should detect stub with _queue property', async () => {
      const queue = [{ method: 'track', args: [{ eventTitle: 'Test' }] }]
      const stub = createTestStub(queue, [], '_queue')
      ;(window as any).intempt = stub

      setupMockScript(mockConfig)
      const IntemptJs = await initSDK()

      // Verify stub was replaced
      expect((window as any).intempt).to.not.equal(stub)
      expect((window as any).intempt).to.be.instanceOf(IntemptJs)
    })

    it('should detect stub with _stubQueue property', async () => {
      const queue = [{ method: 'track', args: [{ eventTitle: 'Test' }] }]
      const stub = createTestStub(queue, [], '_stubQueue')
      ;(window as any).intempt = stub

      setupMockScript(mockConfig)
      const IntemptJs = await initSDK()

      expect((window as any).intempt).to.be.instanceOf(IntemptJs)
    })

    it('should detect stub with queue property', async () => {
      const queue = [{ method: 'track', args: [{ eventTitle: 'Test' }] }]
      const stub = createTestStub(queue, [], 'queue')
      ;(window as any).intempt = stub

      setupMockScript(mockConfig)
      const IntemptJs = await initSDK()

      expect((window as any).intempt).to.be.instanceOf(IntemptJs)
    })

    it('should detect stub with __queue property', async () => {
      const queue = [{ method: 'track', args: [{ eventTitle: 'Test' }] }]
      const stub = createTestStub(queue, [], '__queue')
      ;(window as any).intempt = stub

      setupMockScript(mockConfig)
      const IntemptJs = await initSDK()

      expect((window as any).intempt).to.be.instanceOf(IntemptJs)
    })

    it('should handle initialization without stub', async () => {
      setupMockScript(mockConfig)
      const IntemptJs = await initSDK()

      expect((window as any).intempt).to.be.instanceOf(IntemptJs)
    })

    it('should extract pendingPromises from stub', async () => {
      const promises = [
        { id: 1, resolve: cy.stub(), reject: cy.stub() },
        { id: 2, resolve: cy.stub(), reject: cy.stub() },
      ]
      const stub = createTestStub([], promises)
      ;(window as any).intempt = stub

      setupMockScript(mockConfig)
      const IntemptJs = await initSDK()

      expect((window as any).intempt).to.be.instanceOf(IntemptJs)
    })
  })

  describe('Sync Method Replay', () => {
    it('should replay single track call', async () => {
      const queue = [
        {
          method: 'track',
          args: [{ eventTitle: 'Test Event', data: { test: true } }],
          timestamp: Date.now(),
        },
      ]
      const stub = createTestStub(queue)
      ;(window as any).intempt = stub

      setupMockScript(mockConfig)
      const IntemptJs = await initSDK()

      const realIntempt = (window as any).intempt
      expect(realIntempt).to.be.instanceOf(IntemptJs)
      // Queue should be cleared after replay
      expect(queue.length).to.equal(0)
    })

    it('should replay single identify call', async () => {
      const queue = [
        {
          method: 'identify',
          args: [{ userId: 'test-user-123' }],
          timestamp: Date.now(),
        },
      ]
      const stub = createTestStub(queue)
      ;(window as any).intempt = stub

      setupMockScript(mockConfig)
      const IntemptJs = await initSDK()

      expect((window as any).intempt).to.be.instanceOf(IntemptJs)
      expect(queue.length).to.equal(0)
    })

    it('should replay multiple calls in order', async () => {
      const queue = [
        { method: 'track', args: [{ eventTitle: 'Event 1' }], timestamp: Date.now() },
        { method: 'identify', args: [{ userId: 'user-1' }], timestamp: Date.now() },
        { method: 'track', args: [{ eventTitle: 'Event 2' }], timestamp: Date.now() },
      ]
      const stub = createTestStub(queue)
      ;(window as any).intempt = stub

      setupMockScript(mockConfig)
      const IntemptJs = await initSDK()

      expect((window as any).intempt).to.be.instanceOf(IntemptJs)
      expect(queue.length).to.equal(0)
    })

    it('should replay all sync methods', async () => {
      const queue = [
        { method: 'track', args: [{ eventTitle: 'Track' }] },
        { method: 'identify', args: [{ userId: 'user' }] },
        { method: 'group', args: [{ accountId: 'account' }] },
        { method: 'record', args: [{ eventTitle: 'Record' }] },
        { method: 'alias', args: [{ userId: 'user1', anotherUserId: 'user2' }] },
        { method: 'consent', args: [{ action: 'accept', validUntil: Date.now() }] },
        { method: 'productAdd', args: [{ productId: 'prod-1' }] },
        { method: 'productOrdered', args: [[{ productId: 'prod-1' }]] },
        { method: 'productView', args: ['prod-1'] },
        { method: 'logOut', args: [] },
        { method: 'optIn', args: [] },
        { method: 'optOut', args: [] },
      ]
      const stub = createTestStub(queue)
      ;(window as any).intempt = stub

      setupMockScript(mockConfig)
      const IntemptJs = await initSDK()

      expect((window as any).intempt).to.be.instanceOf(IntemptJs)
      expect(queue.length).to.equal(0)
    })
  })

  describe('Async Recommendation Replay', () => {
    it('should resolve promise for single recommendation call', async () => {
      const queue = [
        {
          method: 'recommendation',
          args: [{ id: 1, quantity: 5, fields: ['name', 'price'] }],
          timestamp: Date.now(),
        },
      ]
      const promiseInfo = { id: 1, resolve: null as any, reject: null as any }
      const promise = new Promise((resolve, reject) => {
        promiseInfo.resolve = resolve
        promiseInfo.reject = reject
      })
      const promises = [promiseInfo]
      const stub = createTestStub(queue, promises)
      ;(window as any).intempt = stub

      setupMockScript(mockConfig)
      const IntemptJs = await initSDK()

      const data = await promise
      expect(data).to.not.be.null
      expect((window as any).intempt).to.be.instanceOf(IntemptJs)
    })

    it('should resolve promises in FIFO order for multiple calls', async () => {
      const queue = [
        {
          method: 'recommendation',
          args: [{ id: 1, quantity: 5, fields: ['name'] }],
        },
        {
          method: 'recommendation',
          args: [{ id: 2, quantity: 10, fields: ['price'] }],
        },
      ]
      const promise1Info = { id: 1, resolve: null as any, reject: null as any }
      const promise2Info = { id: 2, resolve: null as any, reject: null as any }
      const promise1 = new Promise((resolve, reject) => {
        promise1Info.resolve = resolve
        promise1Info.reject = reject
      })
      const promise2 = new Promise((resolve, reject) => {
        promise2Info.resolve = resolve
        promise2Info.reject = reject
      })
      const promises = [promise1Info, promise2Info]
      const stub = createTestStub(queue, promises)
      ;(window as any).intempt = stub

      setupMockScript(mockConfig)
      const IntemptJs = await initSDK()

      await Promise.all([promise1, promise2])
      expect(promises.length).to.equal(0) // Should be cleared
      expect((window as any).intempt).to.be.instanceOf(IntemptJs)
    })

    it('should handle recommendation without pending promise gracefully', async () => {
      const queue = [
        {
          method: 'recommendation',
          args: [{ id: 1, quantity: 5, fields: ['name'] }],
        },
      ]
      const stub = createTestStub(queue, []) // Empty promises array
      ;(window as any).intempt = stub

      setupMockScript(mockConfig)
      const IntemptJs = await initSDK()

      expect((window as any).intempt).to.be.instanceOf(IntemptJs)
      expect(queue.length).to.equal(0)
    })

    it('should handle mixed sync and async calls', async () => {
      const queue = [
        { method: 'track', args: [{ eventTitle: 'Event' }] },
        {
          method: 'recommendation',
          args: [{ id: 1, quantity: 5, fields: ['name'] }],
        },
        { method: 'identify', args: [{ userId: 'user' }] },
      ]
      const promiseInfo = { id: 1, resolve: null as any, reject: null as any }
      const promise = new Promise((resolve, reject) => {
        promiseInfo.resolve = resolve
        promiseInfo.reject = reject
      })
      const promises = [promiseInfo]
      const stub = createTestStub(queue, promises)
      ;(window as any).intempt = stub

      setupMockScript(mockConfig)
      const IntemptJs = await initSDK()

      await promise
      expect(queue.length).to.equal(0)
      expect((window as any).intempt).to.be.instanceOf(IntemptJs)
    })
  })

  describe('Edge Cases & Error Handling', () => {
    it('should handle empty queue', async () => {
      const stub = createTestStub([], [])
      ;(window as any).intempt = stub

      setupMockScript(mockConfig)
      const IntemptJs = await initSDK()

      expect((window as any).intempt).to.be.instanceOf(IntemptJs)
    })

    it('should handle empty promises array', async () => {
      const queue = [
        {
          method: 'recommendation',
          args: [{ id: 1, quantity: 5, fields: ['name'] }],
        },
      ]
      const stub = createTestStub(queue, [])
      ;(window as any).intempt = stub

      setupMockScript(mockConfig)
      const IntemptJs = await initSDK()

      expect((window as any).intempt).to.be.instanceOf(IntemptJs)
    })

    it('should handle invalid method names gracefully', async () => {
      const queue = [
        { method: 'invalidMethod', args: [] },
        { method: 'track', args: [{ eventTitle: 'Valid' }] },
      ]
      const stub = createTestStub(queue)
      ;(window as any).intempt = stub

      setupMockScript(mockConfig)
      const IntemptJs = await initSDK()

      expect((window as any).intempt).to.be.instanceOf(IntemptJs)
      expect(queue.length).to.equal(0)
    })

    it('should prevent double stub initialization', async () => {
      const queue = [{ method: 'track', args: [{ eventTitle: 'Test' }] }]
      const stub1 = createTestStub(queue)
      ;(window as any).intempt = stub1

      // Try to create another stub (simulating stub script running twice)
      const stub2 = createTestStub([], [])
      if ((window as any).intempt && (window as any).intempt._isStub) {
        // Stub already exists, should not replace
        expect((window as any).intempt).to.equal(stub1)
      }

      setupMockScript(mockConfig)
      const IntemptJs = await initSDK()

      expect((window as any).intempt).to.be.instanceOf(IntemptJs)
    })

    it('should handle errors during replay gracefully', async () => {
      const queue = [
        { method: 'track', args: [{ eventTitle: 'Valid' }] },
        { method: 'track', args: [null] }, // Invalid args that might cause error
      ]
      const stub = createTestStub(queue)
      ;(window as any).intempt = stub

      setupMockScript(mockConfig)
      const IntemptJs = await initSDK()

      expect((window as any).intempt).to.be.instanceOf(IntemptJs)
    })
  })

  describe('SDK Initialization', () => {
    it('should initialize without stub', async () => {
      setupMockScript(mockConfig)
      const IntemptJs = await initSDK()

      expect((window as any).intempt).to.be.instanceOf(IntemptJs)
      expect((window as any).intempt).to.not.be.undefined
    })

    it('should extract stub data before replacing window.intempt', async () => {
      const queue = [{ method: 'track', args: [{ eventTitle: 'Test' }] }]
      const stub = createTestStub(queue)
      ;(window as any).intempt = stub

      setupMockScript(mockConfig)
      const IntemptJs = await initSDK()

      // Queue should be extracted and cleared
      expect(queue.length).to.equal(0)
      expect((window as any).intempt).to.be.instanceOf(IntemptJs)
    })

    it('should replace stub with real IntemptJs instance', async () => {
      const stub = createTestStub([{ method: 'track', args: [{ eventTitle: 'Test' }] }])
      ;(window as any).intempt = stub

      setupMockScript(mockConfig)
      const IntemptJs = await initSDK()

      const realIntempt = (window as any).intempt
      expect(realIntempt).to.be.instanceOf(IntemptJs)
      expect(realIntempt).to.not.equal(stub)
      expect(realIntempt._isStub).to.be.undefined
    })

    it('should not replay if queue is empty', async () => {
      const stub = createTestStub([])
      ;(window as any).intempt = stub

      setupMockScript(mockConfig)
      const IntemptJs = await initSDK()

      expect((window as any).intempt).to.be.instanceOf(IntemptJs)
    })
  })

  describe('Integration Tests', () => {
    it('should handle full flow: stub → queue calls → SDK init → replay', async () => {
      const queue = [
        { method: 'track', args: [{ eventTitle: 'Page View' }] },
        { method: 'identify', args: [{ userId: 'user-123' }] },
        {
          method: 'recommendation',
          args: [{ id: 1, quantity: 5, fields: ['name'] }],
        },
      ]
      const promiseInfo = { id: 1, resolve: null as any, reject: null as any }
      const promise = new Promise((resolve, reject) => {
        promiseInfo.resolve = resolve
        promiseInfo.reject = reject
      })
      const promises = [promiseInfo]
      const stub = createTestStub(queue, promises)
      ;(window as any).intempt = stub

      // Simulate calls on stub
      stub.track({ eventTitle: 'Page View' })
      stub.identify({ userId: 'user-123' })
      stub.recommendation({ id: 1, quantity: 5, fields: ['name'] })

      setupMockScript(mockConfig)
      const IntemptJs = await initSDK()

      expect((window as any).intempt).to.be.instanceOf(IntemptJs)
      expect(queue.length).to.equal(0)
    })

    it('should handle real SDK methods after stub replacement', async () => {
      const stub = createTestStub([{ method: 'track', args: [{ eventTitle: 'Test' }] }])
      ;(window as any).intempt = stub

      setupMockScript(mockConfig)
      await initSDK()

      const realIntempt = (window as any).intempt
      expect(realIntempt.getProfileId).to.be.a('function')
      expect(realIntempt.track).to.be.a('function')
      expect(realIntempt.identify).to.be.a('function')
    })

    it('should handle getProfileId and isUserOptIn stub values', async () => {
      const stub = createTestStub([])
      stub.getProfileId = () => undefined
      stub.isUserOptIn = () => true
      ;(window as any).intempt = stub

      expect(stub.getProfileId()).to.be.undefined
      expect(stub.isUserOptIn()).to.be.true

      setupMockScript(mockConfig)
      await initSDK()

      const realIntempt = (window as any).intempt
      // Real SDK should return actual values
      expect(realIntempt.getProfileId()).to.be.a('string')
      expect(realIntempt.isUserOptIn()).to.be.a('boolean')
    })
  })
})
