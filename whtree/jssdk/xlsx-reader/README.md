# @webhare/xlsx-reader

This XLSX parser is based on [xlsx-stream-reader](https://github.com/DaSpawn/xlsx-stream-reader) originally written by [Brian Taber](https://github.com/DaSpawn) and [Kirill Husyatin](https://github.com/kikill95) and released under the MIT license. Streaming the source XLSX file has been removed as WebHare will generally have random access to XLSX files.

|Key|Default Value|Description|
|---|---|---|
|verbose|true|throw additional exceptions, if `false` - then pass empty string in that places|
|formatting|true|should cells with combined formats be formatted or not|

For example usage see `test_xlsx_reader`


References

-----------
* [Working with sheets (Open XML SDK)][msdnSheets]
* [Row class][msdnRows]

[msdnRows]: https://msdn.microsoft.com/EN-US/library/office/documentformat.openxml.spreadsheet.row.aspx
[msdnSheets]: https://msdn.microsoft.com/EN-US/library/office/gg278309.aspx
