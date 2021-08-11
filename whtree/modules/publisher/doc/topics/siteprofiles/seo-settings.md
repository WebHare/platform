# Search engine optimization

You can control the meta robots tag rendered by WebHare by setting the webdesign's
`robotstag` property. The robot properties can only be updated in the preparation phase
of a template.

You can enable the user to modify SEO settings by adding the seotab= property to the baseproperties, ie.
`<baseproperties seotab="true" />`. This will enable the SEO tab on the necessary files and folders.

Setting noindex/noarchive and/or nofollow on a folder will recurse this setting to all contained files and
folders and will not allow users to disabled this on a file or folder basis. The webdesign code can still
override these settings.

You may want to consider disabling the seotab property on dynamic pages, especially if they will take care
of these properties themselves or expand to multiple pages for which a single canonical URL won't make sense.
You can also use the `<baseproperties` noindex/nofollow/noarchive settings to enforce these settings on
certain files (eg 'noindex' on search pages). Alternatively, you can use the `seotabrequireright` attribute
to limit the access to the SEO tab.

## Migrating away from the consilio robots plugin
The consilio `<robots xmlns="http://www.webhare.net/xmlns/consilio" />` has been deprecated
and is no longer needed to add a meta-robots tag. To migrate away from this tag:
- Check your code for `webdesign->GetPlugin("http://www.webhare.net/xmlns/consilio", "robots")` calls
  and rewrite the code to update`webdesign->robotstag>
- Add or update the `<baseproperties />` and set the attribute `seotab="true"`
- Replace any `<robots xmlns="http://www.webhare.net/xmlns/consilio" />` references in your siteprofiles
  that were setting noindex, nofollow or noarchive with a `<baseproperties />`
- Remove any `<robots xmlns="http://www.webhare.net/xmlns/consilio" />` references from your siteprofiles
  that were not setting any property
