import * as test from "@mod-tollium/js/testframework";
//FIXME fix and test ClearSelection

test.registerTests(
  [ { loadpage: test.getTestSiteRoot() + 'testpages/listtest/'
    }

  , { name: 'selection'
    , test: function(doc,win)
      {
        test.fill(test.qS('#selectmode'), 'single');

        //As general class names are standardized for CSS-ers, we should be reasonably safe using them in the tests
        test.click(test.getListViewRow('Rij #0.'));

        test.true(test.getListViewRow('Rij #0.').classList.contains("selected"));
        test.click(test.getListViewRow('Rij #1.'));

        test.eq(1, test.qSA("#listview .selected").length);
        test.true(test.getListViewRow('Rij #1.').classList.contains("selected"));

        //reclicking doesn't change a thing
        test.click(test.getListViewRow('Rij #1.'));
        test.eq(1, test.qSA("#listview .selected").length);
        test.true(test.getListViewRow('Rij #1.').classList.contains("selected"));

        //friendly single select lists still allow us to use ctrl+click to unselect
        test.click(test.getListViewRow('Rij #1.'), {cmd:true});
        test.eq(0, test.qSA("#listview .selected").length);

        //current rendering should be showing rows up to #18, and #19 is rendered because some scenarios show 2 partial rows, and #19 is the second partial row
        test.true(test.getListViewRow('Rij #18') != null);
        test.true(test.getListViewRow('Rij #19.') != null);
        test.false(test.getListViewRow('Rij #20.') != null);
      }
    }

  , { name: 'contextmenu'
    , test:function(doc,win)
      {
        test.fill(test.qS('#selectmode'), 'single');
        test.click(test.getListViewRow('Rij #0.'));
        test.eq(0, win.numcontexts);

        var el = test.getListViewRow('Rij #2.');
        test.sendMouseGesture([{el:el, down:2} ]);
        test.eq(1, win.numcontexts);
        test.false(test.getListViewRow('Rij #0.').classList.contains("selected"));
        test.true(test.getListViewRow('Rij #2.').classList.contains("selected"));

        test.sendMouseGesture([{el:test.getListViewRow('Rij #2.'), up:2}
                         ]);
      }
    }

  , { name: 'clickoutsidelist'
    , test: function(doc,win)
      {
        test.fill(test.qS('#datasource'), 'smallsource');
        test.eq(0, test.qSA("#listview .selected").length);

        test.click(test.getListViewRow('Rij #2.'));
        test.true(test.getListViewRow('Rij #2.').classList.contains("selected"));
        test.eq(1, test.qSA("#listview .selected").length);

        test.qS('#datasource').focus();
        //test.eq(test.qS('#datasource'), $wh.getCurrentlyFocusedElement());

        test.click(test.qS('#listview'), {y:300}); //SHOULD deselect..
        test.eq(0, test.qSA("#listview .selected").length);

        //test.eq(test.qS('#listview'), $wh.getCurrentlyFocusedElement()); //should receive focus

        test.click(test.getListViewRow('Rij #2.'));
        test.true(test.getListViewRow('Rij #2.').classList.contains("selected"));

        test.sendMouseGesture([{el:test.qS('#listview'), y:300, down:2} //contextmenu should deselect too (ADDME: sure? or just put focus here?)
                         ]);

        test.eq(0, test.qSA("#listview .selected").length);
        test.sendMouseGesture([{up:2}
                         ]);
      }
    }

  , { name: 'multiselect'
    , test: function(doc,win)
      {
        test.fill(test.qS('#datasource'), 'immediatesource');
        test.fill(test.qS('#selectmode'), 'multiple');

        test.eq(0, test.qSA('#listview .selected').length);
        test.click(test.getListViewRow('Rij #0.'));
        test.eq(1, test.qSA('#listview .selected').length);
        test.click(test.getListViewRow('Rij #1.'));
        test.eq(1, test.qSA('#listview .selected').length);

        test.false(test.getListViewRow('Rij #0.').classList.contains("selected"));
        test.false(win.immediatesource.selected.includes(0));
        test.true(test.getListViewRow('Rij #1.').classList.contains("selected"));
        test.true(win.immediatesource.selected.includes(1));

        test.click(test.getListViewRow('Rij #2.'), { cmd: true, x: 5 });
        test.eq(2, test.qSA('#listview .selected').length);

        test.click(test.getListViewRow('Rij #2.'), { cmd: true, x: 50 });
        test.eq(1, test.qSA('#listview .selected').length, "Different x coordinates, don't want a double-click. row should have been unselected");
      }
    }

  , { name: 'checkbox'
    , test: function(doc,win)
      {
        test.eq(1, test.qSA('#listview .selected').length);
        test.true(test.getListViewRow('Rij #1.').classList.contains("selected"));

        //click the checkbox on the second row
        test.true(test.getListViewRow('Rij #3.').querySelector('input[type="checkbox"]').checked);
        test.true(win.immediatesource.checked.includes(3));
        test.fill(test.getListViewRow('Rij #3.').querySelector('input[type="checkbox"]'), false);

        test.false(test.getListViewRow('Rij #3.').querySelector('input[type="checkbox"]').checked);
        test.false(win.immediatesource.checked.includes(3));

        test.fill(test.getListViewRow('Rij #3.').querySelector('input[type="checkbox"]'), true);
        test.true(test.getListViewRow('Rij #3.').querySelector('input[type="checkbox"]').checked);
        test.true(win.immediatesource.checked.includes(3));

        //shouldn't change selection
        test.eq(1, test.qSA('#listview .selected').length);
        test.true(test.getListViewRow('Rij #1.').classList.contains("selected"));
      }
    }

  , { name: 'treeexpand'
    , test:function(doc,win)
      {
        test.fill(test.qS('#selectmode'), 'single');
        test.fill(test.qS('#datasource'), 'treesource');

        test.false(test.getListViewExpanded(test.getListViewRow('B-Lex'))); //should be initially expandable but not expanded
        test.true(test.getListViewExpanded(test.getListViewRow('Kleine sites'))); //should be initially expanded
        test.true(test.getListViewRow('Subitem')!=null);
        test.eq(null, test.getListViewExpanded(test.getListViewRow('Subitem')));

        test.eq(3, test.qSA('#listview .listrow').length);
        test.true(test.getListViewRow('B-Lex').querySelector('.expander') != null);
        test.click(test.getListViewRow('B-Lex').querySelector('.expander'));
        test.true(test.getListViewExpanded(test.getListViewRow('B-Lex')));
        test.eq(5, test.qSA('#listview .listrow').length);
        test.true(test.getListViewRow('Designfiles b-lex')!=null);

        test.click(test.getListViewRow('B-Lex').querySelector('.expander'));
        test.false(test.getListViewExpanded(test.getListViewRow('B-Lex')));
        test.eq(3, test.qSA('#listview .listrow').length);
        test.false(test.getListViewRow('Designfiles b-lex')!=null);
      }
    }

  , { name: 'multirow'
    , test:function(doc,win)
      {
        test.fill(test.qS('#selectmode'), 'single');
        test.fill(test.qS('#datasource'), 'multirowsource');

        //current rendering should be showing rows up to #9 and #10
        test.true(test.getListViewRow('Rij #9') != null);
        test.true(test.getListViewRow('Rij #10') != null, 'row #10 should be in the dom');
        test.false(test.getListViewRow('Rij #11') != null, 'row #11 shouldnt be in the dom');
       }
    }
  ]);
