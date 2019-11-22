export var captcharegistry = {};

export async function getCaptchaResponse(apikey, options)
{
  if(!captcharegistry["google-recaptcha"]) //only supported one so far
    throw new Error("No captcha provider registered");
  return await captcharegistry["google-recaptcha"].getResponse(apikey, options);
}
