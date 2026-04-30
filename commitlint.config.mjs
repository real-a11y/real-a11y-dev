/**
 * Conventional Commits gate for the commit-msg hook and CI.
 *
 * The repo's existing log already follows the convention
 * (`fix(core):`, `chore(ci):`, `feat(ui+examples):`); this config
 * enforces it for new commits without changing the prevailing style.
 *
 * Run locally:  echo "fix: thing" | pnpm commitlint
 */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Allow scopes joined with `+` (e.g. `feat(ui+examples)`) which the
    // existing log uses but `config-conventional` rejects by default.
    "scope-enum": [0],
    // Body/footer line length is a frequent false-positive on long
    // co-author trailers and URL references — keep the rule but loosen.
    "body-max-line-length": [1, "always", 200],
    "footer-max-line-length": [0],
  },
};
