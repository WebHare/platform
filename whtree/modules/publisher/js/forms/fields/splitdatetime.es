import * as dompack from "dompack";
import * as domevents from "dompack/src/events";
import * as whintegration from "@mod-system/js/wh/integration";
import { getTid } from "@mod-tollium/js/gettid";
import "../internal/form.lang.json";

import "./splitdatetime.scss";



let labelcount = 0;


function formatDate(dateformat, dateparts)
{
  let output='';
  if(!dateparts)
    return '';

  for(let c of dateformat.split(""))
  {
    switch(c.toUpperCase())
    {
      case "Y":
        output += dateparts.year;
        break;
      case "M":
        output += (dateparts.month >= 10 ? '' : '0') + dateparts.month;
        break;
      case "D":
        output += (dateparts.day >= 10 ? '' : '0') + dateparts.day;
        break;
      default:
        output += c;
        break;
    }
  }
  return output;
}

function formatISODate(dateparts)
{
  return formatDate("Y-M-D", dateparts)
}

//FIXME dupe from webharefields.es - do we need low level date libs ?
function isValidDate(year,month,day)
{
  if(year<100 || year>9999 || month < 1 || month > 12 || day < 1 || day > 31)
    return false;
  if([4,6,9,11].includes(month) && day > 30) //handle april, june, sep, nov
    return false;
  let isleapyear = (year % 400) == 0 || ((year % 100) != 0 && (year % 4) == 0);
  if(month == 2 && day > (isleapyear ? 29 : 28))
    return false;
  return true;
}

function parseDate(format, newdate, nofail)
{
  if(!newdate) //empty
    return null;

  let setdate = newdate.split('/').join('-').split('.').join('-');
  let parts = setdate.split('-');

  if(parts.length == 3)//parseable
  {
    format = format.toLowerCase();
    let dayoffset = format.indexOf('d');
    let monthoffset = format.indexOf('m');
    let yearoffset = format.indexOf('y');

    let daypos = 0 + (dayoffset > monthoffset ? 1 : 0) + (dayoffset > yearoffset ? 1 : 0);
    let monthpos = 0 + (monthoffset > dayoffset ? 1 : 0) + (monthoffset > yearoffset ? 1 : 0);
    let yearpos = 0 + (yearoffset > dayoffset ? 1 : 0) + (yearoffset > monthoffset ? 1 : 0);

    let day = parseInt(parts[daypos],0);
    let month = parseInt(parts[monthpos],0);
    let year = parseInt(parts[yearpos],0);

    // The browser will always add 1900 for years 0-99, so handle years < 100
    // if (year >= 0 && year < 100 && this.options.cutoffyear > 0)
    // {
    //   if (year < this.options.cutoffyear)
    //     year += 2000;
    //   else
    //     year += 1900;
    // }
    if(isValidDate(year, month, day))
      return { year, month, day };
  }
  if(nofail)
    return undefined;

  throw new Error(`Invalid date value: '${newdate}'`);
}

function getLocalToday()
{
  let today = new Date;
  return { year: today.getFullYear(), month: 1+today.getMonth(), day: today.getDate() };
}

function getOrdinalDay(date)
{

}
function makeJSLocalDate(dateparts)
{
  return new Date(dateparts.year-1900, dateparts.month-1, dateparts.day);
}

function makeJSUTCDate(dateparts)
{
  return new Date(Date.UTC(dateparts.year, dateparts.month-1, dateparts.day));
}

function formatJSLocalISODate(dateobj)
{
  return dateobj.getFullYear() + '-' + ('0'+(dateobj.getMonth()+1)).slice(-2) + '-' + ('0'+dateobj.getDate()).slice(-2);
}
function formatJSUTCISODate(dateobj)
{
  return dateobj.getUTCFullYear() + '-' + ('0'+(dateobj.getUTCMonth()+1)).slice(-2) + '-' + ('0'+dateobj.getUTCDate()).slice(-2);
}

