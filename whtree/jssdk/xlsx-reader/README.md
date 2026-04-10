# @webhare/xlsx-reader

This XLSX parser is based on [xlsx-stream-reader](https://github.com/DaSpawn/xlsx-stream-reader) originally written by [Brian Taber](https://github.com/DaSpawn) and [Kirill Husyatin](https://github.com/kikill95) and released under the MIT license. Streaming the source XLSX file has been removed as WebHare will generally have random access to XLSX files.

Example usage

```ts
  //Streams directly to an array:
  const workBookReader = await openXlsxFromDisk('morecoltypes.xlsx');
  const rows: XlsxRow[] = await Array.fromAsync(workBookReader.openSheet(0).rows());
```

The `rows` are in a 'raw' array-of-array format. Use `@webhare/tabular-files` to parse the raw rows into an array of objects with expected headers, types and validations:

```ts
  const workBookReader = await openXlsxFromDisk('morecoltypes.xlsx');
  const tabularData = await Array.fromAsync(workBookReader.openSheet(0).rows());
  const importMap = {
    stringCol: { header: "String Column" },
    numberCol: { header: "Number Column", type: "number" },
    dateCol: { header: "Date Column", type: "date" },
    boolCol: { header: "Boolean Column", type: "boolean" }
  } as const;
  const result = parseTabularData(importMap, tabularData);
```

References

-----------
* [Working with sheets (Open XML SDK)][msdnSheets]
* [Row class][msdnRows]

[msdnRows]: https://msdn.microsoft.com/EN-US/library/office/documentformat.openxml.spreadsheet.row.aspx
[msdnSheets]: https://msdn.microsoft.com/EN-US/library/office/gg278309.aspx
