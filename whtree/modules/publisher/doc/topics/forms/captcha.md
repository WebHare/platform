# (Re)captcha
To enable captcha checks on the forms, add a usecaptcha=true to the `formintegration` node in the site profile:

```xml
  <apply>
    <to type="all"/>
    <formintegration usecaptcha="true" />
  </apply>
```

Setup captcha support in your JS code
```javascript
import * as googleRecaptcha from "@mod-publisher/js/captcha/google-recaptcha";
googleRecaptcha.setupGoogleRecaptcha();
```

Setup the [dompack dialog APIs](https://gitlab.com/webhare/dompack/dompack/blob/master/doc/dialogapi.md)
so the captcha can be shown in an overlay.

Request an API key from Google and configure it in WebHare.

## Manual captcha integration
Request the user to fill in the captcha
```javascript
import { getCaptchaResponse } from "@mod-publisher/js/captcha/api";

let sitekey = 'xxx'; //the result of webcontext->GetCaptchaAPIkey()
let captcharesponse = await getCaptchaResponse(sitekey);

//Submit captcharesponse with the rest of your request
```

Serverside check:
```harescript
STRING captcharesponse := "xxx"; ///captcha response from RPC/GetWebVariable
IF(NOT webcontext->VerifyCaptchaResponse(captcharesponse))
  ABORT("Invalid captcha response");
```

## Disabling captcha checks for some users

```xml
  <apply>
    <to type="all"/>
    <captchaintegration skipfunction="my.whlib#SkipCaptcha" />
  </apply>
```

```harescript
  PUBLIC BOOLEAN FUNCTION SkipCaptcha(OBJECT webcontext)
  {
    IF(IsPrivateIPAddress(GetClientRemoteIP()))
      RETURN TRUE;

    OBJECT wrdauth := webcontext->GetWRDAuthPlugin();
    IF(ObjectExists(wrdauth) AND wrdauth->IsLoggedIn())
      RETURN TRUE;

    RETURN FALSE;
  }
```

You can use %AllowToSkipCaptchaCheck on a webdesign (or webcontext) object
to verify whether the user is allowed to skip the captcha check. This should
usually be done in the RPC that decides whether to request a captcha check
