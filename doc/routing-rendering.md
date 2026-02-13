# Routing & rendering in WebHare
Basic routing flow once a router (a WebRequest => WebResponse function) decides it wants to render a page inside a site:
- buildContentPageRequest takes the WebRequest to build a ContentPageRequest
- getPageRenderer (hidden API) figures out which function will render that page (usually based on type)
- The render function is invoked with the ContentPageRequest and is expected to return a WebResponse
- that renderer function eventually invokes ContentPageRequest.buildWebPage(html)
- ContentPageRequest.buildWebPage will initialize plugins
- ContentPageRequest.buildWebPage will then look up the pageBuilder function for the current webdesign
- The pageBuilder takes a PageBuildRequest (more or less the same ContentPageRequest as above) and returns a WebResponse.
- That render function eventually invokes PageBuildRequest.render({head,body})
- We send the WebResponse


## Mixed language scenarios

### pageBuilder (JS) based rendering
`getPageRenderer` supports rendering HareScript pages, both dynamic and static. The aim is to be compatible 'out of the box'
with pages that don't interface with specific WebDesign implementations or plugins (eg publisher forms).

HareScript pages that deeply interface with their webdesign will need some modifications (just like they would
if you were to run them from a HareScript webdesign they didn't expect)

The actual handling is in `runHareScriptPage` which
- Sets up a HSVM
- Invokes a hs-pagehost.whlib's entrypoint, transferring control to HareScript (in WASM)
- hs-pagehost sets up a simple webdesign object (HSPageHostWebdesign) as HareScript pages expect this interface
- For dynamic request, hs-pagehost uses MockSHTMLContext to handle calls to eg GetWebVariable
- All output is captured and returned back to `runHareScriptPage`

### HareScript webdesigns
HareScript webdesigns can invoke pages with JS-based renderers (eg. markdown files). This is handled
by `captureJSPage`. This route currently only supports static pages.
