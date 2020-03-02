import * as test from '@mod-system/js/wh/testframework';
import FormBase from '@mod-publisher/js/forms/formbase';
import { $qS, $qSA } from '@mod-system/js/wh/testframework';
import * as dompack from 'dompack';

test.registerTests(
  [ { loadpage: test.getTestSiteRoot() + 'testpages/formtest/?dynamic=1'
    }

  , { name: 'Study page fields'
    , test: async function()
      {
        let form = $qS('#dynamicform');
        let extra_textfield = form.elements.textfield;
        test.eq('beagle', form.dataset.bob);
        test.true(extra_textfield);
        test.eq('val 1', extra_textfield.value);
        $qS('*[id="dynamictest-timeslot-20120505T170000Z"]').click();
        test.true(form.elements.mycheckbox.checked);
        $qS('#dynamictest-myradio-42').click();
        $qS('*[id="dynamictest-timeslot-20120505T210000.005Z"]').click();
        dompack.changeValue(form.elements.addendum42,'Fourty-two');
        test.eq("number", test.qS("#dynamictest-myint").getAttribute("type"));

        //submit it
        test.click($qS('#submitbutton'));
      }
    , waits:['ui']
    }
  , { test: function()
      {
        let serverreponse = JSON.parse($qS('#dynamicformsubmitresponse').textContent);
        test.eq(42, serverreponse.form.myradio);
        test.true(serverreponse.form.mycheckbox);
        test.eq('Fourty-two', serverreponse.form.addendum42);
        test.eq('2012-05-05T21:00:00.005Z', serverreponse.form.timeslot);
      }
    }
  ]);
