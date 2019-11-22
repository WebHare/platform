import * as test from "@mod-tollium/js/testframework";

test.registerTests(
  [ { loadpage: '/.webhare_testsuite/tests/pages/rte/?editor=page'
    }
  , { name: 'firsttest'
    , test: function(doc,win)
      {
        var h1 = win.rte.getBody().getElementsByTagName("H1")[0];
        test.true(h1!=null);
        test.eq("pointer", getComputedStyle(h1).cursor);

        var boldbutton = test.qSA('span.wh-rtd-button[data-button=b]')[0];
        var italicbutton = test.qSA('span.wh-rtd-button[data-button=i]')[0];

        test.true(boldbutton!=null);
        test.true(italicbutton!=null);
        test.true(boldbutton.classList.contains('disabled'));
        test.true(italicbutton.classList.contains('disabled'));

        test.click(h1);

        test.false(italicbutton.classList.contains('disabled'));
        //test.true(boldbutton.classList.contains('-disabled')); //FIXME this SHOULD work, if the RTE understands its still editing a H1
      }
    }

  , { name: 'outsideeditclick'
    , test:function(doc,win)
      {
        //click on 'belangrijk'. it's in a non-editable area, so clicking there should disable edit mode
        test.click(win.rte.qS("#belangrijk"));

        var italicbutton = test.$$t('span.wh-rtd-button[data-button=i]')[0];
        test.true(italicbutton.classList.contains('disabled'));

        //let's click the image. it's inside the editable div anyway
        test.click(win.rte.qS("img"));

        var blockstylepulldown = test.qS('.wh-rtd__toolbarstyle');
        //the pulldown should only contain ONE instance of HEADING1
        test.true(blockstylepulldown != null);
        test.eq(1, blockstylepulldown.querySelectorAll('option[value="HEADING1"]').length);
      }

    }
  ]);
