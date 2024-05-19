import { getCookie, localIntemptPageSessionCookie, setCookie } from '../src/shared/storageHandler.ts';
import { dispatchIntemptEvent, generateId } from '../src/shared/shared.utils.ts';
import { PageTrackerModule } from '../src/intemptJs/modules/autoTracker/modules/pagesTracker/pagesTracker.module.ts';

describe('PageTrackerModule', () => {
  let pageTracker: any;
  const mockCookie = JSON.stringify({ id: 'test-id', startTime: 1234567890, current_page: 'test-current-page', previous_page: 'test-previous-page' });
  const newPageSession = {
    id: 'new-id',
    startTime: new Date().getTime(),
    current_page: window.location.href,
    previous_page: '',
  };

  beforeEach(() => {
   cy.stub(window, 'addEventListener').as('addEventListener');

   // cy.stub(dispatchIntemptEvent).as('dispatchIntemptEvent');
    //cy.stub(getCookie)
   // cy.stub(mockCookie, getCookie).callsFake(() => mockCookie);


    //cy.stub(setCookie);
    //
    //
    // cy.stub(localIntemptPageSessionCookie).callsFake(() => null);
    //
    //

    //
    //
    // cy.stub(generateId).callsFake(() => 'generated-id');

    // Mock window.location.href using a getter
    // Object.defineProperty(window, 'location', {
    //   value: {
    //     href: 'http://example.com'
    //   },
    //   writable: true
    // });

    // Initialize the class
    pageTracker = new PageTrackerModule() ;
    pageTracker.init();
  });


  it('should add event listeners on init', () => {
    expect(window.addEventListener).to.be.calledWith('load');
    expect(window.addEventListener).to.be.calledWith('popstate');
    expect(window.addEventListener).to.be.calledWith('beforeunload');
  });

  it('should retrieve page session start time from cookie', () => {
    const startTime = pageTracker.getPageSessionStartTime();
    expect(startTime).to.not.be.null;
    expect(startTime).to.not.be.undefined;
    expect(startTime).to.be.a('number').and.to.be.above(0);
  });

  it('should retrieve previous page from cookie', () => {
    const previousPage = pageTracker.getPreviousPage();
    expect(previousPage).to.not.be.null;
    expect(previousPage).to.not.be.undefined;
    expect(previousPage).to.be.empty
  });

  // it('should handle missing cookie and set a new page session', () => {
  //   cy.stub(window, 'getCookie').returns(null);
  //   pageTracker.getId();
  //   expect(setCookie).to.be.calledWith({
  //     name: 'page_session',
  //     value: JSON.stringify(newPageSession),
  //     path: '/',
  //   });
  // });

  // it('should correctly set and retrieve the page session ID', () => {
  //   const pageId = pageTracker.getId();
  //   expect(pageId).to.not.be.null;
  //   expect(pageId).to.not.be.undefined;
  //   expect(pageId).to.be.a('string')
  //   expect(pageId).to.not.be.empty;
  // });


  // it('should start tracking on load event', () => {
  //   cy.window().then((win) => {
  //
  //     //cy.stub(window, 'dispatchIntemptEvent').as('dispatchIntemptEvent');
  //
  //     window.dispatchEvent(new Event('load'));
  //
  //     expect(dispatchIntemptEvent).to.be.calledWith('intempt:page', {
  //       eventName: 'View Page',
  //       fullUrl: window.location.href,
  //       title: document.title,
  //       windowWidth: window.innerWidth,
  //       pageId: 'test-id',
  //       previousPage: 'test-previous-page',
  //     });
  //   });
  // });
  //
  // it('should end tracking on beforeunload event', () => {
  //   cy.window().then((win) => {
  //     win.dispatchEvent(new Event('beforeunload'));
  //     expect(dispatchIntemptEvent).to.be.calledWith('intempt:page', {
  //       eventName: 'Leave Page',
  //       fullUrl: window.location.href,
  //       title: document.title,
  //       windowWidth: window.innerWidth,
  //       pageId: 'test-id',
  //       duration: Cypress.sinon.match.number,
  //       previousPage: 'test-previous-page',
  //     });
  //   });
  // });


  //
  // it('should handle errors in getId', () => {
  //   getCookie.returns('invalid-json');
  //   cy.stub(console, 'error').as('consoleError');
  //   const pageId = pageTracker.getId();
  //   expect(console.error).to.be.called;
  //   expect(pageId).to.equal('');
  // });
});
