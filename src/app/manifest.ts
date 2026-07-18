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
    background_color: "#f8fafc",
    theme_color: "#0f766e",
    icons: [
      { src: "/icon1", sizes: "192x192", type: "image/png" },
      { src: "/icon2", sizes: "512x512", type: "image/png" },
    ],
  };
}
