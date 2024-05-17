import * as dompack from 'dompack';
import { getTid, getTidLanguage } from "@mod-tollium/js/gettid";
import formservice, { EmailValidationResult } from "@webhare/forms/src/formservice";
import { isValidEmail } from '@webhare/std';

const cache:
  {
    [key: string]: Promise<EmailValidationResult>;
  } = {};

function mayValidateField(field: HTMLInputElement) {
  if (field.disabled || field.readOnly) //FIXME shouldn't we just decide not to validate at a much higher level if something cannot be changed ?
    return false;

  if (field.autocomplete && field.autocomplete.split(' ').includes("username")) //Well, we shouldn't *force* usernames as a blacklisted domain might still have been explicitly added as login. but suggestions are still useful?
    return false;
  return true;
}

//FIXME fix 'form' as soon as formbase is ported to TS
interface FormBase {
  _reportFieldValidity: (arg0: HTMLElement) => void;
}

function acceptEmailSuggestion(evt: Event, form: FormBase, field: HTMLInputElement, suggestion: string) {
  dompack.stop(evt);
  field.value = suggestion;
  field.propWhValidationSuggestion = null;
  form._reportFieldValidity(field);
}

export async function validateField(form: FormBase, field: HTMLInputElement) {
  const checkvalue: string = field.value;
  if (!checkvalue || !mayValidateField(field))
    return true; //not a problem

  if (!isValidEmail(checkvalue)) {
    field.propWhValidationError = getTid("publisher:site.forms.commonerrors.email");
    return false;
  }

  //user is 'done' with email field apparently. remotely validate it
  const key = "e_" + checkvalue; //e_ prefix protects against funny people using 'constructor' etc. TODO just switch to a Map<> or similar
  if (!cache[key])
    cache[key] = formservice.validateEmail(getTidLanguage(), checkvalue);

  //TODO should we ever clear the cache? only relevant probably if someone is on the frontend testing emails and doesn't want to refresh
  const result = await cache[key];
  if (checkvalue !== field.value || !mayValidateField(field))
    return true; //the field already changed, don't report about old errors

  if (result) {
    if (result.blocked) {
      field.propWhValidationError = result.blocked;
      return false;
    } else if (result.force) {
      field.value = result.force;
      return true;
    } else if (result.suggestion) {
      const suggestion = getTid("publisher:site.forms.commonerrors.email_suggestion", "___SUGGESTION___").split("___SUGGESTION___");
      field.propWhValidationSuggestion =
        <span class="wh-form__emailcorrection">
          {suggestion[0]}
          <a href="#" class="wh-form__emailcorrected" on={{ click: (evt: Event) => acceptEmailSuggestion(evt, form, field, result.suggestion as string) }}>{result.suggestion}</a>
          {suggestion[1]}
        </span>;
      return true;
    }
  }
  return true;
}
