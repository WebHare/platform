# Maps marker icons

Icons that can be used with the maps component.

## Markers

The marker icons are available in black, blue, green, red and yellow and in a default variant with a hole and a filled variant.

## Overlays

To add an overlay to a marker icon, use the filled version of the icon and combine using `++` instead of `+` to prevent the
overlay knocking through the marker icon (i.e. it treats the icon before it as an IXO backgroundlayer instead of a layer).
There are number overlays from 0 through 9 and letter overlays from A through J.

Examples:

| icon | description |
| --- | --- |
| `tollium:maps/markers/marker_blue_filled++tollium:maps/overlays/1` | Blue marker icon with the number '1' |
| `tollium:maps/markers/marker_red_filled++tollium:maps/overlays/j` | Red marker icon with letter 'J' |

## Usage within the maps component

The marker icons all have their anchor points at [24,38], which can be specified when adding icons to a map component.

For example, to add a black icon with a hole named `firsticon` and a green icon with the number '6'  named `othericon`, the
following code can be used:

```xml
<s:map>
  <s:icon name="firsticon"
          anchor_x="24"
          anchor_y="38"
          icon="tollium:maps/markers/marker_black" />
  <s:icon name="othericon"
          anchor_x="24"
          anchor_y="38"
          icon="tollium:maps/markers/marker_green++tollium:maps/overlays/6" />
</s:map>
```
