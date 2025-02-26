# Managing NPM modules

`whtree/package.json` manages the packages available for the whole platform. Non-@webhare packages in the whtree are
not made available to add-on modules (not even webhare_testsuite)

## Embedded JSSDK packages
The packages inside `whtree/jssdk` are made available under the `@webhare` scope for all builtin and addon modules.

A subset of these packages can be published directly to npm (see `publishPackages` in [axioms.yml](../whtree/modules/platform/data/axioms.yml)):

```bash
# test first
wh run mod::platform/scripts/jspackages/validate_jssdk.ts
wh run mod::platform/scripts/jspackages/publish_jsddk.ts -v

# publish alpha version
wh run mod::platform/scripts/jspackages/publish_jsddk.ts --publish-alpha
```
