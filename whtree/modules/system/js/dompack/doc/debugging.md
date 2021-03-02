WARNING: this documentation was written when dompack was a separate module and may be out of date

# Debugging
The dompack offers a simple framework to control and pass debug settings to components.

## Well known flags
- bus: Enable busy flag logging and allow listCurrentBusyLocks() in the console
- key: Debug the extra/keyboard handler

## Testing a flag
```
import * as dompack from 'dompack';
if (dompack.debugflags.myflag)
{
  console.log('[myflag] ....')
}
```

## Setting a debug flag
```
import * as dompack from 'dompack';
dompack.addDebugFlags(['myflag']);
```

## Allowing to set debugflags on the url (?dompack-debug=flag,flag,flag or #dompak-debug)
```
import * as dompack from 'dompack';
dompack.parseDebugURL('dompack-debug');
```

For every flag set using parseDebugURL, a dompack--debug-<flagname> class is
applied to the `<html>` element

## Advanced debug flag setting
WebHare offers a central page hosted on all sites (/.publisher/debug) which
allows users to toggle debug flags on and off. A library that is loaded into
every site (@webhare-system/wh/integration) ensures that the cookies from
/.publisher/debug are supported, and that any ?wh-debug= url variables are read.
