## WHFS sites in TypeScript
- The new `createSite(rootId, options)` in `@webhare/whfs` turns the folder with that id into a site. `Site` has new
  `description`, `locked` and `lockReason` properties.
- `Site.update` now also accepts `name` (which renames the site's root folder), `description`, `locked` and
  `lockReason`.
- `Site.update` now republishes the site when its webdesign, webfeatures or lock change, like the HareScript
  `UpdateSiteMetadata` already did.
- `wh site update` can now set a site's `name` and `description`.
- The new `Site.setOutput` sets where a site is published: in a folder on a webserver (`{ webServer, folder }`), in a
  foreign folder of another site (`{ site, folder }`, which creates that folder if needed), or nowhere (`null`).
- The new `ensureTestSite(name, options)` in `@webhare/test-backend` is the TypeScript counterpart of the HareScript
  `EnsureTestSite`.
