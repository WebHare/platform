# Events

Events used internally in WebHare (eg by %BroadcastEvent). These are subject to change between releases!


## System events
Please note that new code should not rely on `system:clearcaches` or `system:softreset` and any existing user should
start converting to more specific events.

### `system:clearcaches`
Flushes all adhoc caches

Effect in C++ code: clears HareScript VM caches (TCP/IP context and any DLL callbacks).

This event should never be directly listened to.

### `system:config.rights`
Fired when rights or objecttypes have appeared or been removed. This event is NOT fired after right grant/removals or role creation.

### `system:config.servertype`
This event is fired whenever the servertype (eg. development, production) is changed.

### `system:config.webserver`
Fired when the webserver configuration (eg. hostnames, accessrules, aliases) is changed

### `system:sitesupdate`
Fired when a site is added or removed

### `system:modulesupdate`
Fired when a new module is installed or a moduledefinition.xml changes

### `system:precalccache.updated`
Fired when the system.precalccache table changed

### `system:registrychange.<keyname>`
Fires when a registry key is changed using the registry key APIs.
Eg, if setting whfs.versioning.showwhfshistory is changed, an event
'system:registrychange.whfs.versioning' will fire on commit.

### `system:softreset`
Effect in C++ code: reloads module name->directory mapping, updates module list

This event is deprecated and should not be listened to by new code

## WHFS events
### `system:whfs.folder.<folderid>`
Updates to objects in the specified folder(s).

### `system:whfs.site.<siteid>`
Updates to objects in the specified site.

### `system:whfs.types`
Fired if any WHFS Type had its metadata changed

## WRD events

### `wrd:type.<typeid>.change`
An entity of the specified type was changed. This event receives are record with the list of updated entities

### `wrd:schema.<schemaid>.change`
The metadata of the specified schema changed

### `wrd:schema.list`
The list of schemas on this server changed (new schema added, one got renamed, etc)
