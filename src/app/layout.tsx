import type { Metadata, Viewport } from "next";
import { Fraunces, Readex_Pro } from "next/font/google";
import "./globals.css";

const readex = Readex_Pro({ variable: "--font-readex", subsets: ["latin", "arabic"] });
const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"], axes: ["SOFT", "opsz"] });

export const metadata: Metadata = {
  title: "Sou Coach",
  description: "Your English coach who speaks Darija.",
  appleWebApp: { capable: true, title: "Sou Coach", statusBarStyle: "default" },
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
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
