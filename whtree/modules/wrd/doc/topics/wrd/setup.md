# WRD Schema setup
This guide will explain how to automatically setup and upgrade WRD schemas (as opposed to manually setting it up using the WRD Browser application)

First, declare the WRD schema in your moduledefinition. For example, this will
create a schema named 'mymodule:myschema'

```xml
<wrdschemas xmlns="http://www.webhare.net/xmlns/wrd/schemadefinition">
  <schema tag="myschema" autocreate="true" definitionfile="data/myschema.wrdschema.xml"/>
</wrdschemas>
```

Step 2: describe the schema in data/wrdschema.xml. The following example sets up a minimal wrdschema with an emailfield for the WRD_PERSON type

```xml
<schemadefinition xmlns="http://www.webhare.net/xmlns/wrd/schemadefinition">
  <object tag="WRD_PERSON" title="Person" parent="WRD_RELATION">
    <attributes>
      <email tag="WRD_CONTACT_EMAIL" title="E-mail" required="1" unique="1"/>
    </attributes>
  </object>
</schemadefinition>
```
