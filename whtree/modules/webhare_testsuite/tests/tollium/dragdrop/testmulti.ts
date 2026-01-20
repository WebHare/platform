import * as test from '@mod-tollium/js/testframework';
import * as tt from "@mod-webhare_testsuite/js/tolliumtest-wts";
import { debugFlags } from '@webhare/env/src/envbackend';

const gesture_time = 200;

function getLogComponent() { return test.compByName("log").querySelector("textarea"); }

function logDragEvent(e: DragEvent) {
  const path = [];
  let n: Element | null = e.target as Element;
  while (n && n.nodeType !== 9) {
    path.push(n.nodeName.toLowerCase());
    n = n.parentNode as Element | null;
  }
  console.log(e.type, e.dataTransfer?.dropEffect, e.dataTransfer?.effectAllowed/*, path.reverse().join(">")*/, e.target, e.relatedTarget);
}

function logAllDragEvents() {
  test.getWin().addEventListener("drag", logDragEvent, { capture: true });
  test.getWin().addEventListener("dragend", logDragEvent, { capture: true });
  test.getWin().addEventListener("dragenter", logDragEvent, { capture: true });
  test.getWin().addEventListener("dragleave", logDragEvent, { capture: true });
  test.getWin().addEventListener("dragover", logDragEvent, { capture: true });
  test.getWin().addEventListener("dragstart", logDragEvent, { capture: true });
  test.getWin().addEventListener("drop", logDragEvent, { capture: true });
  //test.getWin().addEventListener("mousemove", logDragEvent, { capture: true });
}

