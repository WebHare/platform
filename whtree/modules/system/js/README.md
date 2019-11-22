- compat/
Basic polyfills/libraries to plug holes in ES and browsers (generally requires a browser)

- dom/
DOM utilities and polyfills (requires a browser)

- internal/
Not supported, may still move around/change a lot.

- net/
Internet stuff (JSONRPC), not browser dependent (or at least, shouldn't be, but WHBase.debug might pull in Cookie - that needs to be resolved...)

- util/
Utilities, preferably free-standing code (hardly any dependencies), not browser dependent

- wh/
Libraries to access WebHare specific functionality

Candidates for externalizing (unstable, not needed in our core?)
- dom/resizelistener
