# Webdesign plugins
Modules can define plugins to extend site profiles

To register a plugin, extend your mmoduledefinitionfile:
```xml
  <publisher>
    <webdesignplugin name="myplugin" namespace="http://www.example.net/mymodule" objectname="lib/plugin.whlib#myplugin" />
  </publisher>
```

All plugins should derive from %WebDesignPluginBase and override ParseConfigurationNode to receive information from
the site profile:

```harescript
PUBLIC STATIC OBJECTTYPE MyPlugin EXTEND WebDesignPluginBase
<
  UPDATE PUBLIC RECORD FUNCTION ParseConfigurationNode(OBJECT siteprofile, OBJECT node)
  {
    RETURN [ myprop := ParseXSBoolean(node->GetAttribute("myprop"))
           , mytext := node->GetAttribute("mytext") ?? "fallback"
           ];
  }
>;
```

The siteprofile reader willl combine the parseed values for all apply nodes and update settings based on which
attributes are actually set. For this reason, the cellnames returned by ParseCongigurationNode *must* match the attribute
names used in the siteprofile (unless you also override ListConfigurationNodeAttributes to explain which attributes are
overridden by each node)

