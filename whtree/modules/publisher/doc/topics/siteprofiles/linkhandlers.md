# Link handlers
You can add support for extra types of links to RTD documents. These will appear
next to the standard external and internal link types when creating a hyperlink
in the RTD or applying a link to an image

## Setup
Linktypes are a type of Tollium component. You need to already have a
[component definition](topic:tolliumcomponents/custom) set up and add setup
an inline component for your custom link type, for example:

```xml
  <xs:element name="topiclink" xmnls:t="http://www.webhare.net/xmlns/tollium/screens">
    <xs:complexType>
      <xs:annotation>
        <xs:appinfo>
          <t:tolliumcomponent placement="inline" objecttype="../lib/links.whlib#TopicLink" />
        </xs:appinfo>
      </xs:annotation>
      <xs:attributeGroup ref="t:ComponentBase" />
    </xs:complexType>
  </xs:element>
```

You can then activate your component as a link handler in the rtdtype in
your siteprofile. In the following example 'my' is bound to your component XML namespace:

```xml
  <rtdtype namespace="http://www.utwente.nl/xmlns/rtd/defaulttype" ...>
    <linkhandlers xmlns="http://www.webhare.net/xmlns/tollium/screens">
      <my:topiclink />
    </linkhandlers>
  </rtdtype>
```

The HareScript implementation of this component needs to:
- derive from TolliumLinkHandlerBase manually create the necessary components
- manually create the components when CreateComponents is invoked, and return
  these components for proper 'enableon' handling
- destroy these components when DestroyComponents is invoked
- override TrySetValue, listen to the link passed and return TRUE to confirm
  it has handled the link (usually when the link starts with your custom scheme)
- return the link including you custom scheme when GetValue is invoked.

```harescript
<?wh

LOADLIB "mod::tollium/lib/componentbase.whlib";

PUBLIC STATIC OBJECTTYPE TopicLink EXTEND TolliumLinkHandlerBase
<
  OBJECT link;

  UPDATE PUBLIC OBJECT ARRAY FUNCTION CreateComponents(OBJECT screen)
  {
    this->link := screen->CreateTolliumComponent("textedit");
    this->link->title := "Topic";
    RETURN [ this->link ];
  }

  UPDATE PUBLIC MACRO DestroyComponents()
  {
    this->link->DeleteComponent();
  }

  UPDATE PUBLIC BOOLEAN FUNCTION TrySetValue(OBJECT rte, STRING inlink)
  {
    IF(inlink NOT LIKE "x-topiclink:*")
      RETURN FALSE;

    this->link->value := Substring(inlink, 12);
    RETURN TRUE;
  }

  UPDATE PUBLIC STRING FUNCTION GetValue(OBJECT rte)
  {
    RETURN "x-topiclink:" || this->link->value;
  }
>;
```
