import type { Metadata } from "next";
import "./globals.css";
import { Urbanist } from "next/font/google";
const urbanist = Urbanist({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-urbanist",
  display: "swap",
});
export const metadata: Metadata = {
  title: "Hemline — Every handoff accounted for",
  description: "Synthetic hospital coordination sandbox",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={urbanist.variable}>
      <body>{children}</body>
    </html>
  );
}
