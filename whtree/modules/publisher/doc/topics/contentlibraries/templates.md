# Templates

Siteprofiles can set up 'templates' for files and folders which will be offered
when selecting "New file" or "New folder" in the Publisher. To set up templates,
set up the files (or folders) somewhere in the Publisher, and then set up
a `publisher:fsobjecttemplates` library through an apply rule to point the
template source:

```xml
  <apply>
    <to type="all" />
    <setlibrary name="publisher:fsobjecttemplates">
      <source path="site::mysite/templates/" />
      <source path="site::repository/globaltemplates/" />
    </setlibrary>
  </apply>
```

You can disable the original type in 'new file/folder' dialogs to prevent the
creation of 'empty' objects. Eg if you set up a few 'news' templates you might
want to prevent users from not using the templates. You can use the `newonlytemplate`
option for this, eg:

```xml
  <apply>
    <to type="all" />
    <setlibrary ... />
    <allowfiletype typemask="http://www.webhare.net/xmlns/publisher/richdocumentfile" newonlytemplate="true" />
  </apply>
```

Remember that allowfiletype is just a convenience option for users but isn't strictly enforced, eg copy/move
actions can easily avoid these restrictions.
