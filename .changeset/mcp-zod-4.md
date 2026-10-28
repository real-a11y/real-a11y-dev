---
"@real-a11y-dev/mcp": patch
---

Upgrade the `zod` dependency to 4.x. Tool validation and results are unchanged — unknown arguments are still dropped (`list_sessions` still rejects them) — but zod 4 generates the advertised JSON Schema differently: the tool `inputSchema`s no longer carry `additionalProperties: false`, integer bounds such as `nth` gain an explicit `maximum`, and the repeated checkpoint-label schema is inlined instead of `$ref`'d.
