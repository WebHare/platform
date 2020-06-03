# Publisher index
The publisher index is a built-in catalog which indexes all sites and implements the Publisher Search

## Custom search providers
moduledefinition.xml:
```xml
  <publisher>
    <searchcontentprovider name="myprovider" objectname="lib/search/searchproviders.whlib#MyProvider" version="1.0.0" />
  </publisher>
```

Searchproviders should update their `version=` when their (search) preview changes in a way that requires reindexing.

You can then specify a `searchcontentprovider=` with a filetype.

Widgettypes should set/update a `indexversion=` when their (search) preview changes in a way that requires reindexing.

## Adding folders to WHFS index
By default the WHFS Index adds all sites. You can additionally have content in a `/webhare-private/` folder indexed
by adding this through the moduledefinition.xml:

```xml
  <consilio>
    <addtowhfsindex privatefolder="addtowhfsindex/anywhere" />
  </consilio>
```

This would index `/webhare-private/<yourmodulename>/addtowhfsindex/anywhere`.

Any folder you add is normally indexed after all sites are indexed. You can change this by setting the `priority` attribute
to `beforesites` or even `beforerepository`
