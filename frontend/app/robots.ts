import type { MetadataRoute } from "next";

const BASE = (process.env.NEXT_PUBLIC_SITE_URL || "https://chefotech.com").replace(/\/$/, "");

/**
 * Crawling rules.
 *
 * The authenticated areas are disallowed. This is not a security control —
 * they are already behind authentication, and a robots file is a request
 * rather than a barrier — but it keeps customer workspace URLs out of search
 * results, and stops a crawler from burning rate limit on pages that will only
 * ever redirect it to a sign-in screen.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/app/",
          "/me/",
          "/platform/",
          "/onboarding",
          "/accept-invitation",
          "/reset-password",
          "/forgot-password",
          "/api/",
        ],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
