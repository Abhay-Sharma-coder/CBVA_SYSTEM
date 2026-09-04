import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { NotificationsClient } from "@/app/admin/notifications/notifications-client";
import { auth } from "@/lib/adapters";
import { serverEnv } from "@/lib/config";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const viewer = await auth().currentUser();
  if (!viewer?.isAdmin) notFound();
  const demo = serverEnv().appMode !== "production";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl">Notifications</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          {demo
            ? "Every message the product has produced, rendered exactly as it would have been sent. In demo mode nothing leaves the machine — this is the mailbox."
            : "The outbox. Every message queued, sent or failed, with the delivery attempts behind it."}
        </p>
      </header>
      <NotificationsClient />
    </div>
  );
}
