# Widget syntax

## Defining a widget

Widgets are a special type of contenttype and are defined in a site profile. As
an example:

```xml
<siteprofile xmlns="http://www.webhare.net/xmlns/publisher/siteprofile">
  <widgettype
    namespace="http://www.example.net/mywidgettype"
    tid="widgets.mywidget.title"
    wittycomponent="widgets.witty:mywidget">
    <members>
      <member name="shorttitle" type="string" />
      <member name="content" type="richdocument" />
    </members>
  </widgettype>
</siteprofile>
```

The simplest widgets (as in the example above) only need to provide a witty component for the actual rendering, eg:

```witty
[component anchor]
  [if isrtdpreview]
    Title: [shorttitle]
  [else]
    <div class="mywidget">[shorttitle]</div>
  [/if]
[/component]
```

If you need more control over the generated HTML, specify a renderobjectname, eg `renderobjectname="widgets.whlib#MyWidget"`
The object should derive from %WidgetBase and at minimum, implement %Render. It can use `EmbedComponent` to invoke the
specified `wittycomponent`, eg:

```harescript
LOADLIB "mod::publisher/lib/widgets.whlib";

PUBLIC STATIC OBJECTTYPE MyWidget EXTEND WidgetBase
<
  UPDATE PUBLIC MACRO Render()
  {
    this->EmbedComponent([ title := ToUppercase(this->data.title )]);
  }
>;
```

The widget class can query `this->context->IsRTDPreview()` to see if it is
being rendered in the rich text editor (as a preview) or in a live web page
(equivalent to `isrtdpreview` in witty)


## Editing widget data
A widget's contenttype can contain one or more members. To set up an editor for
the data inside a widget, add an `editextension=` to its `<widgettype>`,
eg editextension="#mywidgeteditor" (which refers to a tabsextension in the same file)

For example:
```xml
  <tabsextension xmlns="http://www.webhare.net/xmlns/tollium/screens"
                 name="mywidgeteditor" implementation="none">
    <newtab>
      <textedit composition="contentdata" cellname="shorttitle" />
      <richdocument composition="contentdata" cellname="content" />
    </newtab>
  </tabsextension>
```

Set `allowresize=true` on the `<tabsextension>` to allow the widget editor to resize.

Note that `<tabsextension>` in the above example needs to use `xmlns` because
the `<tabsextension>` element is in a different namespace from siteprofiles)

## Manual widget rendering
Widgets are normally rendered when automatically when they are encountered
in rich text documents. You can also explicitly render a widget using
%WebDesign::RenderWidgetInstance

## Publisher preview
The publisher can show previews for widgets. Previews are visible when:
- a `<webdesign>` applies to the widget itself
- a `<rtddoc>` applies to the widget

This will generally be true inside a site but you may need to check the above
when widgets are inside a separate repository.
