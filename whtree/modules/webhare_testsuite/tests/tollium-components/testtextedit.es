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

  , "Test min/max-length, counter"
  , async function()
    {
      await test.load(test.getCompTestPage('textedit', { validationchecks: ['url-plus-relative']} ));
      await test.wait("ui");

      let textedit_comp = test.compByName("componentpanel");
      let textedit = textedit_comp.querySelector("input");

      console.log(test.compByTitle("minlength"));

      test.fill(test.compByTitle("minlength").querySelector("input"), "4");
      test.click(test.compByTitle("showcounter").querySelector("label"));
      test.fill(test.compByTitle("lengthmeasure"), "characters");
      await test.wait("ui");

      textedit_comp = test.compByName("componentpanel");
      textedit = textedit_comp.querySelector("input");
      let counter = textedit_comp.querySelector(".wh-counter");

      test.fill(textedit,"1");
      await test.wait("ui");
      test.focus(textedit);
      test.true(counter.classList.contains("wh-counter--haveminvalue"));
      test.true(counter.classList.contains("wh-counter--underflow"));

      test.fill(textedit,"1234");
      await test.wait("ui");

      test.false(counter.classList.contains("wh-counter--underflow"));

      // empty is not an error wrd minlength is set but not required
      test.fill(textedit,"");
      await test.wait("ui");
      test.false(counter.classList.contains("wh-counter--underflow"));

      test.click(test.compByTitle("Required").querySelector("label"));
      await test.wait("events", "ui");

      textedit_comp = test.compByName("componentpanel");
      textedit = textedit_comp.querySelector("input");
      counter = textedit_comp.querySelector(".wh-counter");

      test.true(counter.classList.contains("wh-counter--underflow"));
      test.eq("0/4+", counter.textContent);
      test.fill(textedit,"123");
      test.eq("3/4+", counter.textContent);

      test.fill(test.compByTitle("maxlength").querySelector("input"), "6");
      await test.wait("events");
      test.clickTolliumButton("Read"); //force immediate state transfer
      await test.wait("ui");

      textedit_comp = test.compByName("componentpanel");
      textedit = textedit_comp.querySelector("input");
      counter = textedit_comp.querySelector(".wh-counter");

      test.eq("3/4 - 6", counter.textContent);

      test.fill(textedit,"");
      test.eq("0/4 - 6", counter.textContent);
      test.true(counter.classList.contains("wh-counter--underflow"));

      test.fill(test.compByTitle("minlength").querySelector("input"), "-1");
      test.clickTolliumButton("Read"); //force immediate state transfer
      await test.wait("ui");

      textedit_comp = test.compByName("componentpanel");
      textedit = textedit_comp.querySelector("input");
      counter = textedit_comp.querySelector(".wh-counter");

      test.eq("0/6", counter.textContent);
    }
  ]);
