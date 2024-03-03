/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from "@mod-tollium/js/testframework";
import { browser } from "@webhare/dompack";
//FIXME fix and test ClearSelection

test.registerTests(
  [
    async function () {
      await test.load(test.getTestSiteRoot() + 'testpages/listtest/');
      test.assert(!test.qS("#listview.wh-ui-listview--columnselect"));
    },

    {
      name: 'selection',
      test: function (doc, win) {
        test.fill('#selectmode', 'single');

        //As general class names are standardized for CSS-ers, we should be reasonably safe using them in the tests
        test.click(test.getListViewRow('Rij #0.'));

        test.assert(test.getListViewRow('Rij #0.').classList.contains("wh-list__row--selected"));
        test.assert(!test.qS(".list__row__cell--selected")); //no cell ANYWHERE should be selected
        test.click(test.getListViewRow('Rij #1.'));

        test.eq(1, test.qSA("#listview .wh-list__row--selected").length);
        test.assert(test.getListViewRow('Rij #1.').classList.contains("wh-list__row--selected"));

        //reclicking doesn't change a thing
        test.click(test.getListViewRow('Rij #1.'));
        test.eq(1, test.qSA("#listview .wh-list__row--selected").length);
        test.assert(test.getListViewRow('Rij #1.').classList.contains("wh-list__row--selected"));

        //friendly single select lists still allow us to use ctrl+click to unselect
        test.click(test.getListViewRow('Rij #1.'), { cmd: true });
        test.eq(0, test.qSA("#listview .wh-list__row--selected").length);

        //current rendering should be showing rows up to #18, and #19 is rendered because some scenarios show 2 partial rows, and #19 is the second partial row
        test.assert(test.getListViewRow('Rij #18') !== null);
        test.assert(test.getListViewRow('Rij #19.') !== null);
        test.assert(!test.getListViewRow('Rij #20.') !== null);
      }
    },

    {
      name: 'contextmenu',
      test: function (doc, win) {
        test.fill('#selectmode', 'single');
        test.click(test.getListViewRow('Rij #0.'));
        test.eq(0, win.numcontexts);

        const el = test.getListViewRow('Rij #2.');
        test.sendMouseGesture([{ el: el, down: 2 }]);
        test.eq(1, win.numcontexts);
        test.assert(!test.getListViewRow('Rij #0.').classList.contains("wh-list__row--selected"));
        test.assert(test.getListViewRow('Rij #2.').classList.contains("wh-list__row--selected"));

        test.sendMouseGesture([{ el: test.getListViewRow('Rij #2.'), up: 2 }]);
      }
    },

    {
      name: 'clickoutsidelist',
      test: function (doc, win) {
        test.fill('#datasource', 'smallsource');
        test.eq(0, test.qSA("#listview .wh-list__row--selected").length);

        test.click(test.getListViewRow('Rij #2.'));
        test.assert(test.getListViewRow('Rij #2.').classList.contains("wh-list__row--selected"));
        test.eq(1, test.qSA("#listview .wh-list__row--selected").length);

        test.qS('#datasource').focus();
        //test.eq(test.qS('#datasource'), $wh.getCurrentlyFocusedElement());

        test.click(test.qS('#listview'), { y: 300 }); //SHOULD deselect..
        test.eq(0, test.qSA("#listview .wh-list__row--selected").length);

        //test.eq(test.qS('#listview'), $wh.getCurrentlyFocusedElement()); //should receive focus

        test.click(test.getListViewRow('Rij #2.'));
        test.assert(test.getListViewRow('Rij #2.').classList.contains("wh-list__row--selected"));

        test.sendMouseGesture([{ el: test.qS('#listview'), y: 300, down: 2 } //contextmenu should deselect too (ADDME: sure? or just put focus here?)
        ]);

        test.eq(0, test.qSA("#listview .wh-list__row--selected").length);
        test.sendMouseGesture([{ up: 2 }]);
      }
    },

    {
      name: 'multiselect',
      test: function (doc, win) {
        test.fill('#datasource', 'immediatesource');
        test.fill('#selectmode', 'multiple');

        test.eq(0, test.qSA('#listview .wh-list__row--selected').length);
        test.click(test.getListViewRow('Rij #0.'));
        test.eq(1, test.qSA('#listview .wh-list__row--selected').length);
        test.click(test.getListViewRow('Rij #1.'));
        test.eq(1, test.qSA('#listview .wh-list__row--selected').length);

        test.assert(!test.getListViewRow('Rij #0.').classList.contains("wh-list__row--selected"));
        test.assert(!win.immediatesource.selected.includes(0));
        test.assert(test.getListViewRow('Rij #1.').classList.contains("wh-list__row--selected"));
        test.assert(win.immediatesource.selected.includes(1));

        test.click(test.getListViewRow('Rij #2.'), { cmd: true, x: 5 });
        test.eq(2, test.qSA('#listview .wh-list__row--selected').length);

        test.click(test.getListViewRow('Rij #2.'), { cmd: true, x: 50 });
        test.eq(1, test.qSA('#listview .wh-list__row--selected').length, "Different x coordinates, don't want a double-click. row should have been unselected");
      }
    },

    {
      name: 'checkbox',
      test: function (doc, win) {
        test.eq(1, test.qSA('#listview .wh-list__row--selected').length);
        test.assert(test.getListViewRow('Rij #1.').classList.contains("wh-list__row--selected"));

        //click the checkbox on the second row
        test.assert(test.getListViewRow('Rij #3.').querySelector('input[type="checkbox"]').checked);
        test.assert(win.immediatesource.checked.includes(3));
        test.fill(test.getListViewRow('Rij #3.').querySelector('input[type="checkbox"]'), false);

        test.assert(!test.getListViewRow('Rij #3.').querySelector('input[type="checkbox"]').checked);
        test.assert(!win.immediatesource.checked.includes(3));

        test.fill(test.getListViewRow('Rij #3.').querySelector('input[type="checkbox"]'), true);
        test.assert(test.getListViewRow('Rij #3.').querySelector('input[type="checkbox"]').checked);
        test.assert(win.immediatesource.checked.includes(3));

        //shouldn't change selection
        test.eq(1, test.qSA('#listview .wh-list__row--selected').length);
        test.assert(test.getListViewRow('Rij #1.').classList.contains("wh-list__row--selected"));
      }
    },

    'multiselect empty list issues',
    async function () {
      test.fill('#datasource', 'emptysource');

      test.focus("#listview");
      await test.pressKey("A", browser.platform === "mac" ? { metaKey: true } : { ctrlKey: true });

      test.fill('#datasource', 'none');

      test.focus("#listview");
      await test.pressKey("A", browser.platform === "mac" ? { metaKey: true } : { ctrlKey: true });
    },

    'treeexpand',
    async function (doc, win) {
      test.fill('#selectmode', 'single');
      test.fill('#datasource', 'treesource');

      test.assert(!test.getListViewExpanded(test.getListViewRow('B-Lex'))); //should be initially expandable but not expanded
      test.assert(test.getListViewExpanded(test.getListViewRow('Kleine sites'))); //should be initially expanded
      test.assert(test.getListViewRow('Subitem') !== null);
      test.eq(null, test.getListViewExpanded(test.getListViewRow('Subitem')));

      test.eq(3, test.qSA('#listview .listrow').length);
      test.assert(test.getListViewRow('B-Lex').querySelector('.expander') !== null);
      test.click(test.getListViewRow('B-Lex').querySelector('.expander'));
      test.assert(test.getListViewExpanded(test.getListViewRow('B-Lex')));
      test.eq(5, test.qSA('#listview .listrow').length);
      test.assert(test.getListViewRow('Designfiles b-lex') !== null);

      test.click(test.getListViewRow('B-Lex').querySelector('.expander'));
      test.assert(!test.getListViewExpanded(test.getListViewRow('B-Lex')));
      test.eq(3, test.qSA('#listview .listrow').length);
      test.assert(!test.getListViewRow('Designfiles b-lex') !== null);

      test.click(test.getListViewRow('Subitem'));
      test.eq(1, test.qSA("#listview .wh-list__row--selected").length);
      test.assert(test.getListViewRow('Subitem').classList.contains("wh-list__row--selected"));

      test.click(test.getListViewRow('B-Lex'));
      test.assert(!test.getListViewExpanded(test.getListViewRow('B-Lex')));
      await test.pressKey(['ArrowRight']);
      test.assert(test.getListViewExpanded(test.getListViewRow('B-Lex')));
      test.eq(1, test.qSA("#listview .wh-list__row--selected").length);
      test.assert(test.getListViewRow('B-Lex').classList.contains("wh-list__row--selected"));

      await test.pressKey(['ArrowRight']); //now has no effect
      test.eq(1, test.qSA("#listview .wh-list__row--selected").length);
      test.assert(test.getListViewRow('B-Lex').classList.contains("wh-list__row--selected"));
    },

    {
      name: 'multirow',
      test: function (doc, win) {
        test.fill('#selectmode', 'single');
        test.fill('#datasource', 'multirowsource');

        //current rendering should be showing rows up to #9 and #10
        test.assert(test.getListViewRow('Rij #9') !== null);
        test.assert(test.getListViewRow('Rij #10') !== null, 'row #10 should be in the dom');
        test.assert(!test.getListViewRow('Rij #11') !== null, 'row #11 shouldnt be in the dom');
      }
    }
  ]);
