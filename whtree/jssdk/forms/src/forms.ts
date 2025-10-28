/* To verify tree shaking viability, try:
   whcd
   cd whtree
   echo 'import "@webhare/forms"' | node_modules/.bin/esbuild --loader:.css=empty --tsconfig=tsconfig.json --bundle --minify
*/

// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/forms" {
}

import FormBase from '@mod-publisher/js/forms/rpc';
import { default as LocalFormBase } from "@mod-publisher/js/forms/formbase"; //'FormBase', the RPC-ing one, is the one you want 99% of the time. LocalFormBase is for pure local handling (eg a PWA Config screen)
import { verifyAddress, type AddressValidationResult, type AddressChecks } from './address';
import { FileUploadFormElement as FileEditElement } from "@mod-publisher/js/forms/fields/upload";
import { ImgEditElement } from "@mod-publisher/js/forms/fields/imgedit";
import { JSFormElement } from './jsformelement';
import type { FormFileValue, FormAnalyticsEvent } from './types';
import { getFormHandler, getFormData } from './domsupport';
import { registerHandlers } from './registration';

/* TODO / NOTES
  - we cannot move this file into jssdk namespace, the lang.json compiler doesn't accept paths that cannot be translated to a WH resource
  - lang.json isn't really TS compatible, a nicer followup TS interface would allow something like
    import myModuleTexts from "wh:tid/mymodle";
    and offer intellisense (after solving the problems like "what if a module wants to export multiple sets, how to implement HTMLTid and variables, etc")
  - so for now we'll hardcode importing form.lang.json so external users don't have to do this, take the treeshaking hit, and plan to move builtin texts
    to some sort of /.wh/generated/builtin-language-texts system where we load the common builtin texts per language on demand
*/
import "@mod-publisher/js/forms/internal/form.lang.json";

export { FormBase, verifyAddress, ImgEditElement, FileEditElement, JSFormElement, getFormHandler, getFormData };
export type { FormSubmitResult } from "@mod-publisher/js/forms/formbase";
export { buildRPCFormSubmission as buildFormSubmission, submitRPCForm as submitForm } from "@mod-publisher/js/forms/rpc";
export type { RPCFormSubmission as FormSubmission } from "./types";
export type { AddressValidationResult, AddressChecks, FormFileValue, FormAnalyticsEvent };
export { DateField, TimeField } from "@mod-publisher/js/forms/fields/datetime";
export { registerHandler } from "./registration";
export { setupGoogleRecaptcha } from "@mod-publisher/js/captcha/google-recaptcha";
export { setupFriendlyCaptcha } from "./friendly-captcha";
export { setupValidator } from "@mod-publisher/js/forms/internal/customvalidation";
export { LocalFormBase };

export type FormHandlerFactory = (form: HTMLFormElement) => LocalFormBase;

export type FormSetupOptions = {
  handlers: Record<string, FormHandlerFactory>;
};

/// Initialize all forms we already have the handler for
export function setupForms(options?: FormSetupOptions) {
  registerHandlers(options?.handlers ?? {});
}
