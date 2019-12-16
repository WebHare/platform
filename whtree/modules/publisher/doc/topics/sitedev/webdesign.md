# Webdesign
The webdesign is the base object (generally derived from %WebDesignBase) which
implements the design of your website. The code is generally shared by all
static and dynamic pages in your website

## Witty fields
The webdesign implements the following witty fields which are available to all
pages (unless overridden by your pageconfig)

### sitelanguage
A record containing a boolean cell for each language code listed in the `<assetpack supportedlanguages=`
to determine which language code (the siteprofile `<sitelanguage lang=>`) is currently active.

Eg. if your site has an English and a Dutch version, `[if sitelanguage.en]` would
evaluate to FALSE and `[if sitelanguage.nl]` would evaluate to TRUE. Trying to
evaluate `[sitelanguage.de]` would throw unless German was also added to the asset packs' supported languages.
