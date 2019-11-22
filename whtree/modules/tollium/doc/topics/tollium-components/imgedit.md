# The new `<imgedit>`

## Allowed actions and filters

You can control which functions are available within the image editor using the
`allowedactions` attribute. Possible values are:

* `crop`: Crop the image
* `rotate`: Rotate and mirror the image
* `filters`: Apply filters to the image
* `all`: All of the above, the default (NOTE: doesn't include `refpoint`!)
* `refpoint`: Set the reference point for the image (see below)

If the `filters` action is allowed, the `allowedfilters` attribute defines which
filters are allowed. Possible values are:

* `grayscale`
* `invert`
* `sharpen`
* `blur`
* `brightnesscontrast`
* `autocontrast`
* `coloradjust`
* `all`: All of the above, the default


## Reference point

The `refpoint` action can be activated to allow setting the image reference
point. This reference point is used when auto-cropping the image in the image
editor or when cropping the image using the image cache.

In addition, the reference point can be used when displaying a cropped header
photo on a site while keeping a certain point in view (this is used in WS2016
for example). If you use the `WrapCachedImage` from `module::system/cache.whlib`,
you get a record with `link`, `width` and `height` values, and a
`refpoint_backgroundposition` value. In witty you can then specify:

```
background-image: url([mycachedimage.link]);
background-position: [if mycachedimage.refpoint_backgroundposition][mycachedimage.refpoint_backgroundposition][else]center[/if];
```


## Image selection source

By default, the `<imgedit>` can receive a new image by uploading it directly or
by selecting an image from the Publisher. To disable those sources, the
attributes `upload` and `publisher` respectively can be set to `false`.

### Media library

In addition to direct upload and general Publisher selection, the `<imgedit>`
can be configured to select images from specific Publisher folders using a media
library.

A media library can be configured in a siteprofile using the `<setlibrary>`
option within an `<apply>` block. This tag should have a `name` attribute and
should contain one or more `<source>`s.

Each `<source>` has a `path` attribute, which contains an absolute path (e.g.
`site::repository/mysite/images`) or a relative path (e.g. `../images`). A
relative path is relative to the site profile in which the media library is
defined. To have it resolved against the object to which the media library is
applied, set the `relativeto` attribute to `targetobject` (it is `siteprofile`
by default). If a relative path starts with `/`, it is resolved relative to the
root of the parent site of the `relativeto` object (if it's not within a site,
it's relative to the WHFS root).

For example, to have a central media library and a media library per site, the
following code can be used:

```
<apply>
  <to type="all" sitemask="*" />

  <setlibrary name="mylibrary">
    <!-- Each site can have its own media folder -->
    <source path="/media" relativeto="targetobject" />
    <!-- All sites use a central media folder -->
    <source path="site::repository/mysite/media" />
  </setlibrary>
</apply>
```

To use a media library, set the `medialibrary` attribute of the `<imgedit>` to
the name of the library to use. So to use the example library above, add the
attribute `medialibrary="mylibrary"`.

## Migrating from `<imageedit>`

The new `<imgedit>` can almost be used as a drop-in replacement for
`<imageedit>`. The main difference is that an `<imageedit>` defines `imagewidth`
and `imageheight` attributes to control the size of the `<image>` element within
the component, whereas for the `<imgedit>` you can just set `width` and `height`
directly.
