# Publisher index
The publisher index is a built-in catalog which indexes all fs_objects and implements the Publisher Search

## Custom search providers
moduledefinition.xml:
```xml
  <publisher>
    <searchcontentprovider name="myprovider" objectname="lib/search/searchproviders.whlib#MyProvider" version="1.0.0" />
  </publisher>
```

Searchproviders should update their `versionn=` when their (search) preview changes in a way that requires reindexing.

You can then specify a `searchcontentprovider=` with a filetype.

Widgettypes should set/update a `indexversion=` when their (search) preview changes in a way that requires reindexing.
