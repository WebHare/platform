import * as dompack from 'dompack';
import * as test from "@mod-tollium/js/testframework";

let htmlnode;
let savescrollpos;

test.registerTests(
  [ { loadpage: test.getTestScreen('tests/richdoc.main,bigstructure')
    , waits: [ 'ui' ]
    }

   , { name: 'firstclick-issue'
    , test:function(doc,win)
      {
        test.compByName('focusfield').focus();

        let toddrte=test.compByName('structured');
        htmlnode=toddrte.querySelector('.wh-rtd__html');
        htmlnode.scrollTop = htmlnode.scrollHeight; //scroll it to the bottom
        dompack.dispatchDomEvent(htmlnode, 'scroll');

        savescrollpos = htmlnode.scrollTop; //should be truncated to maxheight
      }
    , waits: [ 100 ]
    }
  , { test: function(doc,win)
      {
//        test.click(htmlnode.querySelector('.wh-rtd__widgetedit'));
        //ADDME completely confused why the click above doesn't work for IE...
        test.sendMouseGesture( [ { el: htmlnode.querySelector('.wh-rtd-editbutton'), down:0, x:"50%", y:"50%" }
                               , { el: htmlnode.querySelector('.wh-rtd-editbutton'), up:0, x:"50%", y:"50%" }
                               ]);

      }
    , waits: [ 'pointer','ui' ]
    }

  , { test:function(doc,win)
      {
        test.eq(savescrollpos, htmlnode.scrollTop);
        test.clickTolliumButton("OK");
      }
    , waits: [ 'ui', 'events' ]
    }

  , { test:function(doc,win)
      {
        test.eq(savescrollpos, htmlnode.scrollTop, 'should still be at right scroll pos');
      }
    }

 ]);
