"use client";

import { forwardRef, useCallback, useEffect, useId, useRef, useState } from "react";
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
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${selectId}-error` : undefined}
          className={`w-full cursor-pointer appearance-none rounded-xl border border-line-input bg-white py-2.5 pl-3.5 pr-10 text-sm shadow-sm outline-none transition hover:border-brand-teal focus:border-brand-coral focus:ring-2 focus:ring-brand-coral/30 ${className}`}
          {...props}
        >
          {children}
        </select>
        <Chevron className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" />
      </div>
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

/** Lucide `chevron-down`, inlined. */
function Chevron({ className = "", open = false }: { className?: string; open?: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={`${className} transition-transform duration-150 ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** Lucide `check`, inlined. */
function Check({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// Shared by Dropdown and MultiSelectDropdown so every filter control on a
// page reads as one family — the same shape as Input/Select above.
const TRIGGER =
  "flex w-full items-center justify-between gap-2 rounded-xl border bg-white py-2.5 pl-3.5 pr-3 text-left text-sm shadow-sm outline-none transition hover:border-brand-teal focus-visible:border-brand-coral focus-visible:ring-2 focus-visible:ring-brand-coral/30";
const PANEL =
  "absolute left-0 z-30 mt-1.5 w-full min-w-[13rem] overflow-hidden rounded-2xl border border-line bg-white p-1.5 shadow-xl shadow-brand-teal/10";
const OPTION =
  "flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition";

/** Close a popover on outside click or Escape. */
function useDismiss(
  open: boolean,
  ref: React.RefObject<HTMLElement | null>,
  close: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ref, close]);
}

export interface DropdownOption {
  value: string;
  label: string;
}

/**
 * A single-choice dropdown drawn in the site's own style (a native <select>'s
 * option list can't be styled). Keyboard: arrows move, Enter picks, Esc
 * closes, and long lists get a search box.
 */
export function Dropdown({
  label,
  value,
  options,
  onChange,
  placeholder = "Select…",
  className = "",
}: {
  label: string;
  value: string;
  options: readonly DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchable = options.length > 8;

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);
  useDismiss(open, ref, close);

  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  const current = options.find((o) => o.value === value);

  const openList = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  const pick = (option: DropdownOption) => {
    onChange(option.value);
    close();
    triggerRef.current?.focus();
  };

  // Keep the highlighted option in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(shown.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[active]) pick(shown[active]);
    } else if (e.key === "Tab") {
      close();
    }
  };

  return (
    <div ref={ref} className={`relative space-y-1 ${className}`} onKeyDown={onKeyDown}>
      <span id={`${id}-label`} className="block text-xs text-text-subtle">
        {label}
      </span>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-controls={open ? `${id}-list` : undefined}
        onClick={() => (open ? close() : openList())}
        className={`${TRIGGER} ${open ? "border-brand-coral ring-2 ring-brand-coral/30" : "border-line-input"}`}
      >
        <span
          id={`${id}-value`}
          className={`truncate ${current ? "font-medium text-foreground" : "text-text-subtle"}`}
        >
          {current?.label ?? placeholder}
        </span>
        <Chevron open={open} className="h-4 w-4 shrink-0 text-text-subtle" />
      </button>
      {open && (
        <div className={PANEL}>
          {searchable && (
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              placeholder={`Search ${label.toLowerCase()}…`}
              aria-label={`Search ${label.toLowerCase()}`}
              aria-controls={`${id}-list`}
              aria-activedescendant={shown[active] ? `${id}-opt-${active}` : undefined}
              className="mb-1.5 w-full rounded-lg border border-line-input bg-background px-3 py-2 text-sm outline-none focus:border-brand-coral"
            />
          )}
          <ul
            ref={listRef}
            id={`${id}-list`}
            role="listbox"
            aria-labelledby={`${id}-label`}
            tabIndex={-1}
            className="max-h-64 overflow-y-auto"
          >
            {shown.length === 0 && (
              <li className="px-3 py-2 text-sm text-text-subtle">No matches</li>
            )}
            {shown.map((option, i) => {
              const selected = option.value === value;
              return (
                <li
                  key={option.value}
                  id={`${id}-opt-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(option)}
                  className={`${OPTION} ${i === active ? "bg-surface-alt" : ""} ${
                    selected ? "font-semibold text-brand-teal" : "text-text-muted"
                  }`}
                >
                  <span className="truncate">{option.label}</span>
                  {selected && <Check className="h-4 w-4 shrink-0 text-brand-coral" />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * A dropdown of checkboxes — for filters with many options (e.g. interests)
 * that would otherwise sprawl across the page. Styled to match Dropdown.
 */
export function MultiSelectDropdown({
  label,
  options,
  selected,
  onToggle,
  onClear,
  emptyLabel = "Any",
}: {
  label: string;
  options: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
  onClear?: () => void;
  emptyLabel?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, ref, close);

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const summary =
    selected.length === 0
      ? emptyLabel
      : selected.length <= 2
        ? selected.map(cap).join(", ")
        : `${cap(selected[0])} +${selected.length - 1} more`;

  return (
    <div ref={ref} className="relative min-w-[170px] space-y-1">
      <span id={`${id}-label`} className="block text-xs text-text-subtle">
        {label}
      </span>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => setOpen((o) => !o)}
        className={`${TRIGGER} ${open ? "border-brand-coral ring-2 ring-brand-coral/30" : "border-line-input"}`}
      >
        <span
          id={`${id}-value`}
          className={`truncate ${selected.length ? "font-medium text-foreground" : "text-text-subtle"}`}
        >
          {summary}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {selected.length > 0 && (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand-teal px-1.5 text-[11px] font-bold text-background">
              {selected.length}
            </span>
          )}
          <Chevron open={open} className="h-4 w-4 text-text-subtle" />
        </span>
      </button>
      {open && (
        <div className={`${PANEL} w-64`}>
          <ul className="max-h-72 overflow-y-auto">
            {options.map((option) => {
              const on = selected.includes(option);
              return (
                <li key={option}>
                  <label
                    className={`${OPTION} justify-start hover:bg-surface-alt ${
                      on ? "font-semibold text-brand-teal" : "text-text-muted"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => onToggle(option)}
                      className="peer sr-only"
                    />
                    <span
                      aria-hidden
                      className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md border transition peer-focus-visible:ring-2 peer-focus-visible:ring-brand-coral/40 ${
                        on
                          ? "border-brand-teal bg-brand-teal text-background"
                          : "border-line-input bg-white"
                      }`}
                    >
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    {cap(option)}
                  </label>
                </li>
              );
            })}
          </ul>
          {onClear && selected.length > 0 && (
            <div className="mt-1 border-t border-line pt-1">
              <button
                type="button"
                onClick={onClear}
                className="w-full rounded-xl px-3 py-2 text-left text-xs font-semibold text-brand-coral-ink hover:bg-brand-coral-tint"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
