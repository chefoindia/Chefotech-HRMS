import Image from "next/image";
import { COMPANY } from "@/content/company";

/**
 * The Chefotech mark and wordmark.
 *
 * This is the PRODUCT's identity, not a tenant's. The distinction matters in a
 * white-label multi-tenant product: inside a customer's workspace the sidebar
 * shows *their* logo, and this mark appears only where the reader is dealing
 * with Chefotech itself — the marketing site, the sign-in screen, the platform
 * console, and the "Powered by Chefotech" line. Putting it in the tenant shell
 * would overwrite the branding a customer just paid to configure.
 *
 * Sized with explicit width/height so the layout never shifts while it loads,
 * and marked priority where it sits above the fold, because the header logo is
 * the first thing that renders on the marketing site.
 */

const SIZES = {
  sm: { box: 24, text: "text-[14px]" },
  md: { box: 32, text: "text-[15px]" },
  lg: { box: 40, text: "text-[17px]" },
  xl: { box: 56, text: "text-[20px]" },
} as const;

export type LogoSize = keyof typeof SIZES;

export function LogoMark({
  size = "md",
  className = "",
  priority = false,
}: {
  size?: LogoSize;
  className?: string;
  priority?: boolean;
}) {
  const { box } = SIZES[size];
  return (
    <Image
      src="/brand/chefotech-logo.png"
      alt=""
      width={box}
      height={box}
      priority={priority}
      // The mark is decorative whenever it sits beside the wordmark; the
      // accessible name comes from the text next to it, and a screen reader
      // announcing "Chefotech Chefotech HRMS" is noise.
      aria-hidden
      className={`shrink-0 object-contain ${className}`}
      style={{ width: box, height: box }}
    />
  );
}

export function Logo({
  size = "md",
  showWordmark = true,
  priority = false,
  className = "",
}: {
  size?: LogoSize;
  showWordmark?: boolean;
  priority?: boolean;
  className?: string;
}) {
  const { text } = SIZES[size];

  if (!showWordmark) {
    return (
      <Image
        src="/brand/chefotech-logo.png"
        alt={COMPANY.name}
        width={SIZES[size].box}
        height={SIZES[size].box}
        priority={priority}
        className={`shrink-0 object-contain ${className}`}
        style={{ width: SIZES[size].box, height: SIZES[size].box }}
      />
    );
  }

  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <LogoMark size={size} priority={priority} />
      <span className={`font-semibold tracking-tight text-[var(--text)] ${text}`}>
        {COMPANY.name} <span className="font-normal text-[var(--text-muted)]">HRMS</span>
      </span>
    </span>
  );
}

/**
 * The attribution line. Appears in tenant workspaces too, where the customer's
 * own logo is the primary mark — so it stays small and stays honest about
 * whose product this is.
 */
export function PoweredBy({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <LogoMark size="sm" className="!h-4 !w-4" />
      <span>Powered by {COMPANY.name}</span>
    </span>
  );
}
