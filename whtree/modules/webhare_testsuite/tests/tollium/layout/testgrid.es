import * as test from '@mod-tollium/js/testframework';
import {$qS,$qSA} from '@mod-tollium/js/testframework';


test.registerTests(
  [ { loadpage: test.getTestScreen('tests/layout.layouttest,grid')
    , waits: [ 'ui' ]
    }

  , { name: 'verifybox'
    , test:function(doc,win)
      {
        //var stretcharea = test.compByName('stretcharea');
        //var stretchareaholder = test.compByName('stretchareaholder');
        var selectel = test.compByName('rightmiddlecell').querySelector('select');
        var selectel2 = test.compByName('righttopcell').querySelector('select');
        var datecomp = test.compByName('date1').querySelector('input[type=date]');

        test.eq(test.compByName('textedit').offsetHeight, selectel/*.retrieve('wh-ui-replacedby')*/.offsetHeight, "Height of pulldown should match height of textedit");
        test.eq(test.compByName('textedit').getBoundingClientRect().right, test.compByName('stretcharea').getBoundingClientRect().right, "Right edges of textedit TE1 and the textarea below it should align");

        //2gr is the default for a textarea, so it should have the same size as stretcharea gets (which is in a 2pr panel)
        test.eq(test.compByName('stretcharea').offsetHeight, test.compByName('defaultarea').offsetHeight, 'both textareas should have identical sizes');

        test.eq(test.compByName('textedit').getBoundingClientRect().top, test.compByName('defaultarea').getBoundingClientRect().top, "Top of textedit#1 and textarea should align");
        test.eq(test.compByName('textedit2').getBoundingClientRect().top, test.compByName('defaultarea').getBoundingClientRect().top, "Top of textedit#2 and textarea should align");
        test.eq(test.compByName('textedit3').getBoundingClientRect().bottom, test.compByName('defaultarea').getBoundingClientRect().bottom, "Bottom of textedit#3 and textarea should align");

        test.eq(test.compByName('textedit4').getBoundingClientRect().top, selectel./*retrieve('wh-ui-replacedby').*/getBoundingClientRect().top, "Top line of textedit#4 and select should align");
        test.eq(test.compByName('textedit4').getBoundingClientRect().bottom, selectel./*retrieve('wh-ui-replacedby').*/getBoundingClientRect().bottom, "Bottom line of textedit#4 and select should align");
        test.eq(test.compByName('stretcharea').getBoundingClientRect().bottom, selectel./*retrieve('wh-ui-replacedby').*/getBoundingClientRect().bottom, "Bottom line of textarea and select should align");
        test.eq(test.compByName('stretcharea').getBoundingClientRect().bottom, test.compByName('textedit4').getBoundingClientRect().bottom, "Bottom line of textarea and textedit should align");

        test.eq(test.compByName('textedit4').getBoundingClientRect().top,    test.compByName('button').getBoundingClientRect().top,    "Top line of textedit#4 and button should align");
        test.eq(test.compByName('textedit4').getBoundingClientRect().bottom, test.compByName('button').getBoundingClientRect().bottom, "Bottom line of textedit#4 and button should align");

        test.eq(test.compByName('textedit').getBoundingClientRect().top, selectel2/*.retrieve('wh-ui-replacedby')*/.getBoundingClientRect().top, "Top line of textedit#1 and select topright should align");
        test.eq(test.compByName('textedit').getBoundingClientRect().bottom, selectel2/*.retrieve('wh-ui-replacedby')*/.getBoundingClientRect().bottom, "Bottom line of textedit#1 and select topright should align");

        test.eq(test.compByName('textedit3').getBoundingClientRect().top,    datecomp.nextSibling.getBoundingClientRect().top, "Top line of textedit#3 and date topright should align");
        test.eq(test.compByName('textedit3').getBoundingClientRect().bottom, datecomp.nextSibling.getBoundingClientRect().bottom, "Bottom line of textedit#3 and date topright should align");

      }
    }

  , { name: 'gridupdate'
    , test:function(doc,win)
      {
        test.eq(0,$qSA('.wh-radiobutton').length);
        test.eq(2,$qSA('select').length);
        test.click(test.compByName('button')); //converts the select to a radiobutton
      }
    , waits: ['ui']
    }

  , { test:function(doc,win)
      {
        test.eq(2,$qSA('.wh-radiobutton').length);
        test.eq(1,$qSA('select').length);
      }
    }
  ]);