test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen('tests/dragdrop.multitest');
    },
    async function mainTest() {
      test.compByName('log').querySelector('textarea').value = '';

      const clist = test.compByName("clist");
      const ctable = test.compByName("ctable");
      const cpanel = test.compByName("cpanel");

      if (debugFlags.logdragdrop)
        logAllDragEvents();

      const dragelt = test.qSA(clist, "span").filter(n => n.textContent === "Draggable")[0];
      if (!dragelt)
        throw new Error("no dragelt");

      test.subtest("list");
      // Move to middle of list
      await test.sendMouseGesture([
        { el: dragelt, down: 0 },
        { el: clist, delay: gesture_time }
      ]);

      // require the droptarget--hover on the list body
      test.assert(clist.querySelector(".listbodyholder.droptarget--hover"));

      // drop it
      await test.sendMouseGesture([{ el: clist, up: 0 }]);

      // droptarget--hover should be gone
      test.assert(!clist.querySelector(".listbodyholder.droptarget--hover"));

      await test.wait("ui");

      test.eq("list move-local:type1", getLogComponent().value);
      getLogComponent().value = "";

      test.subtest("table");
      await test.sendMouseGesture([
        { el: dragelt, down: 0 },
        { el: ctable, delay: gesture_time }
      ]);

      // require the droptarget--hover on the table cell
      test.assert(ctable.querySelector("td.droptarget--hover"));

      await test.sendMouseGesture([{ el: ctable, up: 0, delay: gesture_time }]);

      test.assert(!ctable.querySelector("td.droptarget--hover"));

      await test.wait("ui");

      test.eq("table move-local:type1", getLogComponent().value);
      getLogComponent().value = "";

      test.subtest("panel");
      await test.sendMouseGesture([
        { el: dragelt, down: 0 },
        { el: cpanel, delay: gesture_time }
      ]);

      test.assert(cpanel.classList.contains("droptarget--hover"));

      await test.sendMouseGesture([{ el: cpanel, up: 0, delay: gesture_time }]);

      test.assert(!cpanel.classList.contains("droptarget--hover"));

      await test.wait("ui");

      test.eq("panel move-local:type1", getLogComponent().value);
      getLogComponent().value = "";

      test.subtest("droptarget-clear");

      // Drag to middle of list
      await test.sendMouseGesture([
        { el: dragelt, down: 0 },
        { el: clist, delay: gesture_time }
      ]);

      test.assert(clist.querySelector(".listbodyholder.droptarget--hover"));

      await test.sendMouseGesture([{ el: ctable, delay: gesture_time }]);

      test.assert(!clist.querySelector(".listbodyholder.droptarget--hover"));
      test.assert(ctable.querySelector("td.droptarget--hover"));

      await test.sendMouseGesture([{ el: cpanel, delay: gesture_time }]);

      test.assert(!clist.querySelector(".listbodyholder.droptarget--hover"));
      test.assert(!ctable.querySelector("td.droptarget--hover"));
      test.assert(cpanel.classList.contains("droptarget--hover"));

      await test.sendMouseGesture([{ el: ctable, delay: gesture_time }]);

      test.assert(!clist.querySelector(".listbodyholder.droptarget--hover"));
      test.assert(ctable.querySelector("td.droptarget--hover"));
      test.assert(!cpanel.classList.contains("droptarget--hover"));

      await test.sendMouseGesture([{ el: clist, up: 0, delay: gesture_time }]);

      test.assert(!clist.querySelector(".listbodyholder.droptarget--hover"));
      test.assert(!ctable.querySelector("td.droptarget--hover"));
      test.assert(!cpanel.classList.contains("droptarget--hover"));

      await test.wait("ui");

      test.subtest("panel-copy");
      getLogComponent().value = "";

      await test.sendMouseGesture([
        { el: dragelt, down: 0, ...test.keyboardCopyModifier },
        { el: cpanel, delay: gesture_time }
      ]);

      test.assert(cpanel.classList.contains("droptarget--hover"));
      test.eq("copy", test.getCurrentDragDataStore()?.currentDragOperation);

      await test.sendMouseGesture([{ el: cpanel, up: 0, delay: gesture_time }]);

      test.assert(!cpanel.classList.contains("droptarget--hover"));

      await test.wait("ui");

      test.eq("panel copy-local:type1", getLogComponent().value);

      test.subtest("panel-link");
      getLogComponent().value = "";

      await test.sendMouseGesture([
        { el: dragelt, down: 0, ...test.keyboardLinkModifier },
        { el: cpanel, delay: gesture_time }
      ]);

      test.assert(cpanel.classList.contains("droptarget--hover"));
      test.eq("link", test.getCurrentDragDataStore()?.currentDragOperation);

      await test.sendMouseGesture([{ el: cpanel, up: 0, delay: gesture_time }]);

      test.assert(!cpanel.classList.contains("droptarget--hover"));

      await test.wait("ui");

      test.eq("panel link-local:type1", getLogComponent().value);
    },

    async function fileDropTest() {
      const clist = test.compByName("clist");
      const ctable = test.compByName("ctable");
      const cpanel = test.compByName("cpanel");

      test.subtest("list");
      getLogComponent().value = "";

      test.startExternalFileDrag(new File(["test1"], "test1.txt", { type: "text/plain" }));

      await test.sendMouseGesture([
        { el: test.getDoc().documentElement },
        { el: clist, delay: gesture_time }
      ]);

      // require the droptarget--hover on the list body
      test.assert(clist.querySelector(".listbodyholder.droptarget--hover"));

      // drop it
      await test.sendMouseGesture([{ el: clist, up: 0 }]);

      // droptarget--hover should be gone
      test.assert(!clist.querySelector(".listbodyholder.droptarget--hover"));

      await test.wait("ui");

      test.eq("list move-file test1.txt text/plain 'test1'", getLogComponent().value);

      test.subtest("table");
      getLogComponent().value = "";

      test.startExternalFileDrag(new File(["test2"], "test2.txt", { type: "text/plain" }));

      await test.sendMouseGesture([
        { el: test.getDoc().documentElement },
        { el: ctable, delay: gesture_time }
      ]);

      // require the droptarget--hover on the table body
      test.assert(ctable.querySelector("td.droptarget--hover"));

      // drop it
      await test.sendMouseGesture([{ el: ctable, up: 0 }]);

      // droptarget--hover should be gone
      test.assert(!ctable.querySelector("td.droptarget--hover"));

      await test.wait("ui");

      test.eq("table move-file test2.txt text/plain 'test2'", getLogComponent().value);

      test.subtest("panel");
      getLogComponent().value = "";

      test.startExternalFileDrag(new File(["test3"], "test3.txt", { type: "text/plain" }));

      await test.sendMouseGesture([
        { el: test.getDoc().documentElement },
        { el: cpanel, delay: gesture_time }
      ]);

      // require the droptarget--hover on the panel body
      test.assert(cpanel.classList.contains("droptarget--hover"));

      // drop it
      await test.sendMouseGesture([{ el: cpanel, up: 0 }]);

      // droptarget--hover should be gone
      test.assert(!cpanel.classList.contains("droptarget--hover"));

      await test.wait("ui");

      test.eq("panel move-file test3.txt text/plain 'test3'", getLogComponent().value);
      getLogComponent().value = "";

    }
  ]);
