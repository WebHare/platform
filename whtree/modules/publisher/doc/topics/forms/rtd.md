# Setting up RTD fields

## Quick start

We assume you've already set up the RTD storage and RTD type for your site, and the rtdtype
and any setwidget apply rules are already applied to the file hosting your form. The forms api will
be looking for these `<apply>` nodes to configure the rendering of the elements (just like the backend's RTD editor)

We also assume your form is backed by a RPC handler (see [forms/rpc]). Without the RPC handler inserting images or video may fail.

- Add a field of type RTD to your form definition, eg
```
<rtd name="rtd" rtdtype="http://www.webhare.net/xmlns/webhare_testsuite/rtd/level1" title="RTD" />
```

- Load and register the RTD Field editor

```
import RTDField from '@webhare-publisher/forms/fields/rtd';

dompack.register(".wh-form__rtd", node => new RTDField(node));
```

The RTDField object has a small API for embedding videos. You can store the newly
created RTDField object, or request is using `RTDField.getForNode(node)`

## Hiding controls
You can hide specific buttons using the 'hidebuttons' option, eg

```
dompack.register(".wh-form__rtd", node => new RTDField(node, { hidebuttons: ['table'] }));
```


## Embedded video
To add a video at the current cursor position, invoke `insertVideoByURL(url)` on the RTDField object.

The RTD field also has a built-in embedded video handler which is available if you've
properly setup the dompack dialog api. To use this embedded video handler, you'll need
to load an additional library and pass its insertVideo function to the options parameter
of the RTDField constructor:

```
import * as embedvideo from '@webhare-publisher/forms/fields/rtd/embedvideo';

let rtdopts = {};
rtdopts.onInsertVideo = embedvideo.insertVideo;
dompack.register(".wh-form__rtd", node => new RTDField(node, rtdopts));
```


## Troubleshooting

Q: The error 'Cannot create dialog, no dialog class defined' appears

A: You need to register your dialog creater using `setDefault` on the dompack dialogapi
