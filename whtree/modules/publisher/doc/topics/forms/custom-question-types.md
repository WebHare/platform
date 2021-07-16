# CUSTOM QUESTION TYPES
You can define your own custom question types for forms. These question types can be found in the "Custom" tab in the form application when adding questions. Naturally, this tab only appears if there's at least one custom question type available.

As an example, we're creating a (disabled) textedit field that will generate a unique code.

Select a namespace, for example 'http://www.mysite.net/xmlns/forms'. In the module's moduledefinition.xml file (assuming the module is called 'mymodule'), create a form definition file, mymodule/data/formdef.xsd, and fill it with:

## XML field definition

```xml
<xs:schema
  xmlns="http://www.mysite.net/xmlns/forms"
  xmlns:forms="http://www.webhare.net/xmlns/publisher/forms"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:sc="http://www.webhare.net/xmlns/system/common"
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
            editdefaults="name title hidetitle required groupclasses"
            fieldobject="mod::mymodule/formcomponents/formcomponents.whlib#GenerateID"
            />
        </xs:appinfo>
      </xs:annotation>
      <xs:attributeGroup ref="sc:FormBaseAttributes" />
    </xs:complexType>
  </xs:element>

</xs:schema>
```

`editdefaults` controls which fields are made available when editing the component. The following `editdefaults` are supported:
"name", "title", "hidetitle", "required", "noenabled", "novisible", "groupclasses", "label", "placeholder", "prefix", "suffix", "infotext"

By default, only the 'enabled' and 'visible' condition fields will be shown as they require an explicit opt-out. Most components will choose `name title hidetitle required groupclasses`.

Refer to this form definition in your moduledefinition.xml by adding the following tags (if you have an existing `<publisher>` section, just add the `<formcomponents>` there):

```xml
  <publisher>
    <formcomponents namespace="http://www.mysite.net/xmlns/forms" xmlschema="data/formdef.xsd"/>
  </publisher>
```

Once you've setup the XSD, the field is available for use in custom forms and when you manually edit the sourcecode for a form.

To enable users to select the custom fields in the form editor, your siteprofile needs to enable the new question type(s).
This can be done by adding this piece of code to your main site profile:

```xml
<apply>
  <to type="file" filetype="http://www.webhare.net/xmlns/publisher/formwebtool" />
  <allowformquestion type="http://www.mysite.net/xmlns/forms#*" />
</apply>
```


## Component code
The `fieldobject` needs to point to the server-side code handling the field. All form fields must (eventually) derive from
%FormFieldBase, but you can consier using %SelectFormFieldBase as a base class if you're building a component that
is simply wrapping a `<select>`, or %ComposedFormFieldBase as a generic base class for holding one or more dynamically
created components.

This example creates a sub-textedit prefilled with a random value

```harescript
LOADLIB "mod::publisher/lib/forms/components.whlib";

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
```


## Custom attributes
Your form can accept custom attributes by
- adding these to the xs:complexType (xs:attribute...)
- setting up a parser for these attributes by adding a `parserfunc` to the forms:formcomponent node, eg `parserfunc="mod::mymodule/formcomponents/formcomponents.whlib#ParseGenerateID"`

Example of such a parser:

```
PUBLIC RECORD FUNCTION ParseGenerateId(RECORD fielddef, OBJECT node, RECORD parsecontext)
{
  INSERT CELL code := node->GetAttribute("code") INTO fielddef;
  RETURN fielddef;
}
```

You cannot define `on` attributes such as Tollium's `onchange` that callback into your Form code. It's not possible to set
up these kind of attributes as forms and components don't have the separate `Init` and `StaticInit` steps that Tollium adds
to allow references to the containing screen.

## Configuring custom attributes
To allow custom attributes to be managed in the form editor, add an `editextension` to the forms:formcomponent node

For example, create a mymodule/formcomponents/formcomponents.xml file containing the following:

```xml
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

and add this to the form:formcomponent: `editextension="mod::mymodule/formcomponents/formcomponents.xml#generateidformfield"`

Acceptable insert positions are: titles, answers, presentation, validation, dependencies, advanced

Add the necessary logic:

```harescript
<?wh
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

```
