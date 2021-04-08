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

