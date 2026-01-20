import * as test from '@mod-tollium/js/testframework';
import * as tt from "@mod-webhare_testsuite/js/tolliumtest-wts";

test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/layout.layouttest");
    },

    {
      name: 'openform',
      test: function (doc, win) {
        test.click(test.getMenu(['M01', 'A05']));
      },
      waits: ['ui']
    },

    {
      name: 'verifybox',
      test: function (doc, win) {
        test.eq(2, test.qSA('.t-screen').length);

        const emptytext = test.compByName('emptytext');
        const settext = test.compByName('settext');
        const longlabeltext = test.compByName('longlabel');
        const nolabeltext = test.compByName('nolabel');
        const nolabeltext_wrapped = test.compByName('nolabel_wrapped');
        const nolabeltext_crs = test.compByName('nolabel_crs');

        const emptytextline = emptytext.parentNode.closest('div');
        const settextline = settext.parentNode.closest('div');

        test.assert(emptytext.offsetHeight >= 8);
        //        console.log("#1", emptytext, settext);
        test.eq(settextline.offsetHeight, emptytextline.offsetHeight); //must have same height
        test.assert(settext.offsetWidth >= settext.scrollWidth, "#settext scrollWidth > offsetWidth - the text is being truncated!");

        const settextlinelabel = settextline.querySelector('t-text.label');
        test.assert(settextlinelabel.offsetWidth > 20); //label should be there
        test.assert(settextlinelabel.offsetHeight > 8); //label should be there

        //long and nolabel should be aligned
        test.eq(longlabeltext.getBoundingClientRect().left, settext.getBoundingClientRect().left);
        test.eq(longlabeltext.getBoundingClientRect().left, nolabeltext.getBoundingClientRect().left, 'nolabeltext did not align with longlabeltext');

        //and should be gridsize (28) apart
        test.eq(settext.getBoundingClientRect().top + 28, longlabeltext.getBoundingClientRect().top, 'longlabel should be 28px below settext');
        test.eq(longlabeltext.getBoundingClientRect().top + 28, nolabeltext.getBoundingClientRect().top, 'nolabel should be 28px below longlabel');

        const longlabellabel = test.qSA("t-text").filter(text => text.textContent?.includes('a longer label'))[0];
        test.assert(longlabellabel.getBoundingClientRect().right <= longlabeltext.getBoundingClientRect().left);

        //the wrapping/cr versions are exactly twice the text of the nolabeltext, and should in the end have the same sizes (one implicitly through wordwrap)
        //Rob: FireFox makes the multiline text a pixel wider, though
        test.eq(nolabeltext.offsetWidth, nolabeltext_wrapped.offsetWidth);
        test.eq(nolabeltext.offsetWidth, nolabeltext_crs.offsetWidth);

        //split and snappedpanel should be aligned to the grid ( we align the whole panel)
        test.eq(0, (test.compByName('layouttest_splitrow2').getBoundingClientRect().top - test.compByName('snappedpanel').getBoundingClientRect().top) % tt.metrics.gridRowHeight, 'splitrow2 and nolabeltext_wrapped did not align to the grid');

        //no overlapping
        test.assert(nolabeltext_wrapped.getBoundingClientRect().bottom <= nolabeltext_crs.getBoundingClientRect().top, 'nolabeltext_wrapped and nolabeltext_crs overlapped (' + nolabeltext_wrapped.getBoundingClientRect().bottom + "," + nolabeltext_crs.getBoundingClientRect().top + ')');

        //no overlapping
        const longest_text = longlabellabel.parentElement?.nextElementSibling?.querySelector('t-text');
        test.assert(longest_text!.getBoundingClientRect().right <= longlabellabel.parentElement!.getBoundingClientRect().right, "text extends out of line, right is " + longest_text!.getBoundingClientRect().right + ', max was ' + longlabellabel.parentElement!.getBoundingClientRect().right);
      }
    },

    {
      name: 'verifybox-wrapequality',
      test: function (doc, win) {
        const nolabeltext_wrapped = test.compByName('nolabel_wrapped');
        const nolabeltext_crs = test.compByName('nolabel_crs');
        test.eq(nolabeltext_wrapped.offsetHeight, nolabeltext_crs.offsetHeight, "nolabel_wrapped should be just as high as nolabel_crs. it wrapped in unexpected places");
      }
    },

    {
      name: 'verifyalignmodes',
      test: function (doc, win) {
        //mode should not affect positioning if no titles are specified
        test.eq(test.compByName('mode_left').getBoundingClientRect().left, test.compByName('mode_right').getBoundingClientRect().left);
        test.eq(test.compByName('mode_left').getBoundingClientRect().left, test.compByName('mode_form').getBoundingClientRect().left);
      }
    },

    {
      name: 'verifyspacers',
      test: function (doc, win) {
        const label = test.qSA("t-text").filter(text => text.textContent?.includes('label'))[0];
        test.eq('label:', label.textContent); //Semicolons

        const aligntest = test.compByName('grid_aligntest');

        const cells = test.qSA("t-text").filter(text => text.textContent?.includes('cell'));
        test.eq(3, cells.length); //3 cells
        test.assert(cells[0].getBoundingClientRect().right < cells[1].getBoundingClientRect().left, "expected a spacer between the grid cells");

        test.eq(aligntest.getBoundingClientRect().left, cells[0].getBoundingClientRect().left, "leftmost cell of grid should NOT have a spacer before it and align with the text above (" + aligntest.getBoundingClientRect().left + "," + cells[0].getBoundingClientRect().left + ")");
      }
    },
    {
      name: 'verifyellipsis',
      test: function (doc, win) {
        const valuenode = test.compByName('ellipsistest');
        //compare with panel width minus padding 2*10px
        test.eq(valuenode.closest('t-panel').offsetWidth - 20, valuenode.offsetWidth);
      }
    }
  ]);
