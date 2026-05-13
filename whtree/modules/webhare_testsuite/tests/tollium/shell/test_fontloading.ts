import * as test from '@mod-tollium/js/testframework';
import * as tt from "@mod-webhare_testsuite/js/tolliumtest-wts";

const fontFaceKeys = [
  "ascentOverride",
  "descentOverride",
  "display",
  "family",
  "featureSettings",
  "lineGapOverride",
  "loaded",
  "stretch",
  "style",
  "unicodeRange",
  "weight",
] as const;

function getFontDescription(font: FontFace): string {
  const props: Record<typeof fontFaceKeys[number], unknown> = {} as any;
  for (const key of fontFaceKeys) {
    props[key] = font[key];
  }
  return JSON.stringify(props);
}

async function checkLoadedFonts(preloadedFonts: string[]) {
  await test.getDoc().fonts.ready;
  const loadedFonts = test.getDoc().fonts.values().filter(f => f.status === "loaded").map(f => getFontDescription(f)).toArray();
  const extra = loadedFonts.filter(f => !preloadedFonts.includes(f));
  test.eq([], extra, "Not all fonts needed by the page were preloaded");
}

test.runTests(
  [
    async function () {
      console.log("Loading tollium shell");
      await test.load(test.getTolliumHost(), { waitUI: false });

      console.log(`loaded, fonts:`, test.getDoc().fonts.values().toArray());
      console.log(test.getDoc(), test.getDoc().readyState);

      if (test.getDoc().readyState !== "complete" && test.getDoc().readyState !== "interactive")
        await new Promise(resolve => test.getDoc().addEventListener("DOMContentLoaded", resolve));

      const preloadedFonts = test.getDoc().fonts.values().filter(f => f.status === "loaded").map(f => getFontDescription(f)).toArray();

      // Load a lot of other comonent pages
      await test.load(test.getCompTestPage('labels', { rowkeytype: 34, icons: ["tollium:actions/center"] })); // TypeID(STRING) = 34
      await checkLoadedFonts(preloadedFonts);

      await tt.loadWTSTestScreen("tests/basecomponents.arrayedittest");
      await checkLoadedFonts(preloadedFonts);

      await test.load(test.getCompTestPage('tagedit'));
      await checkLoadedFonts(preloadedFonts);

      await test.load(test.getCompTestPage("imgedit", {
        width: "250px",
        height: "250px",
        imgsize: { setwidth: 600, setheight: 150, method: "fill", allowedactions: ["crop", "refpoint"] }
      }));
      await checkLoadedFonts(preloadedFonts);

      await tt.loadWTSTestScreen("tests/basecomponents.formtest");
      await checkLoadedFonts(preloadedFonts);

      await tt.loadWTSTestScreen("tests/lists.hscroll");
      await checkLoadedFonts(preloadedFonts);
    }
  ]);
