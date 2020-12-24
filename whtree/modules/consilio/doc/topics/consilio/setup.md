# Setting up Consilio

Consilio catalogs are owned by a module and specified in their moduledefinition.xml:

```xml
  <consilio>
    <catalog tag="testsitecatalog" />
  </consilio>
```

Individual sites can add themselves using `sitesettings` in their siteprofiles


```xml
  <sitesettings>
    <addtocatalog catalog="testsitecatalog" />
  </sitesettings>
```

## ongetsources

For more complex scenarios you can define a function that will return the content
sources for your catalog and pass it as an `ongetsources=` option to your catalog.
This function should return a record array with an `fsobject` member listing the folder to index.

Example:
```xml
  <consilio>
    <catalog tag="testsitecatalog"
             ongetsources="lib/sources.whlib#GetCatalogSources" />
  </consilio>
```

```harescript
PUBLIC RECORD ARRAY FUNCTION GetCatalogSources()
{
  RETURN SELECT fsobject := id
           FROM system.fs_objects
          WHERE type = 2; //index all system folders
}
```

## Legacy catalogs
Legacy catalogs may not follow the `module:tag` naming convention. We recommend
creating new catalogs using the above syntax and switching your code to use
`mod::consilio/lib/api.whlib` for searches (ie RunConsilioSearch).

You may opt for a multi-step approach to migrate without search downtime:
- push the new catalog names and content sources first, wait for this index to be complete
- switch your code to use the new consilio api and catalog
- when satisfied, remove code setting the old catalogs
- remove the old catalogs manually
