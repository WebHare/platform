# Search engine optimization

## Navigation, header and SEO titles
WebHare 4.34 adds standardized (but still opt-in) fields to separately control the titles used to refer to a file:

### Navigation title
This is the title that should be used when referring to this file in navigation - it's how other parts of the site will
generally list it in paths, lists and trees. This title is shown in the Publisher file lists and object properties as
'title' and as 'Navigation title' in a SEO export.

The navigation title is also the fallback for the SEO and Header title if not explicitly set, and is always enabled. In
the database, this is the `title` field in `system.fs_objects`. It's available as `pagetitle` in your webdesign templates
and code.

### Header title
This is the title to use in a page header or as the first H1. It is available as `headertitle` in your webdesign templates
and code. If the `headertitle` is not set in the file settings, it falls back to `pagetitle`.

To enable, add or update your siteprofile's baseproperties: `<baseproperties headertitle="true" />`

### SEO title
This is the title to use in the `<title>` element of the `<head>` of the page and is usually the title shown by search
engines and used for browser tabs/bookmarks. It is available as `seotitle` in your webdesign templates
and code. If the `seotitle` is not set in the file settings, it falls back to `pagetitle`.

To enable, add or update your siteprofile's baseproperties: `<baseproperties seotitle="true" />`

### Migrating custom fields to these titles
You'll need to write a conversion script that sets the `headertitle` and `seotitle` in the
`http://www.webhare.net/xmlns/publisher/seosettings` instance. Keep in mind that these fields are only available on files,
if you did something meaningful with them at the folder level you'll still need to implement that yourself.

After that, ensure `<baseproperties seotitle="true" headertitle="true"/>` is set and update your webdesign code as needed.

## Robot tags
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

### Migrating away from the consilio robots plugin
The consilio `<robots xmlns="http://www.webhare.net/xmlns/consilio" />` has been deprecated
and is no longer needed to add a meta-robots tag. To migrate away from this tag:
- Check your code for `webdesign->GetPlugin("http://www.webhare.net/xmlns/consilio", "robots")` calls
  and rewrite the code to update `webdesign->robotstag`
- Add or update the `<baseproperties />` and set the attribute `seotab="true"`
- Replace any `<robots xmlns="http://www.webhare.net/xmlns/consilio" />` references in your siteprofiles
  that were setting noindex, nofollow or noarchive with a `<baseproperties />`
- Remove any `<robots xmlns="http://www.webhare.net/xmlns/consilio" />` references from your siteprofiles
  that were not setting any property
