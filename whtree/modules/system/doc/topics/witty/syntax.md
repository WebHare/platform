# Witty syntax

A Witty template consists of text (which can be real text, HTML, XML, etc) and Witty instructions. Witty instructions can delineate a block (`forevery`, `if`, `component`) or be a standalone instruction.
Comments can be inserted between `[!` and `!]` (exclamation points inside the square brackets).

As comments can span multiple lines and do not stop at the first close bracket without an exclamation point, comments can also be used to disable sections of Witty code.

A simple example of Witty code follows:
```witty
<title>
  [title]          [! standalone instruction, prints the document title !]
</title>
[if birthday]      [! block instruction !]
  Happy Birthday
[/if]              [! ends the above block instruction !]
```
As all Witty instructions start with a `[` (open bracket), you should use a double open bracket if you want a real open bracket in your code (eg `[[`). This may lead to problems with for example embedded JavaScript - there might be a lot of brackets to escape. We recommend storing JavaScript into separate files wherever possible, but when this is impossible, you can use the open bracket.

For example, consider this code, which fills a JavaScript array using a HareScript record array:
```
<script type="text/javascript" language="javascript">
  var popup = new Array([num_items]);

  [forevery popup_item]
    popup [[[seqnr] ] = &#39;[text:java]&#39;;
  [/forevery]
</script>
```
The spaces between popup, the JavaScript brackets and the Witty code were added for clarity - they are not required. The &#39;:java&#39; specifies that the string should be encoded for use in Java(Script) - more on this later.

## Cell name lookups

Witty instructions that expect a cell name follow specific lookup rules to find a record containing that cell. This is done using a system of _scopes_ - every time your code &#39;opens&#39; a record by using a forevery or if block, this record is added as a new level of scope during the execution of that block. Whenever you specify a cell name, the Witty engine first looks for that cell in the most recently opened record. If it cannot find the cell there, it will look in the parent block, until it reaches the record originally passed to the Witty execution command (RunWitty or RunWittyComponent)

You can specify cells from a record contained in a cell by using the _dot_ syntax, as shown below:
```witty
**[cellname.subcellname]    ** [! get a cell from the record &#39;cellname&#39; !]

**[cellname.subcellname.subsubcellname]**  [! get a cell from a record in a record !]
```
This allows you to directly access data inside a record, without having to open the record using an _if_ or _forevery_ statement. The cell name lookup rules only apply to the first _cellname_ specified - as soon as a cell with a matching name was found, the Witty engine will look for the sub cell names inside this record (just like normal HareScript would)

HareScript code invoked using a function pointer in a Witty variable can use the %GetWittyVariable function to lookup a cell in the Witty data, using the above lookup rules. Additionally, any record passed to %CallWittyComponent is also added as a new scope level.

## Embedding external data

Most Witty instructions will only embed external data. There are two syntaxes to embed external data: one that automatically selects the proper encoding based on the Witty encoding (see Data encoding), or by explicitly specifying the encoding:
```witty
**[cellname]**            [! Print data with the default encoding !]

**[cellname:encoding]  ** [! Print data with the specified encoding !]
```
What exactly is printed depends on the type of the cell to which _cellname_ refers:

| Cell type | Effect |
| --- | --- |
| Integer | The value of the integer is printed |
| String | The string is printed, using the specified encoding |
| Function ptr | The function pointer is executed, and any Print statements done by the function are included in the Witty output. Output from a function pointer is never encoded! |

The following encodings are supported for strings:

| Encoding | Effect |
| --- | --- |
| none | No encoding (prints the string unmodified) |
| base16 | Base-16 encoding (hexadecimal) (%EncodeBase16)|
| base64 | Base-64 encoding (MIME) (%EncodeBase64)|
| value | Value encoding: escape all quotes, <, >, &amp; and linefeeds as HTML entities (%EncodeValue) |
| xml | XML encoding: a synonym for value encoding |
| html | HTML encoding: like value encoding, but remove carriage returns and encode linefeeds as &#39;<br />&#39; tags (%EncodeHTML)|
| xhtml | A synonym for HTML encoding |
| url | URL parameter encoding: encode data for use as parameter in a URL (%EncodeURL)|
| java | Java/JavaScript encoding: escape all quotes, backslashes and control characters with a backslash. (%EncodeJava)|
| json | Encode value as JSON (%EncodeJSON) |
| jsonvalue | Encode as JSON and then as value, needed when used in eg. HTML attributes (%EncodeJSON + %EncodeValue) |

