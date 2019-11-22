# Sharedblocks

Siteprofile, setting up the widgets library:

```xml
<apply>
  <to type="all"/>

  <setlibrary name="widgets">
    <source path="site::daytoday/bibliotheek/widgets/" />
  </setlibrary>
</apply>
```

Using it:
```xml
      <p:sharedblocks cellname="widgets" composition="contentdata"
                      height="1pr"
                      widgetlibrary="widgets"
                      />
```
