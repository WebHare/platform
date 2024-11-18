import * as dompack from 'dompack';
import * as dialogapi from 'dompack/api/dialog';
import "./__captcha.css";
import { CaptchaSettings, captcharegistry } from "@mod-publisher/js/captcha/api";

//recaptcha API: https://developers.google.com/recaptcha/docs/display
let recaptchaload: PromiseWithResolvers<void> | undefined;

declare global {
  interface Window {
    $wh__ongooglerecaptchaloaded: () => void;
    grecaptcha: {
      render: (node: HTMLElement, options: { sitekey: string; callback: () => void }) => string;
      getResponse: (id: string) => string;
    };
  }
}

window.$wh__ongooglerecaptchaloaded = function () {
  recaptchaload!.resolve();
};

function makeRecaptchaLoadPromise() {
  recaptchaload = Promise.withResolvers<void>();
  document.querySelector<HTMLElement>("head,body")!.append(<script src="https://www.google.com/recaptcha/api.js?onload=$wh__ongooglerecaptchaloaded&amp;render=explicit" />);
  return recaptchaload.promise;
}

export async function runRecaptchaDialog(sitekey: string, settings: CaptchaSettings) {
  let diag: dialogapi.DialogBase | undefined;
  const lock = dompack.flagUIBusy({ modal: true });
  try {
    await (recaptchaload ? recaptchaload.promise : makeRecaptchaLoadPromise());

    const captchanode = <div class="wh-captcha__googlerecaptchaholder"></div>;
    diag = dialogapi.createDialog();
    diag.contentnode!.appendChild(<div class="wh-captcha wh-captcha--googlerecaptcha">
      <h2 class="wh-captcha__title">{settings.title}</h2>
      <p class="wh-captcha__explain">{settings.explain}</p>
      {captchanode}
    </div>);

    if (sitekey === 'mock') {
      captchanode.appendChild(<label class="wh-captcha__mock"><input type="checkbox" on={{ click: () => diag!.resolve('mock') }} />I am a human, beep-bop</label>);
    } else {
      //@ts-ignore the recaptcha/api.js adds grecaptcha to the window
      const recaptchaid = window.grecaptcha.render(captchanode, {
        sitekey, callback: () => {
          const response = window.grecaptcha ? window.grecaptcha.getResponse(recaptchaid) : '';
          diag!.resolve(response);
        }
      });
    }
  } finally {
    lock.release();
  }

  return (await diag?.runModal()) || null;
}

const captchaDefer = Symbol("captchaDefer");

export async function runRecaptcha(sitekey: string, settings: CaptchaSettings) {
  if (!settings.injectInto)
    return runRecaptchaDialog(sitekey, settings); //legacy implementation, remove once all pre-5.4s have been republished at least once

  const injectinto = settings.injectInto as typeof settings.injectInto & { [captchaDefer]?: PromiseWithResolvers<string> };
  if (injectinto[captchaDefer])
    return injectinto[captchaDefer].promise;

  const defer = Promise.withResolvers<string>();
  const lock = dompack.flagUIBusy({ modal: true });
  try {
    await (recaptchaload ? recaptchaload.promise : makeRecaptchaLoadPromise());

    const captchanode = <div class="wh-captcha__googlerecaptchaholder"></div>;
    injectinto.append(
      <div class="wh-captcha wh-captcha--googlerecaptcha">
        <h2 class="wh-captcha__title">{settings.title}</h2>
        <p class="wh-captcha__explain">{settings.explain}</p>
        {captchanode}
      </div>);

    if (sitekey === 'mock') {
      captchanode.appendChild(<label class="wh-captcha__mock"><input type="checkbox" on={{ click: () => defer.resolve('mock') }} />I am a human, beep-bop</label>);
    } else {
      const recaptchaid = window.grecaptcha.render(captchanode, {
        sitekey, callback: () => {
          const response = window.grecaptcha ? window.grecaptcha.getResponse(recaptchaid) : '';
          defer.resolve(response);
        }
      });
    }
  } finally {
    lock.release();
  }

  injectinto[captchaDefer] = defer;
  return defer.promise;
}


export function setupGoogleRecaptcha() {
  if (captcharegistry["google-recaptcha"])
    throw new Error("Duplicate google recaptcha initialization");

  captcharegistry["google-recaptcha"] = { getResponse: runRecaptcha };
}
