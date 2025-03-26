/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from 'dompack';
import KeyboardHandler from "dompack/extra/keyboard";
import * as datehelpers from "./datehelpers";
// import "./datestrings.lang.json";
//import { getTid } from "@webhare/gettid";

// FIXME work with backend
const langcodes =
{
  "nl": "am;pm;januari;februari;maart;april;mei;juni;juli;augustus;september;oktober;november;december;maandag;dinsdag;woensdag;donderdag;vrijdag;zaterdag;zondag;jan;feb;mrt;apr;mei;jun;jul;aug;sep;okt;nov;dec;ma;di;wo;do;vr;za;zo",
  "de": "am;pm;Januar;Februar;März;April;Mai;Juni;Juli;August;September;Oktober;November;Dezember;Montag;Dienstag;Mittwoch;Donnerstag;Freitag;Samstag;Sonntag;Jan.;Febr.;März;Apr.;Mai;Juni;Juli;Aug.;Sept.;Okt.;Nov.;Dez.;Mo;Di;Mi;Do;Fr;Sa;So",
  "en": "am;pm;January;February;March;April;May;June;July;August;September;October;November;December;Monday;Tuesday;Wednesday;Thursday;Friday;Saturday;Sunday;Jan;Feb;Mar;Apr;May;Jun;Jul;Aug;Sep;Oct;Nov;Dec;Mon;Tue;Wed;Thu;Fri;Sat;Sun"
};

//Load any needed localizations yourself: frameworks.mootools.more.locale.nl-nl.date, frameworks.mootools.more.locale.es-es.date, frameworks.mootools.more.locale.de-de.date, frameworks.mootools.more.locale.fr-fr.date

/*

Converting calendar.js code to calendar2.js

    Changed classes
      - .-wh-calendar-popup   ->   .wh-datepicker > .value
      - .-wh-calendar-icon    ->   .wh-datepicker > .arrow

    Changed <input> attributes:
      - data-formatting -> data-format
      - data-empty -> placeholder

    Load:
      LOAD: wh.ui.calendar2
      LOAD: wh.locale.common.de-de.date
      LOAD: wh.locale.common.en-us.date
      LOAD: wh.locale.common.nl-nl.date

    Taal instellen:
      Locale.use("de-DE");
      Locale.use("en-US");
      Locale.use("nl-NL");
*/


/////////////////////
//
//

//NOTE preparing to sync this with dompack selectlist.es

class ComponentOverlay {
  constructor() {
    this._boundGlobalEvents = null;
  }
  _startOverlayDismissCapture() {
    //set up capturing handlers to kill our pulldowns asap when something else is clicked
    if (!this._boundGlobalEvents)
      this._boundGlobalEvents = evt => this._globalEvents(evt);

    if (!dompack.debugflags.meo) {
      window.addEventListener("keyup", this._boundGlobalEvents, true);
      window.addEventListener("mousedown", this._boundGlobalEvents, true);
      window.addEventListener("touchstart", this._boundGlobalEvents, true);
    }
  }
  _endOverlayDismissCapture() {
    window.removeEventListener("keyup", this._boundGlobalEvents, true);
    window.removeEventListener("mousedown", this._boundGlobalEvents, true);
    window.removeEventListener("touchstart", this._boundGlobalEvents, true);
  }
  _globalEvents(evt) {
    if (evt && evt.type === "keyup") {
      if (evt.keyCode === 27)
        this._dismissOverlay();
      return;
    }

    if (!dompack.contains(this._anchornode, evt.target) && !dompack.contains(this._items, evt.target))
      this._dismissOverlay();
  }
}



//
//
////////////////////



/*
 * $wh.CalendarTable
 * Builds a plain calendar table based on mootools locale settings
 *
 */

class CalendarTable extends ComponentOverlay {
  constructor() {
    super();
    this.options = {
      weeknumbers: false,
      header_weeknr: '', //weeknr.
      min: null, //minimal date
      max: null //maximal date (out of range gets disabled class
    };
    this.cdate = null;
    this.showdate = null;
  }

