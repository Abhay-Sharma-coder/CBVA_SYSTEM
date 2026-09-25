import { notFound } from "next/navigation";

import { auth } from "@/lib/adapters";
import { AdminNav } from "./admin-nav";

export const dynamic = "force-dynamic";

/**
 * THE ADMIN GATE, in one place.
 *
 * Until Phase 5 every admin page carried its own `if (!viewer?.isAdmin)
 * notFound()` — except `/admin` itself, which carried none at all, so anybody
 * who knew the URL saw the admin index. Harmless while it was a list of links;
 * not harmless now that it leads to the seat inventory, the staff roster and
 * every occupancy figure the firm has.
 *
 * A layout is the right place because it cannot be forgotten when somebody adds
 * the next screen — which is exactly how the hole appeared the first time.
 *
 * `notFound()` rather than a 403: an admin area whose existence is confirmed to
 * a non-admin is an invitation. The nav item is hidden from them too, but that
 * is a courtesy, not a permission check.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const viewer = await auth().currentUser();
  if (!viewer?.isAdmin) notFound();

  return (
    <div className="space-y-6">
      <AdminNav />
      {children}
    </div>
  );
}
