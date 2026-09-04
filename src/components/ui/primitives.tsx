"use client";

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------- Card */

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-md border border-hairline bg-surface", className)}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("border-b border-hairline px-5 py-4", className)}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("text-sm font-semibold tracking-tight text-ink", className)}
      {...props}
    />
  );
}

export function CardBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

/* ------------------------------------------------------------------ Badge */

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] font-medium leading-4",
  {
    variants: {
      variant: {
        neutral: "border-hairline bg-surface-sunken text-ink-muted",
        navy: "border-navy/25 bg-navy-tint text-navy",
        positive: "border-positive/30 bg-positive/8 text-positive",
        caution: "border-caution/30 bg-caution/8 text-caution",
        danger: "border-danger/30 bg-danger/8 text-danger",
        /** Accent. One per screen, on the single most important number. */
        gold: "border-gold bg-transparent text-caution",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/* ------------------------------------------------------------ Label/Input */

export const Label = React.forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      "text-xs font-medium text-ink-muted select-none",
      "peer-disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Label.displayName = "Label";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type = "text", ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      "h-9 w-full rounded-sm border border-hairline bg-surface px-3 text-sm text-ink",
      "placeholder:text-ink-subtle",
      "focus-visible:border-navy focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy",
      "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:opacity-60",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

/* ------------------------------------------------------------------- Tabs */

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn("flex items-center gap-6 border-b border-hairline", className)}
    {...props}
  />
));
TabsList.displayName = "TabsList";

/** The active tab is marked by a 2px gold underline — one of gold's three jobs. */
export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "-mb-px border-b-2 border-transparent pb-2.5 text-sm text-ink-muted transition-colors",
      "hover:text-ink",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy",
      "data-[state=active]:border-gold data-[state=active]:font-medium data-[state=active]:text-ink",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = TabsPrimitive.Content;

/* ----------------------------------------------------------------- Dialog */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export function DialogContent({
  className,
  children,
  title,
  description,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  title: string;
  description?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/25" />
      <DialogPrimitive.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2",
          "overscroll-contain rounded-md border border-hairline bg-surface",
          className,
        )}
        {...props}
      >
        <div className="border-b border-hairline px-5 py-4">
          <DialogPrimitive.Title className="font-title text-lg text-ink">
            {title}
          </DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="mt-1 text-sm text-ink-muted">
              {description}
            </DialogPrimitive.Description>
          ) : (
            <DialogPrimitive.Description className="sr-only">
              {title}
            </DialogPrimitive.Description>
          )}
        </div>
        <div className="px-5 py-4">{children}</div>
        <DialogPrimitive.Close
          aria-label="Close dialog"
          className="absolute top-4 right-4 rounded-sm p-1 text-ink-subtle hover:bg-surface-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
        >
          <X className="size-4" aria-hidden="true" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/* ------------------------------------------------------------------ Table */

export function Table({
  className,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table
        className={cn("w-full border-collapse text-sm", className)}
        {...props}
      />
    </div>
  );
}

export function Th({
  className,
  numeric,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-hairline px-3 py-2 text-left text-[11px] font-semibold tracking-wide text-ink-muted uppercase",
        numeric && "numeric text-right",
        className,
      )}
      {...props}
    />
  );
}

export function Td({
  className,
  numeric,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        "border-b border-hairline px-3 py-2 align-middle text-ink",
        numeric && "numeric text-right",
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------- Empty state */

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-dashed border-hairline px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {children ? (
        <p className="mx-auto mt-1 max-w-prose text-sm text-ink-muted">{children}</p>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- Textarea */

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, rows = 3, ...props }, ref) => (
  <textarea
    ref={ref}
    rows={rows}
    className={cn(
      "w-full rounded-sm border border-hairline bg-surface px-3 py-2 text-sm text-ink",
      "placeholder:text-ink-subtle",
      "focus-visible:border-navy focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy",
      "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:opacity-60",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

/* ----------------------------------------------------------------- Select */

/**
 * A native select, styled.
 *
 * `@radix-ui/react-select` is installed, but the native control is better here:
 * it is keyboard- and screen-reader-correct with no work, it uses the platform
 * picker on a phone, and this product has no requirement a native select cannot
 * meet. The role switcher and the list-view filters already use one.
 */
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "h-9 w-full rounded-sm border border-hairline bg-surface px-2 text-sm text-ink",
      "focus-visible:border-navy focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy",
      "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:opacity-60",
      className,
    )}
    {...props}
  />
));
Select.displayName = "Select";

/* ---------------------------------------------------------------- Field */

/** A label bound to one control, with optional help and error text beneath. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error ? <p className="text-xs text-ink-subtle">{hint}</p> : null}
      {error ? (
        <p className="text-xs text-danger" id={`${htmlFor}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------- StatusMessage */

/**
 * The one way this product reports the outcome of a write.
 *
 * Deliberately inline and in flow rather than a toast. A toast that says
 * "somebody just took that desk" can be missed, and the recovery — the map has
 * been refreshed, pick another — needs to be read next to the thing it is about.
 * `role="status"` for good news and `role="alert"` for a refusal, so a screen
 * reader interrupts only when it should.
 */
export function StatusMessage({
  tone,
  children,
  className,
}: {
  tone: "positive" | "danger" | "caution" | "neutral";
  children: React.ReactNode;
  className?: string;
}) {
  const styles: Record<string, string> = {
    positive: "border-positive/30 bg-positive/8 text-positive",
    danger: "border-danger/30 bg-danger/8 text-danger",
    caution: "border-caution/30 bg-caution/8 text-caution",
    neutral: "border-hairline bg-surface-sunken text-ink-muted",
  };
  return (
    <p
      role={tone === "danger" ? "alert" : "status"}
      aria-live={tone === "danger" ? "assertive" : "polite"}
      className={cn(
        "rounded-sm border px-3 py-2 text-sm",
        styles[tone],
        className,
      )}
    >
      {children}
    </p>
  );
}
