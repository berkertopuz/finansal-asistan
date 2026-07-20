import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";

// latin-ext, not just latin — ğ/ş/ı/İ (Turkish Latin Extended-A) render in
// a fallback system font without it, and every screen in this app is
// Turkish. Verified both families declare latin-ext support (Google Fonts
// METADATA.pb) before switching from Geist to match the Defter redesign.
const hankenGrotesk = Hanken_Grotesk({
  variable: "--font-hanken-grotesk",
  subsets: ["latin", "latin-ext"],
});

// Used for mono-styled labels (month pills, category tags) in the Defter
// redesign — small, deliberate use, not a general body font.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin", "latin-ext"],
  weight: ["500"],
});

export const metadata: Metadata = {
  title: "Finansal Asistan",
  description:
    "Nakit akışı defteri ve haber tetiklemeli yatırım sinyal motoru.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // No maximumScale cap — that disables pinch-zoom, which fails Lighthouse
  // accessibility and actively hurts low-vision users. The touch-target
  // sizing (CLAUDE.md rule 4) is what actually needs to hold up, not a
  // zoom lock.
  // Lets content flow into the safe-area insets so .safe-area-* padding works.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6faf8" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1326" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      className={`${hankenGrotesk.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
