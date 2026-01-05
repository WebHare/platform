# Gallery widget
The gallery widget is a built-in widget to render a photoalbum. To enable
it, add the following code to your site code

```js
import setupGallery from '@mod-publisher/js/gallery/defaultgallery';
dompack.register('.wh-gallery', node => setupGallery(node));
```

Note that WH 4.33.1 and up offer an empty stub for setupGallery so you can
already refer to this library when experimenting, as versions before 4.34 will
not generate `wh-gallery` elements anyway.
