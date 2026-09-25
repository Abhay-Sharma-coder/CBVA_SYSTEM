"use client";

import * as React from "react";

import { StatusMessage } from "@/components/ui/primitives";

/**
 * An error boundary around ONE widget, never around a route.
 *
 * There is deliberately no `error.tsx` anywhere in this app — ADR-032 took that
 * position in Phase 4 for the 3D view and it holds harder on an analytics
 * screen. A route-level error page replaces the entire screen when what has
 * actually failed is one card, and a partner looking at a blank page cannot
 * tell whether the product is broken or the floor is empty. Nine widgets and
 * one bad query should be eight good widgets and one apology.
 *
 * The message names the widget, because "something went wrong" on a screen with
 * nine panels is not information.
 */
interface Props {
  /** Named in the fallback, so the reader knows which panel failed. */
  title: string;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class WidgetBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Kept: a widget that fails silently in front of a client is worse than one
    // that fails loudly in a console somebody can read afterwards.
    console.error(`[widget] ${this.props.title} failed to render`, error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <StatusMessage tone="caution">
          <span className="font-medium">{this.props.title}</span> could not be drawn.
          The rest of this page is unaffected — reload to try again.
        </StatusMessage>
      );
    }
    return this.props.children;
  }
}
