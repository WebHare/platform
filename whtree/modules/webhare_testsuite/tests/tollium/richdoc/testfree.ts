/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from "@mod-tollium/js/testframework";
import * as tt from '@mod-webhare_testsuite/js/tolliumtest-wts';
import * as rtetest from "@mod-tollium/js/testframework-rte";
import { prepareUpload } from '@webhare/test-frontend';

test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/richdoc.main");
    },

    {
      name: 'imagebuttontest',
      test: async function (doc, win) {
        const rte = rtetest.getRTE(win, 'editor');
        const geoffreynode = rte.qSA("br")[1].nextSibling;
        rtetest.setRTESelection(win, rte.getEditor(),
          {
            startContainer: geoffreynode,
            startOffset: 5,
            endContainer: geoffreynode,
            endOffset: 10
          });

        prepareUpload(['/tollium_todd.res/webhare_testsuite/tollium/logo.png']);

        //        test.prepareNextUpload(win, 'logo.png', new $wh.URL(location.href).resolveToAbsoluteURL('/tollium_todd.res/webhare_testsuite/tollium/logo.png'));
        test.click(test.compByName('editor').querySelector('.wh-rtd-button[data-button=img]'));
      },
      waits: ['ui']
    },

    {
      name: 'imagebuttontest-verify',
      test: function (doc, win) {
        const rte = rtetest.getRTE(win, 'editor');
        const selection = rte.getEditor().getSelectionRange();
        test.eq(1, selection.querySelectorAll("img").length);
      }
    },

    {
      name: 'imagebutton properties',
      test: function (doc, win) {
        const rte = rtetest.getRTE(win, 'editor');
        test.click(rte.getButtonNode('action-properties'));
      },
      waits: ['ui']
    },

    {
      test: function (doc, win) {
        test.eq('27', test.compByName('width').querySelector('input').value);
        test.clickTolliumButton("OK");
      },
      waits: ['ui']
    },

    {
      test: function (doc, win) {
        test.clickTolliumButton("Rewrite");
      },
      waits: ['ui']
    },

    {
      name: 'copypasteimage',
      wait: function (doc, win, callback) {
        const rte = rtetest.getRTE(win, 'editor');
        const imgnode = rte.qSA("img")[0];

        // Emulate firing of 'paste' event before actual paste
        rte.getEditor().gotPaste(); //FIXME need an official way to fire 'after paste'

        //copy paste the image behind itself
        imgnode.parentNode.insertBefore(imgnode.cloneNode(), imgnode.nextSibling);
        //and now add a remote image
        imgnode.parentNode.insertBefore(Object.assign(document.createElement("img"), { src: "/tollium_todd.res/webhare_testsuite/tollium/touchicon.png" }), imgnode.nextSibling.nextSibling);

        // Give paste handlers chance to run
        setTimeout(callback, 10);
      },
      waits: ['ui']
    },

    {
      test: function (doc, win) {
        test.clickTolliumButton("Edit raw html");
      },
      waits: ['ui']
    },

    {
      name: 'verify-copypasteimage',
      test: function (doc, win) {
        const holder = document.createElement("div");
        holder.innerHTML = rtetest.getRawHTMLTextArea(win).value;
        const imgs = holder.querySelectorAll('img');
        test.eq(3, imgs.length); //should be two
        test.eq(/^cid:/, imgs[0].src);
        test.eq(/^cid:/, imgs[1].src);
        test.eq(/^cid:/, imgs[2].src, 'remote img src failed (upload/download failure?)');
        // The CID url's should be the same; they're the same filetransfer.shtml url (should be recognized by $todd.ObjLayout.isMyFileTransferURL)
        test.eq(imgs[0].src, imgs[1].src);
        test.assert(imgs[1].src !== imgs[2].src);

        test.clickTolliumButton("Cancel");
      },
      waits: ['ui']
    },

    {
      name: 'texthyperlink',
      test: function (doc, win) {
        const rte = rtetest.getRTE(win, 'editor');
        const quote = rte.qS('blockquote');
        rtetest.setRTESelection(win, rte.getEditor(),
          {
            startContainer: quote.firstChild,
            startOffset: 5,
            endContainer: quote.firstChild,
            endOffset: 10
          });
        test.click(rte.getButtonNode('a-href'));
      },
      waits: ['ui']
    },

    {
      test: function (doc, win) {
        const textedit = test.getCurrentScreen().qSA('t-textedit');
        test.eq(1, textedit.length, 'Expected only one textedit control (external link)');

        const texteditinput = textedit[0].querySelector('input');
        test.eq('', texteditinput.value);
        texteditinput.value = 'http://www.example.net/';

        test.clickTolliumButton("OK");
      },
      waits: ['ui']
    },

    {
      name: 'verifyhyperlink',
      test: function (doc, win) {
        const rte = rtetest.getRTE(win, 'editor');
        const range = rte.getEditor().getSelectionRange();
        //ensure hyperlink contents are selected
        test.eq(range.start.element, range.end.element);
        test.eq(0, range.start.offset);
        test.eq(5, range.end.offset);
        test.eq('A', range.start.element.parentNode.tagName);
        test.eq('http://www.example.net/', range.start.element.parentNode.href);
        test.assert(!range.start.element.parentNode.hasAttribute("target"));

        test.assert(!rte.getButtonNode('a-href').classList.contains('disabled'), 'a-href should not be disabled');
        test.click(rte.getButtonNode('a-href'));
      },
      waits: ['ui']
    },

    {
      test: function (doc, win) {
        const textedit = test.getCurrentScreen().qSA('t-textedit');
        test.eq(1, textedit.length, 'Expected only one textedit control (external link)');

        const texteditinput = textedit[0].querySelector('input');
        test.eq('http://www.example.net/', texteditinput.value);
        texteditinput.value = 'http://www.example.com/';
        test.clickTolliumButton("OK");
      },
      waits: ['ui']
    },

    {
      test: function (doc, win) {
        const rte = rtetest.getRTE(win, 'editor');
        const link = rte.qSA("a[href]")[0];
        test.eq('http://www.example.com/', link.href);
        test.assert(!link.hasAttribute("target"));

        //Verify the link's presence
        test.eq(1, rte.qSA('a[href="http://www.example.com/"]').length);

        //Reopen hyperlink dialog
        test.click(rte.getButtonNode('a-href'));
      },
      waits: ['ui']
    },

    {
      name: 'Remove hyperlink',
      test: function (doc, win) {
        test.clickTolliumButton("Remove hyperlink");
      },
      waits: ['ui']
    },

    {
      test: function (doc, win) {
        const rte = rtetest.getRTE(win, 'editor');
        //Verify the link's disappearance
        test.eq(0, rte.qSA('a[href="http://www.example.com/"]').length);
      }
    },

    {
      name: 'Counter',
      test: async function (doc, win) {
        // Enable the counter
        test.setTodd("showcounter", true);
        await test.wait("ui");

        // Length is now 989
        const counternode = test.compByName('editor').querySelector('.wh-counter__count');
        test.eq("989", counternode.textContent);
      },
      waits: ['ui']
    },

    "Plain text conversion options",
    async function () {
      test.clickTolliumButton("View plaintext");
      await test.wait("ui");

      let plaintext = rtetest.getRawHTMLTextArea(test.getWin()).value;
      test.assert(plaintext.indexOf("Arnold Hendriks <a.hendriks@example.net> <URL:mailto:a.hendriks@example.net> Postbus") !== -1);

      test.clickTolliumButton("Cancel");
      await test.wait("ui");

      test.setTodd("suppress_urls", true);
      await test.wait("ui");

      test.clickTolliumButton("View plaintext");
      await test.wait("ui");

      plaintext = rtetest.getRawHTMLTextArea(test.getWin()).value;
      test.assert(plaintext.indexOf("Arnold Hendriks <a.hendriks@example.net> Postbus") !== -1);
      let plaintextlen = test.compByName('len').querySelector('input').value;

      test.clickTolliumButton("Cancel");
      await test.wait("ui");

      let counternode = test.compByName('editor').querySelector('.wh-counter__count');
      test.eq(plaintextlen, counternode.textContent);

      test.setTodd("unix_newlines", true);
      await test.wait("ui");

      test.clickTolliumButton("View plaintext");
      await test.wait("ui");

      plaintext = rtetest.getRawHTMLTextArea(test.getWin()).value;
      test.assert(plaintext.indexOf("Arnold Hendriks <a.hendriks@example.net> Postbus") !== -1);
      plaintextlen = test.compByName('len').querySelector('input').value;

      test.clickTolliumButton("Cancel");
      await test.wait("ui");

      counternode = test.compByName('editor').querySelector('.wh-counter__count');
      test.eq(plaintextlen, counternode.textContent);
    },

    "textcontent count mode",
    async function () {
      test.setTodd("toplaintextmethod", "textcontent");
      await test.wait("ui");
      test.eq('1091', test.compByName('editor').querySelector('.wh-counter__count').textContent);
    },

    "Copy paste with <style>",
    async function () {
      await tt.loadWTSTestScreen('tests/richdoc.main');
      await test.waitForUI();

      const rte = rtetest.getRTE(test.getWin(), 'editor');
      const quote = rte.qS("blockquote");

      // Emulate firing of 'paste' event before actual paste
      rte.getEditor().gotPaste(); //FIXME need an official way to fire 'after paste'

      const stylenode = test.getDoc().createElement("style");
      stylenode.textContent = "* { display: none !mportant; }";
      quote.parentNode.insertBefore(stylenode, quote);

      const scriptnode = test.getDoc().createElement("script");
      quote.parentNode.insertBefore(scriptnode, quote);

      // Give paste handlers chance to run
      await test.wait('tick');
      test.eq(null, rte.qS("style")); //should be removed!
      test.eq(null, rte.qS("script")); //should be removed!

      // test counter
      test.setTodd("showcounter", true);
      await test.wait("ui");

      test.clickTolliumButton("View plaintext");
      await test.wait("ui");
      //let plaintextlen = test.compByName('len').querySelector('input').value;
      test.clickTolliumButton("Cancel");
      await test.wait("ui");

      /* FIXME: the counter is one off from the harescript plaintext character count, probably because of the
         import of the rte value into a HTML document in HareScript removes the newline after the last </pre>
      */

      //let counternode = test.compByName('editor').querySelector('.wh-counter__count');
      // test.eq(plaintextlen, counternode.textContent);
    }

  ]);
