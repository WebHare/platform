/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from "@mod-tollium/js/testframework";


test.registerTests(
  [
    "Test rendering",
    async function () {
      await test.load(test.getCompTestPage('textedit'));
      await test.wait("ui");

      const textedit = test.compByName("componentpanel").querySelector("input");
      test.eq("the-placeholder", textedit.getAttribute("placeholder"));
      test.eq("organization-title", textedit.getAttribute("autocomplete"));

      // make sure the subbuttons are visible
      const ttextedit = textedit.closest("t-textedit");
      const tbutton = ttextedit.querySelector("button");
      test.assert(tbutton);
    },

    "Test inline autocorrection", //#522
    async function () {
      await test.load(test.getCompTestPage('textedit', { validationchecks: ['url-plus-relative'] }));
      await test.wait("ui");

      const textedit = test.compByName("componentpanel").querySelector("input");
      test.fill(textedit, "arnold@example.net");
      await test.pressKey('Tab'); //moves to tagedit
      test.eq("mailto:arnold@example.net", textedit.value);

      test.fill(textedit, "mailto: arnold@example.net");
      await test.pressKey('Tab'); //moves to tagedit
      test.eq("mailto:arnold@example.net", textedit.value);
    },

    "Test min/max-length, counter",
    async function () {
      await test.load(test.getCompTestPage('textedit', { validationchecks: ['url-plus-relative'] }));
      await test.wait("ui");

      let textedit_comp = test.compByName("componentpanel");
      let textedit = textedit_comp.querySelector("input");

      console.log(test.compByTitle("minlength"));

      test.fill(test.compByTitle("minlength").querySelector("input"), "4");
      test.click(test.compByTitle("showcounter"));
      test.fill(test.compByTitle("lengthmeasure"), "characters");
      await test.wait("ui");

      textedit_comp = test.compByName("componentpanel");
      textedit = textedit_comp.querySelector("input");
      let counter = textedit_comp.querySelector(".wh-counter");

      test.fill(textedit, "1");
      await test.wait("ui");
      test.focus(textedit);
      test.assert(counter.classList.contains("wh-counter--haveminvalue"));
      test.assert(counter.classList.contains("wh-counter--underflow"));

      test.fill(textedit, "1234");
      await test.wait("ui");

      test.assert(!counter.classList.contains("wh-counter--underflow"));

      // empty is not an error wrd minlength is set but not required
      test.fill(textedit, "");
      await test.wait("ui");
      test.assert(!counter.classList.contains("wh-counter--underflow"));

      test.click(test.compByTitle("Required"));
      await test.wait("events");
      await test.wait("ui");

      textedit_comp = test.compByName("componentpanel");
      textedit = textedit_comp.querySelector("input");
      counter = textedit_comp.querySelector(".wh-counter");

      test.assert(counter.classList.contains("wh-counter--underflow"));
      test.eq("0/4+", counter.textContent);
      test.fill(textedit, "123");
      test.eq("3/4+", counter.textContent);

      test.fill(test.compByTitle("maxlength").querySelector("input"), "6");
      await test.wait("events");
      test.clickTolliumButton("Read"); //force immediate state transfer
      await test.wait("ui");

      textedit_comp = test.compByName("componentpanel");
      textedit = textedit_comp.querySelector("input");
      counter = textedit_comp.querySelector(".wh-counter");

      test.eq("3/4 - 6", counter.textContent);

      test.fill(textedit, "");
      test.eq("0/4 - 6", counter.textContent);
      test.assert(counter.classList.contains("wh-counter--underflow"));

      test.fill(test.compByTitle("minlength").querySelector("input"), "-1");
      test.clickTolliumButton("Read"); //force immediate state transfer
      await test.wait("ui");

      textedit_comp = test.compByName("componentpanel");
      textedit = textedit_comp.querySelector("input");
      counter = textedit_comp.querySelector(".wh-counter");

      test.eq("0/6", counter.textContent);
    },

    "Required/HideRequiredIfDisabled",
    async function () {
      //we start at Enabled,Required,HideRequiredIfDisabled all true
      test.eq('rgb(252, 248, 208)', getComputedStyle(test.compByName("componentpanel").querySelector("input")).backgroundColor);
      test.eq("none", getComputedStyle(test.compByName("componentpanel").querySelector("input")).backgroundImage);

      //required + disabled REMOVES the background color (but SETS the disabled pattern)
      test.fill(test.compByTitle("Enabled"), false);
      await test.wait("ui");
      test.eq('rgba(0, 0, 0, 0)', getComputedStyle(test.compByName("componentpanel").querySelector("input")).backgroundColor);
      test.eq(/^url/, getComputedStyle(test.compByName("componentpanel").querySelector("input")).backgroundImage);

      //Disabling HideRequiredIfDisabled re-enables the yellow background AND sets the disabled pattern
      test.fill(test.compByTitle("HideRequiredIfDisabled"), false);
      await test.wait("ui");
      test.eq('rgb(252, 248, 208)', getComputedStyle(test.compByName("componentpanel").querySelector("input")).backgroundColor);
      test.eq(/^url/, getComputedStyle(test.compByName("componentpanel").querySelector("input")).backgroundImage);

      //But not if it's not actually required
      test.fill(test.compByTitle("Required"), false);
      await test.wait("ui");
      test.eq('rgba(0, 0, 0, 0)', getComputedStyle(test.compByName("componentpanel").querySelector("input")).backgroundColor);
      test.eq(/^url/, getComputedStyle(test.compByName("componentpanel").querySelector("input")).backgroundImage);

      //Enable and Require the field again - should see the background color but NOT the pattern
      test.fill(test.compByTitle("Enabled"), true);
      await test.wait("ui");
      test.fill(test.compByTitle("Required"), true);
      await test.wait("ui");
      test.eq('rgb(252, 248, 208)', getComputedStyle(test.compByName("componentpanel").querySelector("input")).backgroundColor);
      test.eq("none", getComputedStyle(test.compByName("componentpanel").querySelector("input")).backgroundImage);
    },

    "Test read/write selection",
    async function () {
      await test.load(test.getCompTestPage('textedit'));
      await test.wait("ui");

      const textedit = test.compByName("componentpanel").querySelector("input");
      textedit.value = "aap noot mies";
      textedit.setSelectionRange(4, 8); // select the 4th up until the 8th character, i.e. "noot"

      test.eq(0, parseInt(test.compByName("onselectcount").textContent));
      test.click(test.compByName("readselectionbutton"));
      await test.wait("ui");
      test.eq(1, parseInt(test.compByName("onselectcount").textContent));

      const selection = test.compByName("selection").querySelector("input");
      test.eq(JSON.stringify("noot"), selection.value); // selection is presented as a JSON stringified value

      // update the selected text
      selection.value = JSON.stringify("wim");
      test.click(test.compByName("writeselectionbutton"));
      await test.wait(() => parseInt(test.compByName("onselectcount").textContent) === 2);
      test.eq("aap wim mies", textedit.value);
      // the replaced text should be selected
      test.eq(4, textedit.selectionStart);
      test.eq(7, textedit.selectionEnd);
    },
  ]);
