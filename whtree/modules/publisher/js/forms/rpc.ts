/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from 'dompack';
import * as focus from 'dompack/browserfix/focus';
import * as merge from './internal/merge';
import FormBase from './formbase';
import RPCClient from '@mod-system/js/wh/rpc';
import * as whintegration from '@mod-system/js/wh/integration';
import * as emailvalidation from './internal/emailvalidation';
import { runMessageBox } from 'dompack/api/dialog';
import * as pxl from '@mod-consilio/js/pxl';
import { isLive } from "@webhare/env";

function getServiceSubmitInfo(formtarget) {
  return {
    url: location.href.split('/').slice(3).join('/'),
    target: formtarget || ''
  };
}

function unpackObject(formvalue) {
  return Object.entries(formvalue).map(_ => ({ name: _[0], value: _[1] }));
}

/** Directly submit a RPC form to WebHare
 *  @param target Formtarget as obtained from
 */
export async function submitForm(target, formvalue, options) {
  let eventtype = 'publisher:formsubmitted';
  const fields = {
    ds_formmeta_jssource: 'submitForm'
  };
  const submitstart = Date.now();

  try {
    const submitparameters = {
      ...getServiceSubmitInfo(target),
      vals: unpackObject(formvalue),
      extrasubmit: options?.extrasubmit || null
    };

    const formservice = new RPCClient("publisher:forms");
    const retval = await formservice.invoke("callFormService", "submit", submitparameters);
    if (!retval.success) {
      const failedfields = retval.errors.map(error => error.name || "*").sort().join(" ");
      fields.ds_formmeta_errorfields = failedfields;
      fields.ds_formmeta_errorsource = 'server';
    }
    return retval;
  } catch (e) {
    eventtype = 'publisher:formexception';
    fields.ds_formmeta_exception = String(e);
    fields.ds_formmeta_errorsource = 'server';
    throw e;
  } finally {
    fields.dn_formmeta_waittime = Date.now() - submitstart;
    pxl.sendPxlEvent(eventtype, fields);
  }
}

export default class RPCFormBase extends FormBase {
  constructor(formnode) {
    super(formnode);
    this.__formhandler = {
      errors: [],
      warnings: [],
      formid: formnode.dataset.whFormId, //needed for 'old' __formwidget: stuff
      url: location.href.split('/').slice(3).join('/'),
      target: formnode.dataset.whFormTarget
    };
    this.pendingrpcs = [];

    if (!this.__formhandler.target) {
      if (this.__formhandler.formid) {
        console.error("This page needs to be republished!");
      } else {
        if (!isLive)
          console.error("Missing data-wh-form-target on form, did your witty apply '[form.formattributes]' to the <form> tag ?", formnode);
        throw new Error("Form does not appear to be a WebHare form");
      }
    }

    this.formservice = new RPCClient("publisher:forms"); //FIXME switch away from RPCClient
  }

  getServiceSubmitInfo() //submitinfo as required by some RPCs
  {
    return getServiceSubmitInfo(this.__formhandler.target);
  }

