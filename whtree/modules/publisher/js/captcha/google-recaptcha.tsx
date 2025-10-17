import * as dompack from '@webhare/dompack';
import { type CaptchaProvider, type CaptchaSettings, captcharegistry } from "@mod-publisher/js/captcha/api";

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

const captchaResolvers = new WeakMap<HTMLElement, PromiseWithResolvers<string>>();

export async function runRecaptcha(provider: CaptchaProvider, injectInto: HTMLElement, settings: CaptchaSettings) {
  const existingResolver = captchaResolvers.get(injectInto); // Check if a captcha is already being built
  if (existingResolver)
    return existingResolver.promise;

  const defer = Promise.withResolvers<string>();
  const lock = dompack.flagUIBusy({ modal: true });
  try {
    await (recaptchaload ? recaptchaload.promise : makeRecaptchaLoadPromise());

    const captchanode = <div class="wh-captcha__googlerecaptchaholder"></div>;
    injectInto.append(
      <div class="wh-captcha wh-captcha--googlerecaptcha">
        <h2 class="wh-captcha__title">{settings.title}</h2>
        <p class="wh-captcha__explain">{settings.explain}</p>
        {captchanode}
      </div>);

    if (provider.apikey === 'mock') {
      captchanode.appendChild(<label class="wh-captcha__mock"><input type="checkbox" on={{ click: () => defer.resolve('mock') }} />I am a human, beep-bop</label>);
    } else {
      const recaptchaid = window.grecaptcha.render(captchanode, {
        sitekey: provider.apikey, callback: () => {
          const response = window.grecaptcha ? window.grecaptcha.getResponse(recaptchaid) : '';
          defer.resolve(response);
        }
      });
    }
  } finally {
    lock.release();
  }

  captchaResolvers.set(injectInto, defer);
  return defer.promise;
}


export function setupGoogleRecaptcha() {
  if (captcharegistry["google-recaptcha"])
    throw new Error("Duplicate google recaptcha initialization");

  captcharegistry["google-recaptcha"] = { getResponse: runRecaptcha };
}
