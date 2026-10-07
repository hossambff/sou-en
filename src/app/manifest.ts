import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sou Coach",
    short_name: "Sou Coach",
    description: "Your English coach who speaks Darija.",
    start_url: "/",
    display: "standalone",
    background_color: "#fbf5ec",
    theme_color: "#c8553d",
    orientation: "portrait",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