  _onDayClick(evt) {
    const clickedday = evt.target.closest(`.${this.options.baseclass}__day--selectable`);
    // console.error(clickedday, clickedday.dataset.whDatepickerDate);
    if (!clickedday)
      return;

    dompack.stop(evt);
    this._dismissOverlay();

    dompack.changeValue(this._datenode, clickedday.dataset.whDatepickerDate);
  }

  getTable(showdate, options) {
    this.options = { ...this.options, options };

    const caltable = dompack.create('table', {
      className: this.options.baseclass + '__days',
      on: { click: evt => this._onDayClick(evt) }
    });
    const calbody = dompack.create('tbody');
    caltable.appendChild(calbody);

    //Build week rows
    const rownode = <tr class={this.options.baseclass + '__weekdays'}></tr>;
    if (this.options.weeknumbers)
      rownode.appendChild(<td></td>); //placeholder for upperleft corner

    for (let w = 0; w < 7; ++w) {
      rownode.appendChild(<th scope="column" class={this.options.baseclass + '__weekday'}><span>{this._languagetexts[w + 33]}</span></th>);
    }
    calbody.appendChild(rownode);

    const mindate = this.options.min ? {
      day: this.options.min.getUTCDay(),
      month: this.options.min.getUTCMonth(),
      year: this.options.min.getUTCFullYear()
    } : null;

    const maxdate = this.options.max ? {
      day: this.options.max.getUTCDay(),
      month: this.options.max.getUTCMonth(),
      year: this.options.max.getUTCFullYear()
    } : null;

    //What is the weekday for the first day of the selected month ?
    const startofmonth = datehelpers.makeJSUTCDate({ ...showdate, day: 1 });
    const showmonth = startofmonth.getUTCMonth();
    const showyear = startofmonth.getUTCFullYear();

    //    console.log(startofmonth);
    const startofmonth_weekday = startofmonth.getUTCDay(); //0-6 where 0=Sunday

    //Work backwards to a monday (start of the week)
    const backwardsdays = startofmonth_weekday === 0 ? 6 : startofmonth_weekday - 1;
    let currentgriddate = startofmonth.getTime() - (backwardsdays * 86400 * 1000);

    //Build the grid!
    for (let week = 0; week < 6; ++week) {
      const rownode = dompack.create('tr', { className: this.options.baseclass + '__week' });

      for (let day = 0; day < 7; ++day) {
        const date = new Date(currentgriddate);
        if (this.options.weeknumbers && day === 0)
          rownode.appendChild(<th class={this.options.baseclass + '__weeknr'} scope="row"><span>{datehelpers.getWeekNumber(date)}</span></th>);

        const dateY = date.getUTCFullYear();
        const dateM = date.getUTCMonth();
        const dateD = date.getUTCDate();

        const celldate = { year: dateY, month: dateM + 1, day: dateD };

        const dayclass = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'][day];
        const daynode = dompack.create('td', {
          className: `${this.options.baseclass}__day ${this.options.baseclass}__day--${dayclass}`,
          childNodes: [dompack.create("span", { textContent: date.getUTCDate() })],
          dataset: { whDatepickerDate: datehelpers.formatJSUTCISODate(date) }
        });

        if (dateM !== showmonth || dateY !== showyear)
          daynode.classList.add(this.options.baseclass + '__day--othermonth');

        if ((mindate && dateY < mindate.year && dateM < mindate.month && dateD < mindate.day)
          || (maxdate && dateY > maxdate.year && dateM > maxdate.month && dateD > maxdate.day)) {
          daynode.classList.add(this.options.baseclass + '__day--disabled');
        } else {
          daynode.setAttribute("tabindex", "0");
          daynode.classList.add(this.options.baseclass + '__day--selectable');
        }

        if (datehelpers.compareDate(this.today, celldate) === 0)
          daynode.classList.add(this.options.baseclass + '__day--today');

        if (this.date && datehelpers.compareDate(this.date, celldate) === 0)
          daynode.classList.add(this.options.baseclass + '__day--selected');

        rownode.appendChild(daynode);
        currentgriddate += 86400 * 1000;
      }
      calbody.appendChild(rownode);
    }

    return caltable;
  }
}

