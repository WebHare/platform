import type { FormConfiguration } from "@webhare/forms";
import { dispatchCustomEvent } from "@webhare/dompack";

let formConfiguration: FormConfiguration | undefined;

export function configureForms(setup: FormConfiguration) {
  if (!Object.keys(setup).length)
    return;

  formConfiguration = { ...formConfiguration, ...setup };
  dispatchCustomEvent(window, "wh:form-configure", { bubbles: true, cancelable: false, detail: formConfiguration });
}

export function getFormConfiguration(): FormConfiguration | undefined {
  return formConfiguration;
}