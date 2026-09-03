import type { Metadata, Viewport } from "next";
import { fontVariables } from "@/lib/fonts";
import { Providers } from "@/components/providers";
import { Header } from "@/components/app-shell/header";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Workspace — CBV & Associates LLP",
    template: "%s — CBVA Workspace",
  },
  description:
    "Seat and meeting room booking for CBV & Associates LLP, and the occupancy analytics behind it.",
};

export const viewport: Viewport = {
  themeColor: "#FBFAF7",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN" className={fontVariables}>
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="sr-only rounded-sm bg-navy px-3 py-2 text-sm text-paper focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
        >
          Skip to Content
        </a>
        <Providers>
          <Header />
          <main id="main" className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
            {children}
          </main>
          <footer className="mx-auto max-w-[1400px] px-4 pt-4 pb-10 sm:px-6">
            <p className="border-t border-hairline pt-4 text-xs text-ink-subtle">
              CBV&nbsp;&amp; Associates LLP · Floor 4, Mumbai · Phase 1 foundation
              build
            </p>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
