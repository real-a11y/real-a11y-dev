---
"@real-a11y-dev/core": patch
---

Stop `ElementRefMap` from retaining an entry per element it has ever seen. The `WeakRef` always let the element itself be collected, but the surrounding `Map` entry was only cleared by a `get` for that exact id — and the ids of removed elements are the ones nobody looks up again, so on a long-lived SPA tab the map grew for the life of the page. `set` now sweeps collected entries once the map outgrows twice its live size, which keeps the cost amortized constant. Lookups are unaffected: `get` already reported a collected element as `undefined`.