function ensureLabelID(inputnode)
{
  let id = inputnode.id;
  if (id == "")
  {
    // FIXME: lookup whether we are nested in a label
    return "";
  }

  let labelnode = document.querySelector(`[for="${id}"]`);
  if (!labelnode)
  {
    console.log("Failed to find label for", id);
    return "";
  }

  // Ensure the label has an unique ID
  if (labelnode.id == "")
  {
    labelcount++;
    labelnode.setAttribute("id", `splitdatetime_lbl_${labelcount}`);
  }

  return labelnode.id;
}




/*
cSplitDateInput replaces date input with 3 separate number type inputs
field ordering can be set by data attribute data-dateformat

nice to have:
 - placeholder translations
 - for time input option for seconds/msec??
*/

///////////////////////////////////////
//
// new 'value' property
//
function mySelectGetValue()
{
  let origgetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), 'value').get;
  //console.error("mySelectGetValue", origgetter, origgetter.apply(this));
  return origgetter.apply(this);
}
function mySelectSetValue(newvalue)
{
  let origsetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), 'value').set;
  if(origsetter) //this works on chrome, firefox and IE
  {
    origsetter.apply(this,[newvalue]);
  }
  else
  {
    //safari doesnt let us call the original setter. but we _can_ remove the value property and it will be restored
    delete this.value;
    this.value = newvalue;
    setupMyDateValueProperty(this); //reset our custom property
  }
  this._split_doupdate();
}

function setupMyDateValueProperty(select)
{
  Object.defineProperty(select, 'value', { configurable:true, get: mySelectGetValue, set: mySelectSetValue });
}

class MultiInputSubstition
{
  constructor(inpnode)
  {
    if(!window.MutationObserver)
      return; //best to leave it alone

    this._replacednode = inpnode;
    this._replacednode._split_doupdate = () => this._split_doupdate();

    if(window.MutationObserver)
    {
      this._observer = new MutationObserver(() => this._onObserve());
      this._observer.observe(this._replacednode, { attributes: true, attributeFilter:['disabled','required','class'], subtree: false, childList:false});
    }
  }
  _onObserve()
  {
    console.log("observed!");
    this._refreshAttributes();
  }

  _split_doupdate()
  {
    this._refreshReplacingFields();
  }

