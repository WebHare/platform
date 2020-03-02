# Custom implementations and component parsers

## Implementations

The `implementation` attribute of screens, fragments and tabsextensions can be set to use a standard implementation, like `rowedit`. Modules can now provide custom base implementations for screens, fragments and tabsextensions, so an implementation can be shared. A custom implementation is defined in a component definition file (see [Custom components](topic:tollium-components/custom) for a basic setup of a custom component defintion file) by adding a `ComplexType` with a `tolliumimplementation` annotation. For example:

```xml
<xs:complexType name="myimplementation">
  <xs:annotation>
    <xs:appinfo>
      <t:tolliumimplementation objecttype="/path/to/my/customparsing.whlib#myimplementation" />
    </xs:appinfo>
  </xs:annotation>
</xs:complexType>
```

Add a library with the implementation object type:

```harescript
<?wh

LOADLIB "mod::tollium/lib/screenbase.whlib";


PUBLIC OBJECTTYPE MyImplementation EXTEND TolliumScreenBase
<
  // Object type implementation
>;
```

Then you can use the custom implementation in a screens file (if the `my` prefix is bound to the custom component definition file's `targetNamespace`):

```xml
<screen name="myscreen" implementation="my:myimplementation">
  <!-- Screen contents -->
</screen>
```

## Extra parsing

Sometimes it can be helpful if custom components can contain custom nodes. A component can already define extra parsers to parse tollium nodes, but now modules can define custom extra parsers. Like a custom implementation, a custom extra parser is defined in a custom component definition file by adding a `ComplexType`, but with a `tolliumextraparser` annotation. For example:

```xml
<xs:complexType name="myextraparser">
  <xs:annotation>
    <xs:appinfo>
      <t:tolliumextraparser parsefunc="/path/to/my/customparsing.whlib#myparser"
                            processfunc="/path/to/my/customparsing.whlib#myprocessor" />
    </xs:appinfo>
  </xs:annotation>
</xs:complexType>
```

The `parsefunc` is the function that is called to parse the matching XML nodes. The result of the parsefunc is cached. The `processfunc` is the function that is called to process the parsed data into a definition record field. 

To better understand what is going on, here is an example component definition that uses the example parser:

```xml
<xs:element name="mycustomcomponent">
  <xs:annotation>
    <xs:appinfo>
      <t:tolliumcomponent placement="block" fragment="/path/to/my/components.xml#mycustomcomponent" />
      <t:extraparser field="customsubs" type="myextraparser" target="./my:customsub" />
    </xs:appinfo>
  </xs:annotation>
  <xs:complexType>
    <xs:sequence>
      <xs:choice>
        <xs:element name="customsub" minOccurs="0" maxOccurs="unbounded">
          <xs:complexType>
            <xs:attribute name="mytext" type="xs:string" />
            <xs:attribute name="myint" type="xs:integer" />
            <xs:attribute name="mycomp" type="tc:ComponentRef" />
          </xs:complexType>
        </xs:element>
      </xs:choice>
    </xs:sequence>
    <xs:attributeGroup ref="tc:ComposableComponentBase" />
    <xs:attributeGroup ref="sc:TidOrTitle" />
  </xs:complexType>
</xs:element>
```

Here the `myextraparser` extra parser is used to parse the `customsub` child nodes of the component and store the parsed nodes into the `customsubs` definition record field.

Now the function implementations can be added:

```harescript
<?wh

PUBLIC RECORD ARRAY FUNCTION MyParser(OBJECT nodeset, RECORD field)
{
  // This function receives a NodeSet object containing the matched 'customsub'
  // nodes. We'll read the attributes and return them in a record array. The
  // 'mycomp' attribute contains a component reference, which we cannot resolve
  // while parsing and will have to be resolved in MyProcessor.
  RETURN
      SELECT mytext := node->GetAttribute("mytext")
           , myint := ParseXsInt(node->GetAttribute("myint"))
           , mycomp := node->GetAttribute("mycomp")
        FROM ToRecordArray(nodeset->GetCurrentElements(), "node");
}

PUBLIC RECORD ARRAY FUNCTION MyProcessor(OBJECT screenbuilder, OBJECT obj, RECORD scope, RECORD ARRAY data)
{
  // This function receives the parsed data (as returned by MyParser) and does
  // additional processing, like component reference resolving.
  RETURN
      SELECT *
           , mycomp := mycomp != "" ? screenbuilder->GetCheckComponent(mycomp) : DEFAULT OBJECT
        FROM data;
}
```

The custom component can now be added to a screen (note the xml node prefixes):

```xml
<screen name="myscreen">
  <body>
    <my:mycustomcomponent name="test">
      <my:customsub mytext="This is a string" myint="1234" mycomp="another" />
    </my:mycustomcomponent>
    <textedit name="another" />
  </body>
</screen>
```

And the component implementation now receives the parsed and processed data:

```harescript
<?wh

PUBLIC OBJECTTYPE MyCustomComponent EXTEND TolliumFragmentBase
<
  PUBLIC RECORD ARRAY subnodes;

  UPDATE PUBLIC MACRO StaticInit(RECORD description)
  {
    TolliumFragmentBase::StaticInit(description);
    this->subnodes := description.customsubs;
  }
>;
```

The `subnodes` member of the component now contains one record: `[ mytext := "This is a string", myint := 1234, mycomp := ^another ]`.
