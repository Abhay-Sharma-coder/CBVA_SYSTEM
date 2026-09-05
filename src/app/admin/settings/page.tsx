import type { Metadata } from "next";

import { SettingsClient } from "./settings-client";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl">Settings</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          Every open question, as configuration. When CBVA answers one, it is typed in here rather than deployed.
        </p>
      </header>
      <SettingsClient />
    </div>
  );
}
