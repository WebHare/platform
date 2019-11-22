import * as dompack from 'dompack';
import { getTid, getTidLanguage } from "@mod-tollium/js/gettid";
import * as formservice from './form.rpc.json';

let cache = {};

function mayValidateField(field)
{
  if(field.disabled || field.readOnly) //FIXME shouldn't we just decide not to validate at a much higher level if something cannot be changed ?
    return false;
  if(field.autocomplete && field.autocomplete.split(' ').includes("username"))
    return false;
  return true;
}

function acceptEmailSuggestion(evt, form, field, suggestion)
{
  dompack.stop(evt);
  field.value = suggestion;
  field.propWhValidationSuggestion = null;
  form._reportFieldValidity(field);
}

export async function validateField(form, field)
{
  if(!field.value || !mayValidateField(field))
    return true; //not a problem

  //user is 'done' with email field apparently. remotely validate it
  let key = "e_" + field.value; //e_ prefix protects against funny people using 'constructor' etc
  if(!cache[key])
    cache[key] = formservice.validateEmail(getTidLanguage(), field.value);

  //TODO should we ever clear the cache? only relevant probably if someone is on the frontend testing emails and doesn't want to refrehs
  let result = await cache[key];
  if(result)
  {
    if(result.blocked)
    {
      field.propWhValidationError = result.blocked;
      return false;
    }
    else if (result.force)
    {
      field.value = result.force;
      return true;
    }
    else if (result.suggestion)
    {
      let suggestion = getTid("publisher:site.forms.commonerrors.email_suggestion", "___SUGGESTION___").split("___SUGGESTION___");
      field.propWhValidationSuggestion = <span class="wh-form__emailcorrection">{suggestion[0]}<a href="#" class="wh-form__emailcorrected" on={{click: evt=>acceptEmailSuggestion(evt, form, field, result.suggestion)}}>{result.suggestion}</a>{suggestion[1]}</span>;
      return true;
    }
  }
  return true;
}
