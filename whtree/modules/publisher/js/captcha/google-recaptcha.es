import * as dompack from 'dompack';
import * as dialogapi from 'dompack/api/dialog.es';
import { getTid } from "@mod-tollium/js/gettid";
import "./__captcha.lang.json";
import "./__captcha.css";
import { captcharegistry } from "@mod-publisher/js/captcha/api";

//recaptcha API: https://developers.google.com/recaptcha/docs/display
let recaptchaload;
let settings;

window.$wh__ongooglerecaptchaloaded = function()
{
  recaptchaload.resolve();
};

function makeRecaptchaLoadPromise()
{
  recaptchaload = dompack.createDeferred();
  document.querySelector("head,body").appendChild(<script src="https://www.google.com/recaptcha/api.js?onload=$wh__ongooglerecaptchaloaded&amp;render=explicit" />);
}

export async function runRecaptchaDialog(sitekey, options)
{
  options = { busycomponent: null, ...options};
  let lock = dompack.flagUIBusy({component: options.busycomponent, ismodal: true});

  let diag = null;
  try
  {
    if(!recaptchaload)
      makeRecaptchaLoadPromise();
    await recaptchaload.promise;

    let captchanode = <div class="wh-captcha__googlerecaptchaholder"></div>;
    let title = (settings ? settings.title : '') || getTid("publisher:site.captcha.title");
    let explain = (settings ? settings.explain : '') || getTid("publisher:site.captcha.explain");

    diag = dialogapi.createDialog();
    diag.contentnode.appendChild(<div class="wh-captcha wh-captcha--googlerecaptcha">
                                   <h2 class="wh-captcha__title">{title}</h2>
                                   <p class="wh-captcha__explain">{explain}</p>
                                   {captchanode}
                                 </div>);

    if(sitekey == 'mock')
    {
      captchanode.appendChild(<label class="wh-captcha__mock"><input type="checkbox" on={{click: () => diag.resolve('mock')}} />I am a human, beep-bop</label>);
    }
    else
    {
      var recaptchaid; //retained in closure for the callback handler
      recaptchaid = window.grecaptcha.render(captchanode, { sitekey, callback: evt =>
      {
        let response = window.grecaptcha ? window.grecaptcha.getResponse(recaptchaid) : '';
        diag.resolve(response);
      }});
    }
  }
  finally
  {
    lock.release();
  }
  return diag.runModal();
}

export function setupGoogleRecaptcha()
{
  if(captcharegistry["google-recaptcha"])
    throw new Error("Duplicate google recaptcha initialization");

  captcharegistry["google-recaptcha"] = { getResponse: runRecaptchaDialog };
}
