import * as dompack from "dompack";
//import * as domfocus from "dompack/browserfix/focus";
import * as whintegration from "@mod-system/js/wh/integration";
import * as datehelpers from "../internal/datehelpers";
import Keyboard from 'dompack/extra/keyboard';
import DatePicker from '@mod-publisher/js/forms/internal/datepicker.es';

/*
Replaces date/time inputs into separate number type inputs
Field ordering can be set by data attribute data-dateformat

nice to have:
 - placeholder translations
 - Field ordering by localization
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
export function __setUnderlyingValue(comp, newvalue)
{
  let origsetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(comp), 'value').set;
  if(origsetter) //this works on chrome, firefox and IE
  {
    origsetter.apply(comp,[newvalue]);
  }
  else
  {
    //safari doesn't let us call the original setter. but we _can_ remove the value property and it will be restored
    delete comp.value;
    comp.value = newvalue;
    setupMyValueProperty(comp); //reset our custom property
  }
}
function mySelectSetValue(newvalue) //this is invoked on external sets, and updates the replaced fields
{
  __setUnderlyingValue(this, newvalue);
  this._split_doupdate();
}

function setupMyValueProperty(select)
{
  Object.defineProperty(select, 'value', { configurable:true, get: mySelectGetValue, set: mySelectSetValue }); //FIXME why intercept get?
}

class MultiInputSubstition
{
  constructor(inpnode, options)
  {
    if(!window.MutationObserver)
      return; //best to leave it alone

    this.options = { baseclass: 'datetime'
                   , ...options
                   };

    this._baseclass = this.options.baseclass;
    this._replacednode = inpnode;
    this._replacednode._split_doupdate = () => this._split_doupdate();
    this._replacednode.classList.add(this._baseclass + '--replaced');
    this._replacednode.setAttribute("tabindex","-1"); //disable focus by tabbing replaced field
    this._replacednode.addEventListener('change', () => this._onOriginalChange());

    this._observer = new MutationObserver(() => this._onObserve());
    this._observer.observe(this._replacednode, { attributes: true, attributeFilter:['disabled','required','class'], subtree: false, childList:false});

    this._nodes = {};
    setupMyValueProperty(this._replacednode);
  }
  _onOriginalChange() //capture browser initiated changes (they don't go through our value property)
  {
    if(this._replacednode.value == this._lastsetvalue)
      return;

    this._lastsetvalue = this._replacednode.value;
    this._refreshReplacingFields();
  }
  _onBlur(field)
  {
    if(!isNaN(parseInt(field.value)))
      field.value = ('000' + parseInt(field.value)).slice(-this._getFieldTextLength(field));
  }
  _onReset(evt)
  {
    dompack.stop(evt);
    if(this._replacednode.disabled)
      return;

    this._replacednode.value = '';
    dompack.dispatchDomEvent(this._replacednode, 'input');
    dompack.dispatchDomEvent(this._replacednode, 'change');
  }
  _handlePastedValue(inval)
  {
    return false;
  }
  _handleBaseOnInput(field)
  {
    //now with EARLY focus
    //FIXME cleanup field first?
    //FIXME determine whether to use NUMBER of TEL.
    // if(field && field.input.length == )
    if(field) //we're being invoked for a field
    {
      if(this._handlePastedValue(field.value))
      {
        this._refreshReplacingFields();
        return true;
      }

      let maxlength = this._getFieldTextLength(field);
      if(field.value.length >= maxlength)
      {
        let nextfield = this._getNextField(field);
        if(nextfield)
        {
          dompack.focus(nextfield);

          if(field.value.length > maxlength)
          { //copy over remaining contents
            nextfield.value = field.value.substr(maxlength);
            field.value = field.value.substr(0,maxlength);
            dompack.dispatchDomEvent(nextfield, 'input');
            return true; //the next field's _onInput will deal with all the normal validations
          }
        }
      }
    }
    return false;
  }
  _finalize()
  {
    this._refreshAttributes();
    this._refreshReplacingFields();

    this._controlsnode = <span class={`${this._baseclass}__controls`}></span>;
    this._inputgroup.appendChild(this._controlsnode);
    dompack.after(this._replacednode, this._inputgroup);

    this._inputgroup.addEventListener("input", ev => this._onInput(ev.target), true);
    this._inputgroup.addEventListener("focus", ev => this._onFocus(ev.target), true);
    this._inputgroup.addEventListener('blur', evt => this._onBlur(evt.target), true);

    new Keyboard(this._inputgroup, { "ArrowDown": (evt) => this._trySpin(evt, -1)
                                   , "ArrowUp": (evt) => this._trySpin(evt, +1)
                                   , "ArrowLeft": (evt) => this._arrowHorizontal(evt, -1)
                                   , "ArrowRight": (evt) => this._arrowHorizontal(evt, +1)
                                   , "Backspace": (evt) => this._handleBackspace(evt)
                                   }, { captureunsafekeys: true
                                      , onkeypress: (evt,key) => this._onKeyPress(evt,key)
                                      });

  }
  _constructPart(partname, options)
  {
    return dompack.create("input", { className: `${this._baseclass}__part ${this._baseclass}__${partname}`
                                   , pattern: "[0-9]*"
                                   , inputmode: "numeric"
                                   , autocomplete: "off"
                                   , placeholder: this._placeholder[partname]
                                   , type: "tel" //we need 'tel' for fine selection control, we can't control selectionStart/End of a type=number
                                   , ...options
                                   });
  }
  _onObserve()
  {
    this._refreshAttributes();
  }

  _split_doupdate()
  {
    this._refreshReplacingFields();
    if(this._currentdatepicker)
      this._currentdatepicker.readDateNode();
  }

  _refreshAttributes()
  {
    let isdisabled = this._replacednode.disabled;
    let isrequired = this._replacednode.required;

    dompack.toggleClass(this._inputgroup, this._baseclass + '--disabled', isdisabled );
    dompack.toggleClass(this._inputgroup, this._baseclass + '--required', isrequired );
    this._getSubInputs().forEach(node => { node.disabled = isdisabled; node.required = isrequired; });
  }

  _getSubInputs()
  {
    throw new Error("Override!");
  }

  _setReplacedValue(setvalue)
  {
    if(setvalue != this._lastsetvalue)
    {
      __setUnderlyingValue(this._replacednode, setvalue); //direct update to prevent it from rewriting our fields
      this._lastsetvalue = setvalue;

      //TODO would be more correct to fire 'input' on any value change, but 'change' only on calendar pick OR blur
      dompack.dispatchDomEvent(this._replacednode, 'input');
      dompack.dispatchDomEvent(this._replacednode, 'change');
    }
  }

  _onFocus(field)
  {
    if(this._getSubInputs().indexOf(field) >= 0) //one of our handled fields
      field.select(); //select contents fully on focus, makes it easier to start typing new values
  }

  _trySpin(evt, change)
  {
    let field = evt.target;
    let nodeidx = this._getSubInputs().indexOf(field);
    if(nodeidx < 0) //not one of our inputs
      return; //not handling!

    dompack.stop(evt);
    if(this._spinNode(field, nodeidx, change))
      this._onInput(null);
    return true;
  }

  _arrowHorizontal(evt, dir)
  {
    let field = evt.target;

    if( (field.selectionStart != field.selectionEnd) //theres a selection, let the browser deal with that
        || (dir < 0 && field.selectionStart > 0) //not at the left edge
        || (dir > 0 && field.selectionEnd < field.value.length)) // not at the right edge
      return;

    dompack.stop(evt);

    let subinputs = this._getSubInputs();
    let gotofield = subinputs[subinputs.indexOf(field) + dir];
    if(gotofield)
    {
      dompack.focus(gotofield);
      gotofield.selectionEnd = gotofield.selectionStart = dir > 0 ? 0 : gotofield.value.length;
    }
  }

  _onKeyPress(evt,key)
  {
    if((key >= '0' && key <= '9') || key.length > 1) //digit or special key
      return true;
    dompack.stop(evt);
  }

  _handleBackspace(evt)
  {
    let field = evt.target;
    let nodeidx = this._getSubInputs().indexOf(field);
    if(nodeidx <= 0) //not one of our fields, or the first (where we can't go back anywhere)
      return false; //not handling

    if(field.selectionEnd > 0) //selection does not include the left side of the field
      return false;

    //remove selection, if any (we're a "backspace" after all)
    dompack.stop(evt);
    field.value = field.value.substr(0, field.selectionStart) + field.value.substr(field.selectionEnd);

    let prevfield = this._getSubInputs()[nodeidx-1];
    dompack.focus(prevfield);
    if(prevfield.value.length > 0) //do a backspace in the previous field as if we were one
      prevfield.value = prevfield.value.substr(0,prevfield.value.length - 1);

    prevfield.selectionEnd = prevfield.selectionStart = prevfield.value.length;
    return true;
  }
}

export class DateField extends MultiInputSubstition
{
  constructor(inpnode, options)
  {
    options = { datepicker: true
              , resetcontrol: true
              , ...options
              };

    super(inpnode, options);
    if(!this._replacednode)
      return;

    this.previous = { value : '' };

    this._placeholder = { year: "yyyy", month: "mm", day: "dd" };

    if( whintegration.config.locale.indexOf("nl") > -1 )
      this._placeholder = { year: "jjjj", month: "mm" , day: "dd" };

    let dateformat = inpnode.dataset.format || "d-m-y";
    let parseddate = dateformat.match(/^([dmy])([^dmy]*)([dmy])([^dmy]*)([dmy])$/);
    if(!parseddate)
      throw new Error(`Unrecognized date format '${dateformat}'`);

    this._inputgroup = <span class={`${this._baseclass} ${this._baseclass}__date`}>
                         {this._constructDatePart(parseddate[1])}
                         <span class={`${this._baseclass}__sep`}>{parseddate[2]}</span>
                         {this._constructDatePart(parseddate[3])}
                         <span class={`${this._baseclass}__sep`}>{parseddate[4]}</span>
                         {this._constructDatePart(parseddate[5])}
                       </span>;

    this._nodes.day.min = 1;
    this._nodes.day.max = 31;
    this._nodes.month.min = 1;
    this._nodes.month.max = 12;

    if( this._replacednode.min != "" ) //Should be iso date
    {
      let minyear = this._replacednode.min.split(/[^0-9]+/)[0];
      if( minyear != "" )
        this._nodes.year.min = minyear;
    }

    if( this._replacednode.max != "" ) //Should be iso date
    {
      let maxyear = this._replacednode.max.split(/[^0-9]+/)[0];
      if( maxyear != "" )
        this._nodes.year.max = maxyear;
    }

    this._finalize();

    if(this.options.datepicker)
    {
      this._datepickercontrol = <span class={`${this._baseclass}__togglepicker`}></span>;
      this._datepickercontrol.addEventListener("click", evt => this._onDatePickerClick(evt));
      this._controlsnode.appendChild(this._datepickercontrol);
    }
    if(this.options.resetcontrol)
    {
      this._resetcontrol = <span class={`${this._baseclass}__reset`}></span>;
      this._resetcontrol.addEventListener("click", evt => this._onReset(evt));
      this._controlsnode.appendChild(this._resetcontrol);
    }
  }

  _onDatePickerClick(evt)
  {
    dompack.stop(evt);

    if(this._currentdatepicker || this._replacednode.disabled)
      return;
    this._currentdatepicker = new DatePicker(this);
  }
  __closedDatepicker()
  {
    this._currentdatepicker = null;

    //return focus to last replacement input (so if using tab you go to next field)
    let inplst = this._inputgroup.querySelectorAll("input");
    if( inplst.length )
      inplst[inplst.length - 1].focus();
  }

  _constructDatePart(which)
  {
    let partname = {d:"day",m:"month",y:"year"}[which];
    if(this._nodes[partname])
      throw new Error(`Duplicate '${partname}' node`);

    this._nodes[partname] = this._constructPart(partname, { maxlength: partname == "year" ? 4 : 2 });
    return this._nodes[partname];
  }

  _getSubInputs()
  {
    return [ this._nodes.day, this._nodes.month, this._nodes.year ];
  }

  _setDateByParts(parts)
  {
    this._nodes.day.value   = ('0' + parts.day).substr(-2);
    this._nodes.month.value = ('0' + parts.month).substr(-2);
    this._nodes.year.value  = ('000' + parts.year).substr(-4);
  }

  _refreshReplacingFields()
  {
    this._lastsetvalue = this._replacednode.value;

    if(this._replacednode.value)//Should be iso date
    {
      this._currentdate = datehelpers.parseISODate(this._replacednode.value, { nofail: true });
      if(this._currentdate)
      {
        this._setDateByParts(this._currentdate);
        return;
      }
    }
    this._nodes.day.value = "";
    this._nodes.month.value = "";
    this._nodes.year.value = "";
  }

  _getFieldTextLength(field)
  {
    return field == this._nodes.year ? 4 : 2;
  }
  _getNextField(field)
  {
    return field == this._nodes.day ? this._nodes.month
           : field == this._nodes.month ? this._nodes.year
           : null;

  }

  _getCurrentAsISODate()
  {
    let year =  parseInt(this._nodes.year.value,0);
    let month = parseInt(this._nodes.month.value,0);
    let day =   parseInt(this._nodes.day.value,0);

    if(year >= 0 && year <= 99 && this._replacednode.dataset.shortyearcutoff != "")
    {
      let cutoff = parseInt(this._replacednode.dataset.shortyearcutoff);
      if(year < cutoff) //to do someday.. current century might not be 2000 anymore
        year += 2000;
      else
        year += 1900;
    }

    return datehelpers.formatISODate(year,month,day);
  }

  _spinNode(node, nodeidx, change)
  {
    let isodate = this._getCurrentAsISODate();
    if(!isodate)
      return; //not sure what to do with a corrupt

    let newdate = new Date(isodate);
    if(node == this._nodes.day)
    {
      newdate = new Date(+newdate + (change * 86400000));
    }
    else if(node == this._nodes.month)
    {
      newdate.setUTCMonth(newdate.getUTCMonth() + change);
    }
    else if(node == this._nodes.year)
    {
      newdate.setUTCFullYear(newdate.getUTCFullYear() + change);
    }
    else
    {
      return;
    }

    this._setReplacedValue(datehelpers.formatJSUTCISODate(newdate));
    this._split_doupdate();
    return true;
  }

  _handlePastedValue(inval)
  {
    //if we're spotting a xx-xx-xx or xx/xx/xx pattern, assume a paste
    let is_dashed = inval.match(/.+-.+-.+/);
    let is_slashed = inval.match(/.+\/.+\/.+/);
    if(is_dashed || is_slashed)
    {
      let parseddate = datehelpers.parseDate('d-m-y', inval,{nofail:true});
      if(parseddate)
      {
        this._setReplacedValue(datehelpers.formatISODate(parseddate.year, parseddate.month, parseddate.day));
        this._refreshReplacingFields();
        return true;
      }
    }
    return false;
  }

  _onInput(field)
  {
    if(this._handleBaseOnInput(field))
      return;

    let year =  parseInt(this._nodes.year.value,0);
    let month = parseInt(this._nodes.month.value,0);
    let day =   parseInt(this._nodes.day.value,0);

    if(year >= 0 && year <= 99 && this._replacednode.dataset.shortyearcutoff != "")
    {
      let cutoff = parseInt(this._replacednode.dataset.shortyearcutoff);
      if(year < cutoff) //TODO current century might not be 2000 anymore
        year += 2000;
      else
        year += 1900;
    }

    this._setReplacedValue(datehelpers.formatISODate(year,month,day));
  }

  _onKeyPress(evt,key)
  {
    if(key == '-' || key == '/')
    {
      let nextfield = this._getNextField(evt.target);
      if(nextfield)
        dompack.focus(nextfield);
      return false;
    }
    return super._onKeyPress(evt,key);
  }

/*
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
*/

  _onReset(evt)
  {
    this.closePicker();
    super._onReset(evt);
  }

  //-------- PUBLIC API ---------------
  closePicker() //close any open date picker
  {
    if(this._currentdatepicker)
      this._currentdatepicker._dismissOverlay();
  }
}

