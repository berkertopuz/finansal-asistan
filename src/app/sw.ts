/// <reference lib="webworker" />
import { defaultCache } from "@serwist/turbopack/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkFirst, Serwist } from "serwist";

const OFFLINE_URL = "/offline";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// "Offline defter": defaultCache already NetworkFirst-caches every
// same-origin GET /api/* route (10s timeout → falls back to the last
// cached response) — that alone covers /api/entries, /api/positions,
// /api/recommendations and /api/market-status. The one addition here is a
// longer offline window specifically for the ledger, since "can I see what
// I already logged" matters more offline than the other tabs.
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname === "/api/entries",
      method: "GET",
      handler: new NetworkFirst({
        cacheName: "ledger-entries",
        networkTimeoutSeconds: 10,
      }),
    },
    ...defaultCache,
  ],
  // Shown instead of a raw network-error page when a document (full page)
  // navigation fails with no connectivity and nothing else in the cache
  // matches it. Requires OFFLINE_URL to already be precached — see
  // additionalPrecacheEntries in src/app/serwist/[path]/route.ts.
  fallbacks: {
    entries: [
      {
        url: OFFLINE_URL,
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();

// Kart ekstre/ödeme günü hatırlatmaları (supabase/functions/send-card-reminders) —
// Serwist'in kendi listener'larından bağımsız, ayrı bir event türü olduğu
// için çakışmaz. Payload her zaman {title, body} şeklinde düz JSON (bkz.
// send-card-reminders/index.ts), başka bir şema yok.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  const { title, body } = event.data.json() as { title: string; body: string };
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon1",
      badge: "/icon1",
    }),
  );
});

// Bildirime tıklayınca uygulamayı odaklar, açık bir sekme yoksa yeni bir
// tane açar.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = clientsList.find((c) => "focus" in c);
      if (existing) {
        await (existing as WindowClient).focus();
        return;
      }
      await self.clients.openWindow("/defter/giderler/kartlar");
    })(),
  );
});
