import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MQTT Dashboard (Next.js)",
  description: "Simple Next.js + Tailwind MQTT dashboard"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
