import * as test from '@mod-tollium/js/testframework';


function getListRowCells(list: HTMLElement, findtext: string) {
  const row = test.qSA(list, '.listrow').filter(listrow => listrow.textContent?.includes(findtext))[0];
  const rowcells = [...row.children].filter(node => node.matches("span"));
  return rowcells;
}

test.registerTests(
  [
    {
      loadpage: test.getTestScreen('tests/lists.columntypes'),
      waits: ['ui']
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

        // test whether we got the expected amount of columns
        test.eq(10, row1cells.length);
        test.eq(10, row2cells.length);
        test.eq(10, row3cells.length);

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

        //date
        test.eq("", row1cells[7].textContent);
        test.eq("10-11-2012", row2cells[7].textContent);

        //time
        test.eq("9:08", row1cells[8].textContent);
        test.eq("0:00", row2cells[8].textContent);

        // ADDME: test datetime
        // ADDME: also test integer, integer64, money and blobrecord
      }
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
      test: function () {
        //find the icon in col A03. icon is 16x16 so x:15/y:15 should work
        const listrow = test.getCurrentScreen().getListRow('list1', '<A03>');
        const imgcell = listrow.childNodes[2];
        test.click(imgcell.querySelector('img, canvas'), { x: 15, y: 15 });
      }
    }

  ]);
