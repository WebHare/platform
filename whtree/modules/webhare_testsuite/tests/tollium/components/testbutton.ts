/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from "@mod-tollium/js/testframework";


test.runTests(
  [
    {
      loadpage: test.getCompTestPage('button'),
      waits: ['ui']
    },
    {
      test: function (doc, win) {
        test.fill(test.compByName('title').querySelector('input'), "WWWWWWWWWW WWWWWWWWWW WWWWWWWWWWW");
        test.click(test.compByName('updatetitlebutton'));
      },
      waits: ['ui']
    },
    {
      name: 'button large enough to show the text',
      test: function (doc, win) {
        const holder = test.compByName("componentpanel");
        const button = holder.querySelector("button");
        const title = button.querySelector("span");
        test.eq("WWWWWWWWWW WWWWWWWWWW WWWWWWWWWWW", title.textContent, 'got the wrong button/span?');
        test.assert(title.getBoundingClientRect().right < button.getBoundingClientRect().right, 'title right is OUTSIDE button right - its clipped!');
      }
    }
  ]);