export class TimeField extends MultiInputSubstition
{
  constructor(inpnode, options)
  {
    options = { resetcontrol: true
              , ...options
              };

    super(inpnode, options);
    if(!this._replacednode)
      return;

    let step = parseFloat(this._replacednode.getAttribute("step")||'0');
    this.previous = { value : '' };
    this._showmsec = step != Math.floor(step); //fraction
    this._showsecond = this._showmsec || (step % 60 != 0); //unable to round to minute... so seconds

    this._placeholder = { hour  : "hh", minute: "mm", second: "ss", msec: "mmm" };

    if( whintegration.config.locale.indexOf("nl") > -1 )
      this._placeholder = { hour  : "uu", minute: "mm", second: "ss", msec: "mmm" };

    this._inputgroup = <span class={`${this._baseclass} ${this._baseclass}__time`}>
                         { this._constructTimePart("hour") }
                         <span class={`${this._baseclass}__sep`}>:</span>
                         { this._constructTimePart("minute") }
                      </span>;

    this._nodes.hour.max = 23;
    this._nodes.minute.max = 59;

    if(this._showsecond)
    {
      this._inputgroup.appendChild(<span class={`${this._baseclass}__sep`}>:</span>);
      this._inputgroup.appendChild(this._constructTimePart("second"));
      this._nodes.second.max = 59;
    }
    if(this._showmsec)
    {
      this._inputgroup.appendChild(<span class={`${this._baseclass}__sep`}>.</span>);
      this._inputgroup.appendChild(this._constructTimePart("msec"));
      this._nodes.msec.max = 999;
    }

    this._finalize();

    if(this.options.resetcontrol)
    {
      this._resetcontrol = <span class={`${this._baseclass}__reset`}></span>;
      this._resetcontrol.addEventListener("click", evt => this._onReset(evt));
      this._controlsnode.appendChild(this._resetcontrol);
    }
  }

