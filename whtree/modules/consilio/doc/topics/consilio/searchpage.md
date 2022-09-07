# Consilio searchpage

To install the searchpage you need to create a file of type `http://www.webhare.net/xmlns/consilio/searchpage`
in the site. By default, the searchpage will use the best catalog (from %GetConsilioPublisherCatalog) for its folder.

You can setup an `<allowfiletype typemask="http://www.webhare.net/xmlns/consilio/searchpage" />` apply rule to allow
end users to create these search pages (but most sites will only have one search page anyway, so it's often best to
have the sysop create the searchpage and pin it)

## Customizing the search presentation
You can define a witty to override components. Refer to a witty using a searchpage plugin:

```xml
  <apply>
    <to ... />
    <searchpage witty="witty/basetest-searchpage.witty" />
  </apply>
```

and override one or more of the following components:
- `searchpage`: The content area of the searchpage
- `searchheader`: The search form
- `searchresults`: The list of search results
- `searchresult`: An individual search result

See searchpage.witty for examples.
