# Webtool formhooks
You can hook into webtool forms (the kind of forms created in the Publisher) by
using the webtoolformhooks in a siteprofile formintegration, eg:


```xml
  <apply>
    <to type="file" filetype="http://www.webhare.dev/xmlns/mycustomform" />
    <formintegration webtoolformhooks="mycustomform.whlib#CustomFormHooks" />
  </apply>
```

## Hidden fields
The hooks can pass 'hidden fields' with form submissions which allow you to
set and pass additional fields with the form results. For example

```harescript
PUBLIC OBJECTTYPE CustomFormHooks EXTEND WebtoolFormHooks
<
  MACRO NEW()
  {
    //Create a textedit, mark it as a hidden field
    OBJECT prize := this->form->AppendFormField(DEFAULT OBJECT, "textedit", "prize", [ ishidden := TRUE ]);
    prize->title := "You won a";

    IF(IsRequest()) //If we're running in the website, set the prize field
    {
      prize->value := DecryptForThisServer("myexample:prize", GetFormWebVariable("prize"));
    }
  }
```

You need to wrap `GetFormVariable` calls inside `IsRequest()` to make sure it's
not invoked outside a web context, eg when running the email handlers

## Fast form RPCs.
When you setup a webtoolformhook the RPC calls done by the form will avoid your
webdesign and pages. We intend to make this the default behaviour for all webtool
forms in the future, so deriving from the WebtoolFormBase is no longer
supported and may be deprecated or removed in the future.
