import * as dompack from '@webhare/dompack';
import { type CaptchaProvider, type CaptchaSettings, captcharegistry } from "@mod-publisher/js/captcha/api";

//recaptcha API: https://developers.google.com/recaptcha/docs/display
let recaptchaload: PromiseWithResolvers<void> | undefined;

type RecaptchaOptions = { language?: string };
let recaptchaOptions: RecaptchaOptions | undefined;

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

export async function runRecaptcha(provider: CaptchaProvider, injectInto: HTMLElement, settings: CaptchaSettings) {
  const lock = dompack.flagUIBusy({ modal: true });
  try {
    await (recaptchaload ? recaptchaload.promise : makeRecaptchaLoadPromise());

    const captchanode = <div class="wh-captcha__googlerecaptchaholder"></div>;
    injectInto.append(captchanode);

    if (provider.apikey === 'mock') {
      captchanode.appendChild(<label class="wh-captcha__mock"><input type="checkbox" on={{ click: () => settings.onResponse('mock') }} />I am a human, beep-bop</label>);
    } else {
      const recaptchaid = window.grecaptcha.render(captchanode, {
        sitekey: provider.apikey,
        ...recaptchaOptions?.language ? { hl: recaptchaOptions.language } : {},
        callback: () => {
          const response = window.grecaptcha ? window.grecaptcha.getResponse(recaptchaid) : '';
          settings.onResponse(response);
        }
      });
    }
  } finally {
    lock.release();
  }
}


/** Setup Google reCAPTCHA rendering
 * @param options Optional settings, currently supports:
 *  - language: The language code to use for the reCAPTCHA widget. See https://developers.google.com/recaptcha/docs/language for supported language codes
 */
export function setupGoogleRecaptcha(options?: RecaptchaOptions) {
  if (captcharegistry["google-recaptcha"])
    throw new Error("Duplicate google recaptcha initialization");

  recaptchaOptions = { ...recaptchaOptions, ...options };
  captcharegistry["google-recaptcha"] = { initialize: runRecaptcha };
}
