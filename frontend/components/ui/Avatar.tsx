"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";

const SIZES = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-[11px]",
  md: "h-10 w-10 text-[13px]",
  lg: "h-14 w-14 text-lg",
  xl: "h-20 w-20 text-2xl",
};

/**
 * Avatar.
 *
 * The image URL points at Google's lh3 host for public Drive files. That host
 * occasionally rate-limits or 404s a freshly uploaded file for a few seconds,
 * so a failed load falls back to initials rather than a broken-image icon —
 * an employee list full of grey squares looks like the product is broken.
 */
export function Avatar({
  src,
  name,
  size = "md",
  className,
  ring,
}: {
  src?: string | null;
  name?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
  ring?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = src && !failed;

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full",
        "bg-brand-100 font-semibold text-brand-700 select-none",
        ring && "ring-2 ring-[var(--surface)]",
        SIZES[size],
        className
      )}
      title={name || undefined}
    >
      {showImage ? (
        // A plain <img>: next/image would need every tenant's Drive host in the
        // config, and these are already served from a CDN with size hints.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name || "Avatar"}
          className="h-full w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden>{initials(name)}</span>
      )}
    </span>
  );
}

/** Overlapping avatars, for team lists and approver chains. */
export function AvatarGroup({
  people,
  max = 4,
  size = "sm",
}: {
  people: Array<{ name: string; avatarUrl?: string | null }>;
  max?: number;
  size?: keyof typeof SIZES;
}) {
  const shown = people.slice(0, max);
  const overflow = people.length - shown.length;

  return (
    <div className="flex -space-x-2">
      {shown.map((person, index) => (
        <Avatar key={index} src={person.avatarUrl} name={person.name} size={size} ring />
      ))}
      {overflow > 0 && (
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-full bg-[var(--surface-sunken)] font-semibold text-[var(--text-muted)] ring-2 ring-[var(--surface)]",
            SIZES[size]
          )}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

/** Name + code + avatar, the standard way a person appears in a table row. */
export function PersonCell({
  name,
  code,
  avatarUrl,
  subtitle,
  size = "sm",
}: {
  name: string;
  code?: string;
  avatarUrl?: string | null;
  subtitle?: string;
  size?: keyof typeof SIZES;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar src={avatarUrl} name={name} size={size} />
      <div className="min-w-0">
        <p className="truncate text-[13.5px] font-medium text-[var(--text)]">{name}</p>
        {(code || subtitle) && (
          <p className="truncate text-[12px] text-[var(--text-muted)]">
            {code}
            {code && subtitle && " · "}
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
