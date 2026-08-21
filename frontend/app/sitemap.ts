import type { MetadataRoute } from "next";
import { LEGAL_DOCUMENTS } from "@/content/legal";
import { DOC_ARTICLES } from "@/content/docs";

/**
 * The sitemap is derived from the same content that renders the pages, so it
 * cannot list a document that does not exist or miss one that does.
 *
 * Only public pages belong here. Everything under /app, /me and /platform is
 * behind authentication and is excluded in robots.txt as well — listing them
 * would advertise the shape of the application to anyone scanning.
 */

const BASE = (process.env.NEXT_PUBLIC_SITE_URL || "https://chefotech.com").replace(/\/$/, "");

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  const marketing = [
    { path: "", priority: 1.0, changeFrequency: "weekly" as const },
    { path: "/features", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/pricing", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/security", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/support", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/docs", priority: 0.8, changeFrequency: "weekly" as const },
    { path: "/about", priority: 0.5, changeFrequency: "yearly" as const },
    { path: "/contact", priority: 0.6, changeFrequency: "yearly" as const },
    { path: "/status", priority: 0.3, changeFrequency: "daily" as const },
    { path: "/legal", priority: 0.4, changeFrequency: "yearly" as const },
    { path: "/register", priority: 0.8, changeFrequency: "yearly" as const },
    { path: "/login", priority: 0.5, changeFrequency: "yearly" as const },
  ];

  return [
    ...marketing.map((entry) => ({
      url: `${BASE}${entry.path}`,
      lastModified,
      changeFrequency: entry.changeFrequency,
      priority: entry.priority,
    })),
    ...DOC_ARTICLES.map((article) => ({
      url: `${BASE}/docs/${article.slug}`,
      lastModified,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    ...LEGAL_DOCUMENTS.map((doc) => ({
      url: `${BASE}/legal/${doc.slug}`,
      lastModified: new Date(doc.updated),
      changeFrequency: "yearly" as const,
      priority: 0.4,
    })),
  ];
}
