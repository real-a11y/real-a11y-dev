// What can go wrong with a scenario suite, mechanically.
//
// The audit that started this project found a scenario naming a `get_native_tree`
// tool that never existed. Nothing caught it because nothing could: the row was
// in Notion and the tool list was in TypeScript. With both in the repo and
// speaking one vocabulary of manifest paths, that class of rot becomes a build
// failure.
//
// What is checkable and what isn't stays deliberately separated. Whether a
// scenario's Steps still describe a sensible test is editorial and stays human.
// Whether it names a tool that exists, whether a shipped command has any
// scenario at all, whether a deprecated row kept its reason — all mechanical.

import { byId } from "./load.mjs";
import { covers, coverageTargets, manifestPaths } from "./paths.mjs";

const BODY_SECTIONS = ["## Steps", "## Expected", "## Why this exists"];

/**
 * @param {object[]} scenarios from {@link loadScenarios}
 * @param {object} manifest
 * @returns {{where: string, message: string}[]}
 */
export function checkScenarios(scenarios, manifest) {
  const problems = [];
  const fail = (where, message) => problems.push({ where, message });
  const valid = manifestPaths(manifest);

  // ---- ids are unique -------------------------------------------------------
  const seen = new Map();
  for (const s of scenarios) {
    const first = seen.get(s.id);
    if (first) {
      fail(s.file, `reuses id ${s.id}, already claimed by ${first}`);
    } else {
      seen.set(s.id, s.file);
    }
  }

  // ---- every ACTIVE row's `covers` path exists -----------------------------
  //
  // The `get_native_tree` case. A path that looks plausible and isn't real makes
  // a scenario appear to cover something nobody tests.
  //
  // Deprecated rows are exempt, and must be: §4b says that when a PR removes a
  // surface you keep the row, set Status: Deprecated and a `validUntil` — so a
  // retired row's `covers` paths are EXPECTED to have left the manifest. That is
  // the whole reason it was retired. Enforcing existence here deadlocked the
  // documented flow: the PR that deletes a command could not pass the gate except
  // by stripping the `covers:` block, which destroys the link this migration
  // exists to create and is documented nowhere.
  //
  // The coverage check below relies on retired rows keeping those paths, too —
  // it looks them up by `covers` to say "only R7 names this, and it's Deprecated".
  for (const s of scenarios) {
    if (s.status !== "Active") continue;
    for (const path of s.covers ?? []) {
      if (!valid.has(path)) {
        fail(
          s.file,
          `covers \`${path}\`, which the manifest has no such thing — a renamed ` +
            `or removed surface, or a typo. Run \`pnpm surface:plan\` to see what moved.` +
            ` If the surface is genuinely gone, this row should be Deprecated with a` +
            ` \`validUntil\` rather than edited to point somewhere else.`,
        );
      }
    }
  }

  // ---- a deprecated row must not be the only thing covering live surface ----
  const active = scenarios.filter((s) => s.status === "Active");
  for (const target of coverageTargets(manifest)) {
    const covering = active.filter((s) => covers(s.covers ?? [], target.path));
    if (covering.length === 0) {
      const deprecated = scenarios.filter(
        (s) => s.status === "Deprecated" && covers(s.covers ?? [], target.path),
      );
      fail(
        "scenarios/",
        `${target.label} ships with no Active scenario covering it` +
          (deprecated.length
            ? ` — only ${deprecated.map((s) => s.id).join(", ")}, which ${deprecated.length === 1 ? "is" : "are"} Deprecated`
            : ""),
      );
    }
  }

  // ---- twins point at each other -------------------------------------------
  //
  // A one-way twin is worse than none: `plan` would report the pair when the
  // regression side changes and stay silent when the dogfood side does.
  const byIdMap = new Map(scenarios.map((s) => [s.id, s]));
  for (const s of scenarios) {
    for (const twinId of s.twin ?? []) {
      const other = byIdMap.get(twinId);
      if (!other) {
        fail(s.file, `\`twin: ${twinId}\` names a scenario that doesn't exist`);
        continue;
      }
      if (other.suite === s.suite) {
        fail(
          s.file,
          `\`twin: ${twinId}\` is in the same suite — a twin is the same subject at ` +
            `the other altitude (pre-publish ↔ post-publish)`,
        );
      }
      if (!(other.twin ?? []).includes(s.id)) {
        const listed = (other.twin ?? []).join(", ") || "(nothing)";
        fail(
          s.file,
          `\`twin: ${twinId}\` is not reciprocated — ${twinId} lists ${listed}. ` +
            `A one-way twin reports the pair when this side changes and stays ` +
            `silent when the other does.`,
        );
      }
    }
  }

  // ---- the body says what a runner needs -----------------------------------
  for (const s of scenarios) {
    const missing = BODY_SECTIONS.filter((h) => !s.body.includes(h));
    if (missing.length) {
      fail(s.file, `body is missing ${missing.join(", ")}`);
    }
  }

  // ---- `validFrom` names a package ----------------------------------------
  //
  // §4b: "packages version independently here, so a bare version number is
  // ambiguous". A range nobody can resolve to a package is unusable at run time.
  for (const s of scenarios) {
    const from = String(s.validFrom ?? "");
    const namesPackage =
      /\b(cli|mcp|core|serialize|audit|snapshot|browser|validate|testing|react|inspector|storybook-addon|semantic-navigator-ui|extension)\b/.test(
        from,
      ) || /every (published )?(package|release)/i.test(from);
    if (!namesPackage) {
      fail(
        s.file,
        `\`validFrom\` doesn't name a package: "${from}". Packages version ` +
          `independently, so a bare number can't be resolved at run time.`,
      );
    }
  }

  return problems.sort(
    (a, b) =>
      a.where.localeCompare(b.where) || a.message.localeCompare(b.message),
  );
}

/** Human-readable coverage, for the report rather than the gate. */
export function coverageSummary(scenarios, manifest) {
  const active = scenarios.filter((s) => s.status === "Active");
  const rows = coverageTargets(manifest).map((target) => ({
    ...target,
    by: active
      .filter((s) => covers(s.covers ?? [], target.path))
      .sort(byId)
      .map((s) => s.id),
  }));
  return {
    rows,
    covered: rows.filter((r) => r.by.length > 0).length,
    total: rows.length,
  };
}