  //Invoke a function on the form on the server
  async _invokeRPC(background, ...invokeargs) {
    const waiter = dompack.createDeferred();

    if (!background)
      this.onRPC(waiter.promise);

    const lock = dompack.flagUIBusy({ modal: !background, component: this.node });
    try {
      let options;
      if (typeof invokeargs[0] == 'object') //receiving optiions first
        options = invokeargs.shift();

      const formvalue = await this.getFormValue();
      const methodname = invokeargs.shift();
      const rpc = this.formservice.invoke(options || {}
        , "callFormService"
        , "invoke"
        , {
          ...getServiceSubmitInfo(this.__formhandler.target),
          vals: unpackObject(formvalue),
          methodname: methodname,
          args: invokeargs
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
  processFieldMessage(field, prop, value) {
    const fieldnode = this.node.querySelector(`*[name="${CSS.escape(field)}"], *[data-wh-form-name="${CSS.escape(field)}"]`);
    if (!fieldnode) {
      console.warn("Message for non-existent field: " + field + ", prop: " + prop + ", value: " + value.toString());
      return;
    }
    if (prop == 'value') {
      this.setFieldValue(fieldnode, value);
      return;
    }
    console.warn("Unknown field message: field: " + field + ", prop: " + prop + ", value: " + value.toString());
  }

  //Override this function to easily submit extra fields
  getFormExtraSubmitData() {
    return {};
  }

  //Invoked when RPC is occuring. Is passed a promise that will resolve on completion
  //onRPC is DEPRECATED, switching to event based api
  onRPC(promise) {
  }

  /** Invoke a function on the form on the server
      @param options RPC invoke options (optional)
      @param methodname Name of the function on the form
      @param args Arguments for the function
      @return Promise that resolves to the result of the rpc call
  */
  invokeRPC(...args) {
    return this._invokeRPC(false, ...args);
  }

  /** Invoke a function on the form on the server, doesn't call .onRPC or request modality layers
      @param options RPC invoke options (optional)
      @param methodname Name of the function on the form
      @param args Arguments for the function
      @return Promise that resolves to the result of the rpc call
  */
  invokeBackgroundRPC(...args) {
    return this._invokeRPC(true, ...args);
  }

  _processMessages(messages) {
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

  async submit(extradata?: object) {
    //ADDME timeout and free the form after some time
    if (this.__formhandler.submitting) //throwing is the safest solution... having the caller register a second resolve is too dangerous
      throw new Error("The form is already being submitted");

    const waiter = dompack.createDeferred();
    let insubmitrpc = false;
    this.onRPC(waiter.promise);

    const eventdetail = {
      form: this.node,
      rpchandler: this
    };
    await this._flushPendingRPCs();
    try {
      this.__formhandler.submitting = true;

      //Request extrasubmit first, so that if it returns a promise, it can execute in parallel with getFormValue
      let extrasubmit = this.getFormExtraSubmitData();
      eventdetail.extrasubmitdata = extrasubmit;

      const formvalue = await this.getFormValue();
      eventdetail.submitted = formvalue;

      if (extrasubmit && extrasubmit.then) //got a promise? expand it
        extrasubmit = await extrasubmit;

      extrasubmit = {
        ...extradata,
        ...extrasubmit
      };

      /* make sure no getFormValue RPCs are still pending, assuming they went through us, eg if an address validation is
         still running (and could update)
         TODO probably wiser to have validators take and hold a submission preventing lock in such a case, but this most closely matches original formservice behavior
      */
      await this._flushPendingRPCs();
      dompack.dispatchCustomEvent(this.node, "wh:form-preparesubmit", { bubbles: true, cancelable: false, detail: { extrasubmit: extrasubmit } });
      const submitparameters = {
        ...getServiceSubmitInfo(this.__formhandler.target),
        fields: formvalue,
        extrasubmit: extrasubmit
      };

      if (dompack.debugflags.fhv)
        console.log('[fhv] start submission', submitparameters);

      insubmitrpc = true; //so we can easily determine exception source
      const result = await this.formservice.invoke("callFormService", "submit", submitparameters);
      insubmitrpc = false;

      if (dompack.debugflags.fhv)
        console.log('[fhv] received response', result);

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
        FormBase.setFieldError(failednode, error.message, { reportimmediately: true, serverside: true, metadata: error.metadata });
      }

      if (result.success) {
        dompack.dispatchCustomEvent(this.node, "wh:form-values", { bubbles: true, cancelable: false, detail: eventdetail });
        this.sendFormEvent('publisher:formsubmitted', { dn_formmeta_waittime: Date.now() - this._submitstart });
        if (dompack.dispatchCustomEvent(this.node, "wh:form-submitted", { bubbles: true, cancelable: true, detail: eventdetail })) {
          merge.run(this.node, { form: await this.getFormValue() });

          this._navigateToThankYou(result.result && result.result.richvalues);
          this.onSubmitSuccess(result.result);
        }
      } else {
        const failedfields = result.errors.map(error => error.name || "*").sort().join(" ");
        this.sendFormEvent('publisher:formfailed', {
          ds_formmeta_errorfields: failedfields,
          ds_formmeta_errorsource: 'server',
          dn_formmeta_waittime: Date.now() - this._submitstart
        });

        if (globalerrors.length) {
          if (dompack.dispatchCustomEvent(this.node, "wh:form-globalerrors", { bubbles: true, cancelable: true, detail: { globalerrors } }))
            this.displayGlobalErrors(globalerrors);
        }

        if (dompack.dispatchCustomEvent(this.node, "wh:form-failed", { bubbles: true, cancelable: true, detail: eventdetail }))
          this.onSubmitFailed(result.errors, result.result);
      }
      return result;
    } catch (e) {
      this.sendFormEvent('publisher:formexception', {
        ds_formmeta_exception: String(e),
        ds_formmeta_errorsource: insubmitrpc ? 'server' : 'client',
        dn_formmeta_waittime: Date.now() - this._submitstart
      });

      if (dompack.dispatchCustomEvent(this.node, "wh:form-exception", { bubbles: true, cancelable: true, detail: eventdetail }))
        this.onSubmitException(e);

      throw e;
    } finally {
      waiter.resolve();
      this.__formhandler.submitting = false;
    }
  }

  displayGlobalErrors(globalerrors) {
    try {
      const errors = globalerrors.map(error => dompack.create("p", { textContent: error.message }));
      runMessageBox(errors, [{ title: "OK" }]); //TODO: language?
    } catch (e) {
      console.error("runMessageBox failed", e);
      alert(globalerrors.map(error => error.message).join("\n"));
    }
  }

  //Get the first group that failed error handling
  getFirstFailedGroup() {
    return this.node.querySelector(".wh-form__fieldgroup-error");
  }

  //override this to deal with succesful submissions
  onSubmitSuccess(result) {
    const formpos = this.node.getBoundingClientRect();
    if (formpos.top < 0)
      this.node.scrollIntoView({ block: 'start', behavior: 'smooth' });

    if (result && result.resultsguid)
      this.node.dataset.whFormResultguid = result.resultsguid;

    if (result && result.submitinstruction)
      whintegration.executeSubmitInstruction(result.submitinstruction);
  }

  //override this to deal with failed submissions
  onSubmitFailed(errors, result) {
  }

  //override this to deal with form exceptions
  onSubmitException(e) {
  }

  async validateSingleFormField(field: HTMLElement): Promise<boolean> {
    if (field.type == "email") { //TODO perhaps move this to webharefields.es ?
      if (focus.getCurrentlyFocusedElement() == field) { //TODO clearing suggestion on change should probably be generalized
        if (field.propWhValidationSuggestion) {
          field.propWhValidationSuggestion = null;
        }
      } else {
        const validation = emailvalidation.validateField(this, field);
        this.pendingrpcs.push(validation);
        if (!(await validation))
          return false;
      }
    }
    return true;
  }
}