  _refreshAttributes()
  {
    let isdisabled = this._replacednode.disabled;
    let isrequired = this._replacednode.required;

    dompack.toggleClass(this.inputgroup, this._class + '--disabled', isdisabled );
    dompack.toggleClass(this.inputgroup, this._class + '--required', isrequired );
    this._getSubInputs().forEach(node => { node.disabled = isdisabled; node.required = isrequired; });
  }
}
export class SplitDateField extends MultiInputSubstition
{
  constructor( inpnode )
  {
    super(inpnode);
    if(!this._replacednode)
      return;

    this._class = "wh-form__dateinputgroup";
    setupMyDateValueProperty(this._replacednode);

    __hideInput(inpnode);//hide current input

    this.previous = { value : '' };

    let day_pos   = 0;
    let month_pos = 1;
    let year_pos  = 2;

    if( inpnode.dataset.dateformat ) // y-m-d, d-m-y, ...
    {
      let ordering = __strToIntegerArray(inpnode.dataset.dateformat);
      for( let i = 0; i < ordering.length; ++i )
      {
        if( ordering[i].indexOf("y") > -1 )
          year_pos = i;
        else if( ordering[i].indexOf("m") > -1 )
          month_pos = i;
        else if( ordering[i].indexOf("d") > -1 )
          day_pos = i;
      }
    }

    this.placeholder = { year : "yyyy"
                       , month: "mm"
                       , day  : "dd"
                       };

    if( whintegration.config.locale.indexOf("nl") > -1 )
      this.placeholder = { year : "jjjj"
                         , month: "mm"
                         , day  : "dd"
                         };

    this.day   = null;
    this.month = null;
    this.year  = null;

    if( this._replacednode.value != "" )//Should be iso date
    {
      let parts = __strToIntegerArray(this._replacednode.value);
      if( parts.length > 2 )
      {
        this.day   = parts[2];
        this.month = parts[1];
        this.year  = parts[0];
      }
    }

    let isdisabled = this._replacednode.disabled;
    let isreadonly = this._replacednode.readonly;

    let year_min  = 1900; let year_max  = 2999;

    if( this._replacednode.min != "" ) //Should be iso date
    {
      let parts = __strToIntegerArray(this._replacednode.min);
      if( parts.length )
        year_min  = parts[0];
    }

    if( this._replacednode.max != "" )
    {
      let parts = __strToIntegerArray(this._replacednode.max);
      if( parts.length && parts[0] >= year_min )
        year_max  = parts[0];
    }


    this.inputgroup = <div class="wh-form__dateinputgroup" role="group" />;


    // Refer to the label (Because we have role="group" we need a label)
    let labelid = ensureLabelID(inpnode);
    if (labelid != "")
      this.inputgroup.setAttribute("aria-labelledby", labelid);


    this.daynode   = <input readonly={isreadonly} pattern="[0-9]*" inputmode="numeric" autocomplete="off" maxlength="2" placeholder={this.placeholder.day} min="1" max="31" type="number" aria-label={getTid("publisher:site.forms.splitdatetime-day-arialabel")} />;
    this.monthnode = <input readonly={isreadonly} pattern="[0-9]*" inputmode="numeric" autocomplete="off" maxlength="2" placeholder={this.placeholder.month} min="1" max="12" type="number" aria-label={getTid("publisher:site.forms.splitdatetime-month-arialabel")} />;
    this.yearnode  = <input readonly={isreadonly} pattern="[0-9]*" inputmode="numeric" autocomplete="off" maxlength="4" placeholder={this.placeholder.year} min={year_min} max={year_max} type="number" aria-label={getTid("publisher:site.forms.splitdatetime-year-arialabel")} />;
    this._refreshAttributes();
    this._refreshReplacingFields();

    for( let i = 0; i < 3; ++i )
    {
      if( i == day_pos )
      {
        this.inputgroup.appendChild(<div class="wh-form__dateinputgroup__line day">
                                      {this.daynode}
                                    </div>); //
      }
      if( i == month_pos )
      {
        this.inputgroup.appendChild(<div class="wh-form__dateinputgroup__line month">
                                     {this.monthnode}
                                    </div>); //
      }
      if( i == year_pos )
      {
        this.inputgroup.appendChild(<div class="wh-form__dateinputgroup__line year">
                                     {this.yearnode}
                                    </div>); //
      }
    }


    // Take the replaced input out of the keyboard navigation.
    // But it'll retain the ability to get focus. So if code sets the focus it will be forwarded to the first input in the group (the day).
    this._replacednode.setAttribute("tabindex", "-1");

    //If focus on hidden date input, set focus on first field in replacement
    this._replacednode.addEventListener("focus", ev => {
      // NOTE: It's important we have set tabindex="-1" on the input, otherwise when we tab backwards from
      //       the first input in our group we are returned back to the day input. (so we can never escape backwards)
      let nextnode = this.inputgroup.querySelector("input");
      if( nextnode )
        nextnode.focus();
    });


    if( isdisabled )
      this.inputgroup.classList.add("wh-form__dateinputgroup--disabled");
    if( isreadonly )
      this.inputgroup.classList.add("wh-form__dateinputgroup--disabled");

    inpnode.parentNode.appendChild(this.inputgroup);

    // this._replacednode.addEventListener("wh:form-enable", ev =>
    // {
    //   dompack.toggleClass(this.inputgroup, "wh-form__dateinputgroup--disabled", ev.detail.enabled );

    //   this.daynode.disabled = !ev.detail.enabled;
    //   this.monthnode.disabled = !ev.detail.enabled;
    //   this.yearnode.disabled = !ev.detail.enabled;

    //   this.daynode.readonly = !ev.detail.enabled;
    //   this.monthnode.readonly = !ev.detail.enabled;
    //   this.yearnode.readonly = !ev.detail.enabled;
    // });

    for( let node of this.inputgroup.querySelectorAll("input") )
    {
      node.addEventListener("blur", () => { this.inputgroup.classList.remove("focus"); } );
      node.addEventListener("focus", () => {
        this.previous.value = node.value;
        this.inputgroup.classList.add("focus");
      } );

      node.addEventListener("change", ev => this.onChange(ev, node) );
      node.addEventListener("keyup", ev => this.onKeyUp(ev, node) );
    }
  }

