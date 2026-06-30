/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  // Register the custom matchers + snapshot serializer once for every test.
  setupFilesAfterEnv: ["<rootDir>/src/setup.ts"],
};
