import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "USDC Checkout",
  description: "USDC checkout for a Next.js site: Solana Pay and an EVM wallet, verified server-side with no database. Test networks only.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@400..700&family=Newsreader:opsz,wght@6..72,300..600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