  _getSubInputs()
  {
    return [ this.daynode, this.monthnode, this.yearnode ];
  }

  _refreshReplacingFields()
  {
    this.day   = null;
    this.month = null;
    this.year  = null;

    if( this._replacednode.value != "" )//Should be iso date
    {
      let parts = __strToIntegerArray(this._replacednode.value);
      if( parts.length > 2 )
      {
        this.day   = parts[2];
        this.month = parts[1];
        this.year  = parts[0];
      }
    }

    this.daynode.value = this.day == null ? "" : this.day;
    this.monthnode.value = this.month == null ? "" : this.month;
    this.yearnode.value = this.year == null ? "" : this.year;
  }

  onChange( ev, node )
  {
    let prev_day   = this.day;
    let prev_month = this.month;
    let prev_year  = this.year;

    if( node == this.daynode )
      __validateNumberField(this, "day", node);
    else if( node == this.monthnode )
      __validateNumberField(this, "month", node);
    else if( node == this.yearnode )
      __validateNumberField(this, "year", node);

    let setvalue = null;
    if( this.day != null && this.month != null && this.year != null && isValidDate(this.year,this.month,this.day))
      setvalue = formatISODate(this);
    else if(this.daynode.value == "" && this.monthnode.value == "" && this.yearnode.value == "")
      setvalue = "";

//FIXME who needs these classes ?
    let hasvalue = this.day != null && this.month != null && this.year != null;
    dompack.toggleClass(this.inputgroup, "hasvalue", hasvalue);
    dompack.toggleClass(this.inputgroup, "partlyfilled", !hasvalue && (this.day != null || this.month != null || this.year != null) );

    if(setvalue !== null && this._lastsetvalue != setvalue)
    {
      this._replacednode.value = setvalue;
      this._lastsetvalue = setvalue;
      domevents.fireHTMLEvent(this._replacednode, 'change');
    }
  }

  onKeyUp( ev, node )
  {
    ev.preventDefault();
    ev.stopPropagation();

    let prevval = this.previous.value;
    this.previous.value = node.value;

    if( ev.keyCode == 8 && node.value == "" && prevval == "" )//backspace
    {
      //Try to set focus on previous input
      let prevnode = node.parentNode.previousSibling;
      if( prevnode )
      {
        let previnp = prevnode.querySelector("input");
        if( previnp )
          previnp.focus();
      }

      return;
    }

    //First some basic validation
    let value = node.value.replace(/[^0-9]+/g,'');

    if( value == "" || value != node.value || 1*value < 1*node.min || 1*value > 1*node.max )
      return;

    //Is field value minimal length
    if( (node == this.yearnode && value.length < 4) || (node != this.yearnode && value.length < 2) )
      return;

    if( prevval == node.value )
        return;//Only go to next input if value changed

    //Try to set focus on next input
    let nextnode = node.parentNode.nextSibling;
    if( !nextnode )
      return;

    let nextinp = nextnode.querySelector("input");
    if( nextinp )
      nextinp.focus();
  }
}

