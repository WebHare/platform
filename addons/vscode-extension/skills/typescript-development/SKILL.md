---
name: typescript-development
description: Writing code for .ts files, both for server and website frontend, for WebHare platform and modules.
---

# General guidelines
- Use native fetch() always
- A 'module' is a WebHare extension. The root of the module folder structure contains moduledefinition.xml and/or moduledefinition.yml
- Registrykeys are found in moduledefinition.xml, in the `<moduleregistry>` in a tree like structure. Eg for module `example` you would see `<node name="ext"><node name="deeper"><string name="deepest">` declaring
  the registry key `example:ext.deeper.deepest`. Use `readRegistryKey` from `@webhare/services` to read registry keys

# Tasks and command line scripts
When creating a TS for a command line script (usually in the `scripts/whcommands` folder of a modue but they can be anywhere) or a task (usually in `scripts/tasks` or deeper) use the [CLI example](assets/cli-example.ts) as a starting point.

The flags, options and arguments passed to run() serve as an example. Update as needed for the script

The actual code goes into the main property/function. should return '0' on success and non-zero (between 1 and 255) on failure.

The most minimal example of how to set up a command line application in WebHare is

```typescript
import { run } from "@webhare/cli";

run({
  async main() {

  }
});
```
