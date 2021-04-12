# Content snippets

Content snippets allow you to set up libraries of reusable (rich) content.

To use a snippets library, enable the insertsnippet widget for your RTD types
(widget type `http://www.webhare.net/xmlns/publisher/widgets/insertsnippet`)
and set up a `publisher:snippets` library

```xml
  <apply>
    <to type="all" />
    <setlibrary name="publisher:snippets">
      <source path="site::mysite/slots/" />
    </setlibrary>
  </apply>
```
