import * as dompack from 'dompack';
import * as focus from 'dompack/browserfix/focus';
import * as browser from 'dompack/extra/browser';
import * as merge from './internal/merge';
import FormBase from './formbase';
import JSONRPC from '@mod-system/js/net/jsonrpc';
import * as formservice from './internal/form.rpc.json';
import * as whintegration from '@mod-system/js/wh/integration';
import * as emailvalidation from './internal/emailvalidation';
import { runMessageBox } from 'dompack/api/dialog';

function supportsScrollIntoViewBehavior() //http://caniuse.com/#feat=scrollintoview
{
  return ["firefox","chrome"].includes(browser.getName());
}

export default class RPCFormBase extends FormBase
{
  constructor(formnode)
  {
    super(formnode);
    this.__formhandler = { errors: []
                         , warnings: []
                         , formid: formnode.dataset.whFormId
                         , formref: formnode.dataset.whFormRef
                         , url: location.href.split('/').slice(3).join('/')
                         };

    if(!this.__formhandler.formid)
    {
      if(!whintegration.config.islive)
        console.error("Missing data-wh-form-id on form, did your witty apply '[form.formattributes]' to the <form> tag ?", formnode);
      throw new Error("Form does not appear to be a WebHare form");
    }

    if(this.__formhandler.formid == '-')
    {
      this.jsonrpc = new JSONRPC();
      this.formservice = { callFormService: this._callFormService.bind(this)
                         };
    }
    else
    {
      this.formservice = formservice;
    }
  }

  getServiceSubmitInfo() //submitinfo as required by some RPCs
  {
    return { formid: this.__formhandler.formid
           , formref: this.__formhandler.formref
           , url: this.__formhandler.url
           };
  }

  async _callFormService(method, ...args)
  {
    return await this.jsonrpc.async("callFormService", method, args);
  }

  //Invoke a function on the form on the server
  async _invokeRPC(methodname, args, options)
  {
    let waiter = dompack.createDeferred();
    let background = !!(options&&options.background);

    if(!background)
      this.onRPC(waiter.promise);

    let lock = dompack.flagUIBusy({ ismodal: !background, component: this.node });
    try
    {
      let formvalue = await this.getFormValue();
      let result = await this.formservice.callFormService("invoke", { ...this.getServiceSubmitInfo()
                                                                    , fields: formvalue
                                                                    , methodname: methodname
                                                                    , args: args
                                                                    });
      this._processMessages(result.messages);
      return result.result;
    }
    finally
    {
      lock.release();
      waiter.resolve();
    }
  }

  /* Override this to implement support for incoming field messages */
  processFieldMessage(field, prop, value)
  {
    let fieldnode = this.node.querySelector('*[name="' + field + '"], *[data-wh-form-name="' + field + '"]');
    if(!fieldnode)
    {
      console.warn("Message for non-existent field: " + field + ", prop: " + prop + ", value: " + value.toString());
      return;
    }
    if(prop == 'value')
    {
      this.setFieldValue(fieldnode, value);
      return;
    }
    console.warn("Unknown field message: field: " + field + ", prop: " + prop + ", value: " + value.toString());
  }

  //Override this function to easily submit extra fields
  getFormExtraSubmitData()
  {
    return {};
  }

  //Invoked when RPC is occuring. Is passed a promise that will resolve on completion
  //onRPC is DEPRECATED, switching to event based api
  onRPC(promise)
  {
  }

  /** Invoke a function on the form on the server
      @param methodname Name of the function on the form
      @param args Arguments for the function
      @return Promise that resolves to the result of the rpc call
  */
  invokeRPC(methodname, ...args)
  {
    return this._invokeRPC(methodname, args);
  }

  /** Invoke a function on the form on the server, doesn't call .onRPC or request modality layers
      @param methodname Name of the function on the form
      @param args Arguments for the function
      @return Promise that resolves to the result of the rpc call
  */
  invokeBackgroundRPC(methodname, ...args)
  {
    return this._invokeRPC(methodname, args, { background: true });
  }

  _processMessages(messages)
  {
    for(let msg of messages)
    {
      this.processFieldMessage(msg.field, msg.prop, msg.data);
    }
  }

