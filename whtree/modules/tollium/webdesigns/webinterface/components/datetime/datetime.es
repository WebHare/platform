import * as dompack from 'dompack';
import { getTid } from '@mod-tollium/js/gettid';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';
import * as datehelpers from "@mod-publisher/js/forms/internal/datehelpers.es"; //FIXME we need a 'today' function in dompack's datehelprs

import $todd from "@mod-tollium/web/ui/js/support";

import { DateField, TimeField } from '@mod-publisher/js/forms/fields/datetime.es';
import './datetime.scss';
import "./datetime.lang.json";


/****************************************************************************************************************************
 *                                                                                                                          *
 *  DATETIME                                                                                                                *
 *                                                                                                                          *
 ****************************************************************************************************************************/
export default class ObjDateTime extends ComponentBase
{

/****************************************************************************************************************************
* Initialization
*/

  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);
    this.componenttype = "datetime";
    this.datefield = null;
    this.timefield = null;
    this.lasterportedvalue = null;
    this.type=data.type;
    this.precision=data.precision;

    // Build our DOM
    this.fieldtype = data.fieldtype;
    this.placeholder = data.placeholder;
    this.dateformat = data.dateformat;
    this.cutoffyear = data.cutoffyear;
    this.buildNode(data);
    this.lastreportedvalue = "0000-00-00T00:00:00.000Z";
    this.setValue(data.value);

    this.node.addEventListener("change", this._reportChangesCallback.bind(this));

    this.setRequired(data.required);
    this.setEnabled(data.enabled);
  }

  // ---------------------------------------------------------------------------
  //
  // Helper functions
  //

  _padLeft(data, len)
  {
    data = '0000' + data;
    return data.substr(data.length - Math.max(data.length - 4, len));
  }

  _reportChangesCallback(event)
  {
    // Get the current value, compare with last reported value
    var currentvalue = this.getValue();
    if (this.lastreportedvalue != currentvalue)// && this.isEventUnmasked('change'))
    {
      this.setDirty();

      // Only update lastreportedvalue when we're actually reporting.
      this.lastreportedvalue = currentvalue;
      this.transferState(false);
    }
  }

  /** Store the value in the node, no callbacks
  */
  _setValueInternal(value)
  {
    var dateval='', timeval='';
    var tpos = value.indexOf('T');
    if(value && this.datefield)
    {
      var year = parseInt(value.substr(0, tpos - 4),10);
      var month = parseInt(value.substr(tpos - 4, 2),10);
      var day = parseInt(value.substr(tpos - 2, 2),10);

      //Just plain db format
      dateval = (year < 1000 ? ("000"+year).slice(-4) : year) + "-" + ("0"+month).slice(-2) + "-" +  ("0"+day).slice(-2);
    }

    if(value && this.timefield)
    {
      var hour = parseInt(value.substr(tpos + 1,2),10);
      var min = parseInt(value.substr(tpos + 3,2),10);
      var sec = parseInt(value.substr(tpos + 5,2),10);
      var msec = parseInt(value.substr(tpos + 8,3),10);

      timeval = ("0"+hour).slice(-2) + ":" + ("0"+min).slice(-2);
      if(this.precision=='seconds' || this.precision=='milliseconds')
        timeval += ':' + ("0"+sec).slice(-2);
      if(this.precision=='milliseconds')
        timeval += '.' + ("00"+msec).slice(-3);
    }

    if(this.datefield)
      this.datefield.value = dateval;
    if(this.timefield)
      this.timefield.value = timeval;
  }

