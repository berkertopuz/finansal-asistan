import path from "node:path";
import { createSerwistRoute } from "@serwist/turbopack";

// Turbopack has no build-time plugin hook (yet), so @serwist/turbopack
// compiles and serves the service worker through this Route Handler
// instead — see next.config.ts. SerwistProvider (root layout) registers it
// at /serwist/sw.js, matching this route's [path] param.
export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: path.join(process.cwd(), "src/app/sw.ts"),
});
