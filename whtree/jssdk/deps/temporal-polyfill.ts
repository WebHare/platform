/** Import this library in frontend apps to actually get Temporal

```typescript
import "@webhare/deps/temporal-polyfill";
```
*/

import "temporal-polyfill/global";

/* Note that we auto-inject the Temporal types using tsconfig.json (so VSCode sees them) and we actually preload it using the whnode-preload so anything run in the backend has it */
