// Validate a documented example against a tool's real JSON Schema.
//
// ajv rather than a hand-rolled walk: the schemas come out of zod and use
// `additionalProperties: false`, `enum`, `minimum`/`maximum`, nested objects
// and arrays, and getting any of that subtly wrong produces a CI failure
// nobody can act on. It was already in the lockfile as a transitive dependency,
// so making it direct costs a line, not a download.

import Ajv from "ajv";

/**
 * `strict: false` because these schemas are emitted by a generator, not written
 * for ajv: they carry `$schema` and `format: "uri"` and other annotations that
 * ajv's strict mode objects to on principle. Refusing to validate a real
 * schema over a style complaint would just mean no check at all.
 *
 * `validateFormats: false` for the same reason in the other direction — a doc
 * example is allowed to say `https://example.com/…`, and failing it for not
 * being a resolvable URI would be a false alarm about a deliberate placeholder.
 */
const ajv = new Ajv({
  strict: false,
  allErrors: true,
  validateFormats: false,
  useDefaults: false,
});

const compiled = new WeakMap();

/**
 * @returns human-readable problems, empty when the example is valid.
 *
 * ajv's own messages are terse and schema-relative ("must NOT have additional
 * properties"); these name the property, because the reader of the failure is
 * fixing a markdown file and needs to know which word to change.
 */
export function validateAgainstSchema(schema, value) {
  let validate = compiled.get(schema);
  if (!validate) {
    validate = ajv.compile(schema);
    compiled.set(schema, validate);
  }
  if (validate(value)) return [];

  return (validate.errors ?? []).map((err) => {
    const at = err.instancePath ? `\`${err.instancePath.slice(1)}\`` : "";
    switch (err.keyword) {
      case "additionalProperties":
        return `passes \`${err.params.additionalProperty}\`, which the tool does not accept`;
      case "required":
        return `omits the required \`${err.params.missingProperty}\``;
      case "enum":
        return `${at} must be one of: ${err.params.allowedValues.join(", ")}`;
      case "type":
        return `${at} must be ${err.params.type}`;
      default:
        return `${at} ${err.message}`.trim();
    }
  });
}
