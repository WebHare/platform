# WebHare eslint settings
Use this package if you want to match or base yourself on WebHare Platform's linting settings. Prepend the array of flat configs exported by this package in your own eslint.config.mjs.

Example:
```typescript
import defaultSettings from "@webhare/eslint-config";

export default = [
    ...defaultSettings, {
        rules: {
            ...
        }
    }
];
```

The following exports are provided:
- webHareConfig: the configuration used for WebHare itself
- moduleConfig: the configuration used for modules (relaxes some rules)
- default: the configuration used for modules
