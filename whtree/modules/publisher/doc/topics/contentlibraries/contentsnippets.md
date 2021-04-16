# Content snippets

Content snippets allow you to set up libraries of reusable (rich) content.

To use a snippets library, enable the insertsnippet widget for your RTD types
(widget type `http://www.webhare.net/xmlns/publisher/widgets/insertsnippet`)
and set up a folder of type Content snippets (namespace `http://www.webhare.net/xmlns/publisher/contentlibraries/contentsnippets`)

In your site profiles, define a library of type `publisher:snippets` and point it to the folder you created.

```xml
  <apply>
    <to type="all" />
    <setlibrary name="publisher:snippets">
      <source path="site::mysite/snippets/" />
    </setlibrary>
  </apply>
```
