The WebHare JS SDK is a 'flat' TypeScript API for use by external modules.

Import layout:

`@webhare/<package>' - this is the recommended public interface. a 'barrel file' mostly exporting subdependencies. We try to keep the API stable at this level and avoid breaking changes without at minimum setting up JSDOC @deprecation notices. We avoid side effects as much as possible and design the subpackages so treeshaking will work to eliminate sub imports

`@webhare/<package>/styling/xxx.(s)css` - CSS subpackages. These are not exported by the toplevel package as you wouldn't be able to avoid/overwrite them.

`@webhare/<package>/<feature>` - if it's impossible to eliminate side effects of an import through tree shaking, we may split off a separate subpackage. `@webhare/deps/temporal-polyfill` is the prime example of this as a polyfill by nature has unavoidable side effects.

Any other JS import should be considerd an unstable/internal API. This includes
- `@webhare/hscompat/src/...` - avoid individual hscompat subpackages
- `dompack/...` - use `@webhare/deps/dompack` instead which is a cleaned up version
- `@mod-<any core module>/...` - these are now considered internal or deprecated apis, although for some packages that were intended to be a public API replacements should exist in one of the jssdk packages.

See also https://www.webhare.dev/manuals/typescript/library-structure/

TODO: Enforce frontend/shared/backend differences mentioned on the page above (something for validate jssdk?)