class Calendar2 extends CalendarTable {
  constructor(options) {
    super();
    this.options = {
      weeknumbers: false,
      date: null,   // initial value
      min: null,
      max: null,
      ...options
    };
    this.node = null;
    this.tablenode = null;
    this.yearspinner = null;
    this.monthselectnode = null;
    this.date = null; //selected date
    this.keys = null;
    this.focusednode = null;
  }

  _onYearMonthChange(evt) {
    this.options.date = {
      year: this.yearspinner.value,
      month: this.monthselectnode.value,
      day: this._currentdate ? this._currentdate.day : 1
    };

    this._currentdate.month = parseInt(this.monthselectnode.value);
    this._currentdate.year = parseInt(this.yearspinner.value);

    this.setMonthTable(this.options.date);
  }

  readDateNode() {
    this.mindate = datehelpers.parseISODate(this._datenode.min, { nofail: true });
    this.maxdate = datehelpers.parseISODate(this._datenode.max, { nofail: true });
    this.date = datehelpers.parseISODate(this._datenode.value, { nofail: true });
    const suggestion = datehelpers.parseISODate(this._datenode.dataset.suggestion, { nofail: true });
    const max = datehelpers.parseISODate(this._datenode.max);
    this.today = datehelpers.getLocalToday();

    this.yearspinner.min = this.mindate ? this.mindate.year : 1901;
    this.yearspinner.max = this.maxdate ? this.maxdate.year : 2099;

    let showdate = this.date ?? suggestion ?? this.today;
    if (this.mindate && datehelpers.makeJSUTCDate(showdate) < datehelpers.makeJSUTCDate(this.mindate))
      showdate = this.mindate;
    if (this.maxdate && datehelpers.makeJSUTCDate(showdate) > datehelpers.makeJSUTCDate(this.maxdate))
      showdate = this.maxdate;

    if (!this._currentdate)
      this._currentdate = showdate;

    this.setMonthTable(showdate);
  }

  _addMeToNode(container) {
    this.node = container;

    this.yearspinner = <input type="number" class={`${this.options.baseclass}__yearselect`} step="1" on={{ change: evt => this._onYearMonthChange(evt) }} />;
    this.monthselectnode = <select class={`${this.options.baseclass}__monthselect`} on={{ change: evt => this._onYearMonthChange(evt) }} />;

    this.readDateNode();

    //build calendar interface:
    const headernode = <div class={this.options.baseclass + "__header"}>
      <div class={this.options.baseclass + "__previous"} onClick={evt => this.changeMonth(evt, -1)} />
      {this.monthselectnode}
      {this.yearspinner}
      <div class={this.options.baseclass + "__next"} onClick={evt => this.changeMonth(evt, +1)} />
    </div>;

    //month pulldown
    const selectedmonth = this._currentdate.month;
    for (let m = 0; m < 12; ++m)
      this.monthselectnode.appendChild(<option value={m + 1} selected={m === selectedmonth - 1}>{this._languagetexts[m + 2]}</option>);

    this.node.append(headernode, this.tablenode);//, btnbarnode);

    //looks like we're visible ! install a capturing
    new KeyboardHandler(this.node, {
      "Enter": ev => this.onKeyEnter(ev)
    }
      , { captureunsafekeys: true }
    );

    // Locale.addEvent("change", this.onLanguageChange.bind(this));
    this._startOverlayDismissCapture();
    this._onYearMonthChange();
  }

  setMonthTable(showdate) {
    this.yearspinner.value = showdate.year;
    this.monthselectnode.value = showdate.month;

    const newtable = this.getTable(showdate);

    if (this.tablenode)
      this.tablenode.replaceWith(newtable);
    this.tablenode = newtable;

    this.setFocus();
  }

  setFocus() {
    if (!this.tablenode.clientWidth)
      return;//Not (yet) visible

    //Set focus on showdate or else first selectable date
    let fnode;
    if (this.date)
      fnode = this.tablenode.querySelector("td[data-wh-datepicker-date='" + datehelpers.formatISODate(this.date.year, this.date.month, this.date.day) + "']");
    if (!fnode) //else pick first selectable day
      fnode = this.tablenode.querySelector("." + this.options.baseclass + '__day--selectable');
    if (fnode)
      fnode.focus();
  }

