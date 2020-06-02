# Custom forms

If you're building forms that are part of an application, you will generally be setting up forms manually and not using the
Publisher forms. To do this, you need to set up formdefinition files. For a simple site, you can just set up one global formdefinition. In your siteprofile:

```xml
<apply>
  <to type="all" />
  <formdefinitions path="[path].formdef.xml" />
</apply>
```

(if you need to use more than one formdefinition file, give it a `name=` attribute of the form `module:name` and access it using `OpenForm("formdefname#formname")`)


In this fields file:
```xml
<formdefinitions xmlns="http://www.webhare.net/xmlns/publisher/forms" gid="site">
  <form name="mysubmission" gid='.mysubmissionform'
        library="mod::mymodule/webdesigns/mydesign/libs/forms.whlib"
        objectname="MySubmissionForm"
        jshandler="mymodule:mysubmissionform">
    <page>
      ....
    </page>
  </form>
</formdefinitions>
```

The objectname refers to a HareScript object handling this form. The jshandler
refers to an optional [JavaScript handler](javascript-handling.md)

Create a bit of HTML/Witty to render it:

```witty
[component myform]
  <form id="myformid" class="wh-form wh-styledinput" [form.formattributes]>
    [form.formprologue]
    <div class="wh-form__page">
      [form.field1.render]
      [form.field2.render]
    </div>
    <div class="wh-form__page" data-wh-form-pagerole="thankyou">
      Thank you for filling in this form
    </div>
    [form.formrendernav]
  </form>
[/component]
```

Create the form handler
```harescript
PUBLIC OBJECTTYPE MySubmissionForm EXTEND FormBase
<
  RECORD FUNCTION Submit(RECORD extradata)
  {
    OBJECT work := this->BeginWork();

    //Process the form.

    work->Finish();
    RETURN DEFAULT RECORD;
  }
>;
```

And to put it all together, get the witty data the form needs and render it:

```HareScript
RECORD data := [ form := this->context->GetWittyDataForForm("<formname>")
               ];
EmbedWittyComponent("myform", data);
```
(and to access the form, use `this->context->OpenForm("<formname>")`

## Custom buttons
Buttons are normally rendered using `[form.formrendernav]`. If you want to customize these buttons and using CSS/JS isn't
sufficient, you can render them manually. Make sure they conform minimally to the following structure to mark these buttons
as having a submit/prev/next effect.

```html
  <!-- Previous and next buttons require a data-wh-form-action -->
  <button/input type="button" data-wh-form-action="previous" ...>
  <button/input type="button" data-wh-form-action="next" ...>

  <!-- Submit buttons must be explicitly marked with type=submit -->
  <button/input type="submit" ...>
```

The `wh-form__button--previous`, `--next` and `--submit` classes are used to hide these buttons when their respective actions are unavailable,
but you can handle that manually by looking for the `wh-form--allowprevious`, `wh-form--allownext` and `wh-form--allowsubmit` classes on the
parent `wh-form` element

# Form handler object

The form object has `formcontext` property in its `Submit` handler which contains the `WebContext` for the URL to which the form was submitted. This gives you immediate
access to eg. the targetobject.

## Processing the submission
The `Submit` handler in your form should handle the actual form submission.
It should use BeginWork/Finish to manage a transaction and trigger errors
where needed. BeginWork will validate all values (eg 'required') and log
errors where needed. Finish will commit the transaction unless any error
is encountered.

Errors should be reported back to the field responsible for the submission
wherever possible, eg:

```harescript
    work->AddErrorFor(^email, "Your email address has been banned");
```

But if you have to, you can cause a general rejection of the form:
```harescript
    work->AddError("I don't like your submission in general");
```

Always remember that the user is waiting for your Submit handler to be invoked.
Consider scheduling long running actions as a separate managed task if the form
submission has succeeded (ie no errors).

## Witty fields
The following witty fields are available when setting up the form template.

- formrender:
Renders the complete form, including `<form>` and `</form>`.

- formattributes:

Prints the final part of a `<form>` tag. Use like this: `<form class="wh-form" [form.formattributes]>`

- formallfields:

Renders all fields in the form

- formbuttons:

- formrender:

- `<field>`.render

Renders the specified field
