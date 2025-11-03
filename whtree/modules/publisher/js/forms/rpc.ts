/* eslint-disable @typescript-eslint/no-floating-promises -- FIXME: needs API rework */

import * as dompack from '@webhare/dompack';
import * as focus from 'dompack/browserfix/focus';
import * as merge from './internal/merge';
import FormBase, { type FormResultValue, type FormSubmitEmbeddedResult, type FormSubmitMessage, type FormSubmitResult } from './formbase';
import { getFormService, getTSFormService, type PublisherFormService } from "@webhare/forms/src/formservice";
import * as emailvalidation from './internal/emailvalidation';
import { runMessageBox } from 'dompack/api/dialog';
import { debugFlags, isLive, navigateTo, type NavigateInstruction } from "@webhare/env";
import { isBlob, pick } from '@webhare/std';
import { setFieldError } from './internal/customvalidation';
import type { RPCFormTarget, RPCFormInvokeBase, RPCFormSubmission } from '@webhare/forms/src/types';
import { SingleFileUploader, type UploadResult } from '@webhare/upload';
import { getFieldName } from '@webhare/forms/src/domsupport';
import { createClient } from '@webhare/jsonrpc-client';

function unpackObject(formvalue: FormResultValue): RPCFormInvokeBase["vals"] {
  return Object.entries(formvalue).map(_ => ({ name: _[0], value: _[1] }));
}

export interface FormSubmitDetails<DataShape extends object = Record<string, unknown>> {
  form: HTMLElement;
  rpchandler: RPCFormBase<DataShape>;
  extrasubmitdata?: unknown;
  submitted: FormResultValue;
  result: unknown;
  errors: FormSubmitMessage[];
}

type UploadCache = WeakMap<Blob, UploadResult>;

function buildTarget(target: string): RPCFormTarget {
  return { target, url: location.href.split('/').slice(3).join('/') };
}

class FormSubmitter {
  private readonly target;
  private readonly cache: UploadCache;

  constructor(target: string, cache: UploadCache | null, private readonly offline: boolean) {
    this.target = buildTarget(target);
    this.cache = cache || new WeakMap();
  }

  private async uploadFile(file: Blob) {
    if (this.offline)
      throw new Error("Cannot upload files in offline mode"); //TODO convert to dataurl and test it

    //TODO what if the server discarded the token? we should negotiate with the server which files it (still) wants
    const completed = this.cache.get(file);
    if (completed)
      return completed;

    const uploader = new SingleFileUploader(file);
    //Ask the server if it's okay to upload these files
    const uploadinstructions = await getTSFormService().requestUpload(this.target, uploader.manifest);
    //Run the actual upload. Options: onProgress, signal
    const uploadedfile: UploadResult = await uploader.upload(uploadinstructions);
    this.cache.set(file, uploadedfile);
    return uploadedfile;
  }

  private async convertSubmittable(formvalue: unknown): Promise<unknown> {
    //TODO combine multiple uploads into one
    if (Array.isArray(formvalue))
      return await Promise.all(formvalue.map(file => this.getSubmittable(file)));

    if (formvalue && typeof formvalue === 'object') {
      if (isBlob(formvalue))
        return await this.uploadFile(formvalue as Blob);

      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(formvalue)) {
        result[key] = await this.getSubmittable(value);
        //console.log(key, value, result[key]);
      }
      return result;
    }
    return formvalue;
  }

  async getSubmittable(formvalue: object): Promise<FormResultValue> {
    return await this.convertSubmittable(formvalue) as FormResultValue;
  }
}

/** Directly submit a RPC form to WebHare
 *  @param target - Formtarget as obtained from
 * @deprecated Switch to \@webhare/forms submitForm and buildFormSubmission
 */
export async function submitForm(target: string, formvalue: FormResultValue, options?: { extrasubmit: unknown }): Promise<FormSubmitResult> {
  const submitparameters = await buildRPCFormSubmission(target, formvalue, { extraSubmit: options?.extrasubmit || null, });
  return await submitRPCForm(submitparameters);
}

