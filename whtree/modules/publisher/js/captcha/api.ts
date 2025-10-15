import { getTid } from "@webhare/gettid";
import "./__captcha.lang.json";

export interface CaptchaProvider {
  name: string;
  apikey: string;
}

export interface CaptchaSettings {
  title: string;
  explain: string;
  injectInto: HTMLElement | null;
}

export const captcharegistry: Record<string, { getResponse: (provider: CaptchaProvider, settings: CaptchaSettings) => Promise<string | null> }> = {};

export async function getCaptchaResponse(provider: CaptchaProvider, settings: Partial<CaptchaSettings> = {}): Promise<string | null> {
  if (!captcharegistry[provider.name]) //only supported one so far
    throw new Error(`Captcha provider '${provider.name}' not registered`);

  const finalsettings: CaptchaSettings = {
    title: settings?.title ?? getTid("publisher:site.captcha.title"),
    explain: settings?.explain ?? getTid("publisher:site.captcha.explain"),
    injectInto: settings?.injectInto ?? null
  };

  return await captcharegistry[provider.name].getResponse(provider, finalsettings);
}
