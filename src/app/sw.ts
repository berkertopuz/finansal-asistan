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
