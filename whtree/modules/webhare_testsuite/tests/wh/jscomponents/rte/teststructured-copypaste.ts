/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from "@mod-tollium/js/testframework";
import * as rtetest from "@mod-tollium/js/testframework-rte";

test.runTests(
  [
    {
      loadpage: '/.webhare_testsuite/tests/pages/rte/?editor=structured'
    },
    {
      name: "simulate paste",
      test: async function (doc, win) {
        const rte = win.rte.getEditor();
        const body = rte.getBody();
        body.focus();

        test.subtest("chrome/ff/edge html paste");

        // replace 'Kop', the chrome/safari/edge way
        rtetest.setRTESelection(win, rte, { startContainer: body, startOffset: 0, endContainer: body, endOffset: 1 });
        await test.wait("events");
        await test.sleep(10);

        await rtetest.runWithUndo(rte, () => rtetest.paste(rte,
          {
            typesdata: { "text/html": "<span>paste_1<span>" },
            files: [],
            items: []
          }), { waits: 'ui' });

        test.eq("paste_1", body.firstElementChild.textContent);

        // Safari paste doesn't give a 'text/html' type, so test the fallback handler using browser paste
        test.subtest("safari html paste");

        // replace 'Kop'
        rtetest.setRTESelection(win, rte, { startContainer: body, startOffset: 0, endContainer: body, endOffset: 1 });
        await test.wait("events");

        await rtetest.runWithUndo(rte, () => rtetest.paste(rte,
          {
            typesdata: { "text/plain": "paste_2" },
            files: [],
            items: []
          }), { waits: 'ui' });

        test.eq("paste_2", body.firstElementChild.textContent);
      }
    },
    "Empty paragraph handling",
    async function () {
      const rte = test.getWin().rte.getEditor();
      rtetest.setStructuredContent(test.getWin(),
        `<p class="normal">(*0*)(*1*)<br data-wh-rte="bogus"></p>` +
        `<p class="normal">"a"</p>`);

      await rtetest.runWithUndo(rte, () => rtetest.paste(rte,
        {
          typesdata: { "text/html": `<meta charset='utf-8'><p class="normal" style="box-sizing: border-box; padding: 0px; margin: 0px; font-weight: 400; color: rgb(0, 0, 0); font-family: Arial, sans-serif; font-size: 13.3333px; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; letter-spacing: normal; orphans: 2; text-align: -webkit-left; text-indent: 0px; text-transform: none; white-space: normal; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; background-color: rgb(255, 255, 255); text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial;"><br class="Apple-interchange-newline"><br data-wh-rte="bogus" style="box-sizing: border-box;"></p><br class="Apple-interchange-newline">` },
          files: [],
          items: []
        }), { waits: 1 });

      rtetest.testEqSelHTMLEx(test.getWin(),
        `<p class="normal"><br data-wh-rte="bogus"></p>` +
        `<p class="normal">"(*0*)(*1*)a"</p>`);

      rtetest.setStructuredContent(test.getWin(),
        `<p class="normal">(*0*)(*1*)<br data-wh-rte="bogus"></p>` +
        `<p class="normal">"a"</p>`);

      await rtetest.runWithUndo(rte, () => rtetest.paste(rte,
        {
          typesdata: { "text/html": `<meta charset="utf-8"><p class="normal" style="box-sizing: border-box; padding: 0px; margin: 0px; font-weight: 400; color: rgb(0, 0, 0); font-family: Arial, sans-serif; font-size: 13.3333px; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; letter-spacing: normal; orphans: 2; text-align: -webkit-left; text-indent: 0px; text-transform: none; white-space: normal; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; background-color: rgb(255, 255, 255); text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial;">1</p><p class="normal" style="box-sizing: border-box; padding: 0px; margin: 0px; font-weight: 400; color: rgb(0, 0, 0); font-family: Arial, sans-serif; font-size: 13.3333px; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; letter-spacing: normal; orphans: 2; text-align: -webkit-left; text-indent: 0px; text-transform: none; white-space: normal; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; background-color: rgb(255, 255, 255); text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial;"><br data-wh-rte="bogus" style="box-sizing: border-box;"></p><p class="normal" style="box-sizing: border-box; padding: 0px; margin: 0px; font-weight: 400; color: rgb(0, 0, 0); font-family: Arial, sans-serif; font-size: 13.3333px; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; letter-spacing: normal; orphans: 2; text-align: -webkit-left; text-indent: 0px; text-transform: none; white-space: normal; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; background-color: rgb(255, 255, 255); text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial;">2</p><br class="Apple-interchange-newline">` },
          files: [],
          items: []
        }), { waits: 1 });

      rtetest.testEqSelHTMLEx(test.getWin(),
        `<p class="normal">"1"</p>` +
        `<p class="normal"><br data-wh-rte="bogus"></p>` +
        `<p class="normal">"2(*0*)(*1*)"</p>` +
        `<p class="normal">"a"</p>`);
    },
    "Paste in list",
    async function () {
      const rte = test.getWin().rte.getEditor();
      const body = rte.getBody();
      body.focus();

      // Paste at empty li at end of list
      {
        rtetest.setStructuredContent(test.getWin(),
          `<p class="normal">"1"</p><ul class="unordered"><li>"a"</li><li>"(*0*)(*1*)"<br data-wh-rte="bogus"></li>`);

        await rtetest.runWithUndo(rte, () => rtetest.paste(rte,
          {
            typesdata: { "text/html": `<p class="normal">aaa</p><br class="Apple-interchange-newline">` },
            files: [],
            items: []
          }), { waits: 1 });

        rtetest.testEqSelHTMLEx(test.getWin(),
          `<p class="normal">"1"</p><ul class="unordered"><li>"a"</li><li>"aaa(*0*)(*1*)"</li>`);
      }

      // Paste at empty li inside of list
      {
        rtetest.setStructuredContent(test.getWin(),
          `<p class="normal">"1"</p><ul class="unordered"><li>"a"</li><li>"(*0*)(*1*)"<br data-wh-rte="bogus"></li><li>"bbb"</li>`);

        await rtetest.runWithUndo(rte, () => rtetest.paste(rte,
          {
            typesdata: { "text/html": `<p class="normal">aaa</p><p><br></p>` },
            files: [],
            items: []
          }), { waits: 1 });
        rtetest.testEqSelHTMLEx(test.getWin(),
          `<p class="normal">"1"</p><ul class="unordered"><li>"a"</li><li>"aaa"<br data-wh-rte="bogus"></li><li>(*0*)(*1*)<br data-wh-rte="bogus"></li><li>"bbb"</li></ul>`);
      }
    },
    "Paste lists",
    async function () {
      await test.load('/.webhare_testsuite/tests/pages/rte/?editor=structured-all-links');
      const rte = test.getWin().rte.getEditor();
      const body = rte.getBody();
      body.focus();

      // Paste a list full of hyperlinks
      {
        rtetest.setStructuredContent(test.getWin(),
          `<p class="normal">(*0*)(*1*)<br data-wh-rte="bogus"></p>`);

        await rtetest.runWithUndo(rte, () => rtetest.paste(rte,
          {
            typesdata: { "text/html": `<ul><li><a href="https://www.example.nl">Studentenstatuut</a><ul class="unordered"><li>test</li></ul></li></ul>` },
            files: [],
            items: []
          }), { waits: 1 });

        rtetest.testEqSelHTMLEx(test.getWin(),
          `<ul class="unordered"><li><a href="https://www.example.nl">"Studentenstatuut"</a><ul class="unordered"><li>"test(*0*)(*1*)"</li></ul></li></ul>`);
      }
    }
  ]);
