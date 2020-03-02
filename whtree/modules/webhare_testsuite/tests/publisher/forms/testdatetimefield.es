import * as test from '@mod-system/js/wh/testframework';
import * as dompack from 'dompack';
import { __setUnderlyingValue } from '@mod-publisher/js/forms/fields/datetime.es';

let datechangeevents = 0;
let timechangeevents = 0;

test.registerTests(
  [  "Run unreplaced for compatibility test"

   , async function()
     {
       await test.load(test.getTestSiteRoot() + 'testpages/formtest/?datetime=1');

       dompack.changeValue(test.qS("#datetimeform-dateofbirth"),"2012-11-13");
       dompack.changeValue(test.qS("#datetimeform-time"),"15:30");

       test.click(test.qSA('[type=submit]')[0]);
       await test.wait('ui');

       let result = JSON.parse(test.qS("#dynamicformsubmitresponse").textContent);
       test.eq("2012-11-13T00:00:00.000Z", result.form.dateofbirth);
       test.eq(55800000, result.form.time);

     }

  , "Run with split versions"
  , async function()
    {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?datetime=1&splitdatetime=1');

      //the fields inside the select controls should be initially disabled but not required
      test.true(test.qS("#datetimeform-choice_date").disabled);
      test.false(test.qS("#datetimeform-choice_date").required);
      test.true(test.qS("#datetimeform-choice_time").disabled);
      test.false(test.qS("#datetimeform-choice_time").required);

      test.true(test.qS("#datetimeform-choice_date~* input").disabled);
      test.false(test.qS("#datetimeform-choice_date~* input").required);
      test.true(test.qS("#datetimeform-choice_time~* input").disabled);
      test.false(test.qS("#datetimeform-choice_time~* input").required);

      let now = new Date;
      let dayfield = test.qSA("[data-wh-form-group-for=dateofbirth] input")[1]; //fixme properly find day fieldin any locale
      let monthfield = test.qSA("[data-wh-form-group-for=dateofbirth] input")[2]; //fixme properly find field in any locale
      let yearfield = test.qSA("[data-wh-form-group-for=dateofbirth] input")[3]; //fixme properly find field in any locale
      let hourfield = test.qSA("[data-wh-form-group-for=time] input")[1];
      let minutefield = test.qSA("[data-wh-form-group-for=time] input")[2];
      test.eq(now.getDate(), parseInt(dayfield.value));

      test.qS("#datetimeform-dateofbirth").addEventListener("change", () => ++datechangeevents);

      //test date direct assignment
      test.qS("#datetimeform-dateofbirth").value = "2018-06-15";
      test.eq("15", dayfield.value);
      test.eq(0, datechangeevents);

      //if datetime correctly recorded the value change, input events to subs should be seen as spurious and not trigger changes
      dompack.dispatchDomEvent(hourfield, 'input');
      test.eq(0, datechangeevents);

      //test date setting
      dompack.changeValue(test.qS("#datetimeform-dateofbirth"),"2018-06-01");
      test.eq("01", dayfield.value);
      test.eq(1, datechangeevents);

       //test time setting, direct events first
      test.qS("#datetimeform-time").addEventListener("change", () => ++timechangeevents);
      test.qS("#datetimeform-time").value = "06:08";
      test.eq("06", hourfield.value);
      test.eq(0, timechangeevents);

      //if time correctly recorded the value change, input events to subs should be seen as spurious and not trigger changes
      dompack.dispatchDomEvent(minutefield, 'input');
      test.eq(0, timechangeevents);

      dompack.changeValue(test.qS("#datetimeform-time"),"07:09");
      test.eq("07", hourfield.value);
      test.eq("09", minutefield.value);
      test.eq(1, timechangeevents);

      dompack.changeValue(test.qS("#datetimeform-time_sec"),"07:09:15");
      let hourfield_sec = test.qSA("[data-wh-form-group-for=time_sec] input")[1];
      let minutefield_sec = test.qSA("[data-wh-form-group-for=time_sec] input")[2];
      let secondfield_sec = test.qSA("[data-wh-form-group-for=time_sec] input")[3];
      test.eq("07", hourfield_sec.value);
      test.eq("09", minutefield_sec.value);
      test.eq("15", secondfield_sec.value);

      //test disabling the date
      test.false(test.qS("[name=dateofbirth]").disabled);
      test.false(test.qS("[name=time]").disabled);

      test.qS("[name=dateofbirth]").disabled=true;
      test.qS("[name=time]").disabled=true;
      await test.wait('tick'); //wait for the observer to disable the rest

      test.true(dayfield.disabled);
      test.true(hourfield.disabled);

      test.qS("[name=dateofbirth]").disabled=false;
      test.qS("[name=time]").disabled=false;
      await test.wait('tick');

      test.false(dayfield.disabled);
      test.false(hourfield.disabled);

      //clear current value - date
      test.true(true, test.qS('[data-wh-form-group-for=dateofbirth]').classList.contains('wh-form__fieldgroup--required'), "Field should be marked as required");
      test.eq("2018-06-01", test.qS("#datetimeform-dateofbirth").value);
      test.eq(1, datechangeevents, "should still be at one event");
      dompack.changeValue(test.qSA("[data-wh-form-group-for=dateofbirth] input")[1],'');
      test.eq(2, datechangeevents, "making date invalid should be a change event");
      test.eq("", test.qS("#datetimeform-dateofbirth").value);
      dompack.changeValue(test.qSA("[data-wh-form-group-for=dateofbirth] input")[2],'');
      test.eq(2, datechangeevents, "keeping it invalid should not be a change");
      dompack.changeValue(test.qSA("[data-wh-form-group-for=dateofbirth] input")[3],'');
      test.eq(2, datechangeevents, "keeping it invalid should not be a change #2");

      //clear current value - time
      test.eq(true, test.qS('[data-wh-form-group-for=time]').classList.contains('wh-form__fieldgroup--required'), "Time field should be marked as required");
      test.eq("07:09", test.qS("#datetimeform-time").value);
      test.eq(1, timechangeevents, "should still be at one event");
      dompack.changeValue(test.qSA("[data-wh-form-group-for=time] input")[1],'');
      test.eq(2, timechangeevents, "making time invalid should be a change event");
      test.eq("", test.qS("#datetimeform-time").value);
      dompack.changeValue(test.qSA("[data-wh-form-group-for=time] input")[2],'');
      test.eq(2, timechangeevents, "keeping it invalid should not be a change");

      test.click(test.qSA('[type=submit]')[0]);
      await test.wait('tick');
      test.true(test.qS('[data-wh-form-group-for=dateofbirth]').classList.contains('wh-form__fieldgroup--error'), "Date field should be in error state");
      test.true(test.qS('[data-wh-form-group-for=time]').classList.contains('wh-form__fieldgroup--error'), "Time field should be in error state");

      //Test that we can type a date
      test.eq(2, datechangeevents, "#changes should still be 2");
      test.fill(dayfield, '13');
      test.fill(monthfield, '11');
      test.eq(2, datechangeevents, "#changes should still be 2, 13-11 is not valid...");
      test.fill(yearfield, '2012');
      test.eq(3, datechangeevents, "#changes should still now be 3, we made it valid!");
      test.eq('2012-11-13', test.qS("#datetimeform-dateofbirth").value);

      //On Safari next test fails because it triggers 2x ArrowUp/Down event
      dayfield.focus();
      await test.pressKey('ArrowUp');
      test.eq('14', dayfield.value);
      test.eq(4, datechangeevents, "cursorkey should be 4th change");

      await test.pressKey('ArrowDown');
      test.eq('13', dayfield.value);

      //And a time
      test.fill(hourfield, '15');
      test.fill(minutefield, '30');
      test.eq('15:30', test.qS("#datetimeform-time").value);

      test.click(test.qSA('[type=submit]')[0]);
      await test.wait('ui');

      let result = JSON.parse(test.qS("#dynamicformsubmitresponse").textContent);
      test.eq("2012-11-13T00:00:00.000Z", result.form.dateofbirth);
      test.eq(55800000, result.form.time);

      //test zero padding on blur
      test.fill(minutefield, '8');
      await test.pressKey('Tab');
      test.eq("08", minutefield.value);

      // test leap days and arrowup
      test.qS("#datetimeform-dateofbirth").value = "1984-02-29";
      yearfield.focus();
      await test.pressKey('ArrowUp');
      test.eq("1985-03-01", test.qS("#datetimeform-dateofbirth").value);

      //test reset
      test.click('[data-wh-form-group-for="dateofbirth"] .datetime__reset');
      test.eq("", test.qS("#datetimeform-dateofbirth").value);
      test.eq("", dayfield.value);

      //test reset
      test.click('[data-wh-form-group-for="time"] .datetime__reset');
      test.eq("", test.qS("#datetimeform-time").value);
      test.eq("", hourfield.value);
    }
   // * /
  , "Test the date picker"
  , async function()
    {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?datetime=1&splitdatetime=1');

      var changeevents = 0;
      test.qS("[name=dateofbirth]").addEventListener("change", () => ++changeevents);

      test.qS("[name=dateofbirth]").disabled = true;
      test.click('[name=dateofbirth] + * .datetime__togglepicker');
      test.eq(0, test.qSA('.datetime__picker').length, "Not allowed to open an empty date picker!");
      test.qS("[name=dateofbirth]").disabled = false;

      test.click('[name=dateofbirth] + * .datetime__togglepicker');
      test.eq(1, test.qSA('.datetime__picker').length);
      test.click('[name=dateofbirth] + * .datetime__togglepicker');
      test.eq(1, test.qSA('.datetime__picker').length, "shouldn't kill this one and shouldn't add another datepicker");

      //verify the picker sticks to the bottom of our input
      let datepicker = test.qS('.datetime__picker');
      let replacingnode = test.qS("[name=dateofbirth]").nextSibling;
      test.eq(replacingnode.getBoundingClientRect().bottom, datepicker.getBoundingClientRect().top);

      test.eq(1, test.qSA(".datetime__picker__day--today").length, "should be only one 'TODAY'");
      test.eq(1, test.qSA(".datetime__picker__day--selected").length, "should be only one selected");
      test.true(test.qS(".datetime__picker__day--today").classList.contains("datetime__picker__day--selected"), "TODAY should be SELECTED");

      //changing the date should update the date picker
      test.qS('[name=dateofbirth]').value="2014-02-01";
      test.eq("2014-01-27", test.qS(".datetime__picker__day").dataset.whDatepickerDate, "toplevel date should be 2014-01-27");
      test.eq("2", test.qS('.datetime__picker__monthselect').value);
      test.eq("2014", test.qS('.datetime__picker__yearselect').value);
      test.eq(1, test.qSA(".datetime__picker__day--selected").length, "should be only one selected");
      test.eq(0, test.qSA(".datetime__picker__day--today").length, "Today should be out of sight");

      test.true(test.qS("[data-wh-datepicker-date='2014-01-27']").classList.contains("datetime__picker__day--othermonth"));
      test.false(test.qS("[data-wh-datepicker-date='2014-02-01']").classList.contains("datetime__picker__day--othermonth"));
      test.true(test.qS("[data-wh-datepicker-date='2014-02-01']").classList.contains("datetime__picker__day--selected"));
      test.true(test.qS("[data-wh-datepicker-date='2014-02-01']").classList.contains("datetime__picker__day--sat"));

      //test next month
      test.click('.datetime__picker__previous');
      test.eq("2013-12-30", test.qS(".datetime__picker__day").dataset.whDatepickerDate, "toplevel date should be 2013-12-30");

      test.click('.datetime__picker__previous');
      test.eq("2013-11-25", test.qS(".datetime__picker__day").dataset.whDatepickerDate, "toplevel date should be 2013-11-25");

      test.eq("12", test.qS('.datetime__picker__monthselect').value);
      test.eq("2013", test.qS('.datetime__picker__yearselect').value);
      test.click('.datetime__picker__next');
      test.eq("2013-12-30", test.qS(".datetime__picker__day").dataset.whDatepickerDate, "toplevel date should be 2013-12-30");

      test.eq("1", test.qS('.datetime__picker__monthselect').value);
      test.eq("2014", test.qS('.datetime__picker__yearselect').value);

      //clicking outside the datepicker should kill it
      test.click('h1');
      test.false(test.qS('.datetime__picker'));

      //reopen it
      test.click('[name=dateofbirth] + * .datetime__togglepicker');
      test.true(test.qS('.datetime__picker'));

      test.eq(0, changeevents);

      //clicking a date should select it
      test.click(test.qS("[data-wh-datepicker-date='2014-02-13']"));
      test.eq('2014-02-13', test.qS('[name=dateofbirth]').value);
      test.eq(1, changeevents);
      test.false(test.qS('.datetime__picker'));
    }

  , "Test focus datepicker day"
  , async function()
    {
      test.click('[name=dateofbirth] + * .datetime__togglepicker');

      //Focus should be on currently selected day
      test.eq('13',test.qS(".datetime__picker__day:focus").textContent);

      await test.pressKey('Tab');//Goto next day
      test.eq('14',test.qS(".datetime__picker__day:focus").textContent);

      await test.pressKey('Enter');//confirm selected day (and closes datepicker)
      test.eq('2014-02-14', test.qS('[name=dateofbirth]').value);

      //After closing focus should be on last replaced date input (year)
      test.eq(1, test.qSA('[name=dateofbirth] + * input.datetime__year:focus').length);

      //Open again
      test.click('[name=dateofbirth] + * .datetime__togglepicker');

      //Close datepicker with Escape key
      await test.pressKey('Escape');
      test.false(test.qS('.datetime__picker'));
   }

  , "Test weeknumbers"
  , async function()
    {
      test.click('[name=weeknumbers] + * .datetime__togglepicker');
      test.eq('27', test.qS(".datetime__picker__weeknr").textContent);
      test.eq('1', test.qS(".datetime__picker__day").textContent); //first day should be '1', july 2019 started on a monday
    }

  , "Test datepicker reset"
  , async function()
    {
      //resetting it should reset the value AND close the picker
      test.click('[data-wh-form-group-for="dateofbirth"] .datetime__reset');
      test.eq("", test.qS("#datetimeform-time").value);
      test.false(test.qS('.datetime__picker'));
    }

  , "Test keyboard for date field"
  , async function()
    {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?datetime=1&splitdatetime=1&webharevalidation=1');
      dompack.changeValue(test.qS("#datetimeform-dateofbirth"),"1979-06-13");

      var changeevents = 0;
      test.qS("[name=dateofbirth]").addEventListener("change", () => ++changeevents);

      var inputevents = 0;
      test.qS("[name=dateofbirth]").addEventListener("input", () => ++inputevents);

      test.focus('#datetimeform-show_fields');
      await test.pressKey('Tab');

      test.eq(0, changeevents);
      test.eq(0, inputevents);

      await test.pressKey('2');
      test.eq(1, changeevents);
      test.eq(1, inputevents);
      test.eq('1979-06-02', test.qS("[name=dateofbirth]").value);

      await test.pressKey('3');

      test.eq(2, changeevents);
      test.eq(2, inputevents);
      test.eq('1979-06-23', test.qS("[name=dateofbirth]").value);

      let dayfield = test.qSA("[data-wh-form-group-for=dateofbirth] input")[1]; //fixme properly find field in any locale
      let monthfield = test.qSA("[data-wh-form-group-for=dateofbirth] input")[2]; //fixme properly find field in any locale
      let yearfield = test.qSA("[data-wh-form-group-for=dateofbirth] input")[3]; //fixme properly find field in any locale

      //focus should have moved to the month field
      test.eq(monthfield, test.getDoc().activeElement);
      test.eq('06', monthfield.value);

      await test.pressKey('-');
      test.eq(yearfield, test.getDoc().activeElement);
      test.eq('06', monthfield.value);

      test.focus(monthfield);
      await test.pressKey('/');
      test.eq(yearfield, test.getDoc().activeElement);
      test.eq('06', monthfield.value);

      test.focus(monthfield);
      await test.pressKey('a');
      test.eq(monthfield, test.getDoc().activeElement);
      test.eq('06', monthfield.value);

      //backspace once should clear the month field (because we've selected it entirely)
      await test.pressKey('Backspace');
      test.eq('', monthfield.value);

      //backspace AGAIN should move to DAY field.. BUT set the cursor to the end
      await test.pressKey('Backspace');
      test.eq(dayfield, test.getDoc().activeElement);
      test.eq('2', test.getDoc().activeElement.value);

      //ArrowRight brings us to the month field again
      await test.pressKey('ArrowRight');
      test.eq(monthfield, test.getDoc().activeElement);
      test.eq(0, monthfield.selectionStart);
      test.eq(0, monthfield.selectionEnd);

      //Another ArrowRight  goes straight to year
      await test.pressKey('ArrowRight');
      test.eq(yearfield, test.getDoc().activeElement);
      test.eq(0, yearfield.selectionStart);
      test.eq(0, yearfield.selectionEnd);

      test.eq('', monthfield.value);

      //test 'pasting' a date!
      test.getDoc().activeElement.value = '13-5-2011';
      dompack.dispatchDomEvent(test.getDoc().activeElement, 'input');
      test.eq('2011-05-13', test.qS("[name=dateofbirth]").value);
      test.eq('13', dayfield.value);
      test.eq('05', monthfield.value);
      test.eq('2011', yearfield.value);
    }

  , "Test keyboard for time field"
  , async function()
    {
      var changeevents = 0;
      var inputevents = 0;

      test.qS("[name=time]").value = '15:30';
      test.qS("[name=time]").addEventListener("change", () => ++changeevents);
      test.qS("[name=time]").addEventListener("input", () => ++inputevents);

      test.focus('#datetimeform-show_fields');
      await test.pressKey('Tab');
      await test.pressKey('Tab');
      await test.pressKey('Tab');
      await test.pressKey('Tab');

      test.eq(0, changeevents);
      test.eq(0, inputevents);

      await test.pressKey('2');
      test.eq(1, changeevents);
      test.eq(1, inputevents);
      test.eq('02:30', test.qS("[name=time]").value);

      await test.pressKey('3');

      test.eq(2, changeevents);
      test.eq(2, inputevents);
      test.eq('23:30', test.qS("[name=time]").value);

      let hourfield = test.qSA("[data-wh-form-group-for=time] input")[1];
      let minutefield = test.qSA("[data-wh-form-group-for=time] input")[2];

      //focus should have moved to the minute field
      test.eq(minutefield, test.getDoc().activeElement);
      test.eq('23', hourfield.value);

      test.click(hourfield);
      await test.pressKey(':');
      test.eq(minutefield, test.getDoc().activeElement);
      test.eq('23', hourfield.value);

      test.focus(hourfield);
      await test.pressKey('.');
      test.eq(minutefield, test.getDoc().activeElement);
      test.eq('23', hourfield.value);

      test.focus(hourfield);
      await test.pressKey('-');
      test.eq(hourfield, test.getDoc().activeElement);
      test.eq('23', hourfield.value);

      //backspace once should clear the month field (because we've selected it entirely)
      test.focus(minutefield);
      await test.pressKey('Backspace');
      test.eq('', minutefield.value);

      //backspace AGAIN should move to DAY field.. BUT set the cursor to the end
      await test.pressKey('Backspace');
      test.true(hourfield, test.getDoc().activeElement);
      test.eq('2', test.getDoc().activeElement.value);

      // TODO add suport for pasting time
      // test.getDoc().activeElement.value = '13-5-2011';
      // dompack.dispatchDomEvent(test.getDoc().activeElement, 'input');
      // test.eq('2011-05-13', test.qS("[name=time]").value);
    }

  , "Test direct value changing"
  , async function()
    {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?datetime=1&splitdatetime=1');
       __setUnderlyingValue(test.qS("#datetimeform-dateofbirth"),"2012-11-13");
      dompack.dispatchDomEvent(test.qS("#datetimeform-dateofbirth"), 'change');

      test.eq('13',test.qSA("[data-wh-form-group-for=dateofbirth] input")[1].value);
      test.eq('11',test.qSA("[data-wh-form-group-for=dateofbirth] input")[2].value);
      test.eq('2012',test.qSA("[data-wh-form-group-for=dateofbirth] input")[3].value);

       __setUnderlyingValue(test.qS("#datetimeform-time"),"15:30");
      dompack.dispatchDomEvent(test.qS("#datetimeform-time"), 'change');

      test.eq('15', test.qSA("[data-wh-form-group-for=time] input")[1].value);
      test.eq('30', test.qSA("[data-wh-form-group-for=time] input")[2].value);
    }

  , "Test api"
  , async function()
    {
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?datetime=1&splitdatetime=1');
      dompack.changeValue(test.qS("#datetimeform-dateofbirth"),"1979-06-13");

      var changeevents = 0;
      test.qS("[name=dateofbirth]").addEventListener("change", () => ++changeevents);

      test.click('[name=dateofbirth] + * .datetime__togglepicker');
      test.eq(1, test.qSA('.datetime__picker').length);

      test.qS('[name=dateofbirth]').formtestDateHandler.closePicker();
      test.eq(0, test.qSA('.datetime__picker').length);

      test.qS('[name=dateofbirth]').formtestDateHandler.closePicker(); //double invocation should be fine
      test.eq(0, test.qSA('.datetime__picker').length);
      test.eq(0, changeevents);
      test.eq('1979-06-13', test.qS("#datetimeform-dateofbirth").value);
    }
  ]);
