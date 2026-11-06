import * as test from "@mod-tollium/js/testframework";
import * as tt from "@mod-webhare_testsuite/js/tolliumtest-wts";

function getSVGComp() {
  return test.compByName("svg");
}

function getWrapper() {
  return test.qR(getSVGComp(), ".wrapper");
}

function getLog() {
  return test.qR<HTMLTextAreaElement>(test.compByName("log"), "textarea").value;
}

test.runTests(
  [
    "Load",
    async function () {
      await tt.loadWTSTestScreen("tests/basecomponents.svgtest");

      const comp = getSVGComp();
      test.eq("T-SVG", comp.tagName);
      test.assert(comp.classList.contains("clickable"), "Should be clickable, it has both an action and an onclick");
      test.eq("0.75", getComputedStyle(getWrapper()).opacity);

      const box = test.qR(comp, "svg #box");
      test.eq("rgb(255, 0, 0)", getComputedStyle(box).fill, "--fill should have been set by the screen's Init");
    },

    "Tollium CSS variables",
    async function () {
      // Resolve the expected color through a reference element in the document, so we don't depend on the theme's actual value
      const doc = getSVGComp().ownerDocument;
      test.assert(getComputedStyle(doc.documentElement).getPropertyValue("--tollium-color-accent"), "--tollium-color-accent should be defined");
      const reference = doc.createElement("div");
      reference.style.color = "var(--tollium-color-accent)";
      doc.body.append(reference);
      const expectColor = getComputedStyle(reference).color;
      reference.remove();

      const accent = test.qR(getSVGRoot(), "svg #accent");
      test.eq(expectColor, getComputedStyle(accent).fill, "Tollium's CSS variables should be available within the SVG");
    },

    "Click with action and onclick",
    async function () {
      test.click(test.qR(getSVGComp(), "#box"));
      await test.waitForUI();
      test.eq(/^action\nclick box \d+ \d+$/, getLog());
    },

    "Update CSS variables",
    async function () {
      test.click(test.getMenu(["S01"]));
      await test.waitForUI();
      test.eq("rgb(0, 0, 255)", getComputedStyle(test.qR(getSVGComp(), "#box")).fill);
    },

    "Update source",
    async function () {
      test.click(test.getMenu(["S02"]));
      await test.waitForUI();

      const comp = getSVGComp();
      test.assert(!comp.querySelector("#box"), "The old SVG should have been replaced");
      const dot = test.qR(comp, "svg #dot");
      test.eq("rgb(0, 0, 255)", getComputedStyle(dot).fill, "CSS variables should be kept when the source changes");
      test.eq("0.75", getComputedStyle(getWrapper()).opacity, "Opacity should be kept when the source changes");
    },

    "Update opacity",
    async function () {
      test.click(test.getMenu(["S03"]));
      await test.waitForUI();

      test.eq("0.5", getComputedStyle(getWrapper()).opacity);
      test.assert(getSVGComp().querySelector("svg #dot"), "The SVG should be kept when the opacity changes");
    },

    "Click with only onclick",
    async function () {
      test.click(test.getMenu(["S04"]));
      await test.waitForUI();
      test.assert(getSVGComp().classList.contains("clickable"), "Should still be clickable, it has an onclick");

      test.click(test.qR(getSVGComp(), "#dot"));
      await test.waitForUI();
      test.eq(/^action\nclick box \d+ \d+\nclick dot \d+ \d+$/, getLog());
    },

    "Not clickable without action and onclick",
    async function () {
      test.click(test.getMenu(["S05"]));
      await test.waitForUI();
      test.assert(!getSVGComp().classList.contains("clickable"));

      test.click(test.qR(getSVGComp(), "#dot"));
      await test.waitForUI();
      test.eq(/^action\nclick box \d+ \d+\nclick dot \d+ \d+$/, getLog(), "Clicking should not have logged anything");
    }
  ]);
