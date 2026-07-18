import { ImageResponse } from "next/og";
import { IconMark } from "@/lib/app-icon";

// Served at /icon2 — referenced from manifest.ts as the 512x512 PWA icon.
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon512() {
  return new ImageResponse(<IconMark padding={64} barGap={36} />, size);
}
