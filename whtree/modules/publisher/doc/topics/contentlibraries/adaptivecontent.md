# Adaptive content

An adaptive content store consists of one or more 'slots'. Adaptive content slots have a type and can contain zero or more
widgets. They will show zero or one widget, depending on the conditions associated with these widgets.

At places where content is inserted (either template-defined or in RTDs) you refer to one of these slots. Insertion locations
will limit which slot types are avaialble there (eg only header notifications or call-to-action elements)

Technically, all widgets in a slot are inserted into the HTML but rendered inside a `<template>` element to keep them inert.
As soon as one is chosen for display it goes through a `dompack.registerMissed` to activate any needed elements and it will
be inserted after the template element.

```xml
  <apply>
    <to type="all" />
    <setlibrary name="publisher:slots">
      <source path="site::mysite/slots/" />
    </setlibrary>
  </apply>
```

## Configuration

Set up a foldertype for every slot type and use allowfiletype to set up which widget types are acceptable in this slot

```xml
  <foldertype namespace="http://www.example.net/xmlns/mymodule/headerslot">
  </foldertype>

  <apply>
    <to type="file" parenttype="http://www.example.net/xmlns/mymodule/headerslot" />
    <denyfiletype typedef="*" />
    <allowfiletype typedef="http://www.example.net/xmlns/mymodule/headeroption1" />
    <allowfiletype typedef="http://www.example.net/xmlns/mymodule/headeroption2" />
  </apply>
```

You also need to allow these foldertypes for your content store. Eg if your slots are in 'site::My site/slots/':

```xml
  <apply> <!-- this apply rule needs to be made to apply to site 'My site' -->
    <to type="folder" parentmask="/slots/" />
    <denyfoldertype typedef="*" />
    <allowfoldertype typedef="http://www.example.net/xmlns/mymodule/headerslot" />
    <allowfoldertype typedef="http://www.example.net/xmlns/mymodule/contentslot" />
  </apply>
```

If your content store is in `/webhare-private/`, you need a globally applied siteprofile (applied directly through the
moduledefinition `<publisher><siteprofile …`) and use `whfspathmask` in the apply rules.

If you have problems adding slots and CTAs in the adaptive content app (eg you get errors about no types being available)
check whether you can add the necessary folder/files directly in the Publisher, as the content app should be using the same
site profiles.

Setup a startupscript to invoke `OpenAdaptiveContentStore(<rootfolderid>, [ ensure := TRUE ]);`

Only widgettypes are allowed - any other filetype is ignored. And with widget types, only widgets using a tabsextension for
their editor will be supported for content editing.

## File-level adaptive content

Example: per-file 'call to action' in header or sidebar

- Add a `<whfsref>` member to the file's content type
- Add a `xmlns:p="http://www.webhare.net/xmlns/publisher/components"` to your toplevel XML node
- Add a `<p:slot composition="contentdata" cellname="<membername>"  slottypes="http://www.example.net/xmlns/mymodule/headerslot"/>`

Add in pageconfig something like:

```harescript
RECORD fileinstancedata := this->targetobject->GetInstanceData(mynamespace);
connect_headercta :=  PTR RenderAdaptiveContentSlot(this, fileinstancedata.<membername>)
```

Add import rule in main es file and and run adaptivecontent.setup
```javascript
import * as adaptivecontent from '@mod-publisher/js/contentlibraries/adaptivecontent';

adaptivecontent.setup();
```

