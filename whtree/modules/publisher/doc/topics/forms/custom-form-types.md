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
    <extendformeditor settingsextension="customform.xml#props" />
  </apply>
```

Settings screen extension:
```xml
<screens xmlns="http://www.webhare.net/xmlns/tollium/screens" library="customform.whlib">
  <tabsextension name="props" implementation="lib">
    <newtab>
      ...
    </newtab>
  </tabsextension>
</screens>
```

For the settingextension tabsextension, valid insert points are: `settings`

Use `this->contexts->editdocumentapi->readonly` to check if your settings should
be in readonly mode

```harescript
LOADLIB "mod::publisher/lib/forms/editor.whlib";

PUBLIC OBJECTTYPE Props EXTEND FormSettingsExtensionBase
<
  MACRO NEW()
  {
    INSERT "http://www.example.net/xmlns/customform" INTO this->contexts->editdocumentapi->editcontenttypes AT END;
  }
  UPDATE PUBLIC MACRO InitExtension(OBJECT extendablelinescontainer)
  {
    this->somedata->value := this->contexts->editdocumentapi->
       GetInstanceData("http://www.example.net/xmlns/customform").somedata;
  }
  UPDATE PUBLIC MACRO SubmitExtension(OBJECT work)
  {
    this->contexts->editdocumentapi->SetInstanceData("http://www.example.net/xmlns/customform",
       [ somedata := this->somedata->value ]);
  }
>;
```

To allow your custom form controls to act on whether we're currently adding, changing or cancelling, add an apply rule with:
```xml
    <formintegration allowsubmittype="true" />
```
