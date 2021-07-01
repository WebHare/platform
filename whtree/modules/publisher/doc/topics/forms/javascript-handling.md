# JavaScript handling

Form validation and submission can be managed/overridden from JavaScript. To do this:

- Add a jshandler="module:name" to your `<form>` tag
- Register a handler using `registerHandler`

Example:

```javascript
import { RPCFormBase, registerHandler } from "@mod-publisher/js/forms";

class RTDForm extends RPCFormBase
{
  constructor(node)
  {
    super(node);
    node.querySelector(".prefillbutton").addEventListener("click", () => this.doPrefill());
  }
  onSubmitSuccess(result)
  {
    qS("#rtdformresponse").textContent = JSON.stringify(result);
  }
  async doPrefill()
  {
    let prefilled = await this.invokeRPC("prefill");
    this.elements.email.value = prefilled.email;
  }
}

registerHandler("mymodule:rtdform", node => new RTDForm(node));
```

The FormHandler/RPCFormBase offer the following api:

- getFieldValue(field) - override this to implement your own field handling

- getFormExtraSubmitData() - override this to pass on aditional values to your form as 'formextradata'

- onSubmit() - override this with your own submit handling (this function gets invoked when the submit event handler would fire). if you override this, be sure to invoke submit()

- onSubmitSuccess() - override this with your on-submit-success handling. An alternative to submit().then(myonsuccess). Receives the data that the promise would have resolved with

- onSubmitFailed(errors, result) - any errors triggered by `work->AddError` will be added as the first parameter of the function

## Custom validations
```javascript
import { setupValidator } from "@mod-publisher/js/forms";

function myValidator(eltocheck)
{
  return eltocheck.value == "admin" ? "Nice try" : null;
}
dompack.register("[id='myform-username']", node => setupValidator(node, myValidator));
```

## RPC Calls
`invokeRPC` can be used to invoke a serverside function asynchronously. This function returns a promise that resolves to the
server's side RPC result

On the server side you need to declare a PUBLIC function in the handler, with a name prefixed with `RPC_`

```harescript
PUBLIC OBJECTTYPE MySubmissionForm EXTEND FormBase
<
  PUBLIC RECORD FUNCTION RPC_Prefill()
  {
    RETURN [ email := GetWebCookie("emailaddress") ];
  }
>;
```

## MODALITY LAYER DURING SUBMISSION
You don't need to use JS form handlers just to generate a 'modality layer' or a progress indicator during submission. The forms
use the Dompack busy/modality APIs, and these generate events and set classes on the `<html>` element which you can use to indicate
that the form is busy.

# Events

## dompack:scrollintoview
Target: the node that should be scrolled into view

Bubbles: yes

Cancelable: yes

This event is fired (through `dompack.scrollIntoView`) when the form handler wants to focus a field (usually because it
triggered the error). The event is fired on the `.wh-anchor` of the fieldgroup (or if not present, the fieldgroup) containing
the field that should be focused.

You can catch and cancel this event to control the scrolling yourself.

Please Note that if you want to override the scroll because the scrolling places the field below a fixed size header, you
should consider styling `wh-anchor` to reserve the necessary vertical space (by setting eg `height: 80px; margin-top: -80px;`)
as this will also help fix targetted links landing on your page (`#anchor` links)

## wh:form-globalerrors

Target: The form node

Bubbles: yes

Cancelable: yes

Detail: `{ globalerrors: [ { message: 'xxx' } ] }`

Fired whenever global errors have been received from the server (errors that cannot be connected to a specific field).
If not cancelled, the formsapi will attempt to show a popup using the dompack dialog API. If that fails, it will simply `alert()` the message(s).

## wh:form-pagechange

Target: The current page (`.wh-form__page`)

Bubbles: yes

Cancelable: no

Fired whenever the current page changes, after the necessary DOM visibility updates have been made.

Please note that you won't get this event when the form is initially rendered.

# RPC calls
JavaScript: use 'invokeRPC' on the form object, eg
```javascript
  form.invokeRPC('prefill', 'arg1', 42);
```
will invoke the function "RPC_Prefill" on the HareScript form object, with 'arg1' and 42 as its arguments

invokeRPC returns a promise with the result of the RPC call. The RPC can also read and write the form fields in HareScript. Eg
```harescript
  PUBLIC MACRO RPC_Prefill(STRING arg1, INTEGER arg2)
  {
    ^email->value := Tokenize(^name->value,' ')[0] || "@example.com";
  }
```

Please note that most properties you can modify inside a RPC handler are not
reflected back to the form being filled in on the frontend. Future WebHare
versions may improve support for this.