## If-blocks

An if-block conditionally enters the following block if the data is 'truthy', ie it's not equal to the default value for that type (ie, it's not an empty string, the number zero, a non-existing record...)

An if-block can optionally contain an else-block, which is executed when the specified cell evaluates to false. You can also use `if not` to test for data being falsy:
```witty
[if cellname] text if true [/if]

[if not cellname] text if false [/if]

[if cellname] text if true [else] text if false [/if]
```
The text inside both the if-blocks and else-blocks may also contain other Witty instructions.

An if instruction supports cells of the following types - note that it supports more types directly than a plain if statement would in HareScript, but that you cannot build any expressions:

| Cell type | Effect |
| --- | --- |
| Boolean | Evaluates to true if the cell itself contains a true value |
| Integer | Evaluates to true if the cell contains a non-zero value |
| String | Evaluates to true if the cell contains a non-empty string |
| Record | Evaluates to true if the record is not a non-existing record (does not contain a default value)Additionally, the record is added as a new scope for cell name lookups |
| Function ptr | Evaluates to true if the cell contains a function or macro |
| Array | Evaluates to true if the array is not empty |

## Forevery-blocks

A forevery instruction repeats the containing block for every record contained in the record array that is specified as its argument. A forevery-block does not support any other type and does not allow an [else] block:
```witty
[forevery cellname]    [! cellname must reference a record array cell !]
  text to repeat
[/forevery]
```
A forevery instruction processes its array sequentially, and adds the current record as a new scope level for cell name lookups inside the forevery block. You can thus directly access the cells inside the current record, and should not access those cells using the original _cellname_ passed to the forevery instruction.

Inside a forevery-block, you can use a [seqnr] instruction to print the current (zero-based) element number. You can also use the following cell names to an if statement inside a forevery-block - they are automatically generated for every record array passed to a forevery instruction:

| Cell name | Effect |
| --- | --- |
| First | Evaluates to true if this is the first element in the record array |
| Last | Evaluates to true if this is the last element in the record array |
| Odd | Evaluates to true if _seqnr_  would give an odd value (ie: it iterates false, true, false, true,... in a forevery-block) |

As an example, the following code formats a record array of hyperlinks with alternating background colors:

```witty
[! links is our record array of links, containing a &#39;link&#39; and &#39;title&#39; cell !]

[forevery links]
  [if first]
    <table border="1">
  [/if]

      <tr bgcolor="[if odd]#EEEEEE[else]#FFFFFF[/if]">
        <th>
          Link [seqnr]
        </th>
        <td>
          <a href="[link]">[title]</a>
        </td>
      </tr>

  [if last]
    </table>
  [/if]
[/forevery]
```
## Components and embed

Components allow you to mark blocks as reusable, similar to HareScript macros. Code inside a component is never directly executed when it is encountered by a Witty engine, and can be placed anywhere you want in the Witty template. This allows you to put all components together at the beginning or end, or to put them at the position they would normally be embedded so you can see the context of the component.

Components are executed using the Witty _embed_ instruction, or by using the HareScript %RunWittyComponent or %CallWittyComponent commands.

The syntax of a component is just like that of any other block statement, except that the parameter passed to the component instruction is not that of a cell, but a name which can be used later to refer to the component:
```witty
[component componentname]
  component text
[/component]

...

[! to later embed this component: !]
[embed componentname]
```
Components have access to the record scopes as they were at the location where the _embed_ or HareScript component commands were invoked. Placing a _component_ block inside an _if_ or _forevery_ block does not give a component access to the records opened by these statements, nor will they be repeated or influenced by the evaluation result of the _if_ statement.

You can also use `rawcomponent` to specify a component where no Witty parsing or whitespace elimination will take place, and `[` doesn't need to be quoted. This is often used to embed HTML comments or JavaScript snippets where `[` is used in subscript operations. Some examples:

```witty
[rawcomponent analyticssnippet]
<script src="analytics.example.net/js"></script>
<script>analytics[0].push('data')</script>
[/rawcomponent]

[rawcomponent companytag]
<!--
  Developed by
  Widgets inc (c)(r)(tm) 2099
-->
[/rawcomponent]
```

Rawcomponents can be embeded using `[embed]` or %CallWittyComponent just like regular components