/** Return a value safe for RPC submission or typed serialization */
export async function buildRPCFormSubmission<DataShape extends object = Record<string, unknown>>(target: string, formValue: DataShape, options?:
  {
    extraSubmit?: unknown;
    offline?: boolean;
    uploadCache?: WeakMap<Blob, UploadResult>;
    __setupEvent?: FormSubmitDetails<DataShape>;
  }): Promise<RPCFormSubmission> {
  const submitter = new FormSubmitter(target, options?.uploadCache || null, options?.offline || false);

  const vals = await submitter.getSubmittable(formValue);

  if (options?.__setupEvent) {
    const eventdetail = options.__setupEvent;
    eventdetail.extrasubmitdata = options.extraSubmit || null;
    eventdetail.submitted = vals;
  }

  const submitparameters: RPCFormSubmission = {
    ...buildTarget(target),
    vals: unpackObject(vals),
    extrasubmit: options?.extraSubmit || null
  };
  return submitparameters;
}

export async function submitRPCForm(submission: RPCFormSubmission): Promise<FormSubmitResult> {
  // TODO switch over to typed rpc, allow rpc options that make sense to be specified as options to submitRPCForm
  const client = createClient<PublisherFormService>("publisher:forms");
  return await client.formSubmit(submission);
}

export default class RPCFormBase<DataShape extends object = Record<string, unknown>> extends FormBase<DataShape> {
  __formhandler = {
    errors: [],
    warnings: [],
    formid: "",
    url: "",
    target: "",
    submitting: false
  };

  #completedUploads = new WeakMap<Blob, UploadResult>;

  pendingrpcs = new Array<Promise<unknown>>;

