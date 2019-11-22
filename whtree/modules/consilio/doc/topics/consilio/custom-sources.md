# Consilio suggest when custom indexing is used.
Add in the return for the function FetchObject, field in record 'document_fields' the field 'suggestfields'.
suggestfields is a string with each field used for suggestions is space separated. Empty string for hidden pages

Example:
```harescript
  RETURN [ status := "result"
         , document_fields :=
           [ title := title
           , suggestfields := hidepage ? '' : 'title description'
           ]
         ];
```
