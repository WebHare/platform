import * as dompack from 'dompack';
import { getTid, getTidLanguage } from "@webhare/gettid";
import { getFormService } from "@webhare/forms/src/formservice";
import { isValidEmail, sleep } from '@webhare/std';
import { setFieldError } from './customvalidation';
import type { EmailValidationResult } from '@webhare/forms/src/types';
import type FormBase from '../formbase';
import type RPCFormBase from '../rpc';
import { debugFlags } from '@webhare/env';

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

function acceptEmailSuggestion<DataShape extends object = Record<string, unknown>>(evt: Event, form: FormBase<DataShape>, field: HTMLInputElement, suggestion: string) {
  dompack.stop(evt);
  field.value = suggestion;
  field.propWhValidationSuggestion = null;
  form._reportFieldValidity(field);
}

export async function validateField<DataShape extends object = Record<string, unknown>>(form: FormBase<DataShape> | RPCFormBase<DataShape>, field: HTMLInputElement) {
  if (field.dataset.whFormEmailBlocked) {
    delete field.dataset.whFormEmailBlocked;
    setFieldError(field, ""); //explicitly clear our earlier setFieldError, but only if we set it. FIXME To really cleanly solve this we need better integration with rpc.ts - we want to be in the setupValidation chain and simply return errors instead of being explictly invoked
  }

  const checkvalue: string = field.value;
  if (!checkvalue || !mayValidateField(field)) {
    return true; //not a problem
  }

  if (!isValidEmail(checkvalue)) {
    //TODO why aren't we just returning the error like a validator callback? may also help avoid the whFormEamailBlocked hack..
    field.dataset.whFormEmailBlocked = "true";
    setFieldError(field, getTid("publisher:site.forms.commonerrors.email"));
    return false;
  }

  //user is 'done' with email field apparently. remotely validate it
  const key = "e_" + field.name + "." + checkvalue; //e_ prefix protects against funny people using 'constructor' etc. TODO just switch to a Map<> or similar. TODO only include field.name if needed, and also bind to the form then
  if (cache[key] === undefined) {
    const rpcCall = "getRPCFormIdentifier" in form ?
      //TODO rendering.whlib should add a data attribute if there are form+field-specific checks, perhaps we can even generalize that for all fields instead of just email whenever they need to do direct validation
      getFormService().formValidateEmail({ ...form.getRPCFormIdentifier(), field: field.name }, checkvalue)
      : getFormService().validateEmail(getTidLanguage(), checkvalue);

    //wrap in timeout
    cache[key] = Promise.race([rpcCall, sleep(3000).then(() => { throw new Error("Timeout"); })]);
  }

  //TODO should we ever clear the cache? only relevant probably if someone is on the frontend testing emails and doesn't want to refresh
  let result: EmailValidationResult | undefined;

  try {
    result = await cache[key];
  } catch (e) { //timeout or other error, or offline form (PWA?)
    if (debugFlags.fhv)
      console.log('[fhv] Email validation error or timeout for value', checkvalue, e);
  }

  if (checkvalue !== field.value || !mayValidateField(field))
    return true; //the field already changed, don't report about old errors

  if (result?.blocked) {
    field.dataset.whFormEmailBlocked = "true";
    setFieldError(field, result.blocked);
    return false;
  }

  if (result?.force) {
    field.value = result.force;

    //we should be able to assume we won't have to revalidate a server-provided suggestion
    cache["e_" + field.name + "." + result.force] = Promise.resolve<EmailValidationResult>({});

    return true;
  } else if (result?.suggestion) {
    const suggestion = getTid("publisher:site.forms.commonerrors.email_suggestion", "___SUGGESTION___").split("___SUGGESTION___");

    //we should be able to assume we won't have to revalidate a server-provided suggestion
    cache["e_" + field.name + "." + result.suggestion] = Promise.resolve<EmailValidationResult>({});

    field.propWhValidationSuggestion =
      <span class="wh-form__emailcorrection">
        {suggestion[0]}
        <a href="#" class="wh-form__emailcorrected" on={{ click: (evt: Event) => acceptEmailSuggestion(evt, form, field, result.suggestion as string) }}>{result.suggestion}</a>
        {suggestion[1]}
      </span>;
    return true;
  }
  return true;
}
