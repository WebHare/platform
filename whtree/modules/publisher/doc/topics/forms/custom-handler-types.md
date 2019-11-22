# CUSTOM HANDLER TYPES
## FORMDEF.XSD
```xml
  <xs:element name="myhandler">
    <xs:complexType>
      <xs:annotation>
        <xs:appinfo>
          <forms:formhandler
            tid="module.forms.myhandler"
            descriptiontid="module.forms.myhandlerdesc"
            handlerobject="myhandler.whlib#myhandler"
            editextension="myhandler.xml#settings"
            parserfunc="myhandler.whlib#myparser"
            />
        </xs:appinfo>
      </xs:annotation>
    </xs:complexType>
  </xs:element>
```

Add `editdefaults="condition"` if you want to add the interface for setting a condition.

## MYHANDLER.XML
```xml
  <tabsextension name="settings" implementation="lib">
    <insert position="settings" where="after">
      <textedit name="data" />
    </insert>
  </tabsextension>
```

Valid insert positions are: `settings`, `dependencies`, `advanced`.

## MYHANDLER.WHLIB
The settings fragment should derive from FormComponentBase and implement LoadData and StoreData.

The handler XML node is passed as 'this->node' to the FormComponentBase

```harescript
PUBLIC STATIC OBJECTTYPE Settings EXTEND FormComponentExtensionBase
<
  UPDATE PUBLIC MACRO PostInitExtension()
  {
    ^data->value := this->node->GetAttribute("data");
  }

  UPDATE PUBLIC MACRO SubmitExtension(OBJECT work)
  {
    this->node->SetAttribute("data", ^data->value);
  }
>;

PUBLIC RECORD FUNCTION MyParser(RECORD fielddef, OBJECT node, RECORD parsecontext)
{
  fielddef := CELL[ ...fielddef
                  , data := node->GetAttribute("data")
                  ];
  RETURN fielddef;
}
```

You should use a 'managedtask' for processing form results wherever possible, as this reduces the chances for form submissions to fail due to errors in your task handling. Managedtasks are also easier to restart/debug than  online processing.

To link up a form handler to a managed task, add a handlertask attribute to its <formhandler> node in the formdef.xsd, set up a managedtask in the moduledefinition, and make sure your implementation derives from FormHandlerTaskBase (not ManagedTaskBase or FormHandlerBase)

```harescript
PUBLIC OBJECTTYPE MailResultsTask EXTEND FormHandlerTaskBase
<
  UPDATE PUBLIC MACRO RunFormTask(RECORD results)
  {
    /* Add code.
       this->settings contains the attributes applied to your form node
       when done, this->ResolveByCompletion
    */
  }
>;
```

To enable the custom handler, tell your site profile about it. This can be done by adding this piece of code to your main site profile:

```xml
<apply>
  <to type="file" filetype="http://www.webhare.net/xmlns/publisher/formwebtool" />
  <allowformhandler type="http://www.mysite.net/xmlns/forms#*" />
</apply>
```
