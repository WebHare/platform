/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from "@mod-tollium/js/testframework";
import * as dompack from 'dompack';


test.runTests(
  [
    {
      loadpage: test.getCompTestPage('textarea'),
      waits: ['ui']
    },

    {
      test: function (doc, win) {
        const holder = test.compByName("componentpanel");
        const textedits = holder.querySelectorAll("textarea");
        test.eq(1, textedits.length); //make sure we've got the right(only) one
        test.eq("the-placeholder", textedits[0].getAttribute("placeholder"));
      }
    },

    async function defaultbutton_pulldown(doc, win) {
      const alternatedefault = test.compByName('alternatedefault');
      const textedit_selection = test.compByName("selection");

      const testpanel = test.compByName("componentpanel");
      const node = testpanel.querySelector('textarea');

      test.click(textedit_selection.querySelector("input"));
      test.assert(!alternatedefault.classList.contains("default"));

      test.click(node);
      test.assert(alternatedefault.classList.contains("default"));
    },

    "Test min/max-length, counter", //TODO combine with testtextedit?  almost the same...
    async function () {
      let textedit_comp = test.compByName("componentpanel");
      let textedit = textedit_comp.querySelector("textarea");

      test.fill(test.compByTitle("minlength").querySelector("input"), "4");
      test.click(test.compByTitle("showcounter"));
      test.fill(test.compByTitle("lengthmeasure"), "characters");
      await test.wait("ui");

      textedit_comp = test.compByName("componentpanel");
      textedit = textedit_comp.querySelector("textarea");
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
      textedit = textedit_comp.querySelector("textarea");
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
      textedit = textedit_comp.querySelector("textarea");
      counter = textedit_comp.querySelector(".wh-counter");

      test.eq("3/4 - 6", counter.textContent);

      test.fill(textedit, "");
      test.eq("0/4 - 6", counter.textContent);
      test.assert(counter.classList.contains("wh-counter--underflow"));

      test.fill(test.compByTitle("minlength").querySelector("input"), "-1");
      test.clickTolliumButton("Read"); //force immediate state transfer
      await test.wait("ui");

      textedit_comp = test.compByName("componentpanel");
      textedit = textedit_comp.querySelector("textarea");
      counter = textedit_comp.querySelector(".wh-counter");

      test.eq("0/6", counter.textContent);
    },


    "Required/HideRequiredIfDisabled",
    async function () {
      //we start at Enabled,Required,HideRequiredIfDisabled all true
      test.eq('rgb(252, 248, 208)', getComputedStyle(test.compByName("componentpanel").querySelector("textarea")).backgroundColor);
      test.eq("none", getComputedStyle(test.compByName("componentpanel").querySelector("textarea")).backgroundImage);

      //required + disabled REMOVES the background color (but SETS the disabled pattern)
      test.fill(test.compByTitle("Enabled"), false);
      await test.wait("ui");
      test.eq('rgba(0, 0, 0, 0)', getComputedStyle(test.compByName("componentpanel").querySelector("textarea")).backgroundColor);
      test.eq(/^url/, getComputedStyle(test.compByName("componentpanel").querySelector("textarea")).backgroundImage);

      //Disabling HideRequiredIfDisabled re-enables the yellow background AND sets the disabled pattern
      test.fill(test.compByTitle("HideRequiredIfDisabled"), false);
      await test.wait("ui");
      test.eq('rgb(252, 248, 208)', getComputedStyle(test.compByName("componentpanel").querySelector("textarea")).backgroundColor);
      test.eq(/^url/, getComputedStyle(test.compByName("componentpanel").querySelector("textarea")).backgroundImage);

      //But not if it's not actually required
      test.fill(test.compByTitle("Required"), false);
      await test.wait("ui");
      test.eq('rgba(0, 0, 0, 0)', getComputedStyle(test.compByName("componentpanel").querySelector("textarea")).backgroundColor);
      test.eq(/^url/, getComputedStyle(test.compByName("componentpanel").querySelector("textarea")).backgroundImage);

      //Enable and Require the field again - should see the background color but NOT the pattern
      test.fill(test.compByTitle("Enabled"), true);
      await test.wait("ui");
      test.fill(test.compByTitle("Required"), true);
      await test.wait("ui");
      test.eq('rgb(252, 248, 208)', getComputedStyle(test.compByName("componentpanel").querySelector("textarea")).backgroundColor);
      test.eq("none", getComputedStyle(test.compByName("componentpanel").querySelector("textarea")).backgroundImage);
    }
  ]);
