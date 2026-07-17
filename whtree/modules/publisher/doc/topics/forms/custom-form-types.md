# Custom form types

Siteprofile:
```xml
  <filetype typedef="http://www.example.net/xmlns/customform"
            kind="virtualfile"
            extensions=".customform"
            title="WebHare testsuite customform type"
            icon="tollium:files/application_x-webhare-survey"
            isacceptableindex="true">
    <members>
      <string name="somedata" />
    </members>
    <dynamicexecution routerfunction="customform.whlib#CustomFormRouter" />
    <setobjecteditor name="publisher:webtoolform" separateapp="true" />
  </filetype>
```

Custom settings can be added using `<extendproperties />` (XML) or `extendProps: ` (YAML)

To allow your custom form controls to act on whether we're currently adding, changing or cancelling, add an apply rule with:
```xml
    <formintegration allowsubmittype="true" />
```
