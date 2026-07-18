import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Flat-config setup for the real-a11y monorepo.
 *
 * Layered, in order:
 *   1. Ignores
 *   2. JS recommended
 *   3. typescript-eslint recommended (non-type-checked — full type-check
 *      requires a tsconfig project per package and slows things down)
 *   4. Browser globals for src/, Node globals for scripts/
 *   5. import-order rules
 *   6. jsx-a11y on .tsx/.jsx
 *   7. Test file relaxations (Vitest fixtures often include broken markup)
 *   8. eslint-config-prettier LAST — disables formatting rules that fight
 *      Prettier
 */
export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.vitepress/cache/**",
      "**/.vitepress/dist/**",
      "**/coverage/**",
      "**/test-results/**",
      "**/playwright-report/**",
      "**/*.spec.ts-snapshots/**",
      "pnpm-lock.yaml",
      // Lint website TS source (tests/scripts) but skip generated
      // VitePress chrome and the Vue/MD content.
      "website/.vitepress/**",
      "examples/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Browser globals for runtime source.
  {
    files: ["packages/**/src/**/*.{ts,tsx,js,jsx}"],
    languageOptions: {
      globals: { ...globals.browser, chrome: "readonly" },
    },
  },

  // Node globals for build/CI scripts.
  {
    files: ["**/scripts/**/*.{mjs,js}", "**/*.config.{ts,js,mjs,cjs}"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Repo-wide rules.
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    plugins: { import: importPlugin },
    rules: {
      // Error, not warn: a warning never fails CI, so import-order drift
      // accumulated silently until someone ran `eslint --fix` by hand. As an
      // error the `lint` gate blocks it, and it's 100% autofixable
      // (`pnpm lint:fix`), so this costs contributors nothing.
      "import/order": [
        "error",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
          ],
          "newlines-between": "always-and-inside-groups",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      // typescript-eslint already covers no-unused-vars; the JS rule
      // duplicates and double-reports.
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // The codebase uses `any` in a few well-justified places (chrome
      // message payloads, third-party shapes). Warn, don't fail the build.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },

  // JSX a11y — Preact and React components alike.
  {
    files: ["**/*.{tsx,jsx}"],
    plugins: { "jsx-a11y": jsxA11y },
    rules: {
      ...jsxA11y.configs.recommended.rules,
      // Tree rows / listbox options manage keyboard nav at the container
      // level (the listbox/tree itself owns `onKeyDown` and arrow-key
      // selection). The rule expects per-element key handlers, which would
      // double-fire and break ARIA's container-driven model. The actual
      // a11y is correct — we keep these off intentionally on this codebase.
      "jsx-a11y/click-events-have-key-events": "off",
      "jsx-a11y/interactive-supports-focus": "off",
      "jsx-a11y/no-static-element-interactions": "off",
    },
  },

  // Test files: looser rules — Vitest fixtures intentionally include
  // broken markup, ad-hoc `any`, and unused locals from destructuring.
  {
    files: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },

  prettier,
];
