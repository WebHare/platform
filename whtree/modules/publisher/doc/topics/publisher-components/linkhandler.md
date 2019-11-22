# Link handler
The linkhandler is a simple JS library shipped with WebHare to open all external links in a new tab/window

```javascript
   import { openLinksInNewWindow } from '@mod-publisher/js/linkhandler';
   openLinksInNewWindow();

   openLinksInNewWindow( { options... } );
```

Supported options are:

- internalhosts: A list of hosts that are considered local. If unset, the current host and its www/non-www prefixed variant are considered local

- extensions: A list of extensions for URLs that will also be considered to be external (sometimes used for PDF). The extensions should not start with a dot.

The linkhandler works by setting the target to `_blank` when the link is clicked to ensure it plays nice with existing link tracking scripts (which might fail if we cancelled the event and did a window.open). `<a>` click events which are cancelled are ignored.

Links to non http/https locations, `<a download>` links and links which already have a target attribute, are all ignored. You can override the 'open in new window' behaviour for a specific link by setting `target="_self"`
