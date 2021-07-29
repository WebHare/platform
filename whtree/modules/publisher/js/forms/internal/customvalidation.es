import * as dompack from 'dompack';
import { getTid } from "@mod-tollium/js/gettid";
import "./form.lang.json";

//show HTML5-style validity errors
export function reportValidity(node)
{
  if(node.reportValidity) //not present on all browsers, clicking a submit is a workaround
  {
    node.reportValidity();
    return true;
  }
  let form = dompack.closest(node,'form');
  if(!form)
    return false;

  let submitbutton = form.querySelector("button[type=submit], input[type=submit]" );
  if(!submitbutton)
    return false;

  submitbutton.click();
  return true;
}


function setupServerErrorClear(field)
{
  let group = dompack.closest(field,'.wh-form__fieldgroup') || field;
  field.propWhCleanupFunction = () =>
  {
    group.removeEventListener("change", field.propWhCleanupFunction, true);
    group.removeEventListener("input", field.propWhCleanupFunction, true);
    group.removeEventListener("blur", field.propWhCleanupFunction, true);
    setFieldError(field, '', {serverside:true});
    field.propWhCleanupFunction = null;
  };

  // to be rightly paranoid (plugins and JS directly editing other fields) we'll blur when anything anywhere seems to change
  // eg wrd.testwrdauth-emailchange would fail on Chrome without this if the browser window was not currently focused
  group.addEventListener("change", field.propWhCleanupFunction, true);
  group.addEventListener("input", field.propWhCleanupFunction, true);
  if(!dompack.closest(field, 'form[novalidate]')) //if we're doing html5 validation, errors will block submit, so let's already clear on blur
    group.addEventListener("blur", field.propWhCleanupFunction, true);
}


export function setFieldError(field, error, options)
{
  if(dompack.debugflags.fhv)
    console.log(`[fhv] ${error?"Setting":"Clearing"} error for field ${field.name}`, field, error, options);

  options = { serverside: false, reportimmediately: false, ...options };
  field.propWhSetFieldError = error;

  if(error && options.serverside) //we need to reset the check when the user changed something
  {
    setupServerErrorClear(field);
    field.propWhErrorServerSide = true;
  }
  else
  {
    field.propWhErrorServerSide = false;
  }

  //if the error is being cleared, reset any html5 validity stuff to clear custom errors set before wh:form-setfielderror was intercepted
  if(!error && field.setCustomValidity)
    field.setCustomValidity("");

  if(!dompack.dispatchCustomEvent(field, 'wh:form-setfielderror', //this is where parsley hooks in and cancels to handle the rendering of faults itself
          { bubbles:true
          , cancelable:true
          , detail: { error: error
                    , reportimmediately: options.reportimmediately
                    , serverside: options.serverside
                    , metadata: options.metadata
                    } }))
  {
    return;
  }

  //fallback to HTML5 validation
  if(field.setCustomValidity)
  {
    if(typeof error == "object") //we got a DOM?
      error = error.textContent || getTid("publisher:site.forms.commonerrors.default"); //we don't want to suddenly change from 'we had an error' to 'no error'

    field.setCustomValidity(error || "");
    if(!options.reportimmediately || reportValidity(field))
      return;
  }
  if(error) //if we're not setting an error, it's not an issue that we can't show one
    throw new Error("No handler available to process setFieldError request");
}

export function setupValidator(node, checker)
{
  var check = async () =>
  {
    let error = checker(node);

    // If error is a thenable (Promise or something like it) await it. Stay synchronous if not.
    if (typeof error === "object" && error && error.then)
      error = await error;

    if(dompack.debugflags.fhv)
      console.log(`[fhv] Custom check ${error ? `setting error '${error}'` : 'clearing error'} for `,node);

    //FIXME shouldn't we set propWhValidationError instead ?
    setFieldError(node, error, { reportimmediately: false });
  };
  node.addEventListener("blur", check);
  node.addEventListener("input", check);
  node.whFormsApiChecker = check;
  check();
}
