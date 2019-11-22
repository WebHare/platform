# Future deprecations

We expect to deprecate or remove the following features in the future. You
shouldn't use them on new projects anymore. If you cannot find an alternative,
get in touch - we may reconsider deprecation or be able to transfer the code
out of WebHare to a separate module.

Remember to also keep an eye on the [changelogs](topic:changelogs) for past
and current actual deprecations

## In general
- `blexdev_forsmapi` module is obsolete, use the Publisher Forms API
- `socialite` and `google` modules will be removed in the future
  - we're still looking for a good solution for maps
  - commonly used social APIs will probably be moved to system/webapi
  - configuration should be done inside modules themselves (eg registry keys)
    and not rely on socialite databases to store it
  - API key lookup for eg maps should be done using %LookupAPIKey

## Consilio
- The searchobject API (consilio/lib/search.whlib) will be removed. You should use %RunConsilioSearch instead
- `<meta name="consilio-" />` may be deprecated. Where possible, use pagelists to provide additional fields
- Spidering by Consilio may be deprecated. Where possible, use pagelists to provide a list of pages to index.

## Publication and templates
- `template-v2.whlib` is obsolete and slowly being fully replaced by `<webdesign>` functionality
- `harescriptfile-v2.whlib` and content listings shouldn't be used at all anymore - use custom or prebuilt file types
- EmbeddedObjectBase is obsolete - use %WidgetBase
  - And use `<tabsextension>` to implement the widget screen.
- `<propertyeditor>` in siteprofiles is obsolete - use `<tabsextension>`

## System APIs
- MakeEmailComposer is obsolete - use %PrepareMailWitty, see also [Building emails](topic:witty/emails/)

## WRD APIs
- Everything using `mod::wrd/lib/objectapi.whlib` is obsolete. Use `mod::wrd/lib/api.whlib` for new code
  - As an intermediate step, switch from `->GetTypeByTAG("XX")` to `->^xx`. Whether or not you're dealing
    with an old or new style WRD schema, `^` will give you a 'new style' WRDType object.
