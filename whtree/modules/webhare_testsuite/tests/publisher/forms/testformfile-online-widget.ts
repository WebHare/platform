import * as test from '@webhare/test-frontend';
import { getPxlLogLines } from '@webhare/test-frontend';

test.runTests(
  [
    async function () {
      const js = test.getTestSiteRoot().endsWith("testsitejs/");//FIXME more reliable js test - get site name or test params?
      const setupdata = await test.invoke('mod::webhare_testsuite/lib/internal/testsite.whlib#BuildWebtoolForm', { iswidget: true, js });
      await test.load(setupdata.url, { urlParams: { gtmFormEvents: "publisher:form" } });

      const directref = test.getDoc().documentElement.dataset.whOb; //test thet element used by pxl
      test.assert(directref);
      test.eq('formholder', (await test.describeObjRef(directref)).name);

      if (js) { //FIXME we need JS rendering for this page!
        test.assert(!test.qSA('input[type=text]')[0]);
      } else {
        test.fill(test.qSA('input[type=text]')[0], 'Joe');

        const events = (await test.wait(getPxlLogLines, { test: lines => lines.length >= 1 })).filter(l => l.event === "platform:form_started");
        test.eq(setupdata.formholder_objref, events[0].objref);
        test.eq(setupdata.formfile_objref, events[0].mod_platform.formmeta_objref);

        test.eq('formholder', (await test.describeObjRef(events[0].objref)).name);
        test.eq('form', (await test.describeObjRef(events[0].mod_platform.formmeta_objref as string)).name);
      }
    }
  ]);
