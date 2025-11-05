import * as dompack from '@webhare/dompack';
import { type CaptchaProvider, type CaptchaSettings, captcharegistry } from "@mod-publisher/js/captcha/api";

//friendly captcha API: https://developer.friendlycaptcha.com/docs/v2/sdk/configuration
let script = "https://cdn.jsdelivr.net/npm/@friendlycaptcha/sdk@0.1.31/site.min.js";
let isLoaded = false;

export async function runFriendlyCaptcha(provider: CaptchaProvider, injectInto: HTMLElement, settings: CaptchaSettings): Promise<void> {
  const captcha = document.createElement('div');
  captcha.className = "frc-captcha";
  captcha.dataset.sitekey = provider.apikey;
  captcha.dataset.apiEndpoint = "eu"; //https://developer.friendlycaptcha.com/docs/v2/sdk/configuration#data-api-endpoint
  captcha.addEventListener("frc:widget.complete", ((evt: CustomEvent<{ response: string }>) => settings.onResponse(evt.detail.response)) as EventListener);

  injectInto.append(captcha);

  if (isLoaded) {
    //@ts-expect-error -- undocumented but this seems to properly refresh the unit
    window.frcaptcha.attach();
  } else { //Now initialize it
    using lock = dompack.flagUIBusy();
    void (lock);
    //TODO listen for widget.statechange - https://developer.friendlycaptcha.com/docs/v2/sdk/events#frcwidgetstatechange before releasing the lock
    await dompack.loadScript(script, { module: true });
    isLoaded = true;
  }
}

export function setupFriendlyCaptcha(options?: { script: string }) {
  if (captcharegistry["friendly-captcha"])
    throw new Error("Duplicate friendly captcha initialization");

  if (options?.script)
    script = options.script;

  captcharegistry["friendly-captcha"] = { initialize: runFriendlyCaptcha };
}
