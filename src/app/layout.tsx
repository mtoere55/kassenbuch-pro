import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./document-preview.css";

export const metadata: Metadata = {
  title: "Kassenbuch Pro",
  description: "Gerätehandel, Kassenbuch, Rechnungen, Kunden, IMEI und Differenzbesteuerung in einer einfachen Oberfläche.",
  applicationName: "Kassenbuch Pro",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f766e",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
