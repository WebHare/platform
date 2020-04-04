# Custom form types

Siteprofile:
```xml
  <contenttype namespace="http://www.example.net/xmlns/customform">
    <member name="somedata" type="string" />
  </contenttype>
  <filetype typedef="http://www.example.net/xmlns/customform"
            extensions=".customform"
            title="WebHare testsuite customform type"
            tolliumicon="tollium:files/application_x-webhare-survey"
            blobiscontent="false"
            needstemplate="true"
            needsprofile="false"
            isacceptableindex="true"
            ispublishable="true"
            ispublishedassubdir="true">
    <dynamicexecution routerfunction="customform.whlib#CustomFormRouter" />
  </filetype>

  <apply>
    <to type="file" filetype="http://www.example.net/xmlns/customform" />
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
