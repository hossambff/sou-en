import type { Metadata, Viewport } from "next";
import { Fraunces, Readex_Pro } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/pwa/sw-register";
import "./globals.css";

const readex = Readex_Pro({ variable: "--font-readex", subsets: ["latin", "arabic"] });
const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"], axes: ["SOFT", "opsz"] });

// iPhone launch screens for the installed app (iOS shows a blank white screen without them, harsh at a 3 am feed).
// [CSS width, CSS height, pixel ratio]: SE, X/mini, 12–14, 15/16, 16 Pro, 13 Pro Max/14 Plus, 15/16 Plus & Pro Max, 16 Pro Max.
const LAUNCH_SCREENS = [
  [375, 667, 2],
  [375, 812, 3],
  [390, 844, 3],
  [393, 852, 3],
  [402, 874, 3],
  [428, 926, 3],
  [430, 932, 3],
  [440, 956, 3],
] as const;

export const metadata: Metadata = {
  title: "Sou Coach",
  description: "Your English coach who speaks Darija.",
  appleWebApp: {
    capable: true,
    title: "Sou Coach",
    // Status bar above the page, not over it: "black-translucent" would put a white clock on the cream background
    statusBarStyle: "default",
    startupImage: LAUNCH_SCREENS.flatMap(([width, height, ratio]) =>
      (["light", "dark"] as const).map((scheme) => ({
        url: `/pwa/splash/splash-${width * ratio}x${height * ratio}-${scheme}.png`,
        media: `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait) and (prefers-color-scheme: ${scheme})`,
      })),
    ),
  },
  // iOS would turn digits (scores, times, dates) into tappable phone/calendar links
  formatDetection: { telephone: false, date: false, address: false, email: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf5ec" },
    { media: "(prefers-color-scheme: dark)", color: "#15100d" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${readex.variable} ${fraunces.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
