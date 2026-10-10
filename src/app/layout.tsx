import type { Metadata } from "next";
import { Dela_Gothic_One, Sora } from "next/font/google";
import "./globals.css";

// Dela Gothic One : logo et grands titres d'impact uniquement. Sora : tout le
// reste. Les deux sont exposées en variables CSS, lues dans globals.css.
const delaGothic = Dela_Gothic_One({
  weight: "400",
  variable: "--font-dela-gothic",
  subsets: ["latin"],
});

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Admin — Vynl",
  description: "Vynl back-office.",
  // Back-office interne : jamais indexé.
  robots: { index: false, follow: false },
};

// Coquille minimale : la navigation vit dans (admin)/layout.tsx, propre aux
// pages réservées aux admins. /login reste volontairement sans chrome partagé.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${delaGothic.variable} ${sora.variable}`}>
      <body>{children}</body>
    </html>
  );
}
