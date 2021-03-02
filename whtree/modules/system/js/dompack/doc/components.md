WARNING: this documentation was written when dompack was a separate module and may be out of date

# Building components

- components should be selector-based and register with dompack.register
- components should use flagUIBusy to mark moments where interaction is unsafe

## 'Busy' framework
Components can mark the interface as being 'busy' by requesting a lock using `flagUIBusy`. The interface
should be marked as busy when interacting (eg clicking) with elements may be unsafe, eg due to running
transitions, XHR requests...

The testframework can use these busylocks to avoid interaction when elements are still busy, even when
event handlers chain to each other and start new 'actions'. A `test.wait('ui')` in a test completes
when no busy handlers are running for at least one 'tick'.

The lockmanager used by the busy framework automatically links up with parent
frames where possible (ie on the same domain)

### Using locks
```
let lock = dompack.flagUIBusy();
try
{
  //do something
}
finally
{
  lock.release();
}
```

flagUIBusy supports the following flags

- ismodal: request a modality layer to be activated
- component: the component to be locked

when any 'ismodal' busy locks is present, the `dompack--busymodal` class is set on the `html` element, and a dompack:busymodal
with `{detail: { islock: true }}` is fired. When the last modal lock has been released, the class is removed and the event
is fired with `{detail: { islock: false }}`. The busy framework will wait for at least one 'tick' before removing the class
and sending the event

### Debugging
To look for stuck locks, type the following into the console:
`window.$dompack$busylockmanager.logLocks()`

Stacktraces are recorded only if the 'bus' debugflag has been enabled
