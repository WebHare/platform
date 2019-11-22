# Custom components

## Basic setup
Select a namespace (eg `http://www.example.net/mymodule/mycomponents`) and setup a reference to a component definition file
(an XML Schema) in your moduledefinition.xml:

```xml
  <tollium>
    <components namespace="http://www.webhare.nl/xmlns/components" xmlschema="data/components.xsd" />
  </tollium>
```

(add it to an existing `<tollium>` if any)

components.xsd skeleton:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<xs:schema
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:t="http://www.webhare.net/xmlns/tollium/screens"
  xmlns:tc="http://www.webhare.net/xmlns/tollium/common"
  xmlns="http://www.webhare.nl/xmlns/components"
  targetNamespace="http://www.webhare.nl/xmlns/components"
  elementFormDefault="qualified"
  xml:lang="en">

  <xs:import namespace="http://www.webhare.net/xmlns/tollium/screens" schemaLocation="mod::tollium/data/screens.xsd" />
  <xs:import namespace="http://www.webhare.net/xmlns/tollium/common" schemaLocation="mod::tollium/data/common.xsd" />

  <!-- actual elements go here -->
</xs:schema>
```
