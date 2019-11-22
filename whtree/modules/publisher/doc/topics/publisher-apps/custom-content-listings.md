# Custom content listings
Custom content listings allow you to change how the contents of a folder are presented
in the Publisher application.

To setup a custom content listing, you'll need to provide the code how to rearrange the
one- and two row layouts and activate this code for the specific folders using a siteprofile.

The following example sets up a custom listing for the /news/ folder in your site:
```xml
<apply>
  <to type="folder" pathmask="/news/" />
  <foldersettings>
    <contentslisthandler library="moduleroot::mymodule/include/internal/newslist.whlib" objectname="newslisthandler" />
  </foldersettings>
</apply>
```

You'll also need to provide the handler itself. An example implementation of NewsListHandler which simply deletes the status column:
```harescript
LOADLIB "module::publisher/hooks.whlib";

PUBLIC OBJECTTYPE NewsListHandler EXTEND ContentsListHandlerBase
<
  UPDATE PUBLIC RECORD ARRAY FUNCTION GetOneRowLayout()
  {
    RETURN [[ name := "name" ]
           ,[ name := "title" ]
           ,[ name := "modified" ]
           ];
  }

  UPDATE PUBLIC RECORD FUNCTION GetMultiRowLayout()
  {
    RECORD layout := ContentsListHandlerBase::GetMultiRowLayout();
    layout.rows := [[ cells := [[ name := "icon", rowspan := 2 ]
                               ,[ name := "name_noicon" ]
                               ,[ name := "modified" ]
                               ]
                    ]
                   ,[ cells := [[ name := "title", colspan := 2]
                               ]
                    ]
                   ];
    RETURN layout;
  }
>;
```

You will need to restart the filemanager to pick up any changes to the NewsListHandler code.

## ADDING COLUMNS
To add additional columns, your ListHandler will need to override the GetAddedColumns call
```harescript
  UPDATE PUBLIC RECORD ARRAY FUNCTION GetAddedColumns()
  {
    RETURN [[ name := "custom_sticky", type := "icon", title := "", sorttitle := "Sorteer op sticky", sortkeyname := "custom_stickysort" ]
           ,[ name := "custom_date",   type := "date", storeutc := TRUE, title := "Publicatie", sorttitle := "Sorteer op datum" ]
           ];
  }
```

And you will need to provide the actual columns by overriding the OnMapItems call, for example:

```harescript
  UPDATE PUBLIC RECORD ARRAY FUNCTION OnMapItems(INTEGER parentfolder, RECORD ARRAY items)
  {
    INTEGER pinnedicon := this->GetListIcon("tollium:status/pinned");
    items := SELECT *, custom_sticky := 0, custom_stickysort := 0, custom_date := DEFAULT DATETIME FROM items;

    FOREVERY(OBJECT type FROM [this->adtnewstype, this->adtimagetype, this->adtvideotype, this->adtbannertype])
    {
      items := type->Enrich(items, "ID", [ "sticky", "date" ]);
      UPDATE items SET custom_sticky := pinnedicon
                     , custom_stickysort := -1
                     , custom_date := date
                 WHERE items.type = type->id AND items.sticky;

      items := SELECT *, DELETE sticky, DELETE date FROM items;
    }
    RETURN items;
  }
```

Your OnMapItems call will receive an array of 'id' and 'type' and can use the GetListIcon call to request a new icon.
