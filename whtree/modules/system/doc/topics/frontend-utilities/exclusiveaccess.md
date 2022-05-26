# Gettting exclusive access to a resource in the frontend

Using the `@mod-system/js/wh/exclusiveaccess.es` module, you can get a lock
on a (string-identified) resource. This uses the a same infrastructure as
the Tollium GetExclusiveAccess API.

## Considerations
Locks can be stolen by other users at arbitrary times. In Tollium, this
ususally isn't a big problem, because code running under a lock is usually
synchronous, so locks can't be stolen while the code is running. In the
web frontend, manipulations are usually done by RPCs that are decoupled
from the locking logic.

To solve this, the API provides the user with a lock token. With this
token, the user can call GetExclusiveLockRPCMutex (from mod::tollium/lib/applications.whlib)
that guarantees that the lock is active at the moment that function is called.
Also, that function returns a mutex lock that prevents other users from getting
a lock on the resource. You should not hold on to this lock for a long time,
as no feedback is given to the other users.

## Using the dialog-API
The easiest way to lock a resource is using `getExclusiveAccessWithDialog`.
This function will show dialogs using the dompack dialog-api, and uses
dompack modal UI-busy locks to lock the interface while obtaining the requested
lock. The dialogs contents can be overridden using the callbacks.

Example:

```javascript
let lock;
try
{
  lock = await getExclusiveAccessWithDialog("resource-id",
    { realname: "Henk Testuser", entityid: 7 },
    { onAlreadyLocked: (realname, login) => <div>Already locked by {realname || login}. Take over?<div>
    , onLockStolenShown: () => { /* lock was stolen and the user acknowledged it, navigate away */ }
    , buttontitles: { yes: "YES!" }
    });
}
catch (e)
{
  // obtaining the lock failed, navigate away
}

// guard against lock stealing
lock.addEventListener("close", () => lock = null);

// .. show some ui, interact with user

if (lock)
{
  // ... call RPC editresource, passing lock.token
}

if (lock)
  lock.release();
```

```harescript
MACRO RPC_EditResource(STRING locktoken, RECORD editdata)
{
  OBJECT lock := GetExclusiveLockRPCMutex(locktoken);
  TRY
  {
    ... perform the edit
  }
  FINALLY
    lock->Release();
}
```

## Compatibility with Tollium GetExclusiveAccess
The web frontend only supports strings as identifiers, while the tollium API
allowes arbitrary HareScript values. You can translate the web frontend
identifiers to Tollium identifiers wby wrapping them in a record, with
the identifier in the cell `jslock`. Eg:
```harescript
  this->GetExclusiveAccess([ jslock := identifier ]);
```
