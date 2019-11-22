The Tollium `<image>` component

## overlays
Overlays are square selections inside the image. Overlays are based on [dompack-overlays](https://github.com/webhare/dompack-overlays) - use that package for a 'frontend' version of the overlays.

To enable overlays set the `overlaysactive` on the `<image>` component to `TRUE`.
When the `oncreateoverlay` callback is set the user can click+drag an area. The area information will be returned to this callback, which can then add the overlay.

The overlays themselves are accessed through the `overlays` property. The currently selected overlay is available through `selection`.

A testpage is accessible through `/webhare-testsuite.site/testsuiteportal/?app=webhare_testsuite:component(image-overlays,null)` on your WebHare installation (if you have the webhare_testsuite module installed)
