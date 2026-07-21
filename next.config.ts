import path from "node:path";
import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  turbopack: {
    // A stray package-lock.json in a parent directory (outside this repo)
    // makes Turbopack misdetect the workspace root — pin it explicitly.
    root: path.join(__dirname),
  },
  experimental: {
    // Every (app) route is dynamic (reads cookies for auth), so it defaults
    // to staleTimes.dynamic=0 — the client discards its cached copy of a
    // segment instantly, so switching between the 5 tabs re-fetches and
    // re-renders the shared (app) layout from the server on every single
    // tap, even seconds apart. 30s lets the client reuse a segment it
    // already rendered for a short window instead. This only shortens how
    // long the CLIENT trusts output it already received over a real
    // request — src/proxy.ts still re-validates the session on every actual
    // request to the server, so CLAUDE.md rule 3 (no financial data without
    // a valid session) is unaffected.
    staleTimes: {
      dynamic: 30,
    },
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// @serwist/turbopack, not @serwist/next — this project builds with
// Turbopack (Next 16's default bundler), and @serwist/next's service
// worker generation is a webpack plugin that never runs under Turbopack.
export default withNextIntl(withSerwist(nextConfig));