  _spinNode(node, nodeidx, change)
  {
    let newval = (parseInt(node.value) || 0) + change;
    let max = parseInt(node.getAttribute("max"));

    if(newval < 0 || newval > max)
    {
      if(nodeidx == 0) //already at top level, no wrapping..
        return false;

      newval = change < 0 ? max : 0; //wrap it!
      if(nodeidx > 0) //spin higher node too
        if(!this._spinNode(this._getSubInputs()[nodeidx - 1], nodeidx - 1, change))
          return false;
    }
    node.value = ('000' + newval).slice(nodeidx == 3 ? -3 : -2);
    return true;
  }

  _constructTimePart(partname)
  {
    if(this._nodes[partname])
      throw new Error(`Duplicate '${partname}' node`);

    this._nodes[partname] = this._constructPart(partname, { maxlength: partname == 'msec' ? 3 : 2
                                                          , min: "0"
                                                          });

    return this._nodes[partname];
  }

  _refreshReplacingFields()
  {
    this._lastsetvalue = this._replacednode.value;

    let time = datehelpers.parseISOTime(this._replacednode.value, { nofail: true });
    if(time)
    {
      this._currenttime = time;
      this._nodes.hour.value = ("0" + this._currenttime.hour).slice(-2);
      this._nodes.minute.value = ("0" + this._currenttime.minute).slice(-2);
      if(this._nodes.second)
        this._nodes.second.value = ("0" + this._currenttime.second).slice(-2);
      if(this._nodes.msec)
        this._nodes.msec.value = ("00" + this._currenttime.msec).slice(-3);
      return;
    }

    this._nodes.hour.value = "";
    this._nodes.minute.value = "";
    if(this._nodes.second)
      this._nodes.second.value = "";
    if(this._nodes.msec)
      this._nodes.msec.value = "";
  }

