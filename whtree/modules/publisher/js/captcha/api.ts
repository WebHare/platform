import { getTid } from "@webhare/gettid";
import "./__captcha.lang.json";

export interface CaptchaProvider {
  name: string;
  apikey: string;
}

export interface CaptchaSettings {
  title: string;
  onResponse: (response: string) => void;
}

export interface CaptchaProviderRegistration {
  initialize: (provider: CaptchaProvider, injectInto: HTMLElement, settings: CaptchaSettings) => Promise<void>;
}

export const captcharegistry: Record<string, CaptchaProviderRegistration> = {};


export async function initializeCaptcha(provider: CaptchaProvider, injectInto: HTMLElement, settings?: Partial<CaptchaSettings>): Promise<void> {
  if (!captcharegistry[provider.name])
    throw new Error(`Captcha provider '${provider.name}' not registered`);
  if (!settings?.onResponse)
    throw new Error("onResponse callback is required");

  const finalsettings: CaptchaSettings = {
    title: settings?.title ?? getTid("publisher:site.captcha.title"),
    onResponse: settings?.onResponse ?? (() => { }),
  };

  await captcharegistry[provider.name].initialize(provider, injectInto, finalsettings);
}
