import type { Metadata } from 'next';
import Script from 'next/script';

export const metadata: Metadata = {
  title: 'Intempt + Next.js',
  description: 'Installing the Intempt browser SDK in an App Router app',
};

/**
 * The queue stub, byte-for-byte the one in the HTML examples.
 *
 * It is not optional here. `afterInteractive` injects the loader *after*
 * hydration, and the SDK then awaits its guard checks before assigning
 * `window.intempt`. Every button on the page is clickable during that window, so
 * without a stub the first click throws instead of being queued and replayed.
 *
 * `beforeInteractive` is the right strategy for the stub specifically — it has to
 * exist before any handler can fire — while the loader itself stays
 * `afterInteractive`.
 */
const QUEUE_STUB = `(function () {
  if (window.intempt) return;
  var queue = [], pending = [];
  var methods = ['identify','group','track','record','alias','consent','productAdd','productOrdered','productView','logOut','optIn','optOut','isUserOptIn','recommendation'];
  var stub = { _isStub: true, _queue: queue, _pendingPromises: pending };
  methods.forEach(function (m) {
    stub[m] = function () {
      var args = [].slice.call(arguments);
      if (m === 'recommendation') {
        return new Promise(function (resolve, reject) {
          pending.push({ resolve: resolve, reject: reject });
          queue.push({ method: m, args: args });
        });
      }
      queue.push({ method: m, args: args });
    };
  });
  window.intempt = stub;
})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Script id="intempt-stub" strategy="beforeInteractive">
          {QUEUE_STUB}
        </Script>

        {children}

        {/*
          The install, and the whole reason this example exists: a Next app has
          no HTML file to paste the snippet into, so the loader goes in here.

          `afterInteractive` because the SDK captures page views itself and does
          not need to run before hydration. The stub above absorbs anything
          called in the meantime.
        */}
        <Script
          src="https://cdn.intempt.com/v1/intempt.min.js?organization=YOUR_ORG&project=YOUR_PROJECT&source=YOUR_SOURCE_ID&key=YOUR_KEY"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
