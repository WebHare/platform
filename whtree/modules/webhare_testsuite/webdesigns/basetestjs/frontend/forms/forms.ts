import * as dompack from "@webhare/dompack";
import * as forms from "@webhare/forms";
import "@webhare/forms/styling/functional.css";  //Implement functional form styling (eg for implementing visibility)
import * as embedvideo from '@mod-publisher/js/forms/fields/rtd/embedvideo';

//Load neutral styling (optional, but you'll need to supply your own styling for some of the fields below if you skip this)
import "@webhare/forms/styling/neutral.scss";

import './forms.scss';

const urlconfig = new URLSearchParams(location.search);

//Enable publisher forms (also registers the default RPC handlers)
forms.setupForms({
  captcha: (urlconfig.get("captcha") !== "default" && urlconfig.get("captcha") as forms.FormSetupOptions["captcha"]) || undefined
});

if (urlconfig.has("captcha")) {
  forms.setupGoogleRecaptcha();
  forms.setupFriendlyCaptcha();
}

//Setup default file and image edit. Enable only if you've also enabled them in the site profiles (or use them in custom forms)
if (location.href.includes('rtd=1') || location.href.includes('array=1'))
  customElements.define("wh-fileedit", forms.FileEditElement);
customElements.define("wh-imgedit", forms.ImgEditElement);

//The RTD Editor. Enable only if you'll be actually using it, even unloaded it currently adds ~20KB of overhead to your 'base' CSS and JS chunks, and quite a bit of compile time
import { RTDEditElement } from "@webhare/forms-rtdedit";
import { floatAsyncHandler } from "@mod-webhare_testsuite/js/testhelpers";
customElements.define("wh-rtdedit", RTDEditElement);

if (location.href.includes('video=1')) {  //TODO cleaner, use event handlers? RTD already has some action-eventhandler stuff though..
  dompack.register<RTDEditElement>("wh-rtdedit", node => node.onInsertVideo = floatAsyncHandler(embedvideo.insertVideo));
}

//Replaces date/time fields
dompack.register(".wh-form__date", node => new forms.DateField(node));
dompack.register(".wh-form__time", node => new forms.TimeField(node));

//Enable to support google recaptcha you want to use this recaptcha. you'll also need to enable it in the site profile
// forms.setupGoogleRecaptcha();
