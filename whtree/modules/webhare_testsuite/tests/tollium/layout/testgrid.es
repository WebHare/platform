import * as test from '@mod-tollium/js/testframework';


test.registerTests(
  [ async function()
    {
      await test.load(test.getTestScreen('tests/layout.layouttest,grid'));
      await test.wait('ui')
    }

  , "Verify first grid row (inline items)"
  , async function()
    {
        //var stretcharea = test.compByName('stretcharea');
        //var stretchareaholder = test.compByName('stretchareaholder');
        var selectel = test.compByName('rightmiddlecell').querySelector('select');
        var selectel2 = test.compByName('righttopcell').querySelector('select');
        var datecomp = test.compByName('date1').querySelector('input[type=date]');

        test.eq(test.compByName('textedit').offsetHeight, selectel.offsetHeight, "Height of pulldown should match height of textedit");
        test.eq(test.compByName('textedit').getBoundingClientRect().right, test.compByName('stretcharea').getBoundingClientRect().right, "Right edges of textedit TE1 and the textarea below it should align");

        //2gr is the default for a textarea, so it should have the same size as stretcharea gets (which is in a 2pr panel)
        test.eq(test.compByName('stretcharea').offsetHeight, test.compByName('defaultarea').offsetHeight, 'both textareas should have identical sizes');

        test.eq(test.compByName('textedit').getBoundingClientRect().top, test.compByName('defaultarea').getBoundingClientRect().top, "Top of textedit#1 and textarea should align");
        test.eq(test.compByName('textedit2').getBoundingClientRect().top, test.compByName('defaultarea').getBoundingClientRect().top, "Top of textedit#2 and textarea should align");
        test.eq(test.compByName('textedit3').getBoundingClientRect().bottom, test.compByName('defaultarea').getBoundingClientRect().bottom, "Bottom of textedit#3 and textarea should align");

        test.eq(test.compByName('textedit4').getBoundingClientRect().top, selectel.getBoundingClientRect().top, "Top line of textedit#4 and select should align");
        test.eq(test.compByName('textedit4').getBoundingClientRect().bottom, selectel.getBoundingClientRect().bottom, "Bottom line of textedit#4 and select should align");
        test.eq(test.compByName('stretcharea').getBoundingClientRect().bottom, selectel.getBoundingClientRect().bottom, "Bottom line of textarea and select should align");
        test.eq(test.compByName('stretcharea').getBoundingClientRect().bottom, test.compByName('textedit4').getBoundingClientRect().bottom, "Bottom line of textarea and textedit should align");

        test.eq(test.compByName('textedit4').getBoundingClientRect().top,    test.compByName('button').getBoundingClientRect().top,    "Top line of textedit#4 and button should align");
        test.eq(test.compByName('textedit4').getBoundingClientRect().bottom, test.compByName('button').getBoundingClientRect().bottom, "Bottom line of textedit#4 and button should align");

        test.eq(test.compByName('textedit').getBoundingClientRect().top, selectel2.getBoundingClientRect().top, "Top line of textedit#1 and select topright should align");
        test.eq(test.compByName('textedit').getBoundingClientRect().bottom, selectel2.getBoundingClientRect().bottom, "Bottom line of textedit#1 and select topright should align");

        test.eq(test.compByName('textedit3').getBoundingClientRect().top,    datecomp.nextSibling.getBoundingClientRect().top, "Top line of textedit#3 and date topright should align");
        test.eq(test.compByName('textedit3').getBoundingClientRect().bottom, datecomp.nextSibling.getBoundingClientRect().bottom, "Bottom line of textedit#3 and date topright should align");

        test.eq(test.compByName('bottommiddletext').getBoundingClientRect().bottom, test.compByName('belowbuttontext').getBoundingClientRect().bottom, "Bottom line of bottommidle and belowbuttno texts should align");
    }

  , "Verify second grid row (inlineblocks with blocks)"
  , async function()
    {
      test.eq(test.compByName('testalign').getBoundingClientRect().top, test.compByName('inlineblock').getBoundingClientRect().top, "Top line of textarea and inline block should align");
      test.eq(test.compByName('testalign').getBoundingClientRect().bottom, test.compByName('inlineblock').getBoundingClientRect().bottom, "Bottom line of textarea and inline block should align");

      test.eq(test.compByName('testalign').getBoundingClientRect().top, test.compByName('inlineblock_list').getBoundingClientRect().top, "Top line of textarea and inline block list should align");
      test.eq(test.compByName('testalign').getBoundingClientRect().bottom, test.compByName('inlineblock_list').getBoundingClientRect().bottom, "Bottom line of textarea and inline block list should align");

      //NOTE: this test relies on a tunable gridlineSnapMax - which I'm not sure yet we should really need (should we snap at all? should we not have a limit?)
      test.eq(test.compByName('testalign').getBoundingClientRect().top, test.compByName('inlineblock_letitcalc').getBoundingClientRect().top, "Top line of textarea and inline block letitcalc should align");
      test.eq(test.compByName('testalign').getBoundingClientRect().bottom, test.compByName('inlineblock_letitcalc').getBoundingClientRect().bottom, "Bottom line of textarea and inline blockletitcalc should align");

      test.eq(test.compByName('testalign').getBoundingClientRect().top, test.compByName('imgedit!preview').getBoundingClientRect().top, "Top line of textarea and imgedit should align");
      test.eq(test.compByName('testalign').getBoundingClientRect().bottom, test.compByName('imgedit!preview').getBoundingClientRect().bottom, "Bottom line of textarea and imgedit should align");
    }

  , "Verify third grid row (inlineblocks with inline elements)"
  , async function()
    {
      test.eq(test.compByName('line2_2a').getBoundingClientRect().top, test.compByName('line2_2b').getBoundingClientRect().top, "Top line of Line 2.2A and Line 2.2B should align");
      test.eq(test.compByName('line2_2a').getBoundingClientRect().bottom, test.compByName('line2_2b').getBoundingClientRect().bottom, "Bottom line of Line 2.2A and Line 2.2B should align");

      //verify prefix and suffix are aligned with the label. 'bottom' is tricky due to labels receiving height:, but top seems safe ATM
      let line2_2a_label = test.compByName('line2_2a').closest('.line').querySelector('.label');
      test.eq(line2_2a_label.getBoundingClientRect().top, test.compByName('line2_2a').querySelector('.t-textedit__prefix').getBoundingClientRect().top);
      test.eq(line2_2a_label.getBoundingClientRect().top, test.compByName('line2_2a').querySelector('.t-textedit__suffix').getBoundingClientRect().top);

      let firstinlineblockholder = test.compByName('inlineblock_select1_cell');
      test.eq(firstinlineblockholder.querySelector("t-text").getBoundingClientRect().top, firstinlineblockholder.querySelector("t-inlineblock t-text").getBoundingClientRect().top, "Top line of label 'Select1' and 'SE1' should align");
      test.eq(firstinlineblockholder.querySelector("t-text").getBoundingClientRect().bottom, firstinlineblockholder.querySelector("t-inlineblock t-text").getBoundingClientRect().bottom, "Bottom line of label 'Select1' and 'SE1' should align");

      test.eq(test.compByName('line2_2a').getBoundingClientRect().top, test.compByName('line2_2c').getBoundingClientRect().top, "Top line of Line 2.2A and Line 2.2C should align");
      test.eq(test.compByName('line2_2a').getBoundingClientRect().bottom, test.compByName('line2_2c').getBoundingClientRect().bottom, "Bottom line of Line 2.2A and Line 2.2C should align");

      test.eq(test.compByName('line2_2a').getBoundingClientRect().top, test.compByName('line2_2d').getBoundingClientRect().top, "Top line of Line 2.2A and Line 2.2d should align");
      test.eq(test.compByName('line2_2a').getBoundingClientRect().bottom, test.compByName('line2_2d').getBoundingClientRect().bottom, "Bottom line of Line 2.2A and Line 2.2d should align");

      test.eq(test.compByName('line2_2a').getBoundingClientRect().top, test.compByName('line2_2e').getBoundingClientRect().top, "Top line of Line 2.2A and Line 2.2e should align");
      test.eq(test.compByName('line2_2a').getBoundingClientRect().bottom, test.compByName('line2_2e').getBoundingClientRect().bottom, "Bottom line of Line 2.2A and Line 2.2e should align");
    }

  , { name: 'gridupdate'
    , test:function(doc,win)
      {
        test.eq(0,test.qSA('.wh-radiobutton').length);
        test.eq(4,test.qSA('select').length);
        test.click(test.compByName('button')); //converts the select to a radiobutton
      }
    , waits: ['ui']
    }

  , { test:function(doc,win)
      {
        test.eq(2,test.qSA('.wh-radiobutton').length);
        test.eq(3,test.qSA('select').length);
      }
    }
  ]);
