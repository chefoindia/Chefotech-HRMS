"use client";

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { AlertCircle, Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Form primitives.
 *
 * Every field renders its own label, hint and error, wired together with
 * aria-describedby and aria-invalid. Getting that right once here is why the
 * rest of the app can put a field on screen in one line and still be usable
 * with a screen reader.
 */

export interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
  /**
   * Rendered immediately after the label text — in practice the `<FieldHelp>`
   * info icon. A separate slot rather than widening `label` to ReactNode,
   * because `Switch` also feeds `label` straight into `aria-label`, which
   * must stay a plain string for screen readers.
   */
  labelSuffix?: ReactNode;
}

export function Field({ label, hint, error, required, children, className, htmlFor, labelSuffix }: FieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--text)]"
        >
          <span>
            {label}
            {required && <span className="ml-0.5 text-[var(--danger)]">*</span>}
          </span>
          {labelSuffix}
        </label>
      )}
      {children}
      {error ? (
        <p className="flex items-start gap-1.5 text-[12.5px] text-[var(--danger)]">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p className="text-[12.5px] text-[var(--text-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}

// `prefix` is also a global HTML attribute typed as a string, so it has to be
// omitted before being redeclared as a node.
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "prefix"> {
  label?: string;
  hint?: string;
  error?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  containerClassName?: string;
  labelSuffix?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, required, prefix, suffix, className, containerClassName, id, labelSuffix, ...props },
  ref
) {
  const generatedId = useId();
  const inputId = id || generatedId;

  const input = (
    <input
      ref={ref}
      id={inputId}
      aria-invalid={error ? "true" : undefined}
      aria-describedby={error || hint ? `${inputId}-help` : undefined}
      className={cn("input-base", prefix && "pl-9", suffix && "pr-9", className)}
      {...props}
    />
  );

  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      required={required}
      htmlFor={inputId}
      className={containerClassName}
      labelSuffix={labelSuffix}
    >
      {prefix || suffix ? (
        <div className="relative">
          {prefix && (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]">
              {prefix}
            </span>
          )}
          {input}
          {suffix && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]">
              {suffix}
            </span>
          )}
        </div>
      ) : (
        input
      )}
    </Field>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  labelSuffix?: ReactNode;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, required, className, id, rows = 3, labelSuffix, ...props },
  ref
) {
  const generatedId = useId();
  const textareaId = id || generatedId;

  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={textareaId} labelSuffix={labelSuffix}>
      <textarea
        ref={ref}
        id={textareaId}
        rows={rows}
        aria-invalid={error ? "true" : undefined}
        className={cn("input-base resize-y leading-relaxed", className)}
        {...props}
      />
    </Field>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
  options?: Array<{ value: string | number; label: string; disabled?: boolean }>;
  placeholder?: string;
  labelSuffix?: ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, required, options, placeholder, className, id, children, labelSuffix, ...props },
  ref
) {
  const generatedId = useId();
  const selectId = id || generatedId;

  return (
    <Field label={label} hint={hint} error={error} required={required} htmlFor={selectId} labelSuffix={labelSuffix}>
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          aria-invalid={error ? "true" : undefined}
          className={cn("input-base cursor-pointer appearance-none pr-9", className)}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options?.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-subtle)]"
          aria-hidden
        />
      </div>
    </Field>
  );
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: ReactNode;
  hint?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, hint, className, id, ...props },
  ref
) {
  const generatedId = useId();
  const checkboxId = id || generatedId;

  return (
    <div className="flex items-start gap-2.5">
      <div className="relative flex h-5 items-center">
        <input
          ref={ref}
          id={checkboxId}
          type="checkbox"
          className={cn(
            "peer h-4 w-4 shrink-0 cursor-pointer appearance-none rounded border border-[var(--border-strong)]",
            "bg-[var(--surface)] transition-colors",
            "checked:border-brand-600 checked:bg-brand-600",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
          {...props}
        />
        <Check
          className="pointer-events-none absolute left-0 top-0.5 h-4 w-4 text-white opacity-0 peer-checked:opacity-100"
          strokeWidth={3}
          aria-hidden
        />
      </div>
      {(label || hint) && (
        <div className="min-w-0">
          {label && (
            <label htmlFor={checkboxId} className="cursor-pointer text-sm text-[var(--text)]">
              {label}
            </label>
          )}
          {hint && <p className="text-[12.5px] text-[var(--text-muted)]">{hint}</p>}
        </div>
      )}
    </div>
  );
});

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  hint?: string;
  disabled?: boolean;
  id?: string;
  "data-tour"?: string;
  labelSuffix?: ReactNode;
}

export function Switch({ checked, onChange, label, hint, disabled, id, labelSuffix, ...props }: SwitchProps) {
  const generatedId = useId();
  const switchId = id || generatedId;

  return (
    <div className="flex items-start justify-between gap-4">
      {(label || hint) && (
        <div className="min-w-0">
          {label && (
            <label htmlFor={switchId} className="flex items-center gap-1.5 text-sm font-medium text-[var(--text)]">
              <span>{label}</span>
              {labelSuffix}
            </label>
          )}
          {hint && <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">{hint}</p>}
        </div>
      )}
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200",
          checked ? "bg-brand-600" : "bg-[var(--border-strong)]",
          disabled && "cursor-not-allowed opacity-50"
        )}
        {...props}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200",
            // Tailwind's default scale has no "5.5" step (it jumps 3.5 -> 4 -> 5 ->
            // 6...), so `translate-x-5.5` was silently not a real utility — the
            // thumb never actually moved and rendered outside the track instead.
            // An arbitrary-value class always compiles to real CSS regardless of
            // the theme scale. Track is 44px wide, thumb is 20px: 2px inset when
            // off, 44 - 20 - 2 = 22px inset when on.
            checked ? "translate-x-[22px]" : "translate-x-[2px]"
          )}
        />
      </button>
    </div>
  );
}

/** A labelled group of related fields inside a form. */
export function FieldSet({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cn("space-y-4", className)}>
      <div>
        <legend className="text-sm font-semibold text-[var(--text)]">{title}</legend>
        {description && (
          <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">{description}</p>
        )}
      </div>
      {children}
    </fieldset>
  );
}

/** Responsive two/three-column field grid. */
export function FieldGrid({
  columns = 2,
  children,
  className,
}: {
  columns?: 1 | 2 | 3;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-4",
        columns === 1 && "grid-cols-1",
        columns === 2 && "grid-cols-1 sm:grid-cols-2",
        columns === 3 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
        className
      )}
    >
      {children}
    </div>
  );
}
