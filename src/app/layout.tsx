import type { Metadata, Viewport } from "next";
import { PwaRegistration } from "./PwaRegistration";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "ITG Favourites",
  metadataBase: new URL("https://app-itg-favourites.vercel.app"),
  title: "ITG Favourites",
  description: "Bygg timerstyrda danspass för dansmatta.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ITG Favourites"
  },
  icons: {
    icon: [
      { url: "/app-icon.svg", type: "image/svg+xml" },
      { url: "/app-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/app-icon-512.png", sizes: "512x512", type: "image/png" }
    ],
    shortcut: [{ url: "/app-icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/app-icon-192.png", sizes: "192x192", type: "image/png" }]
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#070b17"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sv">
      <body>
        <PwaRegistration />
        {children}
      </body>
    </html>
  );
}
