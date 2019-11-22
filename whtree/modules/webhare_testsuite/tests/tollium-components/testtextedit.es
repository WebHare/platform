import * as test from "@mod-tollium/js/testframework";
import * as dompack from 'dompack';


test.registerTests(
  [ "Test rendering"
  , async function()
    {
      await test.load(test.getCompTestPage('textedit'));
      await test.wait("ui");

      let textedit = test.compByName("componentpanel").querySelector("input");
      test.eq("the-placeholder", textedit.getAttribute("placeholder"));
      test.eq("organization-title", textedit.getAttribute("autocomplete"));

      // make sure the subbuttons are visible
      let ttextedit = dompack.closest(textedit, "t-textedit");
      let tbutton = ttextedit.querySelector("t-button");
      test.true(tbutton);
    }

  , "Test inline autocorrection" //#522
  , async function()
    {
      await test.load(test.getCompTestPage('textedit', { validationchecks: ['url-plus-relative']} ));
      await test.wait("ui");

      let textedit = test.compByName("componentpanel").querySelector("input");
      test.fill(textedit,"arnold@example.net");
      await test.pressKey('Tab'); //moves to tagedit
      test.eq("mailto:arnold@example.net", textedit.value);

      test.fill(textedit,"mailto: arnold@example.net");
      await test.pressKey('Tab'); //moves to tagedit
      test.eq("mailto:arnold@example.net", textedit.value);
    }

  ]);
