import * as test from '@mod-tollium/js/testframework';
import { qSA } from 'dompack';

test.registerTests(
  [ "load component test page"
  , async function()
    {
      await test.load(test.getCompTestPage("imgedit", { width: "250px"
                                                      , height: "250px"
                                                      , imgsize: {setwidth:600, setheight:150, method: "fill", allowedactions: ["crop","refpoint"]}
                                                      }, "sht"));
      await test.wait("ui")

    }

  , "upload image"
  , async function()
    {
      let uploadpromise = test.prepareUpload(
          [ { url: "/tollium_todd.res/webhare_testsuite/tests/rangetestfile.jpg"
            , filename: "imgeditfile.jpeg"
            }
          ]);

      test.click(test.compByName("fragment1!uploadbutton"));
      await uploadpromise;
      await test.wait("ui");

      //editor will auto open
    }

  , "refpoint procedure"
  , async function()
    {
      let refpoint = test.qSA("t-custom[data-name='imageeditor'] .wh-toolbar-button")
                         .filter(button => button.textContent.includes('Reference Point'))[0];
      test.click(refpoint);
      test.false(test.qS(".wh-refbox-pointer"), 'no pointer yet...');
      test.click('.wh-image-surface', { x:346, y:17}); //top visible part of the picture

      let pointer = test.qS(".wh-refbox-pointer");
      test.true(pointer, 'refbox pointer should be there');
      test.clickTolliumButton("OK");

    }
  ]);
