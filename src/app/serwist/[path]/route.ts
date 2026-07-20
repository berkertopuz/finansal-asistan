import path from "node:path";
import { createSerwistRoute } from "@serwist/turbopack";

// Turbopack has no build-time plugin hook (yet), so @serwist/turbopack
// compiles and serves the service worker through this Route Handler
// instead — see next.config.ts. SerwistProvider (root layout) registers it
// at /serwist/sw.js, matching this route's [path] param.
export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: path.join(process.cwd(), "src/app/sw.ts"),
  // /offline isn't part of the normal build asset manifest (it's a page
  // route, not a static asset), but sw.ts's navigation fallback requires it
  // to already be in the precache — so it's added explicitly here. Bump the
  // revision string whenever the offline page's content changes, so the SW
  // knows to re-fetch and re-cache it on the next install.
  additionalPrecacheEntries: [{ url: "/offline", revision: "1" }],
});
