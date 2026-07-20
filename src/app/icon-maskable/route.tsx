import { ImageResponse } from "next/og";
import { IconMark } from "@/lib/app-icon";

// A plain Route Handler, not a Next icon.tsx-style special file — the
// favicon <link rel="icon"> generation those files drive has no `purpose`
// concept, and this icon is only ever meant to be linked from manifest.ts's
// icons array with purpose: "maskable", not the browser tab favicon.
// force-static: the image never varies per-request, same as the sibling
// icon.tsx/icon1.tsx/icon2.tsx special files.
export const dynamic = "force-static";

export async function GET() {
  return new ImageResponse(<IconMark padding={100} barGap={24} maskable />, {
    width: 512,
    height: 512,
  });
}
