import { ImageResponse } from "next/og";
import { IconMark } from "@/lib/app-icon";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<IconMark padding={4} barGap={2.5} />, size);
}
