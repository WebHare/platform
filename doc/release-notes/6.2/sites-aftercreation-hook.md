## Breaking changes

### The `publisher:sites_aftercreation` module hook has been removed
WebHare no longer runs the `publisher:sites_aftercreation` hook when a site is created, and the hook target is gone
from the Publisher's module definition. No known module used it. If your module intercepts this hook, remove the
`<intercept>` and listen to the `system:sites` event instead, which is broadcast when the creation of a site is
committed.
