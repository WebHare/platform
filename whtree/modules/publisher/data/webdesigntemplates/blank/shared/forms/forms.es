import * as dompack from "dompack";
import * as forms from '@mod-publisher/js/forms';
import UploadField from '@mod-publisher/js/forms/fields/upload';
import { SplitDateField, SplitTimeField } from '@mod-publisher/js/forms/fields/splitdatetime';
import ImgEditField from '@mod-publisher/js/forms/fields/imgedit';
import RTDField from '@mod-publisher/js/forms/fields/rtd';

//import * as googleRecaptcha from "@mod-publisher/js/captcha/google-recaptcha";

//Load neutral styling (optional, but you'll need to supply your own styling for some of the fields below if you skip this)
import '@mod-publisher/js/forms/themes/neutral';

import './forms.scss';

//Enable forms and our builtin validation (starting with WebHare 4.23, validate:true will be the default)
forms.setup({validate:true});

//Replaces upload fields with a nicer and edit-supporting version
dompack.register(".wh-form__upload", node => new UploadField(node));

//Replaces date fields with a split version
dompack.register(".wh-form__date", node => new SplitDateField(node));
dompack.register(".wh-form__time", node => new SplitTimeField(node));

//Enable the imgedit and/or rtd fields:
dompack.register(".wh-form__imgedit", node => new ImgEditField(node));
dompack.register(".wh-form__rtd", node => new RTDField(node));

//enable the line below AND the googleRecaptcha import if you want to use this recaptcha. you'll also need to enable it in the site profile
//googleRecaptcha.setupGoogleRecaptcha();
