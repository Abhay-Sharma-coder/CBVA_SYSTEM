"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A boolean toggle, as a real `role="switch"` button.
 *
 * Not a Radix component and not a styled checkbox: this needs to be operable
 * from the keyboard, announce its state, and be legible in greyscale — and the
 * last one is what rules out the usual pill-with-a-dot, whose only cue is
 * colour. The knob POSITION is the primary cue here and the fill is secondary,
 * which is the same rule every seat status follows.
 *
 * The track is navy when on rather than gold. Gold has three sanctioned uses
 * and "every toggle in the admin area" is not one of them.
 */
export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  /** Required: a switch with no accessible name is a mystery box. */
  label: string;
  /** Hides the visible label when the surrounding row already carries one. */
  hideLabel?: boolean;
  description?: string;
  id?: string;
  className?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
  hideLabel,
  description,
  id,
  className,
}: SwitchProps) {
  const generated = React.useId();
  const switchId = id ?? generated;
  const descId = description ? `${switchId}-description` : undefined;

  return (
    <div className={cn("flex items-start gap-3", className)}>
      <button
        type="button"
        role="switch"
        id={switchId}
        aria-checked={checked}
        aria-label={hideLabel ? label : undefined}
        aria-describedby={descId}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-sm border transition-colors",
          checked ? "border-navy bg-navy" : "border-ink-subtle bg-surface-sunken",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "block size-3.5 rounded-sm transition-transform",
            checked ? "translate-x-[18px] bg-paper" : "translate-x-[2px] bg-ink-subtle",
          )}
        />
      </button>

      {!hideLabel ? (
        <div className="min-w-0">
          <label
            htmlFor={switchId}
            className={cn("block text-sm text-ink", disabled && "opacity-60")}
          >
            {label}
          </label>
          {description ? (
            <p id={descId} className="mt-0.5 text-xs text-ink-muted">
              {description}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
