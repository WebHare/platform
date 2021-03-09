WARNING: this documentation was written when dompack was a separate module and may be out of date

# dompack pulldown

Yet another pulldown. The dompack pulldown differs from a lot of other select replacements in that it can
resize itself according to the size of the items in the pulldown, just like the original `<select>`. Most other replacements
are either fixed width or rely on javascript to properly size themselves.

dompack-select observes the replaced `<select>` element and will automatically update its contents if the select is
modified, and pick up any change to the `value` or `selectedIndex` property

dompack pulldown relies on dompack and SCSS, and leaves the choice of used classnames (except for a few internal classes
you should never modify) to you.

## Feature shortlist
- Clean ES6/7 (Babel) and SCSS setup
- Automatically resize the select control based on the content of the options
- Native HTML5 events
- Automatically picks up changes made to the original DOM select and applies it to the replaced control
- Supports responsive fallback to browser-native controls

## To integrate into your project:

Select a class, eg 'mypulldown', to use for your pulldowns. You can set up
different pulldowns using different classes. The example below simply takes
over _all_ `<select>` controls:

The JavaScript part:
```
import * as dompack from "dompack";
import Pulldown from "dompack/components/pulldown";

dompack.register('select', node => new Pulldown(node, 'mypulldown'));
```

The SCSS part, assuming you want each pulldown control and each item to be exactly 28px in height:
```
@import "~dompack/components/pulldown/mixins";

.mypulldown
{
  @include dompack-pulldown(28px);
}
```

You may want to set a minimum height for the rows in the pulldown
```
.mypulldown
{
  @include dompack-pulldown(28px);

  &__item, &__optgroup
  {
    min-height: 28px;
  }
}
```


## Responsive disabling
You may want to disable this control on mobile devices. You could simply not
invoke dompack.register on such devices, or use a media query to show/hide the
original and new controls, eg:

```
.mypulldown
{
  display:none; //By default, hide us
}
@media (min-width: 481px) // <=480px - native pulldown. >480px - replaced pulldown
{
  .mypulldown
  {
    @include dompack-pulldown(28px);
  }
}
```

## Common issues

- The control takes up vertical space for all the items, even if closed

Make sure you specified a height for the control itself.
