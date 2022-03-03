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


## The old photoalbum
If you still need the old photoalbum you can opt into using the old code by
adding this apply rule:

```xml
  <apply>
    <to type="file"
        filetype="http://www.webhare.net/xmlns/publisher/contentlisting"
        parenttype="http://www.webhare.net/xmlns/publisher/photoalbum" />
    <bodyrenderer objectname="mod::publisher/lib/internal/renderers/photogallery.whlib#PhotoGalleryRenderer" />
  </apply>
```

A future version of WebHare may remove this library.
