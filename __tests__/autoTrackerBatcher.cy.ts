import { AutoTrackerModule } from '../src/intemptJs/modules/autoTracker/autoTracker.module.ts';
import { IntemptConfig } from '../src/intemptJs/types/intemptJs.types.ts';
import { PersistentStore } from '../src/shared/storage/persistentStore.ts';

const QUEUE_KEY = '__intempt_queue_test-source__';

/**
 * Read the queue through the same storage abstraction the SDK uses, rather than
 * reaching into localStorage. These assertions used to hardcode localStorage and
 * broke the moment the IndexedDB tier landed — the behaviour was correct, the
 * test was asserting an implementation detail.
 */
function readQueue(): Promise<any[]> {
  // One record per event under a key prefix, not one array under QUEUE_KEY.
  return new PersistentStore({ dbName: 'intempt_test-source' })
    .entries(`${QUEUE_KEY}:i:`)
    .then(entries => entries.map(e => e.value));
}

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
    
    // EnvConfig is initialized in __tests__/support/index.ts with test values
    // No need to set globalThis.import.meta.env - EnvConfig handles this
    
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
      // EnvConfig is initialized in __tests__/support/index.ts with test values
      // No need to set globalThis.import.meta.env - EnvConfig handles this
      
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
      cy.wait(300)
        .then(() => readQueue())
        .then(queue => {
          expect(queue).to.be.an('array');
          expect(queue.length).to.be.greaterThan(0);
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
      cy.wait(300)
        .then(() => readQueue())
        .then(queue => {
          expect(queue.length).to.be.greaterThan(0);

          // Simulate page unload
          cy.window().then((win) => {
            win.dispatchEvent(new Event('beforeunload'));
            cy.wait(200);
          });
        });
    });
  });
});

