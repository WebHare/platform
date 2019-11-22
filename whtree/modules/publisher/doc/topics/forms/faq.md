# FAQ

## INVALID FORM CONTROL NOT FOCUSABLE

If submitting a form gives errors similar to "An invalid form control with name='shippingmethod.shippingmethod' is not focusable.", usually it's trying to report an error for a component that has been set to display:none or visibility:hidden. This often happens when trying to set up a styled radio/checkbox.

You can use the mixin wh-form-hidenativecontrol instead of display/visibility to fix this, or use something similar to the following styling:

```css
  position: absolute !important;
  width: 0;
  height: 0;
  overflow: hidden;
  -webkit-appearance: none;
  -moz-appearance: none;
  opacity: 0;
```

## Is it possible to use the forms api without requiring JavaScript ?
This is no longer supported
