# WebHare eslint settings
Use this package if you want to match or base yourself on WebHare Platform's linting settings. Prepend the array of flat configs exported by this package in your own eslint.config.mjs.

Example:
```typescript
import { relaxedConfig } from "@webhare/eslint-config";

export default = [
    ...relaxedConfig, {
        rules: {
            ...
        }
    }
];
```

The following exports are provided:
- strictConfig: the configuration used for WebHare itself
- relaxedConfig: the configuration used for modules (relaxes some rules)
