import { cn } from "@/lib/utils";

/**
 * The CBVA wordmark. Phase 8 / A2: the client's own full lockup, as a real
 * image — the navy-and-gold logo the app's brand tokens were eyedropped from
 * in the first place, mark + "CBV" + "& ASSOCIATES LLP" together, in the
 * header at every screen width, not only on the signed-out home page.
 *
 * The image carries the whole firm name, so it gets a real `alt`; "Workspace"
 * is the app name, so it stays adjacent text, not baked into the picture. Net
 * accessible name: "CBV & Associates LLP, Workspace" — nothing doubled,
 * nothing silently dropped. `translate="no"` because it is a firm name, not
 * copy to be machine translated. Explicit width/height on the image is what
 * keeps this at zero layout shift.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-baseline gap-2", className)} translate="no">
      {/* eslint-disable-next-line @next/next/no-img-element -- a small,
          static brand asset; next/image's runtime optimiser buys nothing
          here and this is the one place `sizes`/`srcSet` machinery would be
          pure overhead. */}
      <img
        src="/brand/cbva-logo@2x.png"
        alt="CBV & Associates LLP"
        width={900}
        height={404}
        className="h-11 w-auto self-center"
      />
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
