import { ImageResponse } from "next/og";
import { IconMark } from "@/lib/app-icon";

// Served at /icon1 — referenced from manifest.ts as the 192x192 PWA icon.
export const size = { width: 192, height: 192 };
export const contentType = "image/png";

export default function Icon192() {
  return new ImageResponse(<IconMark padding={24} barGap={14} />, size);
}
