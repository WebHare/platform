import { getTid } from "@mod-tollium/js/gettid";
import "./__captcha.lang.json";

export interface CaptchaSettings {
  title: string;
  explain: string;
  injectInto: HTMLElement | null;
}

export const captcharegistry: Record<string, { getResponse: (apikey: string, settings: CaptchaSettings) => Promise<string | null> }> = {};

export async function getCaptchaResponse(apikey: string, settings: Partial<CaptchaSettings> = {}): Promise<string | null> {
  if (!captcharegistry["google-recaptcha"]) //only supported one so far
    throw new Error("No captcha provider registered");

  const finalsettings: CaptchaSettings = {
    title: settings?.title ?? getTid("publisher:site.captcha.title"),
    explain: settings?.explain ?? getTid("publisher:site.captcha.explain"),
    injectInto: settings?.injectInto ?? null
  };

  return await captcharegistry["google-recaptcha"].getResponse(apikey, finalsettings);
}
