# Frontend
WebHare exposes some configuration data to JavaScript through the wh-integration
library. By default, the following witty variables are stored in the top level
configuration:

- siteroot
- designroot
- designcdnroot
- imgroot

they can be extracted by accessing the 'config' variable exported by
`@mod-system/js/wh/integration`, for example:

```
import * as whintegration from "@mod-system/js/wh/integration";
let imgurl = whintegration.config.imgroot + 'spacer.png';
```

## CUSTOM VARIABLES
Your webdesign can assign values to 'jssiteconfig' and 'jsobjconfig'. jssiteconfig
should contain settings that don't/rarely change anywhere on the site, and
jsobjconfig should be used for variables that can differ per object and per request.

jssiteconfig and jsobjconfig can only be modified in the preparation phase. As
soon as the page starts rendering, any attempt to modify these records will
throw an exception.

Eg:
```harescript
INSERT CELL location := "Enschede" INTO this->jsobjconfig;
INSERT CELL fbimgurl := "http://..." INTO this->jssiteconfig;
```

```javascript
import * as whintegration from "@mod-system/js/wh/integration";
let mylocation = whintegration.config.obj.location;
let fbimgurl = whintegration.config.site.fbimagurl;
```

## PLUGINS
Plugins can add their own data to the `config` object using `webdesigncontext->SetJSPluginConfig`,
and it will be available as `whintegration.config[pluginname]`. Before invoking this function, a
plugin should verify that the webdesigncontext object is actually a webdesign instance -
preferably, the plugin would only invoke SetJSPluginConfig inside PrepareForRendering, as this
function is only invoked with webdesign objects.

Webdesigns themselves should not use SetJSPluginConfig

## IMPLEMENTATION
JSConfig variables are injected at 'dependencies-top' - before any `<script src>` headers are included.
Future versions of designfiles will be able to combine JSConfig variables into a combined JS library,
but will avoid mixing the jsobjconfig in a precompiled file.
