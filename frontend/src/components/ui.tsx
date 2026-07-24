import { forwardRef } from "react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
} from "react";

/** Small styled primitives so the auth/profile pages stay consistent. */

export function Button({
  className = "",
  loading,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {loading ? "Please wait…" : children}
    </button>
  );
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }
>(function Input({ label, error, id, className = "", ...props }, ref) {
  const inputId = id ?? props.name;
  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block text-sm font-medium">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-error` : undefined}
        className={`w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-white/20 ${className}`}
        {...props}
      />
      {error && (
        <p id={`${inputId}-error`} role="alert" className="text-sm text-red-600">
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
  const selectId = id ?? props.name;
  return (
    <div className="space-y-1">
      <label htmlFor={selectId} className="block text-sm font-medium">
        {label}
      </label>
      <select
        ref={ref}
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${selectId}-error` : undefined}
        className={`w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-white/20 ${className}`}
        {...props}
      >
        {children}
      </select>
      {error && (
        <p id={`${selectId}-error`} role="alert" className="text-sm text-red-600">
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
      className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
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
      className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/40 dark:text-green-300"
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
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = selected.includes(option);
          return (
            <button
              type="button"
              key={option}
              aria-pressed={active}
              onClick={() => onToggle(option)}
              className={`rounded-full border px-3 py-1 text-sm capitalize transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${
                active
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : "border-black/15 hover:border-indigo-400 dark:border-white/20"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </fieldset>
  );
}
