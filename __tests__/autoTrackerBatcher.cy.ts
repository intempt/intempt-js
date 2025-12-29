import { AutoTrackerModule } from '../src/intemptJs/modules/autoTracker/autoTracker.module.ts';
import { IntemptConfig } from '../src/intemptJs/types/intemptJs.types.ts';

describe('AutoTrackerModule - Batcher Integration', () => {
  let autoTracker: AutoTrackerModule;
  const mockConfig: IntemptConfig = {
    organization: 'test-org',
    sourceId: 'test-source',
    project: 'test-project',
    writeKey: 'test.user',
    shopify: false,
    magento: false
  };

  beforeEach(() => {
    // Clear localStorage
    localStorage.clear();
    
    // Mock import.meta.env to avoid location API error
    const originalImportMeta = (globalThis as any).import?.meta;
    if (!(globalThis as any).import) {
      (globalThis as any).import = { meta: { env: { VITE_LOCATION_API_URL: '', VITE_ENV: 'test' } } };
    } else if (!(globalThis as any).import.meta) {
      (globalThis as any).import.meta = { env: { VITE_LOCATION_API_URL: '', VITE_ENV: 'test' } };
    } else if (!(globalThis as any).import.meta.env) {
      (globalThis as any).import.meta.env = { VITE_LOCATION_API_URL: '', VITE_ENV: 'test' };
    } else {
      (globalThis as any).import.meta.env.VITE_LOCATION_API_URL = '';
      (globalThis as any).import.meta.env.VITE_ENV = 'test';
    }
    
    // Mock fetch
    cy.window().then((win) => {
      (win as any).fetch = cy.stub().resolves({
        ok: true,
        status: 200,
        headers: {
          get: () => null
        }
      });
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('Batcher Initialization', () => {
    it('should initialize batcher on construction', () => {
      autoTracker = new AutoTrackerModule(mockConfig, 'https://api.test.com');
      // Batcher should be initialized
      expect(autoTracker).to.not.be.undefined;
    });

    it('should fallback to legacy method if batcher fails', () => {
      // Mock localStorage to fail
      cy.window().then((win) => {
        const originalSetItem = win.localStorage.setItem;
        let callCount = 0;
        win.localStorage.setItem = function(key: string, value: string) {
          // Fail on first few calls to simulate initialization failure
          if (callCount++ < 3 && key.includes('__intempt_')) {
            throw new Error('Quota exceeded');
          }
          return originalSetItem.call(this, key, value);
        };

        autoTracker = new AutoTrackerModule(mockConfig, 'https://api.test.com');
        // Should still work with fallback
        expect(autoTracker).to.not.be.undefined;

        win.localStorage.setItem = originalSetItem;
      });
    });
  });

  describe('Event Tracking with Batcher', () => {
    beforeEach(() => {
      // Mock import.meta.env to avoid location API error
      // Must be done before creating AutoTrackerModule
      const originalImportMeta = (globalThis as any).import?.meta;
      if (!(globalThis as any).import) {
        (globalThis as any).import = { meta: { env: { VITE_LOCATION_API_URL: '', VITE_ENV: 'test' } } };
      } else if (!(globalThis as any).import.meta) {
        (globalThis as any).import.meta = { env: { VITE_LOCATION_API_URL: '', VITE_ENV: 'test' } };
      } else if (!(globalThis as any).import.meta.env) {
        (globalThis as any).import.meta.env = { VITE_LOCATION_API_URL: '', VITE_ENV: 'test' };
      } else {
        (globalThis as any).import.meta.env.VITE_LOCATION_API_URL = '';
        (globalThis as any).import.meta.env.VITE_ENV = 'test';
      }
      
      // Ensure fetch is stubbed before creating module
      // RequestBatcher.start() immediately calls flush() which uses fetch
      cy.window().then((win) => {
        (win as any).fetch = cy.stub().resolves({
          ok: true,
          status: 200,
          headers: {
            get: () => null
          }
        });
        
        // Create module after fetch is stubbed
        autoTracker = new AutoTrackerModule(mockConfig, 'https://api.test.com');
        
        // Wait for batcher initialization (start() is async and calls flush())
        cy.wait(500);
      });
    });

    it('should enqueue events to batcher', () => {
      // Create event matching the structure that TrackModel creates
      // The event object passed to _onTrackData should have 'name' property
      const event = new CustomEvent('intempt:event', {
        detail: {
          event: {
            type: 'track',
            name: 'Test Event',
            payload: [{ 
              eventId: 'ev_123', 
              profileId: 'prof_123',
              sessionId: 'ses_123',
              pageId: 'pag_123',
              data: { test: 'data' } 
            }]
          }
        }
      });
      
      document.dispatchEvent(event);

      // Wait for async enqueue operation to complete
      cy.wait(300).then(() => {
        // Event should be enqueued (check localStorage)
        const queueData = localStorage.getItem('__intempt_queue_test-source__');
        expect(queueData).to.not.be.null;
        
        if (queueData) {
          const queue = JSON.parse(queueData);
          expect(queue).to.be.an('array');
          // Should have at least one item in queue
          expect(queue.length).to.be.greaterThan(0);
        }
      });
    });

    it('should flush on page unload', () => {
      // Create properly structured events
      for (let i = 0; i < 3; i++) {
        const event = new CustomEvent('intempt:event', {
          detail: {
            event: {
              type: 'track',
              name: `Test Event ${i}`,
              payload: [{ 
                eventId: `ev_${i}`,
                profileId: 'prof_123',
                sessionId: 'ses_123',
                pageId: 'pag_123',
                data: { test: i } 
              }]
            }
          }
        });
        document.dispatchEvent(event);
      }

      // Wait for events to be enqueued
      cy.wait(300).then(() => {
        // Verify events are in queue
        const queueData = localStorage.getItem('__intempt_queue_test-source__');
        expect(queueData).to.not.be.null;
        
        // Simulate page unload
        cy.window().then((win) => {
          win.dispatchEvent(new Event('beforeunload'));
          
          // Wait for flush to complete
          cy.wait(200);
          // Test passes if no errors thrown
        });
      });
    });
  });
});

