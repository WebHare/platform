import * as dompack from 'dompack';
import { qSA } from 'dompack';
import * as datetime from 'dompack/types/datetime';
import CheckboxGroupField from '@mod-publisher/js/forms/fields/checkboxgroup';
import RadioGroupField from '@mod-publisher/js/forms/fields/radiogroup';
import AddressField from '@mod-publisher/js/forms/fields/addressfield';
import ArrayField from '@mod-publisher/js/forms/fields/arrayfield';
import CaptchaField from '@mod-publisher/js/forms/fields/captchafield';
import { setupValidator } from './customvalidation.es';

import { getTid } from "@mod-tollium/js/gettid";
import "./form.lang.json";

function isValidDate(year,month,day)
{
  if(isNaN(year) || isNaN(month) || isNaN(day) || year<100 || year>9999 || month < 1 || month > 12 || day < 1 || day > 31)
    return false;
  if([4,6,9,11].includes(month) && day > 30) //handle april, june, sep, nov
    return false;
  let isleapyear = (year % 400) == 0 || ((year % 100) != 0 && (year % 4) == 0);
  if(month == 2 && day > (isleapyear ? 29 : 28))
    return false;
  return true;
}

function validateDate(date)
{
  if(date.getAttribute('type') != 'date') //it's no longer a date field
    return '';
  if(!date.value) //any required checks should be handled by the HTML5 compat layer, nothing for us to check
    return '';

  let dateparts = date.value.match(/^([0-9]+)-([0-9]+)-([0-9]+)$/) || [];
  let year = parseInt(dateparts[1]), month = parseInt(dateparts[2]), day = parseInt(dateparts[3]);
  if(!isValidDate(year,month,day))
    return getTid("publisher:site.forms.commonerrors.default");

  let normalizeddate = ('0000'+year).substr(-4) + '-' + ('00'+month).substr(-2) + '-' + ('00'+day).substr(-2);
  if(date.getAttribute("min") && normalizeddate < date.getAttribute("min"))
    return getTid("publisher:site.forms.commonerrors.min", date.getAttribute("min"));
  if(date.getAttribute("max") && normalizeddate > date.getAttribute("max"))
    return getTid("publisher:site.forms.commonerrors.max", date.getAttribute("max"));

  return '';
}

function validateTime(time)
{
  if(time.getAttribute('type') != 'time') //it's no longer a time field
    return '';
  if(!time.value) //any required checks should be handled by the HTML5 compat layer, nothing for us to check
    return '';

  let timeparts = time.value.match(/^([0-9]+):([0-9]+)(:([0-9]+))?$/) || [];
  let hours = parseInt(timeparts[1]), minutes = parseInt(timeparts[2]), seconds = parseInt(timeparts[3]);
  if(isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || (!isNaN(seconds) && (seconds < 0 || seconds > 59)))
    return getTid("publisher:site.forms.commonerrors.default");

  return '';
}

export function setup(form)
{
  for (let datecontrol of qSA(form,'input[type=date]'))
  {
    ['whMin','whMax','whValue'].filter(field => !!datecontrol.dataset[field]).forEach(field =>
    {
      //parse 'now' or 'now+5d'. be able to extract '+5d'
      let datematch = datecontrol.dataset[field].match(/^now((\+|-)\d+d)?$/);

      if(datematch)
      {
        let propname = field.substr(2).toLowerCase();
        let thedate;
        if(datematch[1])
          thedate = new Date(Date.now() + parseInt(datematch[1]) * 86400 * 1000);
        else
          thedate = new Date;

        datecontrol[propname] = datetime.getISOLocalDate(thedate);
      }
    });

    if(datecontrol.type != 'date' && !datecontrol.whValidationPolyfilled) //this browser doesn't natively support date fields
    {
      datecontrol.whValidationPolyfilled = true;
      //ADDME some sort of global validator would be better so we don't get confused by fields that change their type
      setupValidator(datecontrol, validateDate);
    }

  }

  for (let timecontrol of qSA(form,'input[type=time]'))
  {
    ['whValue'].filter(field => !!timecontrol.dataset[field]).forEach(field =>
    {
      //parse 'now'
      //ADDME: Support for stuff like 'now + 15 minutes' 'next whole hour + 2.5 hours'?
      let timematch = timecontrol.dataset[field].match(/^now$/);

      if(timematch)
      {
        let propname = field.substr(2).toLowerCase();
        let thedate = new Date;

        let propvalue = ('0' + thedate.getHours()).substr(-2) + '-' + ('0' + thedate.getMinutes()).substr(-2);
        if (parseInt(timecontrol.getAttribute("step")||'0') % 60) //step not multiple of 60? seconds
          propvalue += '-' + ('0' + thedate.getSeconds()).substr(-2);
        timecontrol[propname] = propvalue;
      }
    });

    if(timecontrol.type != 'time' && !timecontrol.whValidationPolyfilled) //this browser doesn't natively support time fields
    {
      timecontrol.whValidationPolyfilled = true;
      //ADDME some sort of global validator would be better so we don't get confused by fields that change their type
      setupValidator(timecontrol, validateTime);
    }

  }

  // Setup checkbox group (min/max checked) validation
  for (let checkboxgroup of qSA(form, ".wh-form__fieldgroup--checkboxgroup"))
    new CheckboxGroupField(checkboxgroup);

  // Setup radio group (hidden/disabled) validation
  for (let checkboxgroup of qSA(form, ".wh-form__fieldgroup--radiogroup"))
    new RadioGroupField(checkboxgroup);

  // Setup address field validation
  for (let addresscontrol of qSA(form, ".wh-form__fieldgroup--addressfield"))
    new AddressField(addresscontrol);

  // Setup array fields
  for (let arrayfieldgroup of qSA(form, ".wh-form__fieldgroup--array"))
    new ArrayField(arrayfieldgroup);

  // Setup on-demand captcha
  if(form.dataset.whFormCaptcha)
  {
    //TODO add something like virtualfields to forms but that is too much for a backport.
    let captchanode = <wh-form-captcha data-wh-form-name={form.dataset.whFormCaptcha} />;
    form.appendChild(captchanode);
    new CaptchaField(captchanode);
  }
}
