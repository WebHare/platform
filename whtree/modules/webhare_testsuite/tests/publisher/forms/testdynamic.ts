import * as test from '@mod-system/js/wh/testframework';
import { getFormData } from '@webhare/forms';
import * as dompack from 'dompack';

interface DynamicFormShape {
  addendum42: string;
  day: number;
  timeslot: Date;
  mycheckbox: boolean;
  myint: number;
  myradio: string;
  textfield: string;
}

test.registerTests(
  [
    async function () {
      await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#SnoozeRateLimits');
      await test.load(test.getTestSiteRoot() + 'testpages/formtest/?dynamic=1');
    },

    {
      name: 'Study page fields',
      test: async function () {
        const form = test.qR<HTMLFormElement>('#dynamicform');
        const extra_textfield = form.elements.namedItem("textfield");
        test.eq('beagle', form.dataset.bob);
        test.assert(extra_textfield);
        test.eq('val 1', (extra_textfield as HTMLInputElement).value);
        test.click('*[id="dynamictest-timeslot-2012-05-05T17:00:00.000Z"]');
        test.assert((form.elements.namedItem("mycheckbox") as HTMLInputElement)?.checked);
        test.click('#dynamictest-myradio-42');
        test.click('*[id="dynamictest-timeslot-2012-05-05T21:00:00.005Z"]');
        dompack.changeValue(form.elements.namedItem("addendum42")! as HTMLInputElement, 'Fourty-two');
        test.eq("number", test.qR("#dynamictest-myint").getAttribute("type"));

        const data = getFormData<DynamicFormShape>(form);
        test.eq({
          "day": 1,
          "textfield": "val 1",
          "myradio": "42",
          "addendum42": "Fourty-two",
          "myint": NaN,
          "mycheckbox": true,
          timeslot: new Date("2012-05-05T21:00:00.005Z")
        }, data);

        //submit it
        test.click('#submitbutton');
      },
      waits: ['ui']
    },
    {
      test: function () {
        const serverreponse = JSON.parse(test.qR('#dynamicformsubmitresponse').textContent!);
        test.eq(42, serverreponse.form.myradio);
        test.assert(serverreponse.form.mycheckbox);
        test.eq('Fourty-two', serverreponse.form.addendum42);
        test.eq('2012-05-05T21:00:00.005Z', serverreponse.form.timeslot);
      }
    }
  ]);
