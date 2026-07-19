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
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// @serwist/turbopack, not @serwist/next — this project builds with
// Turbopack (Next 16's default bundler), and @serwist/next's service
// worker generation is a webpack plugin that never runs under Turbopack.
export default withNextIntl(withSerwist(nextConfig));
