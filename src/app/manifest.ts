import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kassenbuch Pro",
    short_name: "Kassenbuch Pro",
    description: "Gerätehandel, Belege, Kunden, IMEI und Kassenbuch in einer einfachen Oberfläche.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f6f8",
    theme_color: "#0f766e",
    lang: "de",
  };
}