  async submit(extradata)
  {
    //ADDME timeout and free the form after some time
    if(this.submitting) //throwing is the safest solution... having the caller register a second resolve is too dangerous
      throw new Error("The form is already being submitted");

    let waiter = dompack.createDeferred();
    let insubmitrpc = false;
    this.onRPC(waiter.promise);

    let eventdetail = { form: this.node
                      , rpchandler: this
                      };
    try
    {
      this.__formhandler.submitting = true;

      //Request extrasubmit first, so that if it returns a promise, it can execute in parallel with getFormValue
      let extrasubmit = this.getFormExtraSubmitData();
      eventdetail.extrasubmitdata = extrasubmit;

      let formvalue = await this.getFormValue();
      eventdetail.submitted = formvalue;

      if(extrasubmit && extrasubmit.then) //got a promise? expand it
        extrasubmit = await extrasubmit;

      extrasubmit = { ...extradata
                    , ...extrasubmit
                    };

      dompack.dispatchCustomEvent(this.node, "wh:form-preparesubmit", { bubbles:true, cancelable: false, detail: { extrasubmit: extrasubmit } });
      let submitparameters = { ...this.getServiceSubmitInfo()
                             , fields: formvalue
                             , extrasubmit: extrasubmit
                             };

      if(dompack.debugflags.fhv)
        console.log('[fhv] start submission',submitparameters);

      insubmitrpc = true; //so we can easily determine exception source
      let result = await this.formservice.callFormService("submit", submitparameters);
      insubmitrpc = false;

      if(dompack.debugflags.fhv)
        console.log('[fhv] received response',result);

      if(!dompack.dispatchCustomEvent(this.node, "wh:form-response",  { bubbles:true, cancelable: true, detail: result }))
        return result;

      eventdetail.result = result.result;
      eventdetail.errors = result.errors;

      let didfirstfocus = false;
      let globalerrors = [];
      for(let error of result.errors)
      {
        if(!error.name)
        {
          globalerrors.push(error);
          continue;
        }

        let failednode = this.node.querySelector('[name="' + error.name + '"], [data-wh-form-name="' + error.name + '"]');
        if(!failednode)
        {
          console.error("[fhv] Unable to find node '" + error.name + "' which caused error:" + error.message);
          continue;
        }
        if(!didfirstfocus)
        {
          dompack.focus(failednode);
          didfirstfocus = true;
        }
        FormBase.setFieldError(failednode, error.message, { reportimmediately: true, serverside: true, metadata: error.metadata });
      }

      if(result.success)
      {
        dompack.dispatchCustomEvent(this.node, "wh:form-values", { bubbles:true, cancelable: false, detail: eventdetail });
        this.sendFormEvent('publisher:formsubmitted', { dn_formmeta_waittime: Date.now() - this._submitstart });
        if(dompack.dispatchCustomEvent(this.node, "wh:form-submitted", { bubbles:true, cancelable: true, detail: eventdetail }))
        {
          merge.run(this.node, { form: await this.getFormValue() });

          this._navigateToThankYou(result.result && result.result.richvalues);
          this.onSubmitSuccess(result.result);
        }
      }
      else
      {
        let failedfields = result.errors.map(error => error.name || "*").sort().join(" ");
        this.sendFormEvent('publisher:formfailed', { ds_formmeta_errorfields: failedfields
                                                   , ds_formmeta_errorsource: 'server'
                                                   , dn_formmeta_waittime: Date.now() - this._submitstart
                                                 });

        if(globalerrors.length)
        {
          if(dompack.dispatchCustomEvent(this.node, "wh:form-globalerrors", { bubbles:true, cancelable: true, detail: { globalerrors } }))
            this.displayGlobalErrors(globalerrors);
        }

        if(dompack.dispatchCustomEvent(this.node, "wh:form-failed", { bubbles:true, cancelable: true, detail: eventdetail }))
          this.onSubmitFailed(result.errors, result.result);
      }
      return result;
    }
    catch(e)
    {
      this.sendFormEvent('publisher:formexception', { ds_formmeta_exception: String(e)
                                                    , ds_formmeta_errorsource: insubmitrpc ? 'server' : 'client'
                                                    , dn_formmeta_waittime: Date.now() - this._submitstart
                                                    });

      if(dompack.dispatchCustomEvent(this.node, "wh:form-exception", { bubbles:true, cancelable: true, detail: eventdetail }))
        this.onSubmitException(e);

      throw e;
    }
    finally
    {
      waiter.resolve();
      this.__formhandler.submitting = false;
    }
  }

  displayGlobalErrors(globalerrors)
  {
    try
    {
      let errors = globalerrors.map(error => dompack.create("p", { textContent:error.message }));
      runMessageBox(errors, [ { title: "OK" } ]); //TODO: language?
    }
    catch(e)
    {
      console.error("runMessageBox failed",e);
      alert(globalerrors.map(error => error.message).join("\n"));
    }
  }

  //Get the first group that failed error handling
  getFirstFailedGroup()
  {
    return this.node.querySelector(".wh-form__fieldgroup-error");
  }

  //override this to deal with succesful submissions
  onSubmitSuccess(result)
  {
    let formpos = this.node.getBoundingClientRect();
    if(formpos.top < 0)
      this.node.scrollIntoView(supportsScrollIntoViewBehavior() ? {block:'start', behavior:'smooth'} : true);

    if(result && result.resultsguid)
      this.node.dataset.whFormResultguid = result.resultsguid;

    if(result && result.submitinstruction)
      whintegration.executeSubmitInstruction(result.submitinstruction);
  }

  //override this to deal with failed submissions
  onSubmitFailed(errors, result)
  {
  }

  //override this to deal with form exceptions
  onSubmitException(e)
  {
  }

  async validateSingleFormField(field)
  {
    if(field.type == "email") //TODO perhaps move this to webharefields.es ?
    {
      if(focus.getCurrentlyFocusedElement() == field) //TODO clearing suggestion on change should probably be generalized
      {
        if(field.propWhValidationSuggestion)
        {
          field.propWhValidationSuggestion = null;
        }
      }
      else
      {
        if(! (await emailvalidation.validateField(this, field)))
          return false;
      }
    }
    return true;
  }
}
