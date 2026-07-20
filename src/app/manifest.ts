import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Finansal Asistan",
    short_name: "Finansal Asistan",
    description:
      "Nakit akışı defteri ve haber tetiklemeli yatırım sinyal motoru.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "tr",
    background_color: "#f6faf8",
    theme_color: "#0e9f6e",
    icons: [
      { src: "/icon1", sizes: "192x192", type: "image/png" },
      { src: "/icon2", sizes: "512x512", type: "image/png" },
      // Separate from the two above (not "any maskable" combined) — those
      // aren't drawn with a safe zone, so letting an OS mask them the same
      // way as this one risks cropping the mark. See IconMark's `maskable`
      // prop.
      { src: "/icon-maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
