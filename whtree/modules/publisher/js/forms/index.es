/* @import: import '@mod-publisher/js/forms';
*/
import * as dompack from 'dompack';
import './internal/requiredstyles.css';
import * as merge from './internal/merge';
import FormBase from './formbase.es';
import RPCFormBase from './rpc.es';
export { FormBase, RPCFormBase };
export { setFieldError, setupValidator } from './internal/customvalidation.es';

let handlers = { "publisher:form": form => new FormBase(form)
               , "publisher:rpc":  form => new RPCFormBase(form)
               };
let didregister;
let formoptions = null;
let defaultsettings = { triggerevents: ['focusout']
                      , triggerafterfailure: ['input','change']
                      , pxl: true
                      , validate: true
                      , warnslow: 5000 //after how many msecs to warn a form is slow
                      };

export const registerMergeFormatter = merge.registerFormatter;

export function registerHandler(handlername, handler)
{
  if(handlers[handlername])
  {
    console.error(`Duplicate registerHandler for handler '${handlername}'`);
    return; //this _MAY_ be caused by somehow duplicate loading of libs... seen that once and ignoring+continue would indeed be the safer solution
  }
  handlers[handlername] = handler;
  if(didregister) //then we need to catch up registrations
    for(let form of dompack.qSA('form[data-wh-form-handler]'))
    {
      if(form.dataset.whFormHandler == handlername)
      {
        let newform = handler(form);
        if(formoptions)
          newform._setupFormHandler(formoptions);
      }
    }
}

export function setup(options)
{
  formoptions = {...defaultsettings, ...options};
  for(let form of dompack.qSA('form[data-wh-form-handler]'))
    if(form.propWhFormhandler)
      form.propWhFormhandler._setupFormHandler(formoptions);
}

dompack.register("form[data-wh-form-handler]", function(form)
{
  //ADDME allow late registration of handlers, delay/block form submission until we have the handler
  didregister=true;
  if(handlers[form.dataset.whFormHandler] && !form.propWhFormhandler)
  {
    let formobj = handlers[form.dataset.whFormHandler](form);
    if(formoptions)
      formobj._setupFormHandler(formoptions);
  }
});
