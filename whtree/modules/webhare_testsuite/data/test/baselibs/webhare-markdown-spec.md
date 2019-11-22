# Webhare Flavored Markdown (WFM) specification

WebHare uses "WebHare Flavored Markdown" (WFM) for documentation. It is an extension of the [CommonMark specification](https://spec.commonmark.org/current/).

# Blocks

## Tables

WebHare also allows the GitHub Flavored Markdown table extension. The following tests are based on
the [GitHub Flavored Markdown specification](https://github.github.com/gfm/#tables-extension), with some
adjustments to the HTML rendering, and parsing of inline content.

A paragraph is converted to a table if the second line is a valid delimiter row. The first line is then parsed as
a table line. If the number of cells match, the paragraph is converted to a table.

Parsing of a table row is done by parsing it as a paragraph. All top-level, non-escaped pipes are used as separators.
This means that pipes inside emphasis aren't used as separators.


GFM enables the table extension, where an additional leaf block type is available.

A table is an arrangement of data with rows and columns, consisting of a single header row, a delimiter row separating the header from the data, and zero or more data rows.

Each row consists of cells containing arbitrary text, in which inlines are parsed, separated by pipes (|). A leading and trailing pipe is also recommended for clarity of reading, and if there’s otherwise parsing ambiguity. Spaces between pipes and cell content are trimmed. Block-level elements cannot be inserted in a table.

The delimiter row consists of cells whose only content are hyphens (-), and optionally, a leading or trailing colon (:), or both, to indicate left, right, or center alignment respectively.


```````````````````````````````` example
| foo | bar |
| --- | --- |
| baz | bim |
.
<table>
<thead>
<tr>
<th>foo</th>
<th>bar</th>
</tr>
</thead>
<tbody>
<tr>
<td>baz</td>
<td>bim</td>
</tr>
</tbody>
</table>
````````````````````````````````

Cells in one column don’t need to match length, though it’s easier to read if they are. Likewise, use of leading and trailing pipes may be inconsistent:

Example 192
```````````````````````````````` example
| abc | defghi |
:-: | -----------:
bar | baz
.
<table>
<thead>
<tr>
<th align="center">abc</th>
<th align="right">defghi</th>
</tr>
</thead>
<tbody>
<tr>
<td align="center">bar</td>
<td align="right">baz</td>
</tr>
</tbody>
</table>
````````````````````````````````
Include a pipe in a cell’s content by escaping it, including inside other inline spans:

Example 193
```````````````````````````````` example
| f\|oo  |
| ------ |
| b `\|` az |
| b **\|** im |
.
<table>
<thead>
<tr>
<th>f|oo</th>
</tr>
</thead>
<tbody>
<tr>
<td>b <code>\|</code> az</td>
</tr>
<tr>
<td>b <strong>|</strong> im</td>
</tr>
</tbody>
</table>
````````````````````````````````
The table is broken at the first empty line, or beginning of another block-level structure:

Example 194
```````````````````````````````` example
| abc | def |
| --- | --- |
| bar | baz |
> bar
.
<table>
<thead>
<tr>
<th>abc</th>
<th>def</th>
</tr>
</thead>
<tbody>
<tr>
<td>bar</td>
<td>baz</td>
</tr>
</tbody>
</table>
<blockquote>
<p>bar</p>
</blockquote>
````````````````````````````````
Example 195
```````````````````````````````` example
| abc | def |
| --- | --- |
| bar | baz |
bar

bar
.
<table>
<thead>
<tr>
<th>abc</th>
<th>def</th>
</tr>
</thead>
<tbody>
<tr>
<td>bar</td>
<td>baz</td>
</tr>
<tr>
<td>bar</td>
<td></td>
</tr>
</tbody>
</table>
<p>bar</p>
````````````````````````````````
The header row must match the delimiter row in the number of cells. If not, a table will not be recognized:

Example 196
```````````````````````````````` example
| abc | def |
| --- |
| bar |
.
<p>| abc | def |
| --- |
| bar |</p>
````````````````````````````````
The remainder of the table’s rows may vary in the number of cells. If there are a number of cells fewer than the number of cells in the header row, empty cells are inserted. If there are greater, the excess is ignored:

Example 197
```````````````````````````````` example
| abc | def |
| --- | --- |
| bar |
| bar | baz | boo |
.
<table>
<thead>
<tr>
<th>abc</th>
<th>def</th>
</tr>
</thead>
<tbody>
<tr>
<td>bar</td>
<td></td>
</tr>
<tr>
<td>bar</td>
<td>baz</td>
</tr>
</tbody>
</table>
````````````````````````````````
If there are no rows in the body, no <tbody> is generated in HTML output:

Example 198
```````````````````````````````` example
| abc | def |
| --- | --- |
.
<table>
<thead>
<tr>
<th>abc</th>
<th>def</th>
</tr>
</thead>
</table>
````````````````````````````````

# Inlines

## Webhare symbol reference

A <a id="webhare-symbol-reference">WebHare symbol reference<a> is a reference to a public symbol. It consists of a '%' followed by
a <a href="#webhare-token">WebHare token</a>, and optionally a seperator (':' or '::') and another <a href="#webhare-token">WebHare token</a>.
No whitespace is allowed inside the reference.

A <a id="webhare-token">WebHare token<a> is a sequence starting with an ASCII letter or `_`, and followed by any combination of ASCII letters, digits, or `_`.


The following WebHare symbol references are valid:
```````````````````````````````` example
%token
.
<p><a href="%25token">token</a></p>
````````````````````````````````

```````````````````````````````` example
%token:sub1, %token::sub2
.
<p><a href="%25token:sub1">token:sub1</a>, <a href="%25token::sub2">token::sub2</a></p>
````````````````````````````````

Whitespace is not allowed. The symbol reference is parsed as much as possible.
```````````````````````````````` example
%token::1, % token::sec, %token :bla, %token: bla
.
<p><a href="%25token">token</a>::1, % token::sec, <a href="%25token">token</a> :bla, <a href="%25token">token</a>: bla</p>
````````````````````````````````

