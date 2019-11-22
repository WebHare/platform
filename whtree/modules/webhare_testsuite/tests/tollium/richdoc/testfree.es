import * as test from "@mod-tollium/js/testframework";
import * as rtetest from "@mod-tollium/js/testframework-rte";

test.registerTests(
  [ { loadpage: test.getTestScreen('tests/richdoc.main')
    , waits: [ 'ui' ]
    }

  , { name: 'imagebuttontest'
    , test: async function(doc, win)
      {
        var rte = rtetest.getRTE(win, 'editor');
        var geoffreynode = rte.qSA("br")[1].nextSibling;
        rtetest.setRTESelection(win, rte.getEditor(),
                          { startContainer: geoffreynode
                          , startOffset: 5
                          , endContainer: geoffreynode
                          , endOffset: 10
                          });

        let uploadpromise = test.prepareUpload(
            [ { url: '/tollium_todd.res/webhare_testsuite/tollium/logo.png'
              , filename: 'logo.png'
              }
            ]);

//        test.prepareNextUpload(win, 'logo.png', new $wh.URL(location.href).resolveToAbsoluteURL('/tollium_todd.res/webhare_testsuite/tollium/logo.png'));
        test.click(test.compByName('editor').querySelector('.wh-rtd-button[data-button=img]'));
        await uploadpromise;
      }
    , waits: [ 'ui' ]
    }

  , { name: 'imagebuttontest-verify'
    , test: function(doc, win)
      {
        var rte = rtetest.getRTE(win, 'editor');
        var selection = rte.getEditor().getSelectionRange();
        test.eq(1, selection.getElementsByTagName("img").length);
      }
    }

  , { name: 'imagebutton properties'
    , test: function(doc,win)
      {
        let rte = rtetest.getRTE(win, 'editor');
        test.click(rte.getButtonNode('action-properties'));
      }
    , waits:['ui']
    }

  , { test: function(doc,win)
      {
        test.eq('27', test.compByName('width').querySelector('input').value);
        test.clickTolliumButton("OK");
      }
    , waits:['ui']
    }

  , { test: function(doc,win)
      {
        test.clickTolliumButton("Rewrite");
      }
    , waits: [ 'ui' ]
    }

  , { name: 'copypasteimage'
    , wait: function(doc, win, callback)
      {
        var rte = rtetest.getRTE(win, 'editor');
        var imgnode = rte.qSA("img")[0];

        // Emulate firing of 'paste' event before actual paste
        rte.getEditor().gotPaste(); //FIXME need an official way to fire 'after paste'

        //copy paste the image behind itself
        imgnode.parentNode.insertBefore(imgnode.cloneNode(), imgnode.nextSibling);
        //and now add a remote image
        imgnode.parentNode.insertBefore(Object.assign(document.createElement("img"), {src:"/tollium_todd.res/webhare_testsuite/tollium/touchicon.png"}), imgnode.nextSibling.nextSibling);

        // Give paste handlers chance to run
        setTimeout(callback,10);
      }
    , waits: [ 'ui' ]
    }

  , { test: function(doc, win)
      {
        test.clickTolliumButton("Edit raw html");
      }
    , waits: [ 'ui' ]
    }

  , { name: 'verify-copypasteimage'
    , test: function(doc, win)
      {
        var holder = document.createElement("div");
        holder.innerHTML = rtetest.getRawHTMLTextArea(win).value;
        var imgs = holder.querySelectorAll('img');
        test.eq(3,imgs.length); //should be two
        test.eqMatch(/^cid:/, imgs[0].src);
        test.eqMatch(/^cid:/, imgs[1].src);
        test.eqMatch(/^cid:/, imgs[2].src, 'remote img src failed (upload/download failure?)');
        // The CID url's should be the same; they're the same filetransfer.shtml url (should be recognized by $todd.ObjLayout.isMyFileTransferURL)
        test.eq(imgs[0].src,imgs[1].src);
        test.true(imgs[1].src != imgs[2].src);

        test.clickTolliumButton("Cancel");
      }
    , waits: [ 'ui' ]
    }

  , { name: 'texthyperlink'
    , test: function(doc, win)
      {
        let rte = rtetest.getRTE(win, 'editor');
        let quote = rte.qS('blockquote');
        rtetest.setRTESelection(win, rte.getEditor(),
                          { startContainer: quote.firstChild
                          , startOffset: 5
                          , endContainer: quote.firstChild
                          , endOffset: 10
                          });
        test.click(rte.getButtonNode('a-href'));
      }
    , waits: [ 'ui' ]
    }

  , { test: function(doc, win)
      {
        let textedit = test.getCurrentScreen().qSA('t-textedit');
        test.eq(1, textedit.length, 'Expected only one textedit control (external link)');

        let texteditinput = textedit[0].querySelector('input');
        test.eq('', texteditinput.value);
        texteditinput.value='http://www.example.net/';

        test.clickTolliumButton("OK");
      }
    , waits: [ 'ui' ]
    }

  , { name: 'verifyhyperlink'
    , test: function(doc, win)
      {
        let rte = rtetest.getRTE(win, 'editor');
        var range = rte.getEditor().getSelectionRange();
        //ensure hyperlink contents are selected
        test.eq(range.start.element,range.end.element);
        test.eq(0,range.start.offset);
        test.eq(5,range.end.offset);
        test.eq('A',range.start.element.parentNode.tagName);
        test.eq('http://www.example.net/',range.start.element.parentNode.href);
        test.false(range.start.element.parentNode.hasAttribute("target"));

        test.false(rte.getButtonNode('a-href').classList.contains('disabled'),'a-href should not be disabled');
        test.click(rte.getButtonNode('a-href'));
      }
    , waits: [ 'ui' ]
    }

  , { test: function(doc, win)
      {
        let textedit = test.getCurrentScreen().qSA('t-textedit');
        test.eq(1, textedit.length, 'Expected only one textedit control (external link)');

        let texteditinput = textedit[0].querySelector('input');
        test.eq('http://www.example.net/', texteditinput.value);
        texteditinput.value='http://www.example.com/';
        test.clickTolliumButton("OK");
      }
    , waits: [ 'ui' ]
    }

  , { test: function(doc, win)
      {
        let rte = rtetest.getRTE(win, 'editor');
        let link = rte.qSA("a[href]")[0];
        test.eq('http://www.example.com/', link.href);
        test.false(link.hasAttribute("target"));

        //Verify the link's presence
        test.eq(1, rte.qSA('a[href="http://www.example.com/"]').length);

        //Reopen hyperlink dialog
        test.click(rte.getButtonNode('a-href'));
      }
    , waits: [ 'ui' ]
    }

  , { name: 'Remove hyperlink'
    , test: function(doc, win)
      {
        test.clickTolliumButton("Remove hyperlink");
      }
    , waits: [ 'ui' ]
    }

  , { test: function(doc, win)
      {
        let rte = rtetest.getRTE(win, 'editor');
        //Verify the link's disappearance
        test.eq(0, rte.qSA('a[href="http://www.example.com/"]').length);
      }
    }

  , { name: 'Counter'
    , test: async function(doc, win)
      {
        // Enable the counter
        test.setTodd("showcounter", true);
        await test.wait("ui");

        // Length is now 1001
        let counternode = test.compByName('editor').querySelector('.wh-counter__count');
        test.eq("1001", counternode.textContent);
      }
    , waits: [ 'ui' ]
    }

  , "Copy paste with <style>"
  , async function()
    {
      await test.load(test.getTestScreen('tests/richdoc.main'));
      await test.wait('ui');

      let rte = rtetest.getRTE(test.getWin(), 'editor');
      let quote = rte.qS("blockquote");

      // Emulate firing of 'paste' event before actual paste
      rte.getEditor().gotPaste(); //FIXME need an official way to fire 'after paste'

      let stylenode = test.getDoc().createElement("style");
      stylenode.textContent = "* { display: none !mportant; }";
      quote.parentNode.insertBefore(stylenode, quote);

      let scriptnode = test.getDoc().createElement("script");
      quote.parentNode.insertBefore(scriptnode, quote);

      // Give paste handlers chance to run
      await test.wait('tick');
      test.eq(null, rte.qS("style")); //should be removed!
      test.eq(null, rte.qS("script")); //should be removed!
    }

  ]);
