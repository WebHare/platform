import * as test from '@mod-tollium/js/testframework';
import * as tt from "@mod-webhare_testsuite/js/tolliumtest-wts";

function getDump(which: number) {
  return test.compByName("dump").querySelector("textarea").value.split('\n')[which];
}

function setDate(node: HTMLElement, dmy: string) {
  const parts = dmy.split('-');
  test.fill(test.qR(node, ".tollium__datetime__day"), parts[0]);
  test.fill(test.qR(node, ".tollium__datetime__month"), parts[1]);
  test.fill(test.qR(node, ".tollium__datetime__year"), parts[2]);
}

function setTime(node: HTMLElement, hms: string) {
  const parts = hms.split(':');
  test.fill(test.qR(node, ".tollium__datetime__hour"), parts[0]);
  test.fill(test.qR(node, ".tollium__datetime__minute"), parts[1]);
  if (parts.length > 2) {
    const secparts = parts[2].split('.');
    test.fill(test.qR(node, ".tollium__datetime__second"), secparts[0]);
    if (secparts.length > 1)
      test.fill(test.qR(node, ".tollium__datetime__msec"), secparts[1]);
  }
}

test.runTests(
  [
    'test height no title',

    async function () {
      await test.load(test.getCompTestPage('datetime', { title: '' }));
      await test.wait("ui");

      test.assert(test.compByName("thecomponent").getBoundingClientRect().bottom <= test.compByName("componentpanel").getBoundingClientRect().bottom, "datetime should not exceed componentpanel");

      // test onselect call after user change
      setDate(test.compByName("thecomponent"), "13-01-2017");
      await test.wait("ui");
      test.eq(1, parseInt(test.compByName("onselectcount").textContent));

      // test no onselect after harescript set
      test.fill(test.compByName("value*").querySelector("input"), 'hson:d"20170102T04:05:06Z"');
      test.click(test.compByName("writevaluebutton"));
      await test.wait("ui");
      test.eq(1, parseInt(test.compByName("onselectcount").textContent));

      // test onselect call after another user change
      setDate(test.compByName("thecomponent"), "14-01-2017");
      await test.wait("ui");
      test.eq(2, parseInt(test.compByName("onselectcount").textContent));

      // test onselect call after clicking reset
      const comp = test.compByName("thecomponent");
      test.click(comp.querySelector('.tollium__datetime__reset'));
      await test.wait("ui");

      test.eq(3, parseInt(test.compByName("onselectcount").textContent));
      test.eq("", comp.querySelector('.tollium__datetime__day').value);
    },

    "Test right aligned datetime",
    async function () {
      await test.load(test.getCompTestPage('datetime', { __splitside: 'right' }));
      await test.wait("ui");

      test.click(test.compByName("componentpanel").querySelector('.tollium__datetime__togglepicker'));

      const picker = test.qS('.tollium__datetime__picker');
      test.assert(picker);
      test.assert(picker.getBoundingClientRect().right <= test.getDoc().body.getBoundingClientRect().right, "datepicker must be inside screen");
    },

    "Test bottom aligned datetime",
    async function () {
      await test.load(test.getCompTestPage('datetime', { __splitpage: 'bottom' }));
      await test.wait("ui");

      test.click(test.compByName("componentpanel").querySelector('.tollium__datetime__togglepicker'));

      const picker = test.qS('.tollium__datetime__picker');
      test.assert(picker);
      test.assert(picker.getBoundingClientRect().bottom <= test.compByName("thecomponent").getBoundingClientRect().top,
        `datepicker must be above component. datepicker bottom ${picker.getBoundingClientRect().bottom} comp top ${test.compByName("thecomponent").getBoundingClientRect().top}`);
    },

    "suggestion test",
    async function () {
      const suggestion = test.compByTitle("suggestion");
      setDate(suggestion, "1-7-2021");
      setTime(suggestion, "00:00:00");
      test.click(test.compByName("readvaluebutton"));
      await test.wait("ui");

      test.click(test.compByName("componentpanel").querySelector('.tollium__datetime__togglepicker'));

      const picker = test.qS('.tollium__datetime__picker');
      test.assert(picker);
      test.eq("7", test.qR(picker, ".tollium__datetime__picker__monthselect").value);
      test.eq("2021", test.qR(picker, ".tollium__datetime__picker__yearselect").value);
    },

    "Initial tests",
    async function () {
      await tt.loadWTSTestScreen('tests/basecomponents.datetimetest');
      await test.wait("ui");
    },

    async function () {
      const dt1 = test.compByName('dt1'); //datetime with minute precision
      test.eq("2009-08-13", dt1.querySelector('[type=date]').value);
      test.eq("08:09", dt1.querySelector('[type=time]').value);

      //change a time
      const ti1 = test.compByName('ti1'); //time with minute precision
      test.eq(3, ti1.querySelectorAll('input').length);
      test.eq("08:09", ti1.querySelector('[type=time]').value);
      setTime(ti1, '8:19');

      const ti6 = test.compByName('ti6!dt'); //datetime with minute precision
      test.assert(ti6.classList.contains('required'));
      test.eq("08:09:18.189", ti6.querySelector('[type=time]').value);

      const midnight = test.compByName('midnight!dt'); //datetime with minute precision
      test.eq("00:00:00.000", midnight.querySelector('[type=time]').value);

      const emptytime = test.compByName('emptytime!dt'); //datetime with minute precision
      test.eq("", emptytime.querySelector('[type=time]').value);

      const bigdt = test.compByName('bigdt');
      test.eq("", bigdt.querySelector('[type=date]').value);//generated by replaceComponents, orginal input is not valid
      test.eq("", bigdt.querySelector('[type=time]').value);

      const maxdt = test.compByName('maxdt');
      test.eq("", maxdt.querySelector('[type=date]').value);//generated by replaceComponents, orginal input is not valid
      test.eq("", maxdt.querySelector('[type=time]').value);

      //send it
      test.click(test.getMenu(['M01', 'A02'])); //show current
      await test.wait('ui');

      test.eq('ti1: 2009-08-13T08:19:00.000Z p=minutes req=1 utc=0 ro=0 invdate=0 invtime=0', getDump(4));
    },

    'set-max',
    async function () {
      let dt2 = test.compByName('dt2');
      setDate(dt2, '--');
      setTime(dt2, '::');
      test.click(test.getMenu(['M01', 'A09'])); //set max datetime

      await test.wait("ui");
      dt2 = test.compByName('dt2');
      test.eq("", dt2.querySelector('[type=date]').value);
      test.eq("", dt2.querySelector('[type=time]').value);

      const dt3 = test.compByName('dt3');
      test.eq("", dt3.querySelector('[type=date]').value);
      test.eq("", dt3.querySelector('[type=time]').value);

      test.eq("dt2: MAX_DATETIME p=seconds req=1 utc=0 ro=0 invdate=0 invtime=0", getDump(2));
      test.eq("dt3: MAX_DATETIME p=milliseconds req=1 utc=0 ro=0 invdate=0 invtime=0", getDump(3));
    },

    'set-utc',
    async function () {
      test.click(test.getMenu(['M01', 'A05'])); //toggle utc
      await test.wait("ui");

      const dt1 = test.compByName('dt1'); //datetime with minute precision
      test.eq("2009-08-13", dt1.querySelector('[type=date]').value);
      test.eq("08:09", dt1.querySelector('[type=time]').value);

      //change a time
      let ti1 = test.compByName('ti1'); //datetime with minute precision
      test.eq("08:19", ti1.querySelector('[type=time]').value);
      setTime(ti1, '10:29');
      test.click(test.getMenu(['M01', 'A02'])); //show current

      await test.wait("ui");

      ti1 = test.compByName('ti1'); //datetime with minute precision
      test.eq("10:29", ti1.querySelector('[type=time]').value);
      test.eq('ti1: 2009-08-13T10:29:00.000Z p=minutes req=1 utc=1 ro=0 invdate=0 invtime=0', getDump(4));
    },

    'readonly',
    async function () {
      test.click(test.getMenu(['M01', 'A06'])); //toggle read only
      await test.wait("ui");

      const da1 = test.compByName('da1');
      test.eq('13\u00a0August\u00a02009', da1.textContent);
      const dt1 = test.compByName('dt1');
      test.eq('13\u00a0August\u00a02009 08:09', dt1.textContent);
      const ti1 = test.compByName('ti1');
      test.eq('10:29', ti1.textContent);
      const ti6 = test.compByName('ti6!dt');
      test.eq('08:09:18.189', ti6.textContent);
      const midnight = test.compByName('midnight!dt');
      test.eq('00:00:00.000', midnight.textContent);
      const emptytime = test.compByName('emptytime!dt');
      test.eq('', emptytime.textContent);

      test.eq("midnight: 0 p=milliseconds req=0 utc=0 ro=1 invdate=1 invtime=0", getDump(12));
      test.eq("emptytime: -1 p=milliseconds req=0 utc=0 ro=1 invdate=1 invtime=0", getDump(13));

      const maxdt = test.compByName('maxdt');
      test.eq('', maxdt.textContent);
      //test.eq("maxdt: MAX_DATETIME p=seconds req=1 utc=1 ro=1 invdate=0 invtime=0", getDump(15));
      test.eq("maxdt: MAX_DATETIME p=seconds req=1 utc=1 ro=1 invdate=0 invtime=0", getDump(15));
    },

    'writable',
    async function () {
      test.click(test.getMenu(['M01', 'A06'])); //toggle read only
      await test.wait("ui");
    },

    'datepicker',
    async function () {
      const dt1 = test.compByName('dt1'); //datetime with minute precision
      test.assert(dt1.querySelector('[type=date]').value);

      test.click(dt1.querySelector('.tollium__datetime__togglepicker'));
      test.eq(1, test.qSA('.tollium__datetime__picker').length);

      //Test none button
      const nonebutton = test.qSA(".tollium__datetime__picker button").filter(button => button.textContent?.match(/None/))[0];
      test.assert(nonebutton);
      test.click(nonebutton);
      test.assert(!dt1.querySelector('[type=date]').value);
      test.eq(0, test.qSA('.tollium__datetime__picker').length);

      //Test today button
      test.click(dt1.querySelector('.tollium__datetime__togglepicker'));
      test.eq(1, test.qSA('.tollium__datetime__picker').length);

      const todaybutton = test.qSA(".tollium__datetime__picker button").filter(button => button.textContent?.match(/Today/))[0];
      test.assert(todaybutton);
      test.click(todaybutton);

      //reopen the datepicker to confirm today selection...
      test.eq(0, test.qSA('.tollium__datetime__picker').length);
      test.click(dt1.querySelector('.tollium__datetime__togglepicker'));
      test.eq(1, test.qSA('.tollium__datetime__picker').length);
      test.assert(dt1.querySelector('[type=date]').value);
      test.assert(test.qR(".tollium__datetime__picker__day--today").classList.contains("tollium__datetime__picker__day--selected"), "TODAY should be SELECTED");

      //Test cancel button
      const cancelbutton = test.qSA(".tollium__datetime__picker button").filter(button => button.textContent?.match(/Cancel/))[0];
      test.assert(cancelbutton);
      test.click(cancelbutton);

      test.eq(0, test.qSA('.tollium__datetime__picker').length);
      test.assert(dt1.querySelector('[type=date]').value);
    },

    'updownkeys',
    async function () {
      const ti6 = test.compByName('ti6!dt'); //datetime with minute precision
      test.assert(ti6.classList.contains('required'));
      test.eq("08:09:18.189", ti6.querySelector('[type=time]').value);

      setTime(ti6, '01:01:01.001');

      ti6.querySelector('.tollium__datetime__msec').focus();
      test.eq('01:01:01.001', ti6.querySelector('[type=time]').value);
      await test.pressKey('ArrowDown');
      test.eq('000', ti6.querySelector('.tollium__datetime__msec').value); //check 0 filling
      test.eq('01:01:01.000', ti6.querySelector('[type=time]').value);
      await test.pressKey('ArrowDown');
      test.eq('01:01:00.999', ti6.querySelector('[type=time]').value);
      await test.pressKey('ArrowUp');
      test.eq('01:01:01.000', ti6.querySelector('[type=time]').value);
      await test.pressKey('ArrowUp');
      test.eq('001', ti6.querySelector('.tollium__datetime__msec').value); //check 0 filling
      test.eq('01:01:01.001', ti6.querySelector('[type=time]').value);

      ti6.querySelector('.tollium__datetime__second').focus();
      await test.pressKey('ArrowDown');
      test.eq('01:01:00.001', ti6.querySelector('[type=time]').value);
      await test.pressKey('ArrowDown');
      test.eq('01:00:59.001', ti6.querySelector('[type=time]').value);
      await test.pressKey('ArrowUp');
      test.eq('01:01:00.001', ti6.querySelector('[type=time]').value);
      await test.pressKey('ArrowUp');
      test.eq('01:01:01.001', ti6.querySelector('[type=time]').value);

      ti6.querySelector('.tollium__datetime__minute').focus();
      await test.pressKey('ArrowDown');
      test.eq('01:00:01.001', ti6.querySelector('[type=time]').value);
      await test.pressKey('ArrowDown');
      test.eq('00:59:01.001', ti6.querySelector('[type=time]').value);
      await test.pressKey('ArrowUp');
      test.eq('01:00:01.001', ti6.querySelector('[type=time]').value);
      await test.pressKey('ArrowUp');
      test.eq('01:01:01.001', ti6.querySelector('[type=time]').value);

      ti6.querySelector('.tollium__datetime__hour').focus();
      await test.pressKey('ArrowDown');
      test.eq('00:01:01.001', ti6.querySelector('[type=time]').value);
      await test.pressKey('ArrowDown');
      test.eq('00:01:01.001', ti6.querySelector('[type=time]').value);
      await test.pressKey('ArrowUp');
      test.eq('01:01:01.001', ti6.querySelector('[type=time]').value);

      setTime(ti6, '22:59:59.999');

      ti6.querySelector('.tollium__datetime__msec').focus();
      await test.pressKey('ArrowUp');
      test.eq('23:00:00.000', ti6.querySelector('[type=time]').value);

      setTime(ti6, '23:59:59.999');

      ti6.querySelector('.tollium__datetime__hour').focus();
      await test.pressKey('ArrowUp');
      test.eq('23:59:59.999', ti6.querySelector('[type=time]').value);
      ti6.querySelector('.tollium__datetime__minute').focus();
      await test.pressKey('ArrowUp');
      test.eq('23:59:59.999', ti6.querySelector('[type=time]').value);
      ti6.querySelector('.tollium__datetime__second').focus();
      await test.pressKey('ArrowUp');
      test.eq('23:59:59.999', ti6.querySelector('[type=time]').value);
      ti6.querySelector('.tollium__datetime__msec').focus();
      await test.pressKey('ArrowUp');
      test.eq('23:59:59.999', ti6.querySelector('[type=time]').value);

      setTime(ti6, '00:00:00.000');
      test.eq('00:00:00.000', ti6.querySelector('[type=time]').value, "failed to set value");

      ti6.querySelector('.tollium__datetime__hour').focus();
      await test.pressKey('ArrowDown');
      test.eq('00:00:00.000', ti6.querySelector('[type=time]').value);

      ti6.querySelector('.tollium__datetime__minute').focus();
      await test.pressKey('ArrowDown');
      test.eq('00:00:00.000', ti6.querySelector('[type=time]').value);

      ti6.querySelector('.tollium__datetime__second').focus();
      await test.pressKey('ArrowDown');
      test.eq('00:00:00.000', ti6.querySelector('[type=time]').value);

      ti6.querySelector('.tollium__datetime__msec').focus();
      await test.pressKey('ArrowDown');
      test.eq('00:00:00.000', ti6.querySelector('[type=time]').value);
    },

    "cutoff year",
    async function () {
      // Check cutoff year, should be 70
      const cutoff = test.compByName('cutoff');
      setDate(cutoff, '1-1-69');
      await test.wait("ui");
      test.eq('2069-01-01', cutoff.querySelector('[type=date]').value);
      test.eq('2069-01-01T00:00:00.000Z', cutoff.propTodd.getValue());
      setDate(cutoff, '1-1-70');
      await test.wait("ui");
      test.eq('1970-01-01', cutoff.querySelector('[type=date]').value);
      test.eq('1970-01-01T00:00:00.000Z', cutoff.propTodd.getValue());

      test.click(test.getMenu(['M01', 'A10'])); //change cutoff year to 10
      await test.wait("ui");

      test.eq("cutoff: 1970-01-01T00:00:00.000Z p=minutes req=0 utc=0 ro=0 invdate=0 invtime=0", getDump(0));
    },

    'cutoff year 10',
    async function () {

      const cutoff = test.compByName('cutoff');
      setDate(cutoff, '1-1-69');
      await test.wait("ui");
      test.eq('1969-01-01', cutoff.querySelector('[type=date]').value);
      test.eq('1969-01-01T00:00:00.000Z', cutoff.propTodd.getValue());
      setDate(cutoff, '1-1-70');
      await test.wait("ui");
      test.eq('1970-01-01', cutoff.querySelector('[type=date]').value);
      test.eq('1970-01-01T00:00:00.000Z', cutoff.propTodd.getValue());

      test.click(test.getMenu(['M01', 'A10'])); //change cutoff year to 90
      await test.wait("ui");

      test.eq("cutoff: 1970-01-01T00:00:00.000Z p=minutes req=0 utc=0 ro=0 invdate=0 invtime=0", getDump(0));
    },

    'cutoff year 90',
    async function () {

      const cutoff = test.compByName('cutoff');
      setDate(cutoff, '1-1-69');
      await test.wait("ui");
      test.eq('2069-01-01', cutoff.querySelector('[type=date]').value);
      test.eq('2069-01-01T00:00:00.000Z', cutoff.propTodd.getValue());
      setDate(cutoff, '1-1-70');
      await test.wait("ui");
      test.eq('2070-01-01', cutoff.querySelector('[type=date]').value);
      test.eq('2070-01-01T00:00:00.000Z', cutoff.propTodd.getValue());

      test.click(test.getMenu(['M01', 'A10'])); //change cutoff year to 0
      await test.wait("ui");

      test.eq("cutoff: 2070-01-01T00:00:00.000Z p=minutes req=0 utc=0 ro=0 invdate=0 invtime=0", getDump(0));
    },

    'cutoff year 0',
    async function () {
      const cutoff = test.compByName('cutoff');
      setDate(cutoff, '1-1-1');
      await test.wait("ui");
      test.eq('1901-01-01', cutoff.querySelector('[type=date]').value);
      test.eq('1901-01-01T00:00:00.000Z', cutoff.propTodd.getValue());
      setDate(cutoff, '1-1-99');
      await test.wait("ui");
      test.eq('1999-01-01', cutoff.querySelector('[type=date]').value);
      test.eq('1999-01-01T00:00:00.000Z', cutoff.propTodd.getValue());

      test.click(test.getMenu(['M01', 'A10'])); //change cutoff year to 100
      await test.wait("ui");

      test.eq("cutoff: 1999-01-01T00:00:00.000Z p=minutes req=0 utc=0 ro=0 invdate=0 invtime=0", getDump(0));
    },

    'cutoff year 100',
    async function () {

      const cutoff = test.compByName('cutoff');
      setDate(cutoff, '1-1-1');
      await test.wait("ui");
      test.eq('2001-01-01', cutoff.querySelector('[type=date]').value);
      test.eq('2001-01-01T00:00:00.000Z', cutoff.propTodd.getValue());
      setDate(cutoff, '1-1-99');
      await test.wait("ui");
      test.eq('2099-01-01', cutoff.querySelector('[type=date]').value);
      test.eq('2099-01-01T00:00:00.000Z', cutoff.propTodd.getValue());

      test.click(test.getMenu(['M01', 'A10'])); //change cutoff year to -1
      await test.wait("ui");

      test.eq("cutoff: 2099-01-01T00:00:00.000Z p=minutes req=0 utc=0 ro=0 invdate=0 invtime=0", getDump(0));
    },

    'cutoff year -1',
    async function () {
      const cutoff = test.compByName('cutoff');
      setDate(cutoff, '1-1-30');
      await test.wait("ui");
      test.eq('0030-01-01', cutoff.querySelector('[type=date]').value);
      test.eq('0030-01-01T00:00:00.000Z', cutoff.propTodd.getValue());
      setDate(cutoff, '1-1-99');
      await test.wait("ui");
      test.eq('0099-01-01', cutoff.querySelector('[type=date]').value);
      test.eq('0099-01-01T00:00:00.000Z', cutoff.propTodd.getValue());

      test.click(test.getMenu(['M01', 'A10'])); //change cutoff year back to 70
      await test.wait("ui");

      test.eq("cutoff: 0099-01-03T00:00:00.000Z p=minutes req=0 utc=0 ro=0 invdate=0 invtime=0", getDump(0));
    },

    'defaultbuttons',
    async function () {
      const alternatedefault = test.compByName('alternatedefault');
      test.assert(!alternatedefault.classList.contains("default"));

      const dt3 = test.compByName('dt3');
      const dt2 = test.compByName('dt2');

      await test.wait("events");

      test.click(dt3.querySelector(".tollium__datetime__day"));
      test.assert(alternatedefault.classList.contains("default"));

      test.click(dt2.querySelector(".tollium__datetime__day"));
      test.assert(!alternatedefault.classList.contains("default"));

      test.click(dt3.querySelector(".tollium__datetime__hour"));
      test.assert(alternatedefault.classList.contains("default"));
    }

  ]);
