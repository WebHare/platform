/* PLEASE NOTE - including @mod-publisher/js/forms is considered including the 'legacy form api'. It comes
   without tree shaking support and autoregisters forms

   @webhare/forms provides a tree-shakable implementation (but requires more setup). To switch please see dev module forms.ts
  setupForms();
*/

import './internal/requiredstyles.css';
import * as merge from './internal/merge';
import { setFieldError, setupValidator } from './internal/customvalidation';
import FormBase, { type FormSubmitEmbeddedResult } from './formbase';
import RPCFormBase from './rpc';
import { setupForms, registerHandler } from '@webhare/forms';
import { isLive } from '@webhare/env';

export { FormBase, RPCFormBase, setFieldError, setupValidator, type FormSubmitEmbeddedResult };

export const registerMergeFormatter = merge.registerFormatter;

type LegacyFormHandlerFactory = (form: HTMLFormElement) => FormBase;

function legacyRegisterFormHandler(handlername: string, handler: LegacyFormHandlerFactory) {
  registerHandler(handlername, (form: HTMLFormElement) => {
    const createdForm = handler(form);
    if (!isLive && createdForm instanceof FormBase && !(createdForm instanceof RPCFormBase)) {
      console.warn(`Form handler for '${handlername}' is deriving from @mod-publisher/js/forms#FormBase - it should derive from RPCFormBase (In WH5.7+, the FormBase exported by @webhare/forms will *be* the RPCFormBase)`);
    }
    return createdForm as RPCFormBase;
  });
}

/** @deprecated setup() is no longer needed */
export function setup(options: unknown) {
}

// We explicitly bind the 'publisher:form' forms to FormBase. The modern version doesn't distinguish between these anymore (and we want to move away from that difference anyawy, RPCBase isn't that much different)
setupForms({
  handlers: { "publisher:form": form => new FormBase(form) as RPCFormBase }
});

export { legacyRegisterFormHandler as registerHandler };
