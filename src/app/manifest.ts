import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Sou Coach",
    short_name: "Sou Coach",
    description: "Your English coach who speaks Darija.",
    lang: "en",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fbf5ec",
    theme_color: "#c8553d",
    orientation: "portrait",
    categories: ["education"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcuts: [
      {
        name: "Talk 3 min",
        short_name: "Talk 3 min",
        description: "A quick 3-minute chat with Hossam",
        url: "/session?minutes=3",
        icons: [{ src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "How do I say…?",
        short_name: "How do I say…?",
        description: "Say it in Darija, get natural English back",
        url: "/practice",
        icons: [{ src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Word Garden",
        short_name: "Words",
        description: "Your words and phrases",
        url: "/words",
        icons: [{ src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
