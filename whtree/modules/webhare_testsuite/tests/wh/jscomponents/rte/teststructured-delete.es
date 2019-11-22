import * as test from "@mod-tollium/js/testframework";
import * as rtetest from "@mod-tollium/js/testframework-rte";

test.registerTests(
  [
    { loadpage: '/.webhare_testsuite/tests/pages/rte/?editor=structured'
    }

/* test scenario's

   delete normal character within text - no selection
   delete selection within text
   delete selection extending to next p
   delete selection extending to next li
   delete selection over embedded object, table

   delete before end of paragraph - no selection
     - with next normal paragraph
     - with next list (combine with contents of first list node)
     - with next table (don't do anything)
     - with next embedded object (don't do anything)
     - within empty paragraph
     - within empty li
     - within empty table cell
     - at last paragraph

   backspace normal character - no selection
   backspace selection within text
   backspace selection extending to previous p
   backspace selection extending to previous li
   backspace selection over embbedded object, table

   backspace at start of paragraph - no selection
     - with previous normal paragraph
     - with previous list (combine with contents of first list node)
     - with previous table (don't do anything)
     - with previous embedded object (don't do anything)
     - within empty paragraph
     - within empty li
     - within empty table cell
     - at first paragraph
*/
  , { test: async (doc, win) =>
      {
        var rte = win.rte.getEditor();

        rte.getContentBodyNode().focus();
        await test.wait("events");

        test.subtest("Delete selected character");
        rtetest.setStructuredContent(win, '<p class="normal">"a(*0*)b(*1*)c"</p>');
        await rtetest.runWithUndo(rte, () => test.pressKey("Delete"));
        test.eq("ac", rte.getContentBodyNode().textContent);

        test.subtest("Backspace selected character");
        rtetest.setStructuredContent(win, '<p class="normal">"a(*0*)b(*1*)c"</p>');
        await rtetest.runWithUndo(rte, () => test.pressKey("Backspace"));
        test.eq("ac", rte.getContentBodyNode().textContent);

        // word/line delete - not implemented yet
/*        test.subtest("Delete rest of word");
        rtetest.setStructuredContent(win, '<p class="normal">"a(*0*)bc def ghi"</p>');
        await rtetest.runWithUndo(rte, () => test.pressKey("Ctrl+Delete"));
        test.eq("a def ghi", rte.getContentBodyNode().textContent);

        test.subtest("Delete next word");
        rtetest.setStructuredContent(win, '<p class="normal">"a(*0*) bc def ghi"</p>');
        await rtetest.runWithUndo(rte, () => test.pressKey("Ctrl+Delete"));
        test.eq("a def ghi", rte.getContentBodyNode().textContent);

        test.subtest("Delete rest of line");
        rtetest.setStructuredContent(win, '<p class="normal">"a(*0*)bc def ghi"<br>"jkl"</p>');
        await rtetest.runWithUndo(rte, () => test.pressKey("Ctrl+Shift+Delete"));
        test.eq("ajkl", rte.getContentBodyNode().textContent);
*/
        test.subtest("Delete spanning two paragraphs");
        rtetest.setStructuredContent(win, '<p class="normal">"a(*0*)b"</p><p class="normal">"d(*1*)e"</p>');
        await rtetest.runWithUndo(rte, () => test.pressKey("Delete"));
        test.eq("ae", rte.getContentBodyNode().querySelector("p").textContent);

        test.subtest("Delete spanning p and li");
        rtetest.setStructuredContent(win, '<p class="normal">"a(*0*)b"</p><ol class="ordered"><li>"d(*1*)e"</li></ol>');
        await rtetest.runWithUndo(rte, () => test.pressKey("Delete"));
        test.eq("ae", rte.getContentBodyNode().querySelector("p").textContent);

        test.subtest("Delete at empty only paragraph");
        rtetest.setStructuredContent(win, '<p class="normal">"(*0*)"<br data-wh-rte="bogus"></p>');
        await rtetest.runWithUndo(rte, () => test.pressKey("Delete"));
        test.eq("", rte.getContentBodyNode().querySelector("p").textContent); // crashes if no p :-)

        test.subtest("Delete at last paragraph");
        rtetest.setStructuredContent(win, '<p class="normal">"a"</p><p class="normal">"(*0*)"<br data-wh-rte="bogus"></p>');
        await rtetest.runWithUndo(rte, () => test.pressKey("Delete"));
        test.eq("a", rte.getContentBodyNode().querySelector("p").textContent);
        test.eq(null, rte.getContentBodyNode().querySelector("p + p"));

        // in empty p - delete p and goto next paragraph
        test.subtest("Delete in empty paragraph");
        rtetest.setStructuredContent(win, '<p class="normal">"(*0*)"<br data-wh-rte="bogus"></p><p class="mystyle">"ab"</p>');
        await rtetest.runWithUndo(rte, () => test.pressKey("Delete"));
        test.eq("mystyle", rte.getContentBodyNode().querySelector("p").className);
        test.eq("ab", rte.getContentBodyNode().querySelector("p").textContent);

        // in list with one empty li - delete list
        test.subtest("Delete in only empty li");
        rtetest.setStructuredContent(win, '<ol class="ordered"><li>"(*0*)"<br data-wh-rte="bogus"></li></ol><p class="normal">"1"</p>');
        await rtetest.runWithUndo(rte, () => test.pressKey("Delete"));
        test.eq(null, rte.getContentBodyNode().querySelector("li"));
        test.eq("1", rte.getContentBodyNode().querySelector("p").textContent);

        // in empty li with next li - delete li
        test.subtest("Delete in empty li with next li");
        rtetest.setStructuredContent(win, '<ol class="ordered"><li>"(*0*)"<br data-wh-rte="bogus"></li><li>"1"</li></ol>');
        await rtetest.runWithUndo(rte, () => test.pressKey("Delete"));
        test.eq("1", rte.getContentBodyNode().querySelector("li").textContent);

        test.subtest("Delete within table");
        // no verify because table structure is quite complicated
        rtetest.setStructuredContent(win, '<table><tr><td><p class="mystyle">"(*0*)ab"</p></td></tr></tbody></table>', { verify: false });
        await rtetest.runWithUndo(rte, () => test.pressKey("Delete"));
        test.eq("b", rte.getContentBodyNode().querySelector("p").textContent);
        await rtetest.runWithUndo(rte, () => test.pressKey("Delete"));
        test.eq("", rte.getContentBodyNode().querySelector("p").textContent);
        await rtetest.runWithUndo(rte, () => test.pressKey("Delete"));
        test.eq("", rte.getContentBodyNode().querySelector("p").textContent);

        test.subtest("Delete before table"); // should be ignored
        // no verify because table structure is quite complicated
        rtetest.setStructuredContent(win, '<p class="normal">"a(*0*)"</p><table><tr><td><p class="mystyle">"b"</p></td></tr></tbody></table>', { verify: false });
        await rtetest.runWithUndo(rte, () => test.pressKey("Delete"));
        test.eq("a", rte.getContentBodyNode().querySelector("p").textContent);
        test.eq("b", rte.getContentBodyNode().querySelector("table").textContent);

        test.subtest("Delete before embedded object");
        // no verify because embedded object structure is quite complicated
        rtetest.setStructuredContent(win, '<p class="normal">"a(*0*)"<br></p><div class="wh-rtd-embeddedobject" data-instanceid="test456">"Ik ben niet editbaar:test456"</div>', { verify: false });
        await rtetest.runWithUndo(rte, () => test.pressKey("Delete"));
        test.eq("Ik ben niet editbaar:test456", rte.getContentBodyNode().querySelector("div").textContent); // embedded object is not deleted

        test.subtest("Delete whitespace replacement");
        rtetest.setStructuredContent(win, '<p class="normal">"a (*0*)b(*1*) c"</p>');
        await rtetest.runWithUndo(rte, () => test.pressKey("Delete"));
        test.eq("a \u00a0c", rte.getContentBodyNode().querySelector("p").textContent);

        test.subtest("Backspace after empty line");
        rtetest.setStructuredContent(win, '<p class="normal">"a"</p><p class="normal">" "<br>" "</p><p class="normal">"(*0*)(*1*)b"</p>');
        await rtetest.runWithUndo(rte, () => test.pressKey("Backspace"));
        test.eq(2, rte.getContentBodyNode().childNodes.length);

        // Delete in list just before embedded object removed the div around the embedded object
        test.subtest("Delete in list before embedded object");
        rtetest.setStructuredContent(win, '<ol class="ordered"><li>"a(*0*)"</li></ol><div class="wh-rtd-embeddedobject" data-instanceid="test456">"Ik ben niet editbaar:test456"</div>', { verify: false });
        await rtetest.runWithUndo(rte, () => test.pressKey("Delete"));
        test.eq("Ik ben niet editbaar:test456", rte.getContentBodyNode().querySelector("div").textContent); // embedded object is not deleted

        // Backspace in list just after embedded object removed list, left text at root
        test.subtest("Backspace in list after embedded object");
        rtetest.setStructuredContent(win, '<div class="wh-rtd-embeddedobject" data-instanceid="test456">"Ik ben niet editbaar:test456"</div><ol class="ordered"><li>"(*0*)a"</li></ol>', { verify: false });
        await rtetest.runWithUndo(rte, () => test.pressKey("Backspace"));
        test.true(rte.getContentBodyNode().querySelector("li")); // should not delete the li

        // Backspace in empty paragraph after empty paragraph and embedded object caused wrong cursor pos in chrome
        test.subtest("Backspace in list after embedded object");
        rtetest.setStructuredContent(win, '<p class="normal">"a"</p><p class="normal"><br data-wh-rte="bogus"></p><div class="wh-rtd-embeddedobject" data-instanceid="test456">"Ik ben niet editbaar:test456"</div><p class="normal">(*0*)<br data-wh-rte="bogus"></p>', { verify: false });
        await rtetest.runWithUndo(rte, () => test.pressKey("Backspace"));
        await rtetest.runWithUndo(rte, () => test.pressKey("Backspace"));
        test.eq(0, rte.getContentBodyNode().querySelectorAll("p div").length); // should not merge the contents of the embedded object
     }
    }
  ]);
