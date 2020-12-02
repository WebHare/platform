import * as test from "@mod-tollium/js/testframework";


test.registerTests(
  [ { loadpage: test.getCompTestPage('button')
    , waits:['ui']
    }
  , { test:function(doc,win)
      {
        test.fill(test.compByName('title').querySelector('input'), "WWWWWWWWWW WWWWWWWWWW WWWWWWWWWWW");
        test.click(test.compByName('updatetitlebutton'));
      }
    , waits:['ui']
    }
  , { name: 'button large enough to show the text'
    , test:function(doc,win)
      {
        var holder = test.compByName("componentpanel");
        var button = holder.querySelector("t-button");
        var title = button.querySelector("span");
        test.eq("WWWWWWWWWW WWWWWWWWWW WWWWWWWWWWW", title.textContent, 'got the wrong button/span?');
        test.true(title.getBoundingClientRect().right < button.getBoundingClientRect().right, 'title right is OUTSIDE button right - its clipped!');
      }
    }
  ]);