export class SplitTimeField extends MultiInputSubstition
{
  constructor( inpnode )
  {
    super(inpnode);
    if(!this._replacednode)
      return;

    __hideInput(inpnode);//hide current input

    this.previous = { value : '' };

    this.placeholder = { hours  : "hh"
                       , minutes: "mm"
                       , seconds: "ss"
                       };

    if( whintegration.config.locale.indexOf("nl") > -1 )
      this.placeholder = { hours  : "uu"
                         , minutes: "mm"
                         , seconds: "ss"
                         };

    this.hours   = null;
    this.minutes = null;
    this.seconds = null;

    if( this._replacednode.value != "" )//Should be iso date
    {
      let parts = __strToIntegerArray(this._replacednode.value);
      if( parts.length > 1 )
      {
        this.hour   = parts[0];
        this.minute = parts[1];

        if( this._replacednode.dataset.whPrecision == "seconds" && parts.length > 2 )
          this.seconds = parts[2];
      }
    }

    let isdisabled = this._replacednode.disabled;
    let isreadonly = this._replacednode.readonly;

    this.hournode   = <input disabled={isdisabled} readonly={isreadonly} pattern="[0-9]*" inputmode="numeric" autocomplete="off" maxlength="2" value={this.hours == null ? "" : this.hours} min="0" max="23" type="number"
                             placeholder={this.placeholder.hours}
                             aria-label={getTid("publisher:site.forms.splitdatetime-hours-arialabel")}
                             />;
    this.minutenode = <input disabled={isdisabled} readonly={isreadonly} pattern="[0-9]*" inputmode="numeric" autocomplete="off" maxlength="2" value={this.minutes == null ? "" : this.minutes} min="0" max="59" type="number"
                             placeholder={this.placeholder.minutes}
                             aria-label={getTid("publisher:site.forms.splitdatetime-minutes-arialabel")}
                             />;

    this.inputgroup = <div class="wh-form__timeinputgroup" role="group">
                        <div class="wh-form__timeinputgroup__line hour">
                          {this.hournode}
                        </div>
                        <div class="wh-form__timeinputgroup__line minute">
                          {this.minutenode}
                        </div>
                     </div>;

    // Refer to the label (Because we have role="group" we need a label)
    let labelid = ensureLabelID(inpnode);
    //console.log("labelid for time field", labelid);
    if (labelid != "")
      this.inputgroup.setAttribute("aria-labelledby", labelid);


    if( this._replacednode.dataset.whPrecision == "seconds" )
    {
      this.secondnode = <input disabled={isdisabled} readonly={isreadonly} pattern="[0-9]*" inputmode="numeric" autocomplete="off" maxlength="2" value={this.seconds == null ? "" : this.seconds} min="0" max="59" type="number"
                               placeholder={this.placeholder.seconds}
                               aria-label={getTid("publisher:site.forms.splitdatetime-seconds-arialabel")}
                               />;
      this.inputgroup.appendChild( <div class="wh-form__timeinputgroup__line second">
                                     {this.secondnode}
                                   </div> );

      this.inputgroup.classList.add("wh-form__timeinputgroup--3col");
    }


    // Take the replaced input out of the keyboard navigation.
    // But it'll retain the ability to get focus. So if code sets the focus it will be forwarded to the first input in the group (the day).
    this._replacednode.setAttribute("tabindex", "-1");

    //If focus on hidden time input, set focus on first field in replacement
    this._replacednode.addEventListener("focus", ev => {
      // NOTE: It's important we have set tabindex="-1" on the input, otherwise when we tab backwards from
      //       the first input in our group we are returned back to the day input. (so we can never escape backwards)
      let nextnode = this.inputgroup.querySelector("input");
      if( nextnode )
        nextnode.focus();
    });


    if( isdisabled )
      this.inputgroup.classList.add("wh-form__timeinputgroup--disabled");
    if( isreadonly )
      this.inputgroup.classList.add("wh-form__timeinputgroup--disabled");

    inpnode.parentNode.appendChild(this.inputgroup);

    this._replacednode.addEventListener("wh:form-enable", ev => {
      dompack.toggleClass(this.inputgroup, "wh-form__timeinputgroup--disabled", ev.detail.enabled );

      this.hournode.disabled   = !ev.detail.enabled;
      this.minutenode.disabled = !ev.detail.enabled;
      if( this.secondnode )
        this.secondnode.disabled = !ev.detail.enabled;

      this.hournode.readonly   = !ev.detail.enabled;
      this.minutenode.readonly = !ev.detail.enabled;
      if( this.secondnode )
        this.secondnode.readonly = !ev.detail.enabled;
    });

    for( let node of this.inputgroup.querySelectorAll("input") )
    {
      node.addEventListener("blur", () => { this.inputgroup.classList.remove("focus"); } );
      node.addEventListener("focus", () => {
        this.previous.value = node.value;
        this.inputgroup.classList.add("focus");
      });

      node.addEventListener("change", ev => this.onChange(ev,node) );
      node.addEventListener("keyup", ev => this.onKeyUp(ev,node) );
    }
  }