  onKeyEnter(ev) {
    const daynode = ev.target.closest("." + this.options.baseclass + '__day--selectable');
    if (!daynode)
      return;

    this._onDayClick(ev);
  }

  _dismissOverlay() {
    this.node.remove();
    this._endOverlayDismissCapture();
    this._owner.__closedDatepicker();
  }

  changeMonth(evt, direction) {
    dompack.stop(evt);

    let newyear = parseInt(this.yearspinner.value);
    let newmonth = parseInt(this.monthselectnode.value) + direction;

    if (newmonth > 12 || newmonth < 1) //wrap it
    {
      newyear += direction;
      newmonth = direction > 0 ? 1 : 12;
    }
    this.setMonthTable({ year: newyear, month: newmonth });
  }
}

class DatePicker extends Calendar2 {
  /** options.baseclass Base class to use for the elements in the date picker. Defaults to 'datepicker' */
  constructor(owner) {
    super({ ...owner.options, baseclass: owner._baseclass + '__picker' });
    this._owner = owner;
    this._datenode = owner._replacednode;
    this.options = {
      ...this.options,
      language: null
    };
    //TODO limit by supportedlanguages and use gettid("~locale.datetimestrings")
    if (!this.options.language)
      this.options.language = document.documentElement.lang ? document.documentElement.lang.split('-')[0].toLowerCase() : '';

    this._languagetexts = (langcodes[this.options.language] || langcodes.en).split(';');

    //we use the node to store our result, so verify it
    //FIXME maybe this should be optional and you be allowed to create a datepicker without a corresponding node if you just manage getvalue/setvalue yourself, or maybe this glue code belongs outside us
    //     if(node.nodeName !== 'INPUT' || node.getAttribute('type') !== 'date')
    //       throw new Error("The DatePicker expects to be associated with a input[type=date]");

    //     this._node = node;
    //     this._class = (options ? options.baseclass : '') || 'datepicker';
    //     this._node.classList.add(this._class + "--attached");
    // //
    // this._node.addEventListener("wh:datepicker-request");

    this._anchornode = this._datenode.nextSibling;

    this._calendarnode = dompack.create('div', { className: this.options.baseclass }); //tabindex:0 ?
    this._addMeToNode(this._calendarnode);

    this._items = this._calendarnode; //TODO bit ugly but keeps us compatible with selectlist.es

    this._calendarnode.addEventListener("change", ev => {
      console.log(ev);
    });

    //Allow users to hook into the datepicker
    dompack.dispatchCustomEvent(this._datenode, "wh:datepicker-built", { bubbles: true, cancelable: false, detail: { input: this._datenode, datepicker: this._calendarnode } });

    //ADDME can we borrow positioning code from the dompack pulldown?
    //for now, attach to bottom
    document.body.appendChild(this._calendarnode);
    const calendarnodesize = this._calendarnode.getBoundingClientRect();
    const anchornode = this._anchornode.getBoundingClientRect();

    //fits left aligned?
    if (anchornode.left + calendarnodesize.width > window.innerWidth) { //doesn't fit left aligned, we must right align
      this._calendarnode.style.right = '0px';
    } else //left align
    {
      this._calendarnode.style.left = Math.ceil(anchornode.left) + 'px';
    }

    //fits top aligned?
    if (anchornode.top + calendarnodesize.height > window.innerHeight) { //doesn't fit below, send above
      let y = (window.innerHeight - anchornode.top);
      if ((window.innerHeight - y) - calendarnodesize.height < 0) //Prevent calendar hiding behind top of window
        y = window.innerHeight - calendarnodesize.height;
      this._calendarnode.style.bottom = y + 'px';
    } else //left align
    {
      this._calendarnode.style.top = Math.ceil(anchornode.bottom) + 'px';
    }

    this.setFocus();
  }
}

export default DatePicker;
