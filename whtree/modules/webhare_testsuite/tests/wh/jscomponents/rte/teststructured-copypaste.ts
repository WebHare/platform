/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from "@mod-tollium/js/testframework";
import * as rtetest from "@mod-tollium/js/testframework-rte";

test.runTests(
  [
    'Load structured RTE page',
    async function () {
      await test.load('/.webhare_testsuite/tests/pages/rte/?editor=structured');
    },
    {
      name: "simulate paste",
      test: async function () {
        const win = test.getWin();
        const rte = win.rte.getEditor();
        const body = rte.getBody();
        body.focus();

        test.subtest("chrome/ff/edge html paste");

        // replace 'Kop', the chrome/safari/edge way
        rtetest.setRTESelection(win, rte, { startContainer: body, startOffset: 0, endContainer: body, endOffset: 1 });
        await test.sleep(1);
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
        await test.sleep(1);

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
    "Pasted HTML must stay inert",
    async function () {
      const win = test.getWin();
      const rte = win.rte.getEditor();
      rte.getBody().focus();

      test.subtest("event handlers in pasted HTML must not run");
      {
        //An image that fails to load without needing the network. Parsing it in the editor's document would fire its onerror
        const brokenimg = "data:image/png;base64,AAAA";
        win.__rtepastexss = false;

        rtetest.setStructuredContent(win, `<p class="normal">(*0*)(*1*)<br data-wh-rte="bogus"></p>`);
        await rtetest.paste(rte,
          {
            typesdata: { "text/html": `<p class="normal">before<img src="${brokenimg}" onerror="window.__rtepastexss = true">after</p>` },
            files: [],
            items: []
          });

        //Wait for an image we start loading after the paste to fail: the pasted image would have failed by then too
        await new Promise(resolve => {
          const probe = new win.Image;
          probe.onerror = resolve;
          probe.src = brokenimg;
        });
        await test.wait('ui'); //the paste tries to import the image, and removes it when that fails

        test.eq(false, win.__rtepastexss, "The onerror handler of a pasted image should never run");
        test.eq(null, rte.getBody().querySelector("[onerror]"));
        test.eq("beforeafter", rte.getBody().textContent);
      }

      test.subtest("only the body of a pasted document is used");
      {
        rtetest.setStructuredContent(win, `<p class="normal">(*0*)(*1*)<br data-wh-rte="bogus"></p>`);
        await rtetest.runWithUndo(rte, () => rtetest.paste(rte,
          {
            typesdata: { "text/html": `<html><head><title>pastetitle</title><style>p { color: red; }</style></head><body><p class="normal">pastebody</p></body></html>` },
            files: [],
            items: []
          }), { waits: 1 });

        rtetest.testEqSelHTMLEx(win, `<p class="normal">"pastebody(*0*)(*1*)"</p>`);
      }
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
    },
    "Copy test within styling nodes",
    async function () {
      await test.load('/.webhare_testsuite/tests/pages/rte/?editor=structured');

      // setup styled content with selection inside of it
      rtetest.setStructuredContent(test.getWin(),
        `<p class="normal"><a href="http://example.com"><i><b><u><strike><sup>"a(*0*)b(*1*)c"</sup></strike></u></b></i></a></p>`);

      const rte = test.getWin().rte.getEditor() as StructuredEditor;
      rte.getBody().focus();

      const transfer = await rtetest.copy(rte);

      // clear the document and paste the copied content back in
      rtetest.setStructuredContent(test.getWin(), `<p class="normal">"(*0*)(*1*)"<br data-wh-rte="bogus"></p>`);
      await rtetest.paste(rte, transfer);

      rtetest.testEqSelHTMLEx(test.getWin(),
        `<p class="normal"><a href="http://example.com"><i><b><u><strike><sup>"b(*0*)(*1*)"</sup></strike></u></b></i></a></p>`);
    },
    "Copy fragment links",
    async function () {
      await test.load('/.webhare_testsuite/tests/pages/rte/?editor=structured');

      const rte = test.getWin().rte.getEditor() as StructuredEditor;
      rte.getBody().focus();

      /* Chromium resolves relative hrefs in the pasted HTML against the URL of the document it was copied from. Simulate
         that, and check that we restore the original fragment links (but only if the resolved href still ends with it) */
      const base = "https://webhare.example.net/";
      for (const { resolve, expect } of [
        { resolve: (frag: string) => frag, expect: ["#section", "#sectie-ö"] }, //Firefox and Safari don't resolve
        { resolve: (frag: string) => new URL(frag, base).href, expect: ["#section", "#sectie-ö"] }, //resolving percent-encodes the 'ö'
        { resolve: (frag: string) => new URL(frag === "#section" ? "#other" : frag, base).href, expect: [base + "#other", "#sectie-ö"] },
      ]) {
        rtetest.setStructuredContent(test.getWin(),
          `<p class="normal">(*0*)<a href="#section">"Section"</a>" and "<a href="#sectie-ö">"Sectie"</a>(*1*)</p>`);

        const transfer = await rtetest.copy(rte);
        const copiedhtml = transfer.getData("text/html");
        test.assert(copiedhtml.includes(`data-wh-href="#section"`), "Fragment links should be marked when copying");

        const resolvedtransfer = new DataTransfer;
        resolvedtransfer.setData("text/html", copiedhtml.replaceAll(/ href="(#[^"]*)"/g, (_, frag: string) => ` href="${resolve(frag)}"`));
        resolvedtransfer.setData("text/plain", transfer.getData("text/plain"));

        rtetest.setStructuredContent(test.getWin(), `<p class="normal">"(*0*)(*1*)"<br data-wh-rte="bogus"></p>`);
        await rtetest.paste(rte, resolvedtransfer);

        const links = Array.from(rte.getBody().querySelectorAll("a"));
        test.eq(expect, links.map(link => link.getAttribute("href")));
        test.assert(!rte.getBody().querySelector("[data-wh-href]"), "Fragment link markers should not end up in the document");
      }
    }
  ]);
