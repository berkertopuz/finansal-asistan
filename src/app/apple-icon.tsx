import { ImageResponse } from "next/og";
import { IconMark } from "@/lib/app-icon";

// iOS home-screen icon. Apple ignores manifest icons, so this file
// convention is the only way to control the "Add to Home Screen" artwork.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<IconMark padding={22} barGap={13} />, size);
}
