import * as test from '@mod-tollium/js/testframework';

test.registerTests(
  [ "load component test page"
  , async function()
    {
      await test.load(test.getCompTestPage("imgedit", { width: "250px"
                                                      , height: "250px"
                                                      , imgsize: {setwidth:600, setheight:150, method: "fill", allowedactions: ["rotate"]}
                                                      }));
      await test.wait("ui");

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

  , "rotate procedure"
  , async function()
    {
      //analyze the image .. the first canvas holds it (the second canvas does the crop overlay)
      let firstcanvas = test.qS(".wh-image-surface canvas");
      test.eq(600, firstcanvas.width);
      test.eq(450, firstcanvas.height);

      let rotatebutton = test.qSA("t-custom[data-name='imageeditor'] .wh-toolbar-button").filter(button => button.textContent.includes('Rotate'))[0];
      test.click(rotatebutton);

      let rotateright = test.qSA("t-custom[data-name='imageeditor'] .wh-toolbar-button").filter(button => button.textContent.includes('Rotate 90° Right'))[0];
      test.click(rotateright);

      test.clickTolliumButton("OK");
      await test.wait('ui');

      firstcanvas = test.qS(".wh-image-surface canvas");
      test.eq(600, firstcanvas.width);
      test.eq(800, firstcanvas.height);

      test.clickTolliumButton("Save");
      await test.wait('ui');

      var dimensions = test.compByName('fragment1!dimensions');
      test.true(dimensions);
      test.eq("600X150", dimensions.textContent.replace(/[^0-9]/, "X"));
    }
  ]);
