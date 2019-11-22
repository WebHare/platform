# CUSTOM QUESTION TYPES
You can define your own custom question types for forms. These question types can be found in the "Custom" tab in the form application when adding questions. Naturally, this tab only appears if there's at least one custom question type available.

As an example, we're creating a (disabled) textedit field that will generate a unique code.

Select a namespace, for example 'http://www.mysite.net/xmlns/forms'. In the module's moduledefinition.xml file (assuming the module is called 'mymodule'), create a form definition file, mymodule/data/formdef.xsd, and fill it with:

```xml
<?xml version="1.0" encoding="UTF-8"?>

<xs:schema
  xmlns="http://www.mysite.net/xmlns/forms"
  xmlns:forms="http://www.webhare.net/xmlns/publisher/forms"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:sc="http://www.webhare.net/xmlns/system/common"
  xmlns:t="http://www.webhare.net/xmlns/tollium/screens"
  xmlns:html="http://www.w3.org/1999/xhtml"
  targetNamespace="http://www.mysite.net/xmlns/forms"
  elementFormDefault="qualified"
  xml:lang="en"
  >

  <xs:import namespace="http://www.webhare.net/xmlns/system/common" schemaLocation="mod::system/data/common.xsd" />

  <xs:element name="generateid">
    <xs:complexType>
      <xs:annotation>
        <xs:appinfo>
          <forms:formcomponent
            tolliumicon="tollium:forms/textedit"
            tid="module.forms.myhandler"
            descriptiontid="module.forms.myhandlerdesc"
            editdefaults="title placeholder"
            fieldobject="mod::mymodule/formcomponents/formcomponents.whlib#GenerateID"
            parserfunc="mod::mymodule/formcomponents/formcomponents.whlib#ParseGenerateID"
            editextension="mod::mymodule/formcomponents/formcomponents.xml#generateidformfield"
            />
        </xs:appinfo>
      </xs:annotation>
      <xs:attributeGroup ref="sc:FormHandlerAttributes" />
    </xs:complexType>
  </xs:element>

</xs:schema>
```

Optional fields
`parserfunc` and `editextension` are only needed when adding your own fields

Refer to this form definition in your moduledefinition.xml by adding the following tags (if you have an existing <publisher> section, just add the <formcomponents> there):

```xml
  <publisher>
    <formcomponents namespace="http://www.mysite.net/xmlns/forms" xmlschema="data/formdef.xsd"/>
  </publisher>
```

Let's define the screen first. We're creating a field that generates a code, but we also want this code to be based on a certain 'tag' that can be chosen by the content manager.

Create a mymodule/formcomponents/formcomponents.xml file containing the following:

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<screens xmlns="http://www.webhare.net/xmlns/tollium/screens">
  <tabsextension name="generateidformfield"
                 implementation="lib"
                 lib="mod::mymodule/formcomponents/formcomponents.whlib">
    <insert position="answers" where="after">
      <textedit name="code" tid="module.forms.code" width="16x" required="true" />
    </insert>
  </tabsextension>
</screens>
```

Acceptable insert positions are: titles, answers, presentation, validation, dependencies, advanced

Now it's time to add some logic, by creating a mymodule/formcomponents/formcomponents.whlib file:

```harescript
<?wh
LOADLIB "mod::publisher/lib/forms/components.whlib";
LOADLIB "mod::publisher/lib/forms/editor.whlib";

PUBLIC OBJECTTYPE GenerateIdFormField EXTEND FormComponentExtensionBase
<
  UPDATE PUBLIC MACRO PostInitExtension()
  {
    this->code->value := this->node->GetAttribute("code");
  }

  UPDATE PUBLIC MACRO SubmitExtension(OBJECT work)
  {
    this->node->SetAttribute("code", this->code->value);
  }
>;

PUBLIC STATIC OBJECTTYPE GenerateID EXTEND ComposedFormFieldBase
< PUBLIC PROPERTY value(GetValue, SetValue);

  OBJECT idfield;

  MACRO NEW(OBJECT form, OBJECT parent, RECORD field)
  : ComposedFormFieldBase(form, parent, field)
  {
    this->idfield := this->CreateSubField("textedit", "generateid");
    this->idfield->htmltitle := this->htmltitle;
    this->idfield->required := TRUE;
    this->idfield->enabled := FALSE;
    this->SetupComposition( [ this->idfield ]);

    // for this example's purpose, generate a simple code
    this->idfield->value := ToString(Random(0, 999999));
  }

  STRING FUNCTION GetValue()
  {
    RETURN this->idfield->value;
  }

  MACRO SetValue(STRING value)
  {
    this->idfield->value := value;
  }
>;

PUBLIC RECORD FUNCTION ParseGenerateId(RECORD fielddef, OBJECT node, RECORD parsecontext)
{
  INSERT CELL code := node->GetAttribute("code") INTO fielddef;
  RETURN fielddef;
}
```

To enable the custom fields, tell your site profile about it. This can be done by adding this piece of code to your main site profile:

```xml
<apply>
  <to type="file" filetype="http://www.webhare.net/xmlns/publisher/formwebtool" />
  <allowformquestion type="http://www.mysite.net/xmlns/forms#*" />
</apply>
```
