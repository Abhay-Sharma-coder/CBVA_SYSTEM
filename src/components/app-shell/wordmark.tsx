import { cn } from "@/lib/utils";

/**
 * The CBVA wordmark. Serif, letter-spaced, to echo the engraved letterhead.
 * `translate="no"` because it is a firm name, not copy to be machine translated.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-baseline gap-2", className)} translate="no">
      <span className="font-title text-[17px] leading-none font-semibold tracking-[0.14em] text-navy">
        CBV&nbsp;&amp;&nbsp;ASSOCIATES
      </span>
      {/* The suffix is the first thing to go on a phone — the header has to
          leave room for the role switcher without the page overflowing. */}
      <span
        aria-hidden="true"
        className="hidden h-3.5 w-px shrink-0 self-center bg-hairline sm:block"
      />
      <span className="hidden text-[11px] leading-none font-medium tracking-[0.18em] text-ink-subtle uppercase sm:inline">
        Workspace
      </span>
    </span>
  );
}
