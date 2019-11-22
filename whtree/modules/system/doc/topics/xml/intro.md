HareScript's XML libraries aim for conformance with [DOM Level 1](https://www.w3.org/TR/1998/REC-DOM-Level-1-19981001/)
and [DOM Level 2](https://www.w3.org/TR/2000/REC-DOM-Level-2-Core-20001113/) with the following limitations:

- Entity expansion and external DTDs are not supported. There are significant
  [security risks](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.md)
  associated with these options.
