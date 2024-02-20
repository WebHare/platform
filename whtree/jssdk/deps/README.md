# WebHare deps

`@webhare/deps` provides access to a select few WebHare dependencies for your own use. These are modules we hope to be able to ship
for quite some time and offer somewhat stable APIs. We expose most of these module APIs directly through an async interface but refer
you to the modules themselves for further documentation

## Sharp
Usage

```typescript
import { createSharpImage } from "@webhare/deps";
const img = await createSharpImage(data);
```

## Puppeteer
Usage

```typescript
import { launchPuppeteer } from "@webhare/deps";
const puppet = await launchPuppeteer();
const page = await puppet.newPage();

await puppet.close();
```
