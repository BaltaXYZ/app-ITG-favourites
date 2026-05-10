import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ITG Favourites",
  description: "Bygg timerstyrda danspass för dansmatta."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sv">
      <body>{children}</body>
    </html>
  );
}
