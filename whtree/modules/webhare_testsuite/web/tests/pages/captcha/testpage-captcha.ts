import * as dompack from '@webhare/dompack';
import './testpage-captcha.scss';

//activate minimum dialog support
import * as dialog from 'dompack/components/dialog';
import * as dialogapi from 'dompack/api/dialog';

import { initializeCaptcha } from "@mod-publisher/js/captcha/api";

dialogapi.setupDialogs(options => dialog.createDialog('mydialog', options));

//activate google recaptcha (if that happens to be the one activated by the page)
import * as googleRecaptcha from "@mod-publisher/js/captcha/google-recaptcha";
googleRecaptcha.setupGoogleRecaptcha();

function triggerCaptcha(elt: HTMLElement) {
  void initializeCaptcha(JSON.parse(elt.dataset.provider!), dompack.qR("#webcontextcaptcha_container"), {
    onResponse: (result: string) => dompack.qR<HTMLInputElement>('#webcontextcaptcha_result').value = result
  });
}

function init() {
  dompack.qR('#trigger_webcontextcaptcha').addEventListener("click", (evt) => triggerCaptcha(evt.currentTarget as HTMLElement));
}
dompack.onDomReady(init);
