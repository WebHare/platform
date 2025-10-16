import * as dompack from '@webhare/dompack';
import { getCaptchaResponse, type CaptchaProvider } from "@mod-publisher/js/captcha/api";
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
    const metadata = evt.detail.metadata as { provider: CaptchaProvider };
    if (!metadata.provider?.apikey)
      throw new Error("No apikey received in captcha error message");

    const formel = this.node.closest('form');
    const form = formel ? FormBase.getForNode(formel) : null;
    if (!form)
      throw new Error(`Cannot find associated form`);

    const captchapage = dompack.qR(form.node, '[data-wh-form-pagerole=captcha]');
    await form.gotoPage(captchapage);

    if (!this.captchaHolder) {
      this.captchaHolder = document.createElement('div');
      captchapage.appendChild(this.captchaHolder);
    }
    const result = await getCaptchaResponse(metadata.provider, this.captchaHolder);
    this.response = result || '';
  }
}
