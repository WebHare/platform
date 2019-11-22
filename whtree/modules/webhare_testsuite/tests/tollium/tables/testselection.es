import test from '@mod-tollium/js/testframework';
import * as dompack from 'dompack';
import { qSA } from 'dompack';


function getSelection(node_tbl)
{
  return qSA(node_tbl,'.todd-table__cell--selected').filter(node => dompack.closest(node, '.todd-table') == node_tbl);
}

function hasFocus(node)
{
  let active = node.ownerDocument.activeElement;
  return node === active || node.contains(active);
}

test.registerTests(
  [ { loadpage: test.getTestScreen('tests/tables.selectiontest')
    , waits: [ 'ui' ]
    }

  , { name: 'selectcell'
    , test: function(doc,win)
      {
        // Check if cell 0:0 is selected

        var node_tbl = test.compByName("tbl");
        var selected = getSelection(node_tbl);
        test.eq(1, selected.length);
        test.eq('0:0', selected[0].getAttribute('data-todd-cellpos'));

        var node_newsel = node_tbl.querySelector('[data-todd-cellpos="1:1"]');
        test.click(node_newsel);

        selected = getSelection(node_tbl);
        test.eq(1, selected.length);
        test.eq('1:1', selected[0].getAttribute('data-todd-cellpos'));

        // Get current selection state
        test.click(test.getMenu(['M01']));
      }
    , waits: [ 'ui' ]
    }

  , { name: 'reportselect-single'
    , test: function(doc,win)
      {
        var textarea = test.$$t('textarea')[0];
        test.eq('single/single\n1:1', textarea.value.trim());

        // Move to multiple selection
        test.click(test.getMenu(['M02']));
      }
    , waits: [ 'ui' ]
    }

  , { name: 'innerselect' //test that the outer table does not respond to selections made in the inner table in cell(2,2)
    , test: function(doc,win)
      {
        var outertable = test.compByName('tbl');
        var selected = getSelection(outertable);
        test.eq(1, selected.length);
        test.eq('1:1', selected[0].getAttribute('data-todd-cellpos'));

        var innertableholder = outertable.querySelector('[data-todd-cellpos="2:2"]');
        var innertable = innertableholder.querySelector('.todd-table');

        selected = getSelection(innertable);
        test.eq(1, selected.length);
        test.eq('1:0', selected[0].getAttribute('data-todd-cellpos'));

        var node_newsel = innertable.querySelector('[data-todd-cellpos="0:0"]');
        test.click(node_newsel);

        selected = getSelection(innertable);
        test.eq(1, selected.length);
        test.eq('0:0', selected[0].getAttribute('data-todd-cellpos'));

        selected = getSelection(outertable);
        test.eq(1, selected.length);
        test.eq('1:1', selected[0].getAttribute('data-todd-cellpos')); //should be untouched

        // Disable inner table selection
        test.click(test.getMenu(['M03']));
      }
    , waits: [ 'ui' ]
    }

  , { name: 'addselect'
    , test: function(doc,win)
      {
        var textarea = test.$$t('textarea')[0];
        test.eq('multiple/single\n1:1', textarea.value.trim());

        var node_tbl = test.compByName("tbl");
        var node_newsel = node_tbl.querySelector('[data-todd-cellpos="2:2"]');

        // Select new node.
        test.click(node_newsel, {...test.keyboardMultiSelectModifier});
        var selected = getSelection(node_tbl);
        test.eq(2, selected.length);
        test.eq('1:1', selected[0].getAttribute('data-todd-cellpos'));
        test.eq('2:2', selected[1].getAttribute('data-todd-cellpos'));

        // Get current selection state
        test.click(test.getMenu(['M01']));
      }
    , waits: [ 'ui' ]
    }

  , { name: 'reportselect-multiple'
    , test: function(doc,win)
      {
        var textarea = test.$$t('textarea')[0];
        test.eq('multiple/none\n1:1\n2:2', textarea.value.trim());

        // Move to select none
        test.click(test.getMenu(['M02']));
      }
    , waits: [ 'ui' ]
    }

  , { name: 'reportselect-none'
    , test: function(doc,win)
      {
        var textarea = test.$$t('textarea')[0];
        test.eq('none/none', textarea.value.trim());
      }
    }

  , { name: 'click-unselectable'
    , test: async function(doc,win)
      {
        // Move to select single
        test.click(test.getMenu(['M02']));
        await test.wait("ui");

        var node_tbl = test.compByName("tbl");
        test.click(node_tbl.querySelector('[data-todd-cellpos="0:0"]'));
        await test.wait("events");

        test.click(test.$$t('textarea')[0]);
        await test.wait("events");

        test.false(hasFocus(node_tbl));
        test.click(node_tbl.querySelector('[data-todd-cellpos="1:2"]'));
        await test.wait("events");

        test.true(hasFocus(node_tbl));

        // click on selectable element when other element has focus
        test.click(test.compByName("list").querySelector(".listrow span"));
        await test.wait("events");
        test.false(hasFocus(node_tbl));
        test.true(test.compByName("button").classList.contains("todd--disabled"));

        test.click(node_tbl.querySelector('[data-todd-cellpos="1:2"]'));
        await test.wait("events");
        test.true(hasFocus(node_tbl));
        test.false(test.compByName("button").classList.contains("todd--disabled"));

        // click on non-selectable element when other element has focus
        test.click(test.compByName("list").querySelector(".listrow span"));
        await test.wait("events");
        test.false(hasFocus(node_tbl));
        test.true(test.compByName("button").classList.contains("todd--disabled"));

        test.click(node_tbl.querySelector('[data-todd-cellpos="1:2"]'));
        await test.wait("events");
        test.true(hasFocus(node_tbl));
        test.false(test.compByName("button").classList.contains("todd--disabled"));

      }
    }

  ]);
