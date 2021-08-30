# A/B tests

A/B tests are an experimental feature in WebHare 4.32. (Current) limitations:

- the variants must be unpublished static files in the same folder as the abtest file
- the variants should not create subfiles (CreateDBFile,CreateStaticFile)
- you will need to use `navigationobject` instead of the `targetobject` wherever
  navigation is involved, eg to highlight the current menu item.

When publishing an A/B test, the `navigationobject` (which is new in 4.32) will
point to the A/B test file itself. `targetobject` will point to the variant.
`contentobject` will also point to the variant, unless the variant is itself
a content link.
