import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Spadework", template: "%s · Spadework" },
  description:
    "Play spades against simulated opponents and get an honest verdict on every card you play.",
  applicationName: "Spadework",
  appleWebApp: { capable: true, title: "Spadework", statusBarStyle: "black-translucent" },
};

/** Matches the felt, so the phone's status bar does not sit on a pale strip. */
export const viewport: Viewport = {
  themeColor: "#16352a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
