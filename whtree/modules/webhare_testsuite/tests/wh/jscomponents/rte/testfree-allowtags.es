import * as test from "@mod-tollium/js/testframework";
import * as rtetest from "@mod-tollium/js/testframework-rte";

test.registerTests(
  [
    { loadpage: '/.webhare_testsuite/tests/pages/rte/?editor=free&allowtags=b,img'
    }
  , { name: 'testallowtagsbar'
    , test: function(doc,win)
      {
        var boldbutton = test.qSA('span.wh-rtd-button[data-button=b]')[0];
        var italicbutton = test.qSA('span.wh-rtd-button[data-button=i]')[0];

        test.true(boldbutton!=null);
        test.false(italicbutton!=null);
        test.false(boldbutton.classList.contains('disabled'));
        test.false(boldbutton.classList.contains('active'));

        console.log('send focus');
        win.givefocus();

        console.log('got focus');

        // Test delayed surrounds

        // Add bold
        test.click(boldbutton);
        test.true(boldbutton.classList.contains('active'));

        // Remove it
        test.click(boldbutton);
        test.false(boldbutton.classList.contains('active'));

        rtetest.setRawStructuredContent(win,'<b>"a(*0*)"</b>');

        test.true(boldbutton.classList.contains('active'));

        // Remove bold
        test.click(boldbutton);
        test.false(boldbutton.classList.contains('active'));
      }
    }
  ]);
