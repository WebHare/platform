/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from 'dompack';
import { getTid } from "@webhare/gettid";
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';
import * as datehelpers from "@mod-publisher/js/forms/internal/datehelpers"; //FIXME we need a 'today' function in dompack's datehelprs

import * as $todd from "@mod-tollium/web/ui/js/support";

import { DateField, TimeField } from '@mod-publisher/js/forms/fields/datetime';
import './datetime.scss';


/****************************************************************************************************************************
 *                                                                                                                          *
 *  DATETIME                                                                                                                *
 *                                                                                                                          *
 ****************************************************************************************************************************/
export default class ObjDateTime extends ComponentBase {
  datefield: HTMLInputElement | null = null;
  timefield: HTMLInputElement | null = null;

  datehandler?: DateField;
  timehandler?: TimeField;

  /****************************************************************************************************************************
  * Initialization
  */

  constructor(parentcomp, data) {
    super(parentcomp, data);
    this.componenttype = "datetime";
    this.lasterportedvalue = null;
    this.type = data.type;
    this.precision = data.precision;
    this.suggestion = data.suggestion;

    // Build our DOM
    this.fieldtype = data.fieldtype;
    this.dateformat = data.dateformat;
    this.cutoffyear = data.cutoffyear;
    this.buildNode(data);
    this.lastreportedvalue = "0000-00-00T00:00:00.000Z";
    this.setValue(data.value);

    this.node.addEventListener("change", this._reportChangesCallback.bind(this));

    this.setRequired(data.required);
    this.setEnabled(data.enabled ?? true);
  }

  // ---------------------------------------------------------------------------
  //
  // Helper functions
  //

  _padLeft(data, len) {
    data = '0000' + data;
    return data.substr(data.length - Math.max(data.length - 4, len));
  }

  _reportChangesCallback(event) {
    // Get the current value, compare with last reported value
    const currentvalue = this.getValue();
    if (this.lastreportedvalue !== currentvalue)// && this.isEventUnmasked('change'))
    {
      this.setDirty();

      // Only update lastreportedvalue when we're actually reporting.
      this.lastreportedvalue = currentvalue;
      this.transferState(false);
    }
  }

  _parseTolliumValue(value) {
    const tpos = value.indexOf('T');
    return (
      {
        year: parseInt(value.substr(0, tpos - 4), 10),
        month: parseInt(value.substr(tpos - 4, 2), 10),
        day: parseInt(value.substr(tpos - 2, 2), 10),
        hour: parseInt(value.substr(tpos + 1, 2), 10),
        min: parseInt(value.substr(tpos + 3, 2), 10),
        sec: parseInt(value.substr(tpos + 5, 2), 10),
        msec: parseInt(value.substr(tpos + 8, 3), 10)
      });
  }

  /** Store the value in the node, no callbacks
  */
  _setValueInternal(value) {
    let dateval = '', timeval = '';
    if (value) {
      const parsed = this._parseTolliumValue(value);
      if (this.datefield) {
        //Just plain db format
        dateval = (parsed.year < 1000 ? ("000" + parsed.year).slice(-4) : parsed.year) + "-" + ("0" + parsed.month).slice(-2) + "-" + ("0" + parsed.day).slice(-2);
      }
      if (this.timefield) {
        timeval = ("0" + parsed.hour).slice(-2) + ":" + ("0" + parsed.min).slice(-2);
        if (this.precision === 'seconds' || this.precision === 'milliseconds')
          timeval += ':' + ("0" + parsed.sec).slice(-2);
        if (this.precision === 'milliseconds')
          timeval += '.' + ("00" + parsed.msec).slice(-3);
      }
    }

    if (this.datefield)
      this.datefield.value = dateval;
    if (this.timefield)
      this.timefield.value = timeval;
  }

  /****************************************************************************************************************************
  * Property getters & setters
  */

  getSubmitValue() {
    return this.getValue();
  }

