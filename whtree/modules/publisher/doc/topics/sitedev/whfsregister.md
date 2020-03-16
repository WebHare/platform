# WHFS Register
The WHFS register is a central storage of links to important files and folders.
Use this for 'where is my site? where is the project overview?' questions which
can have only one valid answer per server (ie, where you would otherwise have to
hardcode sitenames and folderpaths)

The register is not intended for objects that are unique per site - setting a
contenttype on the site's root folder should suffice for that.

The WHFS register has been added in WebHare 4.13

## USING THE REGISTER

Add a `<registerslot>` to your moduledefinition's publisher section

```xml
  <publisher>
    <registerslot name="<slotname>"
                  tid="<title>"
                  descriptiontid="<description>"
                  initialvalue="<whfs:: or site::>"
                  type="<folder>/<file>/<site>" />
  </publisher>
```


Instead of tid and descriptiontid, you can use title and description attributes with plain texts. The initialvalue attribute is optional - if used, this value will be looked up and set on first use.

To use the API, use LookupInWHFSRegister with the name of your slot, eg

```harescript
INTEGER newsfolder := LookupInWHFSRegister("mysupersite:news");
```

%LookupInWHFSRegister will never return 0, but will throw and explain which slot was not yet configured in its exception. It may, however, return ids of deleted objects..

## Fallback value
The `<registerslot>` can specify a 'fallback' which will be returned if the slot is unset and can't find its initial value. If the fallback value exists and is returned
it will not be 'set' as the value for the slot so the registerslot won't follow the file if it's moved. Fallback values are mostly useful for tests to specify an alternative
testing version of a register slot
