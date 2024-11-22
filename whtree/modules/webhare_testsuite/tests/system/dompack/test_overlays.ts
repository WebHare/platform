/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from "@mod-system/js/wh/testframework";

test.registerTests(
  [
    "API and moving test",
    async function () {
      await test.load('/.webhare_testsuite/tests/pages/dompack/?testpage=overlays');

      test.eq(55, test.getWin().overlaytests.amiga.getArea().right);
      test.eq(200, test.getWin().overlaytests.amiga.getArea().bottom);

      test.eq(3, test.qSA('.myoverlay').length);
      test.eq(1, test.qSA('.myoverlay--selected').length);

      test.eq('Amiga', test.qS("#selection").textContent);

      const atarisquare = test.qSA('.myoverlay')[2];
      test.eq('Atari', atarisquare.querySelector('.myoverlay__content').textContent);

      test.click(test.qSA('.myoverlay')[2]);
      test.eq(1, test.qSA('.myoverlay--selected').length);
      test.eq('Atari', test.qS("#selection").textContent);

      //Move an overlay to the left
      test.qS('#areachangesuser').textContent = 0;

      const origbounds = test.getWin().overlaytests.atari.getArea();
      test.eq("rectangle", origbounds.type);
      test.eq(380, origbounds.left);
      test.eq(80, origbounds.width);

      await test.sendMouseGesture([
        { el: atarisquare, down: 0 },
        { relx: -10, up: 0, delay: 50 }
      ]);

      test.eq(380, origbounds.left, "bounds object should have returned a copy, not a live version");
      test.eq(370, test.getWin().overlaytests.atari.getArea().left);
      test.eq(80, test.getWin().overlaytests.atari.getArea().width);
      test.eq(250, test.getWin().overlaytests.atari.getArea().height);

      test.eq('1', test.qS('#areachangesuser').textContent);

      //Drag a corner
      await test.sendMouseGesture([
        { el: atarisquare.querySelector('.myoverlay__dragger--sw'), down: 0 },
        { relx: -10, rely: 10, up: 0, delay: 50 }
      ]);

      await new Promise(r => setTimeout(r, 10));

      test.eq(90, test.getWin().overlaytests.atari.getArea().width);
      test.eq(260, test.getWin().overlaytests.atari.getArea().height);
      test.eq('2', test.qS('#areachangesuser').textContent);

      test.eq(360, test.getWin().overlaytests.atari.getArea().left);
      test.eq(90, test.getWin().overlaytests.atari.getArea().width);
      test.eq(260, test.getWin().overlaytests.atari.getArea().height);

      // esscape during drag
      await test.sendMouseGesture([
        { el: atarisquare, down: 0 },
        { relx: -10, delay: 100 }
      ]);
      await test.pressKey("Escape");
      await test.sendMouseGesture([
        { el: atarisquare },
        { relx: -10, up: 0, delay: 100 }
      ]);
      test.eq(360, test.getWin().overlaytests.atari.getArea().left);
      test.eq(90, test.getWin().overlaytests.atari.getArea().width);
      test.eq(260, test.getWin().overlaytests.atari.getArea().height);

      // Draw a new overlay
      await test.sendMouseGesture([
        { el: test.qS('.withoverlays'), down: 0, x: 150, y: 50 },
        { up: 0, delay: 100, relx: 40, rely: 40 }
      ]);

      const newsquare = test.qSA('.myoverlay')[3];
      test.eq(true, newsquare.classList.contains("myoverlay--selected"));

      test.eq(4, test.getWin().overlaytests.overlaymgr.overlays.length);
      test.eq(41, test.getWin().overlaytests.overlaymgr.overlays[3].getArea().width);
      test.eq(41, test.getWin().overlaytests.overlaymgr.overlays[3].getArea().height);

      // Draw a new overlay, with cancel
      await test.sendMouseGesture([
        { el: test.qS('.withoverlays'), down: 0, x: 200, y: 50 },
        { delay: 100, relx: 40, rely: 40 }
      ]);
      await test.pressKey("Escape");
      await test.sendMouseGesture([
        { el: test.qS('.withoverlays'), x: 240, y: 90 },
        { relx: 10, rely: 10, up: 0, delay: 100 }
      ]);

      // no new overlays
      test.eq(4, test.qSA('.myoverlay').length);
      test.eq(4, test.getWin().overlaytests.overlaymgr.overlays.length);
    }
  ]);