  _getFieldTextLength(field)
  {
    return field == this._nodes.msec ? 3 : 2;
  }
  _getSubInputs()
  {
    return [ this._nodes.hour
           , this._nodes.minute
           , ...(this._nodes.second ? [this._nodes.second] : [])
           , ...(this._nodes.msec ? [this._nodes.msec] : [])
           ];
  }

  _onInput(field)
  {
    if(this._handleBaseOnInput(field))
      return;

    let hour =   parseInt(this._nodes.hour.value,0);
    let minute = parseInt(this._nodes.minute.value,0);
    let second = this._nodes.second ? parseInt(this._nodes.second.value,0) : 0;
    let msec =   this._nodes.msec ? parseInt(this._nodes.msec.value,0) : 0;

    this._setReplacedValue(datehelpers.formatISOTime(hour, minute, this._showsecond ? second : null, this._showmsec ? msec : null));
  }

  _onKeyPress(evt,key)
  {
    if(key == ':' || key == '.')
    {
      let nextfield = this._getNextField(evt.target);
      if(nextfield)
        dompack.focus(nextfield);
      return false;
    }
    return super._onKeyPress(evt,key);
  }

  _getNextField(field)
  {
    return field == this._nodes.hour ? this._nodes.minute
           : field == this._nodes.minute ? this._nodes.second
           : null;

  }


/*
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
*/
}
