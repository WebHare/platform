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
