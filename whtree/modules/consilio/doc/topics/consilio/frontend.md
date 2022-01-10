# Consilio frontend integration

## Suggest API
Consilio offers a JavaScript API to implement suggestions. To call it, you need
to create an accesstoken for your catalog. The easiest way is to add the token
to the site configuration in your webdesign:

```harescript
LOADLIB "mod::consilio/lib/api.whlib";

    INSERT CELL consiliotoken := GetConsilioRPCToken("example:catalog", [ autosuggest := TRUE ])
           INTO this->jssiteconfig;
```

If your consilio catalog contains non-public content you need to more careful
where you distribute the access token as autosuggest may leak index content.
