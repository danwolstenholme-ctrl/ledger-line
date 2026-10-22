"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, ChevronDown, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Form primitives.
 *
 * These wrap native elements rather than Radix. A native `<select>` submits
 * with the form, works with a keyboard and screen reader out of the box, and
 * gives mobile users the platform picker — none of which come free from a
 * custom listbox. The styling makes them look like the rest of the product.
 */

const CONTROL_BASE =
  "border-hairline-strong bg-surface text-ink placeholder:text-ink-faint w-full rounded-md border " +
  "px-2.5 text-[12.5px] transition-colors outline-none " +
  "focus-visible:border-ring focus-visible:ring-ring/40 focus-visible:ring-[3px] " +
  "disabled:cursor-not-allowed disabled:opacity-60 " +
  "aria-[invalid=true]:border-critical aria-[invalid=true]:ring-critical/20";

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <label
        htmlFor={htmlFor}
        className="text-ink flex items-baseline gap-1 text-[12px] font-medium"
      >
        {label}
        {required ? (
          <span className="text-critical" aria-hidden>
            *
          </span>
        ) : null}
        {hint ? (
          <span className="text-ink-faint ml-auto pl-2 text-[11px] font-normal">
            {hint}
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p className="text-critical text-[11.5px]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({
  className,
  invalid,
  ...props
}: React.ComponentProps<"input"> & { invalid?: boolean }) {
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL_BASE, "h-8", className)}
    />
  );
}

export function TextArea({
  className,
  invalid,
  ...props
}: React.ComponentProps<"textarea"> & { invalid?: boolean }) {
  return (
    <textarea
      {...props}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL_BASE, "resize-y py-2 leading-relaxed", className)}
    />
  );
}

export function NativeSelect({
  className,
  invalid,
  children,
  ...props
}: React.ComponentProps<"select"> & { invalid?: boolean }) {
  return (
    <div className="relative">
      <select
        {...props}
        aria-invalid={invalid || undefined}
        className={cn(CONTROL_BASE, "h-8 cursor-pointer appearance-none pr-8", className)}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="text-ink-faint pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2"
      />
    </div>
  );
}

export function Checkbox({
  label,
  className,
  ...props
}: React.ComponentProps<"input"> & { label: string }) {
  return (
    <label
      className={cn(
        "text-ink flex cursor-pointer items-center gap-2 text-[12.5px] select-none touch:min-h-10 touch:text-[14px]",
        className,
      )}
    >
      <input
        type="checkbox"
        {...props}
        className="border-hairline-strong text-brand accent-brand focus-visible:ring-ring/40 size-3.5 rounded-sm border focus-visible:ring-[3px] touch:size-5"
      />
      {label}
    </label>
  );
}

/** Top-of-form error. Field-level problems appear beside their field instead. */
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="border-critical-line bg-critical-soft text-critical flex items-start gap-2 rounded-md border px-3 py-2 text-[12.5px]"
    >
      <AlertCircle className="mt-px size-4 shrink-0" />
      {message}
    </p>
  );
}

export function SubmitButton({
  children,
  pendingLabel,
  className,
  variant = "primary",
  size = "default",
  disabled,
}: {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
  variant?: "primary" | "outline";
  size?: "default" | "sm";
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={cn(
        "focus-visible:ring-ring/40 inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium transition-colors outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-60",
        size === "sm" ? "h-7 px-2.5 text-[12px] touch:h-10 touch:px-3 touch:text-[13px]" : "h-8 px-3 text-[12.5px] touch:h-11 touch:px-4 touch:text-[15px]",
        variant === "primary"
          ? "bg-brand hover:bg-brand-dark text-white"
          : "border-hairline-strong text-ink hover:bg-muted border",
        className,
      )}
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
      {pending ? (pendingLabel ?? "Saving") : children}
    </button>
  );
}

/**
 * A button that submits a one-field server action form. Used for the many
 * single-purpose controls (complete a task, pin a note, advance a handover)
 * where a whole form component would be ceremony.
 */
export function InlineSubmit({
  children,
  title,
  className,
  destructive,
}: {
  children: ReactNode;
  title?: string;
  className?: string;
  destructive?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      title={title}
      disabled={pending}
      className={cn(
        "focus-visible:ring-ring/40 inline-flex items-center gap-1 rounded text-[11.5px] transition-colors outline-none focus-visible:ring-[3px] disabled:opacity-50 touch:min-h-10 touch:min-w-10 touch:px-1.5 touch:text-[13px]",
        destructive ? "text-ink-faint hover:text-critical" : "text-ink-faint hover:text-brand",
        className,
      )}
    >
      {children}
    </button>
  );
}
