import { getTid } from "@webhare/gettid";
import "./__captcha.lang.json";

export interface CaptchaProvider {
  name: string;
  apikey: string;
}

export interface CaptchaSettings {
  title: string;
  explain: string;
  onResponse: (response: string) => void;
}

export const captcharegistry: Record<string, { initialize: (provider: CaptchaProvider, injectInto: HTMLElement, settings: CaptchaSettings) => Promise<void> }> = {};

export async function initializeCaptcha(provider: CaptchaProvider, injectInto: HTMLElement, settings?: Partial<CaptchaSettings>): Promise<void> {
  if (!captcharegistry[provider.name]) //only supported one so far
    throw new Error(`Captcha provider '${provider.name}' not registered`);
  if (!settings?.onResponse)
    throw new Error("onResponse callback is required");

  const finalsettings: CaptchaSettings = {
    title: settings?.title ?? getTid("publisher:site.captcha.title"),
    explain: settings?.explain ?? getTid("publisher:site.captcha.explain"),
    onResponse: settings?.onResponse ?? (() => { }),
  };

  return await captcharegistry[provider.name].initialize(provider, injectInto, finalsettings);
}
