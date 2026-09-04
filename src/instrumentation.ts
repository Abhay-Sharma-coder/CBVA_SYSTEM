/**
 * Next calls this once per server process.
 *
 * The Node-only work lives in a separate module, imported dynamically inside
 * the `NEXT_RUNTIME` check, because this file is compiled for the EDGE runtime
 * as well — and anything reaching `pg` from an edge bundle fails to resolve
 * `fs` and takes the whole dev server down with it. Next only tree-shakes the
 * edge bundle when the import sits directly inside this exact guard, so the
 * shape here is load-bearing rather than stylistic.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
