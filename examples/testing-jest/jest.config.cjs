/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  // Register the custom matchers + snapshot serializer once for every test.
  setupFilesAfterEnv: ["<rootDir>/src/setup.ts"],
  // After each run, a11y-snapshots/index.html draws every boxedTreeSnapshot
  // and a11yDiff snapshot as the Semantic Navigator panel does. "default"
  // stays first: listing any reporter replaces Jest's own output.
  reporters: ["default", "@real-a11y-dev/testing/reporter/jest"],
};
