# Web Rules
All WebHare assets that usually do not require authentication (ie they are well-known, only content-addressable or do their own authentication)
must be moved to `/.wh/` so we have a single path to exclude from login checks.

All embeddedable assets (eg image cache) should move to `/.wh/ea/` - this will help when designing rate limits and error handling (ie: users should
rarely if ever land on a `/.wh/ea`, requesting 10 real pages in a second is highly suspect, 10 embedded assets in a second isn't)

Keep in mind that embedded assets aren't necessarily static or immutable.

Modules that add similar embeddable assets should do so under `/.wh/ea/mod/<modulename>/`

All under `/.wh/devkit/` will be assigned to the standard 'devkit' module (mod::devkit/web/wh-dev/)
`/.wh/dev/` is reserved for the legacy `dev` module
`/.wh/common/` is a common location for tools such as Publisher feedback pages. It is managed by the 'platform' module

- `/.wh/common/`: Implements various builtin pages
- `/.wh/ea/p/`: Static assets part of the core WebHare 'platform' module (ie used for shadowcss assets)
- `/.wh/ea/uc/`: The new location for the unified cache (Files and Images)
- `/.wh/ea/ap/`: The new location for asset packs (see also getAssetPackBase)
- `/.wh/endpoints/`: Endpoints for various services/webhooks

Add-on modules that want to add content under `/.wh/` should use `/.wh/mod/<modulename>/`

All add-on modules receive a `/.wh/mod/<modulename>/public/` virtual directory that points to the `public` folder of the module. This is intended to replace
both the `/tollium_todd.res/` and `/.publisher/sd/` rules.
