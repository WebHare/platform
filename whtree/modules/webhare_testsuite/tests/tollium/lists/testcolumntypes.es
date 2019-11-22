import * as test from '@mod-tollium/js/testframework';


function getListRowCells(list, findtext)
{
  var row = test.qSA(list,'.listrow').filter(listrow => listrow.textContent.includes(findtext))[0];
  var rowcells = Array.from(row.childNodes).filter(node=>node.matches("span"));
  return rowcells;
}

test.registerTests(
  [ { loadpage: test.getTestScreen('tests/lists.columntypes')
    , waits: [ 'ui' ]
    }
  , { name: 'statictree'
    , test: function(doc,win)
      {
        //Test whether distribute sizes bothered to make use of all available room for the columns
        var list = test.compByName('list1');

        var row1cells = getListRowCells(list, "<R01>");
        var row2cells = getListRowCells(list, "<D02>");
        var row3cells = getListRowCells(list, "<A03>");
        var row4cells = getListRowCells(list, "<A04>");
        var row5cells = getListRowCells(list, "<A05>");

        // test whether we got the expected amount of columns
        test.eq(10, row1cells.length);
        test.eq(10, row2cells.length);
        test.eq(10, row3cells.length);

        // test whether <style>'s are picked up and applied correctly
        test.eqIn(["bold","700"], getComputedStyle(row1cells[3]).fontWeight);
        test.eq("italic", getComputedStyle(row2cells[5]).fontStyle);
        test.eqIn(["rgb(0, 0, 255)","#0000ff"], getComputedStyle(row4cells[5]).color);
        test.eqIn(["rgb(255, 0, 255)","#ff00ff"], getComputedStyle(row5cells[0].parentNode).backgroundColor);

        //rowicon
        test.true( row1cells[0].querySelector('img, canvas') != null);
        test.eq("hover row1cell0",  row1cells[0].querySelector('img, canvas').getAttribute("title"));
        test.true( row1cells[0].querySelector('img, canvas').getAttribute("data-toddimg").indexOf('soundon')!=-1);
        test.false(row2cells[0].querySelector('img, canvas') != null);
        test.true( row3cells[0].querySelector('img, canvas') != null);
        test.false(row3cells[0].querySelector('img, canvas').hasAttribute("title"));

        //icon
        test.false(row1cells[2].querySelector('img, canvas') != null);
        test.true( row2cells[2].querySelector('img, canvas') != null);
        test.true( row2cells[2].querySelector('img, canvas').getAttribute("data-toddimg").indexOf('computer')!=-1);
        test.eq("No.",  row2cells[2].querySelector('img, canvas').getAttribute("title"));

        // ADDME: find a way to test whether the hint on a icon column works?

        //icon+email
        test.false(row1cells[4].querySelector('img, canvas') != null);
        test.true( row2cells[4].querySelector('img, canvas') != null);
        test.true( row2cells[4].querySelector('img, canvas').getAttribute("data-toddimg").indexOf('computer')!=-1);

        test.true(                  row1cells[4].querySelector('a') != null);
        test.eq("mailto:info@example.net", row1cells[4].querySelector('a').href);
        test.eq("info@example.net",        row1cells[4].querySelector('a').textContent);

        // ADDME: test icon+url
        test.false(row1cells[5].querySelector('img, canvas') != null);
        test.true( row2cells[5].querySelector('img, canvas') != null);
        test.true( row2cells[5].querySelector('img, canvas').getAttribute("data-toddimg").indexOf('computer')!=-1);

        test.true(                  row1cells[5].querySelector('a') != null);
        test.eq("http://www.webhare.nl/", row1cells[5].querySelector('a').href);
        test.eq("http://www.webhare.nl",  row1cells[5].querySelector('a').textContent);

        test.false(                 row2cells[4].querySelector('a') != null);

        // alternative url
        test.eq("visit us!", row1cells[6].textContent);
        test.eq("http://www.webhare.nl/", row1cells[6].querySelector('a').href);
        test.eq("_blank", row1cells[6].querySelector('a').target);

        //date
        test.eq("", row1cells[7].textContent);
        test.eq("10-11-2012", row2cells[7].textContent);

        //time
        test.eq("09:08", row1cells[8].textContent);
        test.eq("00:00", row2cells[8].textContent);

        // ADDME: test datetime
        // ADDME: also test integer, integer64, money and blobrecord
      }
    }

  , { name: 'statictree-sort'
    , test: function(doc,win)
      {
        test.click(test.qSA('.listheader span').filter(span=>span.textContent.includes("Date"))[0]);

        /* First click on Date should sort: <R01> <R03> <R02> */
        test.true(test.getCurrentScreen().getListRow('list1','<R01>').getBoundingClientRect().top < test.getCurrentScreen().getListRow('list1','<A03>').getBoundingClientRect().top);
        test.true(test.getCurrentScreen().getListRow('list1','<A03>').getBoundingClientRect().top < test.getCurrentScreen().getListRow('list1','<D02>').getBoundingClientRect().top);

      }
    }

  , { name: 'clickiconcolumn'
    , test:function(doc,win)
      {
        //find the icon in col A03. icon is 16x16 so x:15/y:15 should work
        let listrow = test.getCurrentScreen().getListRow('list1','<A03>');
        let imgcell = listrow.childNodes[2];
        test.click(imgcell.querySelector('img, canvas'), { x:15, y: 15});
      }
    }

  ]);
