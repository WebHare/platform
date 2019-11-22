# RTD Type definitions

Rich text document (RTD) types are defined in site profiles similarly to how you define content types (although you cannot use the
namespace specified as an actual whfstype)

A RTD type defines the styles and widgets a document is allowed to use

Example:

```xml
<siteprofile xmlns="http://www.webhare.net/xmlns/publisher/siteprofile">

  <rtdtype namespace="http://www.webhare.net/xmlns/publisher/defaultrtdtype">
    <css path="../css/rtd.css" /> <!-- CSS file configuring the styles below -->
    <blockstyles defaultstyle="NORMAL">
      <textstyle tag="HEADING1" textstyles="i u" />
      <textstyle tag="HEADING2" textstyles="i u" />
      <textstyle tag="NORMAL" textstyles="b a-href img sup sub strike" />
      <textstyle tag="UNORDERED" containertag="ul" textstyles="b a-href img sup sub strike" />
      <textstyle tag="ORDERED" containertag="ol" textstyles="b a-href img sup sub strike" />
      <tablestyle tag="TABLE" />
    </blockstyles>
    <widgets>
      <allowtype type="http://www.webhare.net/xmlns/publisher/embedvideo" />
    </widgets>
  </rtdtype>
</siteprofile>
```

RTD types do not support SCSS files. The CSS for the rtdtype should contain
styling usable by Tollium richtext editors to give an approximation how the
user's content would look on the web. Your webdesign can also load the same CSS
for maximum consistency.

The RTD rewrites the CSS files to ensure classes defined therein cannot affect
other RTDs or the tollium interface by replacing `html` and `body` in the
selectors with random classnames.

You can specify a `htmlclass` and/or `bodyclass` attribute to the `<rtdtype>` node.
These classes will then be applied to the richtext editor to allow some tweaking
of the rendering while sharing the CSS file.

For example if you set `<rdtype htmlclass="article">` any `html.article` selector
in the supplied rtd.css will apply to the richtext editor.

