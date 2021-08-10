# Search engine optimalization

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

## Legacy search data
The consilio `<robots xmlns="http://www.webhare.net/xmlns/consilio" />` has been deprecated
and is no longer needed to add a meta-robots tag.
