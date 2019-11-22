# Basic setup
## PREREQUISITES
Siteprofile changes:

```xml
  <apply>
    <to type="all"/>

    <!-- Required for forms: enable rendering API -->
    <formintegration />

    <!-- Optional: enable all users to create (standard) forms -->
    <allowfiletype typedef="http://www.webhare.net/xmlns/publisher/formwebtool" />
  </apply>
```

Add the proper JavaScript libraries:

```javascript
//At minimum, activates required CSS and JSON/RPC links
import * as dompack from 'dompack';
import * as forms from '@mod-publisher/js/forms';
forms.setup({ validate: true });

//Load neutral styling (optional, but you'll need to supply your own styling for some of the fields below if you skip this)
import '@mod-publisher/js/forms/themes/neutral';

//Optionally: replaces upload fields with a nicer and edit-supporting version
import UploadField from '@mod-publisher/js/forms/fields/upload';
dompack.register(".wh-form__upload", node => new UploadField(node));

//Optionally: replaces date fields with a split version
import { SplitDateField, SplitTimeField } from '@mod-publisher/js/forms/fields/splitdatetime';
dompack.register(".wh-form__date", node => new SplitDateField(node));
dompack.register(".wh-form__time", node => new SplitTimeField(node));

//Enable the imgedit and/or rtd fields:
import ImgEditField from '@mod-publisher/js/forms/fields/imgedit';
dompack.register(".wh-form__imgedit", node => new ImgEditField(node));

import RTDField from '@mod-publisher/js/forms/fields/rtd';
dompack.register(".wh-form__rtd", node => new RTDField(node));
```

## FORM STYLING

Using SCSS, import the main forms CSS.

`@mod-publisher/js/forms/styles` supplies a mixin to apply "flex" CSS styling to the forms.

Thet following examples sets a minimum width for fields and include this mixin:

```scss
@import '~@mod-publisher/js/forms/styles';

@at-root
{
  @include wh-form-flex;
}
.wh-form__label
{
  min-width:150px;
}

.wh-form__imgedit
{
  width:250px;
  height:250px;
}

```



### RESPONSIVE STYLING

Many sites may want form labels next to their fields in desktop mode, but will want to put the fields below the questions on mobile. Eg:

```scss
@media (max-width: 505px)
{
  /* Order the inputs vertical from their labels */
  .wh-form__fieldgroup
  {
    -ms-flex-direction: column;
    -webkit-flex-direction: column;
    flex-direction: column;
  }
  /* Give the fields their full width back */
  .wh-form__fields
  {
    width:100%;
  }
}
```