  constructor(formnode: HTMLFormElement) {
    super(formnode);
    this.__formhandler.formid = formnode.dataset.whFormId || ''; //needed for 'old' __formwidget: stuff
    this.__formhandler.url = location.href.split('/').slice(3).join('/');
    this.__formhandler.target = formnode.dataset.whFormTarget || '';
    dompack.addDocEventListener(this.node, "focusin", this.#recordLastFocus, { capture: true });

    if (!this.__formhandler.target) {
      if (this.__formhandler.formid) {
        console.error("This page needs to be republished!");
      } else {
        if (!isLive)
          console.error("Missing data-wh-form-target on form, did your witty apply '[form.formattributes]' to the <form> tag ?", formnode);
        throw new Error("Form does not appear to be a WebHare form");
      }
    }
  }

  getRPCFormIdentifier(): RPCFormTarget { //submitinfo as required by some RPCs
    return buildTarget(this.__formhandler.target);
  }

  async #getSubmitVals(): Promise<FormResultValue> {
    const formvalue = await this.getFormValue();
    const submitter = new FormSubmitter(this.__formhandler.target, this.#completedUploads, false);
    return await submitter.getSubmittable(formvalue);
  }

  //Invoke a function on the form on the server
  async _invokeRPC(background: boolean, methodname: string, args: unknown[]) {
    const waiter = Promise.withResolvers<void>();

    if (!background)
      this.onRPC(waiter.promise);

    const lock = dompack.flagUIBusy({ modal: !background });
    try {
      const rpc = getFormService().formInvoke({
        ...this.getRPCFormIdentifier(),
        vals: unpackObject(await this.#getSubmitVals()),
        methodname,
        args
      });
      this.pendingrpcs.push(rpc);
      const result = await rpc;
      this._processMessages(result.messages);
      return result.result;
    } finally {
      lock.release();
      waiter.resolve();
    }
  }

  /* Override this to implement support for incoming field messages */
  processFieldMessage(field: string, prop: string, value: unknown) {
    if (field.startsWith("#page.")) {
      const matchpage = field === "#page.thankyou" ? this.node.querySelector<HTMLElement>(`.wh-form__page[data-wh-form-pagerole=thankyou]`) : null;
      if (!matchpage) { //we currently don't have anything to edit on other pages than thankyou
        console.warn("Message for non-page field: " + field + ", prop: " + prop + ", value: " + String(value));
        return;
      }

      if (prop === 'data') {
        const dataval = value as { redirect: NavigateInstruction | null; exitbutton: string };
        matchpage.dataset.whFormNavigateTo = dataval.redirect ? JSON.stringify(dataval.redirect) : undefined;
        matchpage.dataset.whFormExitButton = dataval.exitbutton;
      }
    } else {
      const fieldnode = this.node.querySelector<HTMLElement>(`*[name="${CSS.escape(field)}"], *[data-wh-form-name="${CSS.escape(field)}"]`);
      if (!fieldnode) {
        console.warn("Message for non-existent field: " + field + ", prop: " + prop + ", value: " + String(value));
        return;
      }
      if (prop === 'value') {
        this.setFieldValue(fieldnode, value);
        return;
      }
    }
    console.warn("Unknown field message: field: " + field + ", prop: " + prop + ", value: " + String(value));
  }

  //Override this function to easily submit extra fields
  getFormExtraSubmitData(): object | Promise<object> {
    return {};
  }

  //Invoked when RPC is occuring. Is passed a promise that will resolve on completion
  //onRPC is DEPRECATED, switching to event based api
  onRPC(promise: Promise<void>) {
  }

  /** Invoke a function on the form on the server
      @param methodname- Name of the function on the form
      @param args - Arguments for the function
      @returns Promise that resolves to the result of the rpc call
  */
  invokeRPC(methodname: string, ...args: unknown[]) {
    return this._invokeRPC(false, methodname, args);
  }

  /** Invoke a function on the form on the server, doesn't call .onRPC or request modality layers
      @param methodname - Name of the function on the form
      @param args - Arguments for the function
      @returns Promise that resolves to the result of the rpc call
  */
  invokeBackgroundRPC(methodname: string, ...args: unknown[]) {
    return this._invokeRPC(true, methodname, args);
  }

  _processMessages(messages: Array<{ field: string; prop: string; data: unknown }>) {
    for (const msg of messages) {
      this.processFieldMessage(msg.field, msg.prop, msg.data);
    }
  }

  async _flushPendingRPCs() {
    while (this.pendingrpcs.length) {
      try {
        await this.pendingrpcs.pop();
      } catch (ignore) {
        //*we* can't handle those...
      }
    }
  }

  protected __formStarted() { //we can remove this once we merge formbase + rpc
    addEventListener("pagehide", this.#onUnload);
  }

  #lastFocused = "";

  #recordLastFocus = (evt: dompack.DocEvent<FocusEvent>) => {
    if (this.node.contains(evt.target)) {
      const name = getFieldName(evt.target) || evt.target.dataset.whFormGroupFor;
      if (name)
        this.#lastFocused = name;
    }
  };

  #onUnload = () => {
    this.sendFormEvent({
      event: 'abandoned',
      lastfocused: this.#lastFocused,
      pagenum: this.getCurrentPageNumber()
    });
  };

  async buildFormSubmission(extradata?: object, options?: { __setupEvent?: FormSubmitDetails<DataShape> }): Promise<RPCFormSubmission> {
    //Request extrasubmit first, so that if it returns a promise, it can execute in parallel with getFormValue
    const extraSubmitAwaitable = this.getFormExtraSubmitData();
    //FIXME we want getFormValue to be sync (and just use 'this.data' here) - who is still sending promises our way? too much to sort out for a backport
    const formvalue = await this.getFormValue() as DataShape;
    const extraSubmit = { ...extradata, ...(await extraSubmitAwaitable as Record<string, unknown>) };

    await this._flushPendingRPCs();
    dompack.dispatchCustomEvent(this.node, "wh:form-preparesubmit", {
      bubbles: true, cancelable: false, detail: {
        extrasubmit: extraSubmit
      }
    });

    const submitparameters = await buildRPCFormSubmission<DataShape>(this.__formhandler.target, formvalue, {
      extraSubmit,
      offline: false,
      uploadCache: this.#completedUploads,
      //hack because we need to record the 'vars' value before unpackObject flattens it for safe HareScript RPC
      __setupEvent: options?.__setupEvent
    });

    return submitparameters;
  }

  async submitForm(parameters: RPCFormSubmission): Promise<FormSubmitResult> {
    return await submitRPCForm(parameters);
  }

  async submit(extradata?: object): Promise<{ result?: FormSubmitEmbeddedResult }> {
    //ADDME timeout and free the form after some time
    if (this.__formhandler.submitting) //throwing is the safest solution... having the caller register a second resolve is too dangerous
      throw new Error("The form is already being submitted");

    const waiter = Promise.withResolvers<void>();
    let insubmitrpc = false;
    this.onRPC(waiter.promise);

    const eventdetail: FormSubmitDetails<DataShape> = {
      form: this.node,
      rpchandler: this,
      submitted: {},
      errors: [],
      result: null
    };

    try {
      this.__formhandler.submitting = true;

      const submitparameters = await this.buildFormSubmission(extradata, { __setupEvent: eventdetail });

      if (debugFlags.fhv)
        console.log('[fhv] start submission', submitparameters);

      insubmitrpc = true; //so we can easily determine exception source
      const result = await this.submitForm(submitparameters);
      insubmitrpc = false;

      if (debugFlags.fhv)
        console.log('[fhv] received response', result);

      this._processMessages(result.messages);

      if (!dompack.dispatchCustomEvent(this.node, "wh:form-response", { bubbles: true, cancelable: true, detail: result }))
        return result;

      eventdetail.result = result.result;
      eventdetail.errors = result.errors;

      let didfirstfocus = false;
      const globalerrors = [];
      for (const error of result.errors) {
        if (!error.name) {
          globalerrors.push(error);
          continue;
        }

        const failednode = this.node.querySelector('[name="' + error.name + '"], [data-wh-form-name="' + error.name + '"]');
        if (!failednode) {
          console.error("[fhv] Unable to find node '" + error.name + "' which caused error:" + error.message);
          continue;
        }
        if (!didfirstfocus) {
          dompack.focus(failednode);
          didfirstfocus = true;
        }
        setFieldError(failednode, error.message, { reportimmediately: true, serverside: true, metadata: error.metadata });
      }

      if (result.success) {
        this.sendFormEvent({ event: 'submitted' });
        if (dompack.dispatchCustomEvent(this.node, "wh:form-submitted", { bubbles: true, cancelable: true, detail: eventdetail as FormSubmitDetails<Record<string, unknown>> })) {
          removeEventListener("pagehide", this.#onUnload);
          merge.run(this.node, { form: await this.getFormValue() });

          //FIXME why is going to 'thank you' not in the formbase?
          this._navigateToThankYou(result.result && result.result.richvalues);
          this.onSubmitSuccess(result.result);
        }
      } else {
        const failedfields = result.errors.map(error => error.name || "*").sort().join(" ");
        this.sendFormEvent({ event: 'failed', errorfields: failedfields, errorsource: 'server' });

        if (globalerrors.length) {
          if (dompack.dispatchCustomEvent(this.node, "wh:form-globalerrors", { bubbles: true, cancelable: true, detail: { globalerrors } }))
            this.displayGlobalErrors(globalerrors);
        }

        if (dompack.dispatchCustomEvent(this.node, "wh:form-failed", { bubbles: true, cancelable: true, detail: eventdetail }))
          this.onSubmitFailed(result.errors, result.result);
      }
      return pick(result, ["result"]);
    } catch (e) {
      this.sendFormEvent({ event: 'exception', exception: String(e), errorsource: insubmitrpc ? 'server' : 'client' });

      if (dompack.dispatchCustomEvent(this.node, "wh:form-exception", { bubbles: true, cancelable: true, detail: eventdetail }))
        this.onSubmitException(e as Error);

      throw e;
    } finally {
      waiter.resolve();
      this.__formhandler.submitting = false;
    }
  }

  displayGlobalErrors(globalerrors: FormSubmitMessage[]) {
    try {
      const errors = globalerrors.map(error => dompack.create("p", { textContent: error.message }));
      runMessageBox(errors, [{ title: "OK" }]); //TODO: language?
    } catch (e) {
      console.error("runMessageBox failed", e);
      // eslint-disable-next-line no-alert -- alert is our fallback without message boxes
      alert(globalerrors.map(error => error.message).join("\n"));
    }
  }

  //Get the first group that failed error handling
  getFirstFailedGroup() {
    return this.node.querySelector(".wh-form__fieldgroup-error");
  }

  //override this to deal with succesful submissions
  onSubmitSuccess(result: FormSubmitEmbeddedResult<unknown>) {
    const formpos = this.node.getBoundingClientRect();
    if (formpos.top < 0)
      this.node.scrollIntoView({ block: 'start', behavior: 'smooth' });

    if (result && result.resultsguid)
      this.node.dataset.whFormResultguid = result.resultsguid;

    if (result && result.submitinstruction)
      navigateTo(result.submitinstruction);
  }

  //override this to deal with failed submissions
  onSubmitFailed(errors: FormSubmitMessage[], result: unknown) {
  }

  //override this to deal with form exceptions
  onSubmitException(e: Error) {
  }

  async validateSingleFormField(field: HTMLElement): Promise<boolean> {
    if (field instanceof HTMLInputElement && field.type === "email") { //TODO perhaps move this to webharefields.es ?
      if (focus.getCurrentlyFocusedElement() === field) { //TODO clearing suggestion on change should probably be generalized
        if (field.propWhValidationSuggestion) {
          field.propWhValidationSuggestion = null;
        }
      }

      //Just because it's focused doesn't mean we shouldn't validate it
      const validation = emailvalidation.validateField(this, field);
      this.pendingrpcs.push(validation);
      if (!(await validation))
        return false;
    }
    return true;
  }
}
