import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { RouteProgress } from "@/components/shell/RouteProgress";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "Chefotech HRMS — HR, attendance, leave and payroll in one place",
    template: "%s · Chefotech HRMS",
  },
  description:
    "Chefotech HRMS is a multi-tenant HR platform for employee records, attendance, leave, payroll and compliance. Configure your own policies without writing code.",
  applicationName: "Chefotech HRMS",
  authors: [{ name: "Chefotech" }],
  keywords: ["HRMS", "HR software", "attendance", "payroll", "leave management", "biometric"],
  openGraph: {
    title: "Chefotech HRMS",
    description:
      "Manage employees, attendance, leave and payroll from one intelligent platform.",
    type: "website",
    siteName: "Chefotech HRMS",
    // Without an image, a link shared into Slack or WhatsApp renders as a bare
    // grey card — which is the first impression for most people who are sent
    // one by a colleague.
    images: [{ url: "/brand/chefotech-logo.png", width: 326, height: 311, alt: "Chefotech" }],
  },
  twitter: {
    card: "summary",
    title: "Chefotech HRMS",
    description:
      "Manage employees, attendance, leave and payroll from one intelligent platform.",
    images: ["/brand/chefotech-logo.png"],
  },
  icons: {
    icon: "/brand/chefotech-logo.png",
    apple: "/brand/chefotech-logo.png",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#4f46e5",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        {/* Keyboard users should not have to tab through the whole sidebar. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        <Providers>
          {/* Reads searchParams, so it must not block the tree from rendering. */}
          <Suspense fallback={null}>
            <RouteProgress />
          </Suspense>
          {children}
        </Providers>
      </body>
    </html>
  );
}
