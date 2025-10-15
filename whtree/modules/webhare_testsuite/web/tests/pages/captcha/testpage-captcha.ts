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

async function triggerGoogleRecaptcha(elt: HTMLElement) {
  const result = await googleRecaptcha.runRecaptcha(elt.dataset.recaptchakey!,
    { injectInto: dompack.qR<HTMLElement>("#googlerecaptcha_container"), title: "Google Recaptcha", explain: "Please click the checkbox below to prove you're not a robot" });
  dompack.qR<HTMLInputElement>('#googlerecaptcha_result').value = result || '';
}

async function triggerCaptcha(elt: HTMLElement) {
  const result = await getCaptchaResponse(elt.dataset.apikey!, { injectInto: dompack.qR<HTMLElement>("#webcontextcaptcha_container") });
  dompack.qR<HTMLInputElement>('#webcontextcaptcha_result').value = result || '';
}

function init() {
  dompack.qR('#trigger_googlerecaptcha').addEventListener("click", (evt) => void triggerGoogleRecaptcha(evt.currentTarget as HTMLElement));
  dompack.qR('#trigger_webcontextcaptcha').addEventListener("click", (evt) => void triggerCaptcha(evt.currentTarget as HTMLElement));
}
dompack.onDomReady(init);
