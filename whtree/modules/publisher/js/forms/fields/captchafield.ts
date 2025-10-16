/* eslint-disable @typescript-eslint/no-floating-promises -- FIXME: needs API rework */

import * as dompack from 'dompack';
import { getCaptchaResponse } from "@mod-publisher/js/captcha/api";
import { type DocEvent, addDocEventListener } from '@webhare/dompack';
import type { SetFieldErrorData } from '../internal/customvalidation';
import FormBase from '../formbase';

export default class CaptchaField {
  node;
  captchaHolder: HTMLElement | null = null;
  response = '';

  constructor(node: HTMLElement) {
    this.node = node;
    addDocEventListener(this.node, 'wh:form-getvalue', evt => this._getValue(evt));
    addDocEventListener(this.node, 'wh:form-setfielderror', evt => this._setFieldError(evt));

    const form = this.node.closest('form');
    if (form)
      addDocEventListener(form, 'reset', () => this._onReset());
  }
  _getValue(evt: DocEvent<CustomEvent<{ deferred: PromiseWithResolvers<unknown> }>>) {
    dompack.stop(evt);
    evt.detail.deferred.resolve(this.response);
  }
  _onReset() {
    this.response = '';
    this.captchaHolder?.remove();
    this.captchaHolder = null;
  }

  async _setFieldError(evt: DocEvent<CustomEvent<SetFieldErrorData>>) {
    dompack.stop(evt);
    if (!evt.detail.error) //error cleared
      return;

    //If we get here, we captcha is either invalid or not set yet (and required).
    const metadata = evt.detail.metadata as { apikey: string };
    if (!metadata.apikey)
      throw new Error("No apikey received in captcha error message");

    const formel = this.node.closest('form');
    const form = formel ? FormBase.getForNode(formel) : null;
    if (!form)
      throw new Error(`Cannot find associated form`);

    const captchapage = form.node.querySelector<HTMLElement>('[data-wh-form-pagerole=captcha]');
    if (!captchapage) { // Execute old (WH5.3) implementation
      //ADDME start a modality layer? coordinate with form? make sure this executes only once!
      const result = await getCaptchaResponse(metadata.apikey);

      if (result) {
        this.response = result;
        //FIXME: We should make sure the same button (submitter) is pressed again, and we should also submit the original
        //       extradata... It's probably better to have the captcha field use the same (kind of) confirmation flow as the
        //       mail confirmation handler. This also has the benefit that the field value is already stored, which would allow
        //       the result to be confirmed in the backend, if a user is stuck on the captcha.
        form._doSubmit(null, undefined); //FIXME we're losing the extradata here!
      }
      return;
    }

    form.gotoPage(captchapage);
    if (!this.captchaHolder) {
      this.captchaHolder = document.createElement('div');
      captchapage.appendChild(this.captchaHolder);
    }

    getCaptchaResponse(metadata.apikey, { injectInto: this.captchaHolder }).then(result => {
      this.response = result || '';
    });
  }
}
