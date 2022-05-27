# Tollium internals

## Module layout

### shell
Scoping: our BEM identifiers should start with `wh-shell` (expect for Tollium components and other (semi-) independent objects.

### webdesigns/webinterface
The Tollium Webinterface webdesign implements the WebHare backend itself. It's primarily used for the Application Portal
but may also be used for error pages, debug configuration, and other page helpers

Scoping: our BEM identifiers should start with `wh-backend`

### webdesigns/webinterface/pages/applicationportal
This filetype implements the actual Application Portal as SPA
