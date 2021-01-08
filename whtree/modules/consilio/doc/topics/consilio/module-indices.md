# Module index definitions

Elasticsearch indices can be defined within a module definition. Managing these indices, adding content sources and indexing data isn't handled by Consilio for now.

## Defining an index

Add an `<index>` node to the `<consilio>` node in the module definition and add field nodes to it:

```xml
<consilio>
  <index tag="myindex">
    <text name="title" />
    <text name="body" />
  </index>
</consilio>
```

## Creating an index

An index defined in the module definition is meant to be managed explicitly, so it isn't automatically created and you cannot add content sources to it. To create a module index on the index manager, use the catalog interface:

```harescript
OBJECT catalog := OpenConsilioCatalog("mymodule:myindex");
catalog->EnsureIndex();
```

## Field types

The following field types can be used:

### `<text>`

A field containing tokenized text.

The `analyzer` attribute can be used to specify how incoming text should be tokenized. Possible values are `standard` (the default, divide text into terms on word boundaries, lowercasing terms and removing punctuation), `simple` (divide text into words on non-letter characters, lowercasing terms) and `whitespace` (divide text into terms on whitespace characters, *not* lowercasing terms). In addition, the following language-specific analyzers are supported: `danish`, `dutch`, `english`, `french`, `german`, `italian`, `portuguese` and `spanish`.

When searching through a text field, the query is also analyzed. By default, the analyzer defined by the `analyzer` attribute is used, but the `search_analyzer` attribute can be used to specify another analyzer to be used for anaylizing query text.

### `<keyword>`

A field containing text that is not tokenized, but can only be found as a whole.

To prevent too long keywords from being indexed, the `ignoreabove` attribute can be set to ignore keywords longer than that value.

### `<integer>`

A field containing INTEGER values.

### `<integer64>`

A field containing INTEGER64 values.

### `<float>`

A field containing FLOAT values.

### `<datetime>`

A field containing DATETIME values.

### `<boolean>`

A field containing BOOLEAN values.

### `<record>`

A field containing other fields or field groups. For example:

```xml
<consilio>
  <index tag="myindex">
    <boolean name="confirmed" />
    <record name="subfields">
      <text name="subtext" />
      <record name="deeper">
        <integer name="num" />
      </record>
    </record>
  </index>
</consilio>
```

This allows indexing of the following record:

```harescript
RECORD mydocument :=
    [ confirmed := TRUE
    , [ subfields :=
        [ subtext := "Some text"
        , deeper := [ num := 42 ]
        ]
      ]
    ];
```

Which can be found using for example this query:

```harescript
RECORD query := CQMatch("subfields.subtext", "CONTAINS", "text");
```

### `<latlng>`

A field containing a geographical position. If the index contains a `latlng` field:

```xml
<consilio>
  <index tag="myindex">
    <latlng name="pos" />
  </index>
</consilio>
```

it can be indexed as a record:

```harescript
RECORD mydocument := [ pos := [ lat := 52.2210244, lng := 6.8957199 ] ];
```

or as a string:

```harescript
RECORD mydocument := [ pos := "52.2210244,6.8957199" ];
```

### `<ipaddress>`

A field containing IPv4/IPv6 addresses.

## Dynamic fields

Fields can only be indexed if they're defined in a module definition, so every field's type is known. If you want a bit more flexibility, you can use dynamic fields to map fields that match a LIKE mask to a type.

To map all fields that have a name starting with `dn_` to a float field, set the name of the field to `"dn_*"`. This only applies to fields on the level that the dynamic field is defined. For example, in the next index definition, a `dn_myfloat` field cannot be indexed within the `subfields` record, where only a `stuff` field is defined:

```xml
<consilio>
  <index tag="myindex">
    <float name="dn_*" />
    <record name="subfields">
      <text name="stuff" />
    </record>
  </index>
</consilio>
```

## Store-only fields

By default, all fields are searchable and can be returned in the search results. If the field is never searched, but only used to store information, the `storeonly` attribute of the field can be set to `true`:

```xml
<consilio>
  <index tag="myindex">
    <text name="title" />
    <text name="extradata" storeonly="true" />
  </index>
</consilio>
```

## Field groups

A field group is a reusable group of fields. Field groups are defined as `<fieldgroup>` nodes within the `<consilio>` node in the module definition. A field group contains other fields, for example:

```xml
<consilio>
  <fieldgroup tag="myfieldgroup">
    <keyword name="id" />
  </fieldgroup>
</consilio>
```

Include field groups in indices or other field groups by adding a field group reference. This example adds the keyword field `id` to `myindex`.

```xml
<consilio>
  <index tag="myindex">
    <text name="title" />
    <text name="body" />
    <fieldgroup ref="myfieldgroup" />
  </index>
  <fieldgroup tag="myfieldgroup">
    <keyword name="id" ignoreabove="256" />
  </fieldgroup>
</consilio>
```

## Array fields

Fields can contain multiple values, which can be searched individually. For example, you can define a `<keyword>` field and index an array of keywords, or index an array of integer values in an `<integer>` field.
