/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from "@mod-tollium/js/testframework";

function getTheKnob() {
  return test.compByName("componentpanel").querySelector(".wh-slider-knob");
}

async function moveTheKnob(percentage) {
  const knob = getTheKnob();
  const sliderlength = test.compByName("componentpanel").querySelector(".wh-slider").getBoundingClientRect().width;
  test.sendMouseGesture([
    { el: knob, down: 0 },
    { relx: sliderlength * percentage, delay: 300, transition: test.dragTransition },
    { up: 0 }
  ]);
  await test.wait('pointer');
  await test.waitForUI();
}

test.runTests(
  [
    {
      loadpage: test.getCompTestPage('slider'),
      waits: ['ui']
    },
    async function () {
      // This was fixed at 200px, should have been set through component width
      const sliderlength = test.compByName("componentpanel").querySelector(".wh-slider-holder").getBoundingClientRect().width;
      test.eq(500, sliderlength);

      let knob = getTheKnob();
      test.eq("0", knob.textContent);
      await moveTheKnob(.5);

      knob = getTheKnob();
      test.eq("50", knob.textContent);
    },
    "Test enabled",
    async function () {
      test.click(test.compByName('enable'));
      await test.waitForUI();

      let knob = getTheKnob();
      test.eq("50", knob.textContent);
      //don't try to move the knob, we're not testing CSS implementations here
      test.eq('none', getComputedStyle(knob).pointerEvents);

      test.click(test.compByName('enable'));
      await test.waitForUI();

      await moveTheKnob(.2);
      knob = getTheKnob();
      test.eq("70", knob.textContent);
    }
  ]);
