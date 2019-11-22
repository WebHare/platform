# Pagelists
Pagelists allow you to setup sitemaps to help robots and Consilio find the pages
to index

## Getting links for a sitemap
You can use %GenerateSitemapLinks to get the sitemap links for a folder or site.

## Configuring a pagelist
A filetype can specify a custom pagelist provider to override the sitemap URL
gathering. Set it up with your `<filetype>` in your siteprofile:

```xml
  <filetype typedef="http://www.example.net/xmlns/myfiletype"
            pagelistprovider="myfiletype.whlib#MyPageListProvider"
            />
```

And implement the handler. This example returns two pages for each published myfiletype:

```harescript
LOADLIB "mod::consilio/lib/pagelists.whlib";

PUBLIC OBJECTTYPE TestPageListProvider EXTEND PagelistProviderBase
<
  UPDATE PUBLIC RECORD ARRAY FUNCTION GetSitemapLinks(RECORD fileinfo)
  {
    RETURN [[ link := fileinfo.link
            , title := fileinfo.title
            , modificationdate := fileinfo.modificationdate
            , priority := 1.0
            , changefreq := "daily"
            , consiliofields := DEFAULT RECORD
            ]
           ,[ link := fileinfo.subpagebaseurl || "birthday.html"
            , title := `Birthday of ${fileinfo.title}`
            , modificationdate := MakeDate(2019,6,13)
            , priority := 0.6
            , changefreq := "yearly"
            , consiliofields := [ birthdayfor := "Bob" ]
            ]
           ]
  }
>;
```

See %PagelistProviderBase::GetSitemapLinks for the cells in the record your filehandler will receive.

## Providing additional fields
`GetSiteMapLinks` can provide additional fields that will be stored with the
indexed pages by specifying a record containing these in `consiliofields`.
