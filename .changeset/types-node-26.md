---
---

Dev-dependency bump only: `@types/node` 22 → 26. The `cli` daemon's line reader now accepts a `string` chunk as well as a `Buffer`, because the newer typings let a socket `data` event carry either. Runtime behaviour is unchanged (the daemon never calls `setEncoding`), so this releases nowhere.
