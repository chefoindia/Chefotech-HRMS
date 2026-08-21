import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));


/** @type {import('next').NextConfig} */
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001";

const nextConfig = {
  reactStrictMode: true,

  /**
   * Pin the workspace root. Without this Next walks up looking for a lockfile,
   * finds the one in the user's home directory, and decides the project root is
   * that directory - then watches the entire tree for changes. Every save and
   * every cold compile pays for it.
   */
  turbopack: { root: PROJECT_ROOT },
  outputFileTracingRoot: PROJECT_ROOT,


  experimental: {
    /**
     * `lucide-react`, `recharts` and `date-fns` are barrel packages: importing
     * one icon pulls the index module, which re-exports thousands of separate
     * files, and the bundler then has to resolve every one of them. Left
     * alone this dominates both cold-start compile time in development and the
     * shipped bundle. Rewriting each import to its own deep path removes the
     * barrel from the graph entirely.
     */
    optimizePackageImports: ["lucide-react", "recharts", "date-fns", "@tanstack/react-query"],
  },

  /**
   * Route bundles are held in memory during development so that going back to
   * a page you have already visited does not recompile it. The default keeps
   * far fewer pages than an HR product has sections, so moving between
   * Attendance, Leave and Payroll evicts and rebuilds each one in turn.
   */
  onDemandEntries: {
    maxInactiveAge: 60 * 60 * 1000,
    pagesBufferLength: 32,
  },

  // Source maps in development cost real compile time and are rebuilt on every
  // edit; the browser devtools still map stack traces without them.
  productionBrowserSourceMaps: false,

  images: {
    // Branding assets and avatars are stored in Google Drive and rendered
    // through Google's lh3 host, which serves the raw bytes with permissive
    // CORS and honours a size hint (=w400). drive.google.com/uc answers an
    // <img> request with an HTML consent page instead, which is why that host
    // is not used for rendering.
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com", pathname: "/d/**" },
      { protocol: "https", hostname: "drive.google.com", pathname: "/thumbnail**" },
      // Images are served from Cloudinary, which does the resizing and format
      // negotiation itself — Next's optimizer would only re-do that work.
      { protocol: "https", hostname: "res.cloudinary.com", pathname: "/**" },
    ],
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(self), payment=()",
          },
        ],
      },
    ];
  },

  env: {
    NEXT_PUBLIC_API_URL: API_URL,
  },
};

export default nextConfig;
