import * as dompack from 'dompack';
import './testpage-captcha.scss';

//activate minimum dialog support
import * as dialog from 'dompack/components/dialog';
import * as dialogapi from 'dompack/api/dialog';

import { getCaptchaResponse } from "@mod-publisher/js/captcha/api";

dialogapi.setupDialogs(options => dialog.createDialog('mydialog', options));

//activate google recaptcha
import * as googleRecaptcha from "@mod-publisher/js/captcha/google-recaptcha";
googleRecaptcha.setupGoogleRecaptcha();

async function triggerGoogleRecaptcha()
{
  let result = await googleRecaptcha.runRecaptchaDialog(this.dataset.recaptchakey);
  dompack.qS('#googlerecaptcha_result').value = result;
}

async function triggerCaptcha()
{
  let result = await getCaptchaResponse(this.dataset.apikey);
  dompack.qS('#webcontextcaptcha_result').value = result;
}

function init()
{
  dompack.qS('#trigger_googlerecaptcha').addEventListener("click", triggerGoogleRecaptcha);
  dompack.qS('#trigger_webcontextcaptcha').addEventListener("click", triggerCaptcha);
}
dompack.onDomReady(init);
