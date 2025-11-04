# Captcha suport

Redesign to support earlier captcha loading into forms (ie not just 'on submit)

Pre-WH5.8:
- EnableCaptcha is used by the form to request captcha support (invoked if formintegration enables it, unless the specific form disables it)
- EnableCaptcha creates __captchaquestion of type http://www.webhare.net/xmlns/publisher/forms#captcha named __webtoolform__captcha
- The CaptchaField
  - implementation invokes __EnsureFormCaptchaPage to inject its 'extra' page
  - sets data-wh-form-captcha on the form for its metadata
    - this currently just contains the field name of the captcha
- BeginWork on a form (to delay it as far as possible) checks the actual captcha:
    ````
    //only if nothing else failed will we validate the captcha
    IF(ObjectExists(this->__captchaquestion) AND NOT workobj->HasFailed())
      this->__captchaquestion->ValidateCaptcha(workobj);
    ```

NEW: Start captchas earlier but keep SkipCaptcha support:
- Support loading captcha code
  - if the page has a form (onLoad)
  - or once the form is activated (onActivate)
    - which is one step before 'formstarted' which only response to actually typing
  - or because the server said so at submission (the WH5.8 approach)
- setupForms gets { captcha: "onLoad" | "onActivate" }
- captcha will check with the server if captcha is required
  - if so, it will provide an element to the form to include
- form will show captcha holder, injecting if necessary, and load that element
- on submit, the captcha field will validate the captcha if present
