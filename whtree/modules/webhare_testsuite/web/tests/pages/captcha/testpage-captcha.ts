import * as dompack from '@webhare/dompack';
import './testpage-captcha.scss';

//activate minimum dialog support
import * as dialog from 'dompack/components/dialog';
import * as dialogapi from 'dompack/api/dialog';

import { getCaptchaResponse } from "@mod-publisher/js/captcha/api";

dialogapi.setupDialogs(options => dialog.createDialog('mydialog', options));

//activate google recaptcha
import * as googleRecaptcha from "@mod-publisher/js/captcha/google-recaptcha";
googleRecaptcha.setupGoogleRecaptcha();

async function triggerGoogleRecaptcha(this: HTMLElement) {
  const result = await googleRecaptcha.runRecaptchaDialog(this.dataset.recaptchakey!,
    { injectInto: null, title: "Google Recaptcha", explain: "Please click the checkbox below to prove you're not a robot" });
  dompack.qR<HTMLInputElement>('#googlerecaptcha_result').value = result || '';
}

async function triggerCaptcha(this: HTMLElement) {
  const result = await getCaptchaResponse(this.dataset.apikey!);
  dompack.qR<HTMLInputElement>('#webcontextcaptcha_result').value = result || '';
}

function init() {
  dompack.qR('#trigger_googlerecaptcha').addEventListener("click", triggerGoogleRecaptcha);
  dompack.qR('#trigger_webcontextcaptcha').addEventListener("click", triggerCaptcha);
}
dompack.onDomReady(init);
