/* To verify tree shaking viability, try:
   whcd
   cd whtree
   echo 'import "@webhare/forms"' | node_modules/.bin/esbuild --loader:.css=empty --tsconfig=tsconfig.json --bundle --minify
*/

// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/forms" {
}

import FormBase from '@mod-publisher/js/forms/formbase';
import RPCFormBase from '@mod-publisher/js/forms/rpc';
import { verifyAddress, AddressValidationResult, AddressChecks } from './address';
import { ImgEditElement } from "@mod-publisher/js/forms/fields/imgedit";
import { JSFormElement } from './jsformelement';
import type { FormFileValue } from './types';
import { getFormHandler, getFormData } from './domsupport';

export { FormBase, RPCFormBase, verifyAddress, ImgEditElement, JSFormElement, getFormHandler, getFormData };
export type { AddressValidationResult, AddressChecks, FormFileValue };
