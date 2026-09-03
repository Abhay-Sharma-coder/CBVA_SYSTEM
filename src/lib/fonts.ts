import { Inter, JetBrains_Mono, Source_Serif_4 } from "next/font/google";

/** Page titles only — echoes the engraved CBVA wordmark. */
export const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-source-serif",
  weight: ["400", "600"],
});

/** Everything else. */
export const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

/** Seat codes, bay labels, floor plan annotations. Nothing else. */
export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
  weight: ["400", "500"],
});

export const fontVariables = [
  inter.variable,
  sourceSerif.variable,
  jetbrainsMono.variable,
].join(" ");
