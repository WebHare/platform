# dompack-overlay

## Usage
To integrate into your project:

Select a class, eg 'myoverlays', to use for the overlays

The JavaScript part:
```
import * as dompack from "@webhare/dompack";
import { OverlayManager } from "@webhare/dompack-overlays";

// .....

let overlaymgr = new OverlayManager(mynode, "myoverlay");
overlaymgr.add({ left: 5, top: 50, width: 50, height: 150 });

```

The SCSS part
```
@import "@webhare/dompack-overlays/styles/mixins";

.myoverlay
{
  @include dompack-overlays;
  @include dompack-overlays-example-styling;
}
```

## API
### OverlayManager.add(options)
Add a new overlay. Returns a `ResizableOverlay`

### OverlayManager.getSelection()
Returns the currently selected `ResizableOverlay`s

## Events
### dompack:overlay-selectionchange
- bubbles: true
- cancelable: false

fired when the currently selected ResizableOverlay changes

## Development
This package is part of the [WebHare Platform](https://www.webhare.dev/)
