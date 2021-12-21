import * as dompack from 'dompack';
import { getCaptchaResponse } from "@mod-publisher/js/captcha/api";

export default class CaptchaField
{
  constructor(node)
  {
    this.response = '';
    this.node = node;
    this.node.addEventListener('wh:form-getvalue', evt => this._getValue(evt));
    this.node.addEventListener('wh:form-setfielderror', evt => this._setFieldError(evt));
  }
  _getValue(evt)
  {
    dompack.stop(evt);
    evt.detail.deferred.resolve(this.response);
  }
  async _setFieldError(evt)
  {
    dompack.stop(evt);
    if(!evt.detail.error) //error cleared
      return;
    if(!evt.detail.metadata.apikey)
      throw new Error("No apikey received in captcha error message");

    //ADDME start a modality layer? coordinate with form? make sure this executes only once!
    let result = await getCaptchaResponse(evt.detail.metadata.apikey, { busycomponent: this.node });
    if(result)
    {
      this.response = result;
      //FIXME: We should make sure the same button (submitter) is pressed again, and we should also submit the original
      //       extradata... It's probably better to have the captcha field use the same (kind of) confirmation flow as the
      //       mail confirmation handler. This also has the benefit that the field value is already stored, which would allow
      //       the result to be confirmed in the backend, if a user is stuck on the captcha.
      this.node.closest('form').propWhFormhandler._doSubmit();
    }
  }
}
