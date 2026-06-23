import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Verofax Finance",
  description: "Verofax internal finance management. Restricted access.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
