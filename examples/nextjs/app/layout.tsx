import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  title: "Intempt + Next.js",
  description: "Installing the Intempt browser SDK in an App Router app",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}

        {/*
          The install, and the whole reason this example exists.

          A Next app has no HTML file to paste the snippet into, so the loader
          goes in as a `next/script` tag. `afterInteractive` is the right
          strategy: the SDK captures page views itself and does not need to run
          before hydration, and `beforeInteractive` would block it.

          The queue stub the HTML examples use is unnecessary here — nothing
          calls `window.intempt` during render, and `sdk()` in
          `app/intempt/analytics.ts` throws a readable error if something does.
        */}
        <Script
          src="https://cdn.intempt.com/v1/intempt.min.js?organization=YOUR_ORG&project=YOUR_PROJECT&source=YOUR_SOURCE_ID&key=YOUR_KEY"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
