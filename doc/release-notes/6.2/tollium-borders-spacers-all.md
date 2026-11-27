## Tollium
- `borders="all"` and `spacers="all"` now override a component's default borders and spacers, just like listing the
  sides (`"top right bottom left"`) does. Before, `"all"` was ignored where a component has its own default: the
  borders of a `<statuspanel>`, the spacers of a tab in a `type="server"` tabs component and the left spacer of a
  cell in the first column of a `<grid>`. Screens that use `"all"` there now get the borders or spacers they asked
  for.
