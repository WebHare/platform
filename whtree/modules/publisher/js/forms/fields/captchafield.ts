import * as dompack from '@webhare/dompack';
import { initializeCaptcha, type CaptchaProvider } from "@mod-publisher/js/captcha/api";
import { setFieldError, type SetFieldErrorData } from '../internal/customvalidation';

import "../../captcha/__captcha.lang.json"; //TODO or have forms send this tid (so it can also be overridden there)
import { JSFormElement } from '@webhare/forms';
import { getTid } from '@webhare/gettid';
import type RPCFormBase from '../rpc';

declare global {
  interface HTMLElementTagNameMap {
    "wh-captcha": CaptchaField;
  }
}

export default class CaptchaField extends JSFormElement<string> {
  value = '';
  provider: CaptchaProvider | null = null;

  constructor() {
    super();
    this.addEventListener('wh:form-setfielderror', evt => void this._setFieldError(evt));
    this.whFormsApiChecker = () => this.check();

    const form = this.closest('form');
    if (form)
      form.addEventListener('reset', () => this.onReset());
  }

  check(): void {
    if (!this.value)
      setFieldError(this, getTid("publisher:site.forms.commonerrors.required"), { reportimmediately: false });
    else
      setFieldError(this, "", { reportimmediately: false });
  }

  private async setup() {
    if (this.provider) {
      await initializeCaptcha(this.provider, this, {
        onResponse: (result: string) => { this.value = result; }
      });
    }
  }

  private onReset() {
    this.value = '';
    this.replaceChildren();
    void this.setup();
  }

  async _setFieldError(evt: CustomEvent<SetFieldErrorData>) {
    const serverMetadata = evt.detail.metadata as { provider: CaptchaProvider } | undefined;
    if (serverMetadata?.provider) { //the first time an error is triggered it should be the server telling us which provider to use
      this.provider = serverMetadata.provider;
      await this.setup();
    }

    dompack.stop(evt);
    if (!evt.detail.error) //error cleared
      return;

    //If we get here, we captcha is either invalid or not set yet (and required).
    if (this.value) { //we were already sending a response!
      console.log("Captcha response was rejected, resetting");
      this.onReset(); //better restart the control, timeout or duplicat submission
    }
  }
}

export function setupCaptchaFieldGroup(form: RPCFormBase<object>): CaptchaField {
  /* Setup a page-less holder for the captcha field

    <div class="wh-form__page wh-form__page--visible">
      <div class="wh-form__fieldgroup" data-wh-form-group-for="__form_captcha">
        ...
    */

  const captchaControl = dompack.create("wh-captcha", { class: "wh-form__captcha", dataset: { whFormName: "__form_captcha", whFormRequired: "true" } });

  const virtualCaptchaPage = dompack.create("div", { class: "wh-form__captchapage" }, [
    dompack.create("div", { class: "wh-form__fieldgroup", dataset: { whFormGroupFor: "__form_captcha" } }, [
      dompack.create("label", { class: "wh-form__label" }, [getTid("publisher:site.captcha.title")]),
      dompack.create("div", { class: "wh-form__fields" },
        [dompack.create("div", { class: "wh-form__fieldline" }, [captchaControl])]
      )
    ])
  ]);

  //Position it before the navbuttons, but if they are missing for whatever reason, just add to the end of the form
  const buttonarea = dompack.qS(form.node, ".wh-form__navbuttons");
  if (buttonarea)
    buttonarea.before(virtualCaptchaPage);
  else
    form.node.appendChild(virtualCaptchaPage);

  return captchaControl;
}


customElements.define("wh-captcha", CaptchaField);
