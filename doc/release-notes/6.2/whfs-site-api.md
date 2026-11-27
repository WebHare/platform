## WHFS sites in TypeScript
- The new `createSite(rootId, options)` in `@webhare/whfs` turns the folder with that id into a site. `Site` has new
  `description`, `locked` and `lockReason` properties.
- `Site.update` now also accepts `name` (which renames the site's root folder), `description`, `locked` and
  `lockReason`.
- `Site.update` now republishes the site when its webdesign, webfeatures or lock change, like the HareScript
  `UpdateSiteMetadata` already did.
- `wh site update` can now set a site's `name` and `description`.
