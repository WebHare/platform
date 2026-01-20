import * as test from '@mod-tollium/js/testframework';
import * as tt from "@mod-webhare_testsuite/js/tolliumtest-wts";

function getListRowCells(list: HTMLElement, findtext: string) {
  const row = test.qSA(list, '.listrow').filter(listrow => listrow.textContent?.includes(findtext))[0];
  const rowcells = [...row.children].filter(node => node.matches("span"));
  return rowcells;
}

function getListContents() {
  return JSON.parse(test.qR<HTMLTextAreaElement>("t-codeedit textarea").value);
}

test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/lists.hscroll");
    },
    {
      name: 'statictree',
      test: function () {
        //Test whether distribute sizes bothered to make use of all available room for the columns
        const list = test.compByName('list1');

        const row1cells = getListRowCells(list, "<R01>");
        const row2cells = getListRowCells(list, "<D02>");
        const row3cells = getListRowCells(list, "<A03>");
        const row4cells = getListRowCells(list, "<A04>");
        const row5cells = getListRowCells(list, "<A05>");
        const rowCells = [row1cells, row2cells, row3cells, row4cells, row5cells];
        const transposedCells = rowCells[0].map((_, colIndex) => rowCells.map(row => row[colIndex]));

        // test whether we got the expected amount of columns
        test.eq(13, row1cells.length);
        test.eq(row1cells.length, row2cells.length);
        test.eq(row1cells.length, row3cells.length);

        // test whether <style>'s are picked up and applied correctly
        test.eq("700", getComputedStyle(row1cells[3]).fontWeight);
        test.eq("italic", getComputedStyle(row2cells[5]).fontStyle);
        test.eq("rgb(0, 0, 255)", getComputedStyle(row4cells[5]).color);
        test.eq("rgb(255, 0, 255)", getComputedStyle(row5cells[0].parentNode as HTMLElement).backgroundColor);

        //rowicon
        test.assert(row1cells[0].querySelector('img, canvas'));
        test.eq("hover row1cell0", row1cells[0].querySelector('img, canvas')?.getAttribute("title"));
        test.assert(row1cells[0].querySelector('img, canvas')?.getAttribute("data-toddimg")?.indexOf('soundon') !== -1);
        test.assert(!row2cells[0].querySelector('img, canvas'));
        test.assert(row3cells[0].querySelector('img, canvas'));
        test.assert(!row3cells[0].querySelector('img, canvas')?.hasAttribute("title"));

        //icon
        test.assert(!row1cells[2].querySelector('img, canvas'));
        test.assert(row2cells[2].querySelector('img, canvas'));
        test.assert(row2cells[2].querySelector('img, canvas')?.getAttribute("data-toddimg")?.indexOf('mail_opened') !== -1);
        test.eq("No.", row2cells[2].querySelector('img, canvas')?.getAttribute("title"));

        // ADDME: find a way to test whether the hint on a icon column works?

        //icon+email
        test.assert(!row1cells[4].querySelector('img, canvas'));
        test.assert(row2cells[4].querySelector('img, canvas'));
        test.assert(row2cells[4].querySelector('img, canvas')?.getAttribute("data-toddimg")?.indexOf('mail_opened') !== -1);

        test.assert(row1cells[4].querySelector('a'));
        test.eq("mailto:info@example.net", row1cells[4].querySelector('a')?.href);
        test.eq("info@example.net", row1cells[4].querySelector('a')?.textContent);

        // ADDME: test icon+url
        test.assert(!row1cells[5].querySelector('img, canvas'));
        test.assert(row2cells[5].querySelector('img, canvas'));
        test.assert(row2cells[5].querySelector('img, canvas')?.getAttribute("data-toddimg")?.indexOf('mail_opened') !== -1);

        test.assert(row1cells[5].querySelector('a'));
        test.eq("http://www.webhare.nl/", row1cells[5].querySelector('a')?.href);
        test.eq("http://www.webhare.nl", row1cells[5].querySelector('a')?.textContent);

        test.assert(!row2cells[4].querySelector('a'));

        // alternative url
        test.eq("visit us!", row1cells[6].textContent);
        test.eq("http://www.webhare.nl/", row1cells[6].querySelector('a')?.href);
        test.eq("_blank", row1cells[6].querySelector('a')?.target);

        //inline items
        test.eq("<i>Italic</i> text", row1cells[7].innerHTML);
        test.eq("rgb(255, 0, 0)", getComputedStyle(row1cells[7]).backgroundColor);
        test.eq("Text <b>in bold</b>", row2cells[7].innerHTML);
        test.eq("", row3cells[7].innerHTML);

        //date
        test.eq("", row1cells[8].textContent);
        test.eq("10-11-2012", row2cells[8].textContent);

        //time
        test.eq("9:08", row1cells[9].textContent);
        test.eq("0:00", row2cells[9].textContent);

        //checkbox
        test.eq(false, row1cells[11].querySelector('input')?.checked);
        test.eq(false, row1cells[11].querySelector('input')?.indeterminate);
        test.eq(true, row2cells[11].querySelector('input')?.checked);
        test.eq(false, row2cells[11].querySelector('input')?.indeterminate);
        test.eq(true, row3cells[11].querySelector('input')?.indeterminate);

        //floats
        test.eq(["3 komma 5", "", "", "0,00", "7,50"], transposedCells[12].map(cell => cell.textContent));
        test.eq(["rgb(0, 255, 0)", "rgba(0, 0, 0, 0)", "rgb(255, 0, 255)", "rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"], transposedCells[12].map(cell => getComputedStyle(cell).backgroundColor));

        // ADDME: test datetime
        // ADDME: also test integer, integer64, money and blobrecord
      }
    },

    'Click checkboxes',
    async function () {
      const list = test.compByName('list1');
      test.eq('', tt.comp("feedback").getValue());
      test.eq([false, true, "indeterminate", false, false], getListContents().map((row: any) => row.cbox1_value));

      test.click(getListRowCells(list, "<R01>")[11].querySelector('input')!); //toggle first row
      await test.wait('ui');

      test.eq('OnCheck: <R01> cbox1_value', tt.comp("feedback").getValue());
      test.eq([true, true, "indeterminate", false, false], getListContents().map((row: any) => row.cbox1_value));

      test.click(getListRowCells(list, "<A03>")[11].querySelector('input')!); //toggle indeermiante one
      await test.wait('ui');

      test.eq('OnCheck: <A03> cbox1_value', tt.comp("feedback").getValue());
      test.eq([true, true, true, false, false], getListContents().map((row: any) => row.cbox1_value));

      test.click(getListRowCells(list, "<A03>")[11].querySelector('input')!); //toggle indeermiante one
      await test.wait('ui');
      test.eq([true, true, false, false, false], getListContents().map((row: any) => row.cbox1_value));
    },

    {
      name: 'statictree-sort',
      test: function () {
        test.click(test.qSA('.listheader span').filter(span => span.textContent?.includes("Date"))[0]);

        /* First click on Date should sort: <R01> <R03> <R02> */
        test.assert(test.getCurrentScreen().getListRow('list1', '<R01>').getBoundingClientRect().top < test.getCurrentScreen().getListRow('list1', '<A03>').getBoundingClientRect().top);
        test.assert(test.getCurrentScreen().getListRow('list1', '<A03>').getBoundingClientRect().top < test.getCurrentScreen().getListRow('list1', '<D02>').getBoundingClientRect().top);

      }
    },

    {
      name: 'clickiconcolumn',
      test: async function () {
        //find the icon in col A03. icon is 16x16 so x:15/y:15 should work
        const listrow = test.getCurrentScreen().getListRow('list1', '<A03>');
        const imgcell = listrow.childNodes[2];
        test.click(imgcell.querySelector('img, canvas'), { x: 15, y: 15 });

        await test.wait('ui');
        test.eq('Iconclick: <A03> icon', tt.comp("feedback").getValue());
      }
    }

  ]);
