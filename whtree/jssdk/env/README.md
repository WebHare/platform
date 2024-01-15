# WebHare environment

`@webhare/env` provides access to basic WebHare configuration and debugflags. It is separated to allow use in code shared between frontend and backend

You would generally import this package this way:

```javascript
import { debugFlags, isLive, dtapStage } from "@webhare/env";
```