  _getSubInputs()
  {
    return [ this.hournode, this.minutenode, ...(this.secondnode ? [this.secondenode] : []) ];
  }

  onChange( ev, node )
  {
    let prev_hours   = this.hours;
    let prev_minutes = this.minutes;
    let prev_seconds = this.seconds;

    if( node == this.hournode )
      __validateNumberField(this, "hours", node);
    else if( node == this.minutenode )
    {
      __validateNumberField(this, "minutes", node);
      if( node.value.length == 1 )
        node.value = "0" + node.value;
    }
    else if( node == this.secondnode )
    {
      __validateNumberField(this, "seconds", node);
      if( node.value.length == 1 )
        node.value = "0" + node.value;
    }

    if( this.hours != null && this.minutes != null )
      this._replacednode.value = ( this.hours < 10 ? "0" : "" ) + this.hours + ( this.minutes < 10 ? ":0" : ":" ) + this.minutes;
    else
      this._replacednode.value = "";

    let hasvalue = this.hours != null && this.minutes != null;
    if( hasvalue && this.secondnode && this.seconds == null )
      hasvalue = false;
    dompack.toggleClass(this.inputgroup, "hasvalue", hasvalue);
    dompack.toggleClass(this.inputgroup, "partlyfilled", !hasvalue && (this.hours != null || this.minutes != null || (this.secondnode && this.seconds != null)) );

    //Trigger change event on original input
    if( prev_hours != this.hours || prev_minutes != this.minutes || prev_seconds != this.seconds )
      domevents.fireHTMLEvent(this._replacednode, 'change');
  }

  onKeyUp( ev, node )
  {
    ev.preventDefault();
    ev.stopPropagation();

    let prevval = this.previous.value;
    this.previous.value = node.value;

    if( ev.keyCode == 8 && node.value == "" && prevval == "" )//backspace
    {
      //Try to set focus on previous input
      let prevnode = node.parentNode.previousSibling;
      if( prevnode )
      {
        let previnp = prevnode.querySelector("input");
        if( previnp )
          previnp.focus();
      }

      return;
    }

    //First some basic validation
    let value = node.value.replace(/[^0-9]+/g,'');
    if( value == "" || value != node.value || 1*value < 1*node.min || 1*value > 1*node.max )
      return;

    //Is field value minimal length
    if( value.length < 2 )
      return;

    if( prevval == node.value )
        return;//Only go to next input if value changed

    //Try to set focus on next input
    let nextnode = node.parentNode.nextSibling;
    if( !nextnode )
      return;

    let nextinp = nextnode.querySelector("input");
    if( nextinp )
      nextinp.focus();
  }
}


function __strToIntegerArray( str )
{
  let ilist = new Array();
  let parts = str.split(/[^0-9]+/);
  for( let i = 0; i < parts.length; ++i )
    ilist.push( 1*parts[i] );

  return ilist;
}


function __validateNumberField( self, fieldname, node)
{
  let value = node.value.replace(/[^0-9]+/g,'');
  node.value = value;

  if( value != "" )
    self[fieldname] = 1*value;
  else
    self[fieldname] = null;
}


function __hideInput( node )
{
  node.style.display  = "block";
  node.style.position = "absolute";
  node.style.left     = "-9999px";
  node.style.width    = "0px";
  node.style.height   = "0px";
}