/****************************************************************************************************************************
* Property getters & setters
*/

  getSubmitValue()
  {
    return this.getValue();
  }

  getValue()
  {
    var retval;
    var defaultdate = true;
    if(this.datefield) //FIXME support dateformat, validate
    {
      var datevalue = this.datefield.value;
      retval = '0000-00-00';
      let parts = datevalue.replace(/\//g,'-').split('-');
      if (parts.length == 3)
      {
        retval = this._padLeft(parts[0],4) + '-' + this._padLeft(parts[1],2) + '-' + this._padLeft(parts[2],2);//Just plain db format
        defaultdate = false;
      }
    }
    else
    {
      retval = '0001-01-01'; //ensure valid datetime if just sending time
    }
    retval += 'T';
    if(this.timefield)
    {
      // FIXME: parse correctly!!!!
      var timevalue = this.timefield.value;
      if (!timevalue && defaultdate)
        return "";
      let parts = timevalue.replace(/\./g,':').split(':');
      if (parts.length >= 2)
        retval += this._padLeft(parts[0],2) + ':' + this._padLeft(parts[1],2);
      else
        retval += '00:00';

      if ((this.precision=='seconds' || this.precision=='milliseconds') && parts.length >= 3)
        retval += ':' + this._padLeft(parts[2],2);
      else
        retval += ':00';

      if(this.precision=='milliseconds' && parts.length >= 4)
        retval += '.' + (parts[3]+'000').substr(0,3);
      else
        retval += '.000';
    }
    else
    {
      if (defaultdate)
        return "";
      retval += '00:00:00.000';
    }
    retval += 'Z';
    return retval;
  }
  /// Set the value. Report back changes when the value has changed
  setValue(value)
  {
    var oldval = this.getValue();
    this._setValueInternal(value);

    if (oldval !== this.getValue())
      this._reportChangesCallback();
  }
  setRequired(value)
  {
    if (value != this.required)
    {
      this.required = value;
      this.node.classList.toggle("required", this.required);

      if (this.datefield)
      {
        this.datefield.required = this.required;
        // this.datefield.fireEvent("wh-refresh");
      }

      if (this.timefield)
      {
        this.timefield.required = this.required;
        // this.timefield.fireEvent("wh-refresh");
      }
    }
  }

  setEnabled(value)
  {
    if (value != this.enabled)
    {
      this.enabled = value;
      this.node.classList.toggle("disabled", !this.enabled);

      if (this.datefield)
      {
        this.datefield.disabled = !this.enabled;
        // this.datefield.fireEvent("wh-refresh");
      }
      if (this.timefield)
      {
        this.timefield.disabled = !this.enabled;
        // this.timefield.fireEvent("wh-refresh");
      }
    }
  }


/****************************************************************************************************************************
* DOM
*/

  // Build the DOM node(s) for this component
  buildNode(data)
  {
    this.node = <t-datetime data-name={this.name} propTodd={this} title={this.hint||''} />;
    if(this.fieldtype == 'date' || this.fieldtype=='datetime')
    {
      this.datefield = <input type="date" placeholder={this.placeholder} data-format={this.dateformat} />;
      this.datefield.addEventListener("wh:datepicker-built", evt => this.onDatepickerBuilt(evt))
      this.node.appendChild(this.datefield);
      this.datefield.required = data.required;
      this.datefield.disabled = !this.enabled;
      this.datefield.setAttribute("data-cutoffyear", this.cutoffyear);

      this.datefield.dataset.format = this.dateformat.replace(/%/g,'').toLowerCase();
      this.datefield.dataset.shortyearcutoff = this.cutoffyear >= 0 ? this.cutoffyear : "";
      this.datehandler = new DateField(this.datefield, { baseclass: "tollium__datetime", weeknumbers: true });

      // this.datefield.fireEvent("wh-refresh");
    }
    if(this.fieldtype == 'datetime')
    {
      this.node.appendChild(<span>&nbsp;</span>);
    }
    if(this.fieldtype == 'time' || this.fieldtype=='datetime')
    {
      var placeholder = "00:00";
      var step = "60"; // minutes
      if (this.precision=='seconds' || this.precision=='milliseconds')
      {
        placeholder += ":00";
        step = "1"; // seconds
      }
      if (this.precision=='milliseconds')
      {
        placeholder += ".000";
        step = ".001"; // milliseconds
      }

      this.timefield = <input type="time" placeholder={placeholder} step={step} />;
      this.node.appendChild(this.timefield);
      this.timefield.required = data.required;
      this.timefield.disabled = !this.enabled;

      new TimeField(this.timefield, { baseclass: "tollium__datetime" });

      // this.timefield.fireEvent("wh-refresh");
    }
  }


/****************************************************************************************************************************
* Dimensions
*/

  calculateDimWidth()
  {
    if(!this.minwidth)
      this.minwidth = this.node.getBoundingClientRect().width;

    this.width.min = this.width.calc = this.minwidth;
  }

  calculateDimHeight()
  {
    this.height.min = this.height.calc = $todd.gridlineInnerHeight;
  }

  relayout()
  {
  }

  // ---------------------------------------------------------------------------
  //
  // Events
  //
  cancelDatepicker()
  {
    this.datehandler.closePicker();
  }
  selectToday()
  {
    this.datehandler.closePicker();
    let today = datehelpers.getLocalToday();
    dompack.changeValue(this.datefield, datehelpers.formatISODate(today.year, today.month, today.day));
  }
  selectNone()
  {
    this.datehandler.closePicker();
    dompack.changeValue(this.datefield, '');
  }

  onDatepickerBuilt(evt)
  {
    evt.detail.datepicker.append(
      <div class="tollium__datetime__picker__buttonbar">
        <button type="button" class="tollium__datetime__picker__button tollium__datetime__picker__cancelbutton" onClick={ () => this.cancelDatepicker() }>{getTid("tollium:common.actions.cancel")}</button>
        <div class="tollium__datetime__picker__buttonflex"></div>
        <button type="button" class="tollium__datetime__picker__button tollium__datetime__picker__todaybutton"  onClick={ () => this.selectToday() }>{getTid("tollium:common.actions.today")}</button>
        <button type="button" class="tollium__datetime__picker__button tollium__datetime__picker__nonebutton"   onClick={ () => this.selectNone() }>{getTid("tollium:common.labels.none")}</button>
      </div>);
  }
}
