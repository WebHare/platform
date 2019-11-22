# ROBOTS META TAGS PLUGIN
This plugin adds a `<meta name="robots">` tag to the pages on which the plugin is applied.
The value of the tag is controlled statically by the 'noindex' and 'nofollow' attributes
on the plugin tag or dynamically in the webdesign.

## INTEGRATION
To activate the plugin for all pages, add the following to the global site settings:

```xml
<robots xmlns="http://www.webhare.net/xmlns/consilio" />
```

To prevent a page from being indexed and followed, add the following to a specific file apply rule:

```xml
<robots xmlns="http://www.webhare.net/xmlns/consilio" noindex="true" nofollow="true" />
```

The tag can be applied multiple times, with each one updating the specified noindex and nofollow settings.

## UPDATE DYNAMICALLY
The plugin settings can be updated dynamically in HareScript, by setting the
noindex and nofollow properties of the plugin, for example:

```harescript
webdesign->GetPlugin("http://www.webhare.net/xmlns/consilio", "robots")->noindex := TRUE;
```

These properties can only be set in the preparation phase!
