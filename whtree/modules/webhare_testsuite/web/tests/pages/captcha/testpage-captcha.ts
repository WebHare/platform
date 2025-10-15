import * as dompack from '@webhare/dompack';
import './testpage-captcha.scss';

//activate minimum dialog support
import * as dialog from 'dompack/components/dialog';
import * as dialogapi from 'dompack/api/dialog';

import { getCaptchaResponse } from "@mod-publisher/js/captcha/api";

dialogapi.setupDialogs(options => dialog.createDialog('mydialog', options));

//activate google recaptcha (if that happens to be the one activated by the page)
import * as googleRecaptcha from "@mod-publisher/js/captcha/google-recaptcha";
googleRecaptcha.setupGoogleRecaptcha();

async function triggerCaptcha(elt: HTMLElement) {
  const result = await getCaptchaResponse(JSON.parse(elt.dataset.provider!), { injectInto: dompack.qR<HTMLElement>("#webcontextcaptcha_container") });
  dompack.qR<HTMLInputElement>('#webcontextcaptcha_result').value = result || '';
}

function init() {
  dompack.qR('#trigger_webcontextcaptcha').addEventListener("click", (evt) => void triggerCaptcha(evt.currentTarget as HTMLElement));
}
dompack.onDomReady(init);
