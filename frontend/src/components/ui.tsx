"use client";

import { forwardRef, useEffect, useId, useRef, useState } from "react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
} from "react";

/** Small styled primitives so the auth/profile pages stay consistent. */

const BUTTON_VARIANTS = {
  /** Default: the teal primary. */
  teal: "bg-brand-teal text-background hover:brightness-90 focus-visible:outline-brand-teal",
  /** Coral CTA — marketing and connect actions. */
  coral: "bg-brand-coral text-white hover:brightness-95 focus-visible:outline-brand-coral",
} as const;

export function Button({
  className = "",
  variant = "teal",
  loading,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  variant?: keyof typeof BUTTON_VARIANTS;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex w-full items-center justify-center rounded-full px-5 py-2.5 text-sm font-bold shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${BUTTON_VARIANTS[variant]} ${className}`}
    >
      {loading ? "Please wait…" : children}
    </button>
  );
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }
>(function Input({ label, error, id, className = "", ...props }, ref) {
  // Fall back to a generated id: without one, `htmlFor` and `id` are both
  // undefined and the label is decorative — the control reaches a screen
  // reader unnamed. Callers that pass `id` or `name` keep those.
  const generated = useId();
  const inputId = id ?? props.name ?? generated;
  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block text-xs text-text-subtle">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-error` : undefined}
        className={`w-full rounded-xl border border-line-input bg-white px-3.5 py-2.5 text-sm shadow-sm outline-none transition focus:border-brand-coral focus:ring-2 focus:ring-brand-coral/30 ${className}`}
        {...props}
      />
      {error && (
        <p id={`${inputId}-error`} role="alert" className="text-sm text-[#8c2f1d]">
          {error}
        </p>
      )}
    </div>
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string }
>(function Select({ label, error, id, className = "", children, ...props }, ref) {
  // See Input: a Select rendered without `id` or `name` (as the discovery
  // filters were) otherwise ends up with an unassociated label.
  const generated = useId();
  const selectId = id ?? props.name ?? generated;
  return (
    <div className="space-y-1">
      <label htmlFor={selectId} className="block text-xs text-text-subtle">
        {label}
      </label>
      <select
        ref={ref}
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${selectId}-error` : undefined}
        className={`w-full rounded-xl border border-line-input bg-white px-3.5 py-2.5 text-sm shadow-sm outline-none transition focus:border-brand-coral focus:ring-2 focus:ring-brand-coral/30 ${className}`}
        {...props}
      >
        {children}
      </select>
      {error && (
        <p id={`${selectId}-error`} role="alert" className="text-sm text-[#8c2f1d]">
          {error}
        </p>
      )}
    </div>
  );
});

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-xl bg-[#fbeae6] px-3 py-2 text-sm text-[#8c2f1d]"
    >
      {message}
    </p>
  );
}

export function FormSuccess({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p
      role="status"
      className="rounded-xl bg-[#e8efe8] px-3 py-2 text-sm text-[#1f5240]"
    >
      {message}
    </p>
  );
}

export function TagPicker({
  legend,
  options,
  selected,
  onToggle,
  error,
}: {
  legend: string;
  options: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
  error?: string;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs text-text-subtle">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = selected.includes(option);
          return (
            <button
              type="button"
              key={option}
              aria-pressed={active}
              onClick={() => onToggle(option)}
              className={`rounded-full border px-3 py-1 text-sm capitalize transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal ${
                active
                  ? "border-brand-teal bg-brand-teal text-white"
                  : "border-line-input text-text-muted hover:border-brand-teal"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-sm text-[#8c2f1d]">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/**
 * A dropdown button that opens a panel of checkboxes — for filters with many
 * options (e.g. interests) that would otherwise sprawl across the page.
 */
export function MultiSelectDropdown({
  label,
  options,
  selected,
  onToggle,
  onClear,
}: {
  label: string;
  options: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
  onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative min-w-[170px]">
      <span className="text-xs text-text-subtle">{label}</span>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="mt-1 flex w-full items-center justify-between gap-2 rounded-lg border border-line-input bg-white px-3 py-2 text-sm text-text-muted hover:border-brand-teal focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-teal"
      >
        <span className="truncate">
          {selected.length === 0 ? "Any interest" : `${selected.length} selected`}
        </span>
        <span aria-hidden className="text-[10px]">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 max-h-72 w-60 overflow-y-auto rounded-xl border border-line bg-white p-2 shadow-lg">
          <ul>
            {options.map((option) => (
              <li key={option}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm capitalize hover:bg-surface-alt">
                  <input
                    type="checkbox"
                    checked={selected.includes(option)}
                    onChange={() => onToggle(option)}
                    className="h-4 w-4 accent-brand-teal"
                  />
                  {option}
                </label>
              </li>
            ))}
          </ul>
          {onClear && selected.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-brand-coral-ink hover:bg-brand-coral-tint"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
