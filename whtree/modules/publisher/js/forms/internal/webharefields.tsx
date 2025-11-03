import * as dompack from 'dompack';
import { qSA } from 'dompack';
import * as datetime from 'dompack/types/datetime';
import AddressField from '@mod-publisher/js/forms/fields/addressfield';
import { setupValidator } from './customvalidation';

import { getTid } from "@webhare/gettid";
import { formatDate, parseISODate } from './datehelpers';
import { isValidDate } from '@webhare/std';

function validateCheckboxGroup(groupnode: HTMLElement) {
  const nodes = dompack.qSA<HTMLInputElement>(groupnode, "input[type='checkbox']");
  const min = Number(groupnode.dataset.whMin) || 0;
  const max = Number(groupnode.dataset.whMax) || 0;

  const anyenabled = nodes.some(node => !node.disabled);
  const numChecked = nodes.filter(node => node.checked).length;

  if (anyenabled) {
    if (numChecked < min)
      return getTid("publisher:site.forms.commonerrors.mincheck", min);
    else if (max > 0 && numChecked > max)
      return getTid("publisher:site.forms.commonerrors.maxcheck", max);
  }
}

function validateRadioGroup(groupnode: HTMLElement) {
  const nodes = dompack.qSA<HTMLInputElement>(groupnode, "input[type='radio']");
  const isrequired = nodes.some(node => node.required);

  if (isrequired) {
    const isanychecked = nodes.some(node => node.checked && !node.disabled);
    if (!isanychecked)
      return getTid("publisher:site.forms.commonerrors.required");
  }
}

export function reformatDate(datestr: string): string {
  const parsed = parseISODate(datestr);
  return parsed ? formatDate("D-M-Y", parsed.year, parsed.month, parsed.day) : "";
}

function validateDate(date: HTMLInputElement) {
  if (date.getAttribute('type') !== 'date') //it's no longer a date field
    return '';
  if (!date.value) //any required checks should be handled by the HTML5 compat layer, nothing for us to check
    return '';

  const dateparts = date.value.match(/^([0-9]+)-([0-9]+)-([0-9]+)$/) || [];
  const year = parseInt(dateparts[1]), month = parseInt(dateparts[2]), day = parseInt(dateparts[3]);
  if (!isValidDate(year, month, day))
    return getTid("publisher:site.forms.commonerrors.default");

  const normalizeddate = ('0000' + year).substr(-4) + '-' + ('00' + month).substr(-2) + '-' + ('00' + day).substr(-2);
  const min = date.getAttribute("min"), max = date.getAttribute("max");
  if (min && normalizeddate < min)
    return getTid("publisher:site.forms.commonerrors.min", reformatDate(min));
  if (max && normalizeddate > max)
    return getTid("publisher:site.forms.commonerrors.max", reformatDate(max));

  return '';
}

function validateTime(time: HTMLInputElement) {
  if (time.getAttribute('type') !== 'time') //it's no longer a time field
    return '';
  if (!time.value) //any required checks should be handled by the HTML5 compat layer, nothing for us to check
    return '';

  const timeparts = time.value.match(/^([0-9]+):([0-9]+)(:([0-9]+))?$/) || [];
  const hours = parseInt(timeparts[1]), minutes = parseInt(timeparts[2]), seconds = parseInt(timeparts[3]);
  if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || (!isNaN(seconds) && (seconds < 0 || seconds > 59)))
    return getTid("publisher:site.forms.commonerrors.default");

  return '';
}

export function setup(form: HTMLElement) {
  for (const datecontrol of qSA<HTMLInputElement>(form, 'input[type=date]')) {
    for (const field of ['whMin', 'whMax', 'whValue'])
      if (datecontrol.dataset[field]) {
        //parse 'now' or 'now+5d'. be able to extract '+5d'
        const datematch = datecontrol.dataset[field]!.match(/^now((\+|-)\d+d)?$/);

        if (datematch) {
          const propname = field.substr(2).toLowerCase();
          let thedate;
          if (datematch[1])
            thedate = new Date(Date.now() + parseInt(datematch[1]) * 86400 * 1000);
          else
            thedate = new Date;

          (datecontrol as unknown as Record<string, string>)[propname] = datetime.getISOLocalDate(thedate);
        }
      }

    if (datecontrol.type !== 'date' && !datecontrol.whValidationPolyfilled) { //this browser doesn't natively support date fields
      datecontrol.whValidationPolyfilled = true;
      //ADDME some sort of global validator would be better so we don't get confused by fields that change their type
      setupValidator(datecontrol, validateDate);
    }
  }

  for (const timecontrol of qSA<HTMLInputElement>(form, 'input[type=time][data-wh-value]')) {
    //parse 'now'
    //ADDME: Support for stuff like 'now + 15 minutes' 'next whole hour + 2.5 hours'?
    const timematch = timecontrol.dataset.whValue!.match(/^now$/);

    if (timematch) {
      const thedate = new Date;

      let propvalue = ('0' + thedate.getHours()).substr(-2) + '-' + ('0' + thedate.getMinutes()).substr(-2);
      if (parseInt(timecontrol.getAttribute("step") || '0') % 60) //step not multiple of 60? seconds
        propvalue += '-' + ('0' + thedate.getSeconds()).substr(-2);
      timecontrol.value = propvalue;
    }

    if (timecontrol.type !== 'time' && !timecontrol.whValidationPolyfilled) { //this browser doesn't natively support time fields
      timecontrol.whValidationPolyfilled = true;
      //ADDME some sort of global validator would be better so we don't get confused by fields that change their type
      setupValidator(timecontrol, validateTime);
    }
  }

  // Setup checkbox group (min/max checked) validation
  for (const checkboxgroup of qSA(form, ".wh-form__fieldgroup--checkboxgroup"))
    setupValidator(checkboxgroup, validateCheckboxGroup);

  // Setup radio group (hidden/disabled) validation
  for (const radiogroup of qSA(form, ".wh-form__fieldgroup--radiogroup")) {
    setupValidator(radiogroup, validateRadioGroup);

    //we should probably disable by name (or form.elements[name] but validate() and form isn't really tracking name either...
    dompack.qSA<HTMLInputElement>(radiogroup, `input[type='radio']`).forEach(
      node => node.dataset.whFormSkipnativevalidation = "true"); //don't handle by both RadioGroupField *and* native validation

  }

  // Setup address field validation
  for (const addresscontrol of qSA(form, ".wh-form__fieldgroup--addressfield"))
    new AddressField(addresscontrol);
}
