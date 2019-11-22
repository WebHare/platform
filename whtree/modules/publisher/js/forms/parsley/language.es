let didsetlang = false;
import { getTid } from "@mod-tollium/js/gettid";
import "../internal/form.lang.json";

export default function setLanguageTexts()
{
  if(didsetlang)
    return;
  didsetlang = true;

  if(!window.Parsley)
    return console.error("window.Parsley not available, cannot set translations");

  window.Parsley.addMessages('webhare', { defaultMessage: getTid("publisher:site.forms.commonerrors.default"),
                                          type: {
                                            email:        getTid("publisher:site.forms.commonerrors.email"),
                                            url:          getTid("publisher:site.forms.commonerrors.url"),
                                            number:       getTid("publisher:site.forms.commonerrors.number"),
                                            integer:      getTid("publisher:site.forms.commonerrors.integer"),
                                            digits:       getTid("publisher:site.forms.commonerrors.digits"),
                                            alphanum:     getTid("publisher:site.forms.commonerrors.alphanum")
                                          },
                                          notblank:       getTid("publisher:site.forms.commonerrors.notblank"),
                                          required:       getTid("publisher:site.forms.commonerrors.required"),
                                          pattern:        getTid("publisher:site.forms.commonerrors.pattern"),
                                          min:            getTid("publisher:site.forms.commonerrors.min", "%s"),
                                          max:            getTid("publisher:site.forms.commonerrors.max", "%s"),
                                          range:          getTid("publisher:site.forms.commonerrors.range", "%s", "%s"),
                                          minlength:      getTid("publisher:site.forms.commonerrors.minlength", "%s"),
                                          maxlength:      getTid("publisher:site.forms.commonerrors.maxlength", "%s"),
                                          length:         getTid("publisher:site.forms.commonerrors.length", "%s", "%s"),
                                          mincheck:       getTid("publisher:site.forms.commonerrors.mincheck", "%s"),
                                          maxcheck:       getTid("publisher:site.forms.commonerrors.maxcheck", "%s"),
                                          check:          getTid("publisher:site.forms.commonerrors.check", "%s", "%s"),
                                          equalto:        getTid("publisher:site.forms.commonerrors.equalto")
                                      });
  window.Parsley.setLocale('webhare');
}
