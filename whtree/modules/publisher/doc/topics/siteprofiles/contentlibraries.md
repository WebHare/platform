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

# Adaptive content

An adaptive content store consists of one or more 'slots'. Adaptive content slots have a type and can contain zero or more
widgets. They will show zero or one widget, depending on the conditions associated with these widgets.

Adaptive content can be linked to beacons. Use `<setlibrary name="publisher:beacons">` to point adaptive content apps
to your beacon store(s).

```xml
  <apply>
    <to type="all" />
    <setlibrary name="publisher:fsobjecttemplates">
      <source path="site::mysite/templates/" />
      <source path="site::repository/globaltemplates/" />
    </setlibrary>
  </apply>
```

Keep in mind that if you have multiple sources of beacon that their names still need to be unique
