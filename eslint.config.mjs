import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

/**
 * THE CLOCK RULE, enforced.
 *
 * Business logic must never read the system clock directly — it takes a Clock
 * (src/lib/clock.ts) and asks for now(). That is what lets the demo shift time
 * and have the REAL auto-release job run the REAL rule. A stray `new Date()`
 * silently opts a code path out of that, so it is an error, not a warning.
 */
const noSystemClock = [
  {
    selector: 'NewExpression[callee.name="Date"][arguments.length=0]',
    message:
      "Never call new Date() in business logic. Take a Clock from src/lib/clock.ts and call clock.now() — this is what makes the demo prove production behaviour.",
  },
  {
    selector:
      'CallExpression[callee.object.name="Date"][callee.property.name="now"]',
    message:
      "Never call Date.now() in business logic. Take a Clock from src/lib/clock.ts and call clock.now().getTime().",
  },
];

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "drizzle/**",
      "assets/**",
      "tools/**",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.ts", "tests/**/*.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...noSystemClock],
      // Leading underscore means "deliberately unused" — the production stubs
      // and demo no-ops must keep their signatures to satisfy the interface.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // The sanctioned exceptions. clock.ts IS the system clock; the seed and the
    // tests are outside business logic and need real wall time to build from.
    files: [
      "src/lib/clock.ts",
      "scripts/**/*.ts",
      "tests/**/*.ts",
      "e2e/**/*.ts",
    ],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    files: ["tests/**/*.ts", "e2e/**/*.ts", "scripts/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
];

export default eslintConfig;
