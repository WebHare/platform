WARNING: this documentation was written when dompack was a separate module and may be out of date

# Movable

Canonical usage
```
import * as movable from 'dompack/browserfix/movable';

node.addEventListener("dompack:movestart", evt => this.onMoveStart(evt));
node.addEventListener("dompack:move",      evt => this.onMove(evt));
node.addEventListener("dompack:moveend",   evt => this.onMoveEnd(evt));

movable.enable(node); //enables firing of dompack:move* events

onMove(evt)
{
  console.log(`Element move: relative x: ${evt.detail.movedX}, relative y: ${evt.detail.movedY}`);
}

```

## Some notes
- The move events bubble. Check event.detail.listener to see which listener was moving
- Cancelling movestart will prevent the move. move & moveend cannot be cancelled
- Only the main (usually left) button click can trigger a movestart
- event.detail.currentTarget is the target receiving the current event. by setting
  the moved element to pointer-events:none, you can get the element underneath
  in currentTarget