  getValue() {
    let retval;
    let defaultdate = true;
    if (this.datefield) { //FIXME support dateformat, validate
      const datevalue = this.datefield.value;
      retval = '0000-00-00';
      const parts = datevalue.replace(/\//g, '-').split('-');
      if (parts.length === 3) {
        retval = this._padLeft(parts[0], 4) + '-' + this._padLeft(parts[1], 2) + '-' + this._padLeft(parts[2], 2);//Just plain db format
        defaultdate = false;
      }
    } else {
      retval = '0001-01-01'; //ensure valid datetime if just sending time
    }
    retval += 'T';
    if (this.timefield) {
      // FIXME: parse correctly!!!!
      const timevalue = this.timefield.value;
      if (!timevalue && defaultdate)
        return "";
      const parts = timevalue.replace(/\./g, ':').split(':');
      if (parts.length >= 2)
        retval += this._padLeft(parts[0], 2) + ':' + this._padLeft(parts[1], 2);
      else
        retval += '00:00';

      if ((this.precision === 'seconds' || this.precision === 'milliseconds') && parts.length >= 3)
        retval += ':' + this._padLeft(parts[2], 2);
      else
        retval += ':00';

      if (this.precision === 'milliseconds' && parts.length >= 4)
        retval += '.' + (parts[3] + '000').substr(0, 3);
      else
        retval += '.000';
    } else {
      if (defaultdate)
        return "";
      retval += '00:00:00.000';
    }
    retval += 'Z';
    return retval;
  }
  /// Set the value. Report back changes when the value has changed
  setValue(value) {
    const oldval = this.getValue();
    this._setValueInternal(value);

    if (oldval !== this.getValue())
      this._reportChangesCallback();
  }
  setRequired(value) {
    if (value !== this.required) {
      this.required = value;
      this.node.classList.toggle("required", this.required);

      if (this.datefield) {
        this.datefield.required = this.required;
      }

      if (this.timefield) {
        this.timefield.required = this.required;
      }
    }
  }

  setEnabled(value) {
    if (value !== this.enabled) {
      this.enabled = value;
      this.node.classList.toggle("disabled", !this.enabled);

      if (this.datefield) {
        this.datefield.disabled = !this.enabled;
      }
      if (this.timefield) {
        this.timefield.disabled = !this.enabled;
      }
    }
  }


  /****************************************************************************************************************************
  * DOM
  */

  // Build the DOM node(s) for this component
  buildNode(data) {
    this.node = <t-datetime data-name={this.name} propTodd={this} title={this.hint || ''} />;
    if (this.fieldtype === 'date' || this.fieldtype === 'datetime') {
      let suggestion_isodate = "";
      if (this.suggestion) {
        const parsed = this._parseTolliumValue(this.suggestion);
        suggestion_isodate = (parsed.year < 1000 ? ("000" + parsed.year).slice(-4) : parsed.year) + "-" + ("0" + parsed.month).slice(-2) + "-" + ("0" + parsed.day).slice(-2);
      }

      this.datefield =
        <input type="date"
          data-format={this.dateformat}
          data-suggestion={suggestion_isodate}
        />;
      this.datefield.addEventListener("wh:datepicker-built", evt => this.onDatepickerBuilt(evt));
      this.node.appendChild(this.datefield);
      this.datefield.required = data.required;
      this.datefield.disabled = !this.enabled;
      this.datefield.setAttribute("data-cutoffyear", this.cutoffyear);

      this.datefield.dataset.format = this.dateformat.replace(/%/g, '').toLowerCase();
      this.datefield.dataset.shortyearcutoff = this.cutoffyear >= 0 ? this.cutoffyear : "";
      this.datehandler = new DateField(this.datefield!, {
        baseclass: "tollium__datetime",
        weeknumbers: true,
        placeholders: this.owner.hostapp.lang?.startsWith('nl') ? { year: "jjjj", month: "m", day: "d" } : { year: "yyyy", month: "m", day: "d" }
      });

      // this.datefield.fireEvent("wh-refresh");
    }
    if (this.fieldtype === 'datetime') {
      this.node.appendChild(<span>&nbsp;</span>);
    }
    if (this.fieldtype === 'time' || this.fieldtype === 'datetime') {
      let placeholder = "00:00";
      let step = "60"; // minutes
      if (this.precision === 'seconds' || this.precision === 'milliseconds') {
        placeholder += ":00";
        step = "1"; // seconds
      }
      if (this.precision === 'milliseconds') {
        placeholder += ".000";
        step = ".001"; // milliseconds
      }

      this.timefield = <input type="time" step={step} />;
      this.node.appendChild(this.timefield);
      this.timefield.required = data.required;
      this.timefield.disabled = !this.enabled;

      this.timehandler = new TimeField(this.timefield!, {
        baseclass: "tollium__datetime",
        placeholders: this.owner.hostapp.lang?.startsWith('nl') ? { hour: "u", minute: "m", second: "s", msec: "ms" } : { hour: "h", minute: "m", second: "s", msec: "ms" }
      });
    }
  }


  /****************************************************************************************************************************
  * Dimensions
  */

  calculateDimWidth() {
    if (!this.minwidth)
      this.minwidth = this.node.getBoundingClientRect().width;

    this.width.min = this.width.calc = this.minwidth;
  }

  calculateDimHeight() {
    this.height.min = this.height.calc = $todd.gridlineInnerHeight;
  }

  relayout() {
  }

  // ---------------------------------------------------------------------------
  //
  // Events
  //
  cancelDatepicker() {
    this.datehandler.closePicker();
  }
  selectToday() {
    this.datehandler.closePicker();
    const today = datehelpers.getLocalToday();
    dompack.changeValue(this.datefield, datehelpers.formatISODate(today.year, today.month, today.day));
  }
  selectNone() {
    this.datehandler.closePicker();
    dompack.changeValue(this.datefield, '');
  }

  onDatepickerBuilt(evt) {
    evt.detail.datepicker.append(
      <div class="tollium__datetime__picker__buttonbar">
        <button type="button" class="tollium__datetime__picker__button tollium__datetime__picker__cancelbutton" onClick={() => this.cancelDatepicker()}>{getTid("~cancel")}</button>
        <div class="tollium__datetime__picker__buttonflex"></div>
        <button type="button" class="tollium__datetime__picker__button tollium__datetime__picker__todaybutton" onClick={() => this.selectToday()}>{getTid("~today")}</button>
        <button type="button" class="tollium__datetime__picker__button tollium__datetime__picker__nonebutton" onClick={() => this.selectNone()}>{getTid("~none")}</button>
      </div>);
  }
}
