import * as dompack from 'dompack';
import * as whintegration from '@mod-system/js/wh/integration';

function restoreForm(formnode, keyname)
{
  for (let field of formnode.querySelectorAll('input, textarea, select'))
  {
    if(field.type=='hidden' || field.disabled || !field.name)
      continue;

    try
    {
      let saveddata = sessionStorage[keyname + field.name];
      if(!saveddata)
        continue;

      if(['radio','checkbox'].includes(field.type))
      {
        field.checked = saveddata == field.value;
      }
      else
      {
        field.value = saveddata;
      }
      dompack.dispatchDomEvent(field, 'input');
      dompack.dispatchDomEvent(field, 'change');
    }
    catch(e)
    {
      if(dompack.debugflags.fhv)
        console.log("[fhv] Failed to restore field '" +field.name + "': " + e.toString(),e);
    }
  }
}

function saveField(evt, keybase)
{
  let field=evt.target;
  if(field.nodeName == 'INPUT' && field.type == 'radio' && !field.checked)
    return;

  let savevalue = null;
  if(['radio','checkbox'].includes(field.type))
    savevalue = field.checked ? field.value : null;
  else
    savevalue = field.value;

  if(savevalue)
    sessionStorage[keybase + field.name] = savevalue;
  else
    delete sessionStorage[keybase + field.name];
}

function clearFields(keybase)
{
  Object.keys(sessionStorage).filter(key => key.substr(0,keybase.length)==keybase).forEach(key => delete sessionStorage[key]);
}

/** Persist the form between page loads by storing it into sessionstorage.
    Calling this function immediately reloads last known values, and watches
    input events for further updates */
export default class FormPersister
{
  constructor(formnode)
  {
    //ADDME also allow us to persist other form types...
    let formid = formnode.dataset.whFormId;
    if(!formid)
    {
      if(!whintegration.config.islive)
        console.error("Missing data-wh-form-id on form, did your witty apply '[form.formattributes]' to the <form> tag ?", formnode);
      throw new Error("Form does not appear to be a WebHare form");
    }

    let keybase = 'wh-form-persist:' + formid + ':';
    restoreForm(formnode, keybase);
    formnode.addEventListener("input", evt => saveField(evt, keybase), true);
    formnode.addEventListener("change", evt => saveField(evt, keybase), true);
    formnode.addEventListener("wh:form-response", evt => { if(evt.detail.success) clearFields(keybase); });
  }
}
