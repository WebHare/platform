# WebHare Connect

This document aims to describe all the pieces involved in
[WebHare Connect](https://www.npmjs.com/package/webhare-connect-helper)
and what you need to do to develop/debug on it.

## Troubleshooting and tips
You can enable the debugflag `whc` to debug traffic to and from WebHare connect.
For full debugging, you need to turn this flag on for both the WebHare backend
and https://connect.webhare.com/ (or your local instance)

## SECURITY IMPLICATIONS
The WebHare Connect infrastructure is experimental and by its vary nature it
will have various serious security implications. Securing it is an ongoing
effort but we offer no warranty and you should probably not run this on
production systems yet.

Issues and comments about potential issues and how to solve them are very much
appreciated.

# The Pieces

## WebHare Backend
The backend loads the whconnect library. If you rightclick on the WebHare menu
button in the topleft corner and the option 'Mount server over WebDav' does not
appear, you need to enable https://connect.webhare.com/

## whconnect library
The module `@mod-system/js/whconnect.es` is the bridge from local JavaScript
to the connect website (it loads https://connect.webhare.com/ into a hidden iframe)

## connect.webhare.com
https://gitlab.b-lex.com/b-lex/webhare_com

https://connect.webhare.com/ hosts the site which serves as the conduit between
a WebHare server and your local machine. You need to visit this site and press
the `Activate` button to enable the connection - otherwise, connect.webhare.com
will ignore all communication

If you want to develop on connect.webhare.com, you need to set `localStorage["tollium-connecturl"]`
to your local version, eg:

```
localStorage["tollium-connecturl"]="https://secure.moe.sf.b-lex.com/connect.webhare.com/"
```

Please note that you need to do this with eg. the WebHare backend open, not on
the connect website itself.

## webhare connect helper
https://github.com/WebHare/connect-helper

This service listens on https://connect-local.webhare.com:7521/ - connect-local
resolves to 127.0.0.1 and the connect-helper ships with a signed certificate
for this name to avoid browser errors.

## sublime extensions
The https://github.com/WebHare/sublime-package integrates WebHare into Sublime
and offers:

- symbol search
- stack trace
- documentation lookup
- code search
- running Harescript code
- syntax validation
... ?

The repository https://github.com/WebHare/sublime-linter contains the source
for SublimeLinter-contrib-hslint, a SublimeLinter plugin that provides
linting for WebHare sourcecode.

## WebDav extensions

A hidden file with the name `.wh-webdavinfo-XXXXXX` where `XXXXXX` is a random
string is available for sysops in every WebHare webdav folder. This file explains
how to access the WebHare services for this server, and gives a shortlived access
token.

eg
```
cat /Volumes/webhare.moe.sf.b-lex.com/system/modules/system/.wh.webdavinfo-1234567
```

# Development etc
Some parts of the integration still live in https://gitlab.b-lex.com/webhare/blex_alpha

## Commit checklist
- Are any Sublime Helper changes committed?
  - Does a new version need to be pushed ?
- Are any connect.webhare.com changes committed?
  - Have these changes been pushed to CMS1 ?
