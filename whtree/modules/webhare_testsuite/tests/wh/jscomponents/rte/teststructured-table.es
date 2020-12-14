import * as dompack from 'dompack';
import * as test from "@mod-tollium/js/testframework";
import * as rtetest from "@mod-tollium/js/testframework-rte";

test.registerTests(
  [ "Basic table checks"
  , async function()
    {
      await test.load('/.webhare_testsuite/tests/pages/rte/?editor=structured&toolbarlayout=td-class,p-class/b,i,u/action-properties');

      const driver = new rtetest.RTEDriver;
      driver.setSelection(driver.body.firstChild);

      //outside table, td-class should be disabled
      test.true(test.qS("select[data-button=td-class]").disabled, "No TD selected, expecting td-class to be disabled");

      /* The table looks something like this:
         +-----------------+
         | mystyle         |
         +--------+--------+
         | normal | normal |
         |        | normal |
         +--------+--------+
      */
      var tables = driver.body.getElementsByTagName('table');
      test.eq(1, tables.length);
      var trs = tables[0].getElementsByTagName('tbody')[0].getElementsByTagName('tr');
      test.eq(2, trs.length);

      var tds = trs[0].getElementsByTagName('td');
      test.eq(1, tds.length);
      var ps = tds[0].getElementsByTagName('p');
      driver.setSelection(ps[0]);

      test.false(test.qS("select[data-button=td-class]").disabled, "In table cell, expecting td-class!");
      test.eq("Normal cell", test.qS("select[data-button=td-class]").selectedOptions[0].textContent);

      test.eq(1, ps.length);
      test.eq('mystyle', ps[0].className);

      tds = trs[1].getElementsByTagName('td');
      test.eq(2, tds.length);
      ps = tds[0].getElementsByTagName('p');
      test.eq(1, ps.length);

      driver.setSelection(ps[0]); //select bottomleft cell
      test.eq("Normal cell", test.qS("select[data-button=td-class]").selectedOptions[0].textContent);
      test.eq(3, test.qS("select[data-button=td-class]").options.length);
      test.fill("select[data-button=td-class]", "red");

      test.true(tds[0].classList.contains("red"));
      test.false(tds[0].classList.contains("blue"));


      test.eq('normal', ps[0].className);
      ps = tds[1].getElementsByTagName('p');
      test.eq(2, ps.length);
      test.eq('normal', ps[0].className);

      driver.setSelection(ps[0]); //select bottom right cell
      test.eq("Normal cell", test.qS("select[data-button=td-class]").selectedOptions[0].textContent);

      test.fill("select[data-button=td-class]", "blue");
      test.false(tds[1].classList.contains("red"));
      test.true(tds[1].classList.contains("blue"));

      driver.setSelection(tds[0].querySelector('p')); //select bottomleft cell
      test.eq("Red Cell", test.qS("select[data-button=td-class]").selectedOptions[0].textContent);
      test.true(tds[0].classList.contains("red"));
      test.false(tds[0].classList.contains("blue"));

      test.fill("select[data-button=td-class]", "");
      test.false(tds[0].classList.contains("red"));
      test.false(tds[0].classList.contains("blue"));

      //Test editing a cell through the properties action
      let cellaction = await driver.executeProperties();
      let targetinfo = driver.rte.getTargetInfo(cellaction.detail.actiontarget);

      //inspect the targetinfo
      test.eq("cell", targetinfo.type);
      test.eq(2, targetinfo.numcolumns);
      test.eq(2, targetinfo.numrows);
      test.eq(0, targetinfo.datacell.row);
      test.eq(0, targetinfo.datacell.col);
      test.eq("table", targetinfo.tablestyletag);
      test.eq("", targetinfo.cellstyletag);

      //test updating settings
      targetinfo.datacell.row=1;
      targetinfo.datacell.col=1;
      targetinfo.cellstyletag="red";
      driver.rte.updateTarget(cellaction.detail.actiontarget, targetinfo);

      //reget the bottom left cell
      let secondrow = driver.qS('table > tbody > tr + tr');
      test.true(secondrow);
      test.eq('TH',secondrow.childNodes[0].nodeName);
      test.eq('TD',secondrow.childNodes[1].nodeName);
      test.true(secondrow.childNodes[0].classList.contains('red'));

      await test.wait(1); //need to give RTD time to update the <select>
      test.eq("Red Cell", test.qS("select[data-button=td-class]").selectedOptions[0].textContent);
    }

  , { name: 'checkresizers'
    , test: function(doc, win)
      {
        var rte = win.rte.getEditor();
        var table = rte.getContentBodyNode().getElementsByTagName('table')[0];
        const driver = new rtetest.RTEDriver;

        // Check if all resizers are present
        var resizers = rte.getContentBodyNode().parentNode.querySelectorAll('.wh-tableeditor-resize-col');
        test.eq(2, resizers.length, "column resizers");
        resizers = rte.getContentBodyNode().parentNode.querySelectorAll('.wh-tableeditor-resize-row');
        test.eq(2, resizers.length, "row resizers");
        resizers = rte.getContentBodyNode().parentNode.querySelectorAll('.wh-tableeditor-resize-table');
        test.eq(2, resizers.length, "table resizers");

        // Check resizer positions
        var coords = table.getBoundingClientRect();
        var el = test.getValidatedElementFromPoint(doc, coords.right, coords.top + 5, true);

        test.true(el, "column and row resizer");
        test.true(el.classList.contains('wh-tableeditor-resize-col'), "column and row resizer class 1");
        test.true(el.classList.contains('wh-tableeditor-resize-table'), "column and row resizer class 2");

        el = test.getValidatedElementFromPoint(doc, coords.left + driver.qS('table tr+tr th').offsetWidth, coords.top + 10, true);
        test.true(el, "column resizer rowspanned");
        test.false(el.classList.contains('wh-tableeditor-resize-col'), "column resizer rowspanned class 1");
        test.false(el.classList.contains('wh-tableeditor-resize-row'), "column resizer rowspanned class 2");
        test.false(el.classList.contains('wh-tableeditor-resize-table'), "column resizer rowspanned class 3");

        var tryx = coords.left + driver.qS('table tr+tr th').offsetWidth;
        var tryy = coords.bottom - 10;

        el = test.getValidatedElementFromPoint(doc, tryx, tryy, true);
        test.true(el, "column resizer");
        test.true(el.classList.contains('wh-tableeditor-resize-col'), "column resizer class 1");
        test.false(el.classList.contains('wh-tableeditor-resize-table'), "column resizer class 2");

        el = test.getValidatedElementFromPoint(doc, coords.left + 10, coords.top + table.getElementsByTagName('tr')[0].offsetHeight, true);
        test.true(el, "row resizer");
        test.true(el.classList.contains('wh-tableeditor-resize-row'), "row resizer class 1");
        test.false(el.classList.contains('wh-tableeditor-resize-table'), "row resizer class 2");

        el = test.getValidatedElementFromPoint(doc, coords.left + 10, coords.bottom - 2, true);
        test.true(el, "row and table resizer");

        test.true(el.classList.contains('wh-tableeditor-resize-row'), "row and table resizer class 1");
        test.true(el.classList.contains('wh-tableeditor-resize-table'), "row and table resizer class 2");
      }
    }

  , { name: 'checkstyle'
    , test: function(doc, win)
      {
        var rte = win.rte.getEditor();

        // The 'table' style should not be available as a selectable style
        var styles = rte.getAvailableBlockStyles();
        test.eq(0, styles.filter(style => style.istable).length);
      }
    }

  , { name: 'refilter table'
     , test: function(doc,win)
       {
         var rte=win.rte.getEditor();
         rte.setContentsHTML('<h1 class="heading1">H1</h1>'
                             + '<table class="table"><tbody>'
                               + '<tr> <td class="red"><p class="normal">EOS</p></td> <td class="blue"><p class="normal">Team </p></td> <td><p class="normal">EOS private pages </p></td> </tr>'
                               + '<tr> <td valign="top" width="33%"><p class="normal"> </p><p class="normal"> </p><ul class="unordered" style="margin-bottom: 0;"> <li><a href="x-richdoclink:RL-lnBTa-N_MXn3OmgJWn1P5g">Mission Statement</a></li> <li><a class="ITCTable" href="x-richdoclink:RL-JBJm6G_4uiG2MCK_AncNig" style="margin-top: 0; margin-bottom: 0;">Strategic Plan</a> </li> <li><a href="x-richdoclink:RL-Hg0k03zf3CyLJt04X8FJcw">Who\'s who </a></li> <li><a class="ITCTable" href="x-richdoclink:RL-qcvAUwTbxNNW1v5Sm89a-Q" style="margin-top: 0; margin-bottom: 0;">Internet pages</a></li> <li><a href="x-richdoclink:RL-Yge_CUL0hcDGvjoEhC6WCw">MSc topics EOS 2014/2015</a></li> <li>Posters EOS MSc topics 2015 </li> </ul> <blockquote class="quote" style="margin-top: 0;"> <p class="normal">-<a href="x-richdoclink:RL-QsoeIvbyqCJk_9FWpHEtVg">Methods</a> <br> -<a href="x-richdoclink:RL-wJvgXcyjtTAQYaPdKZ8oMA">Spatial Data Qualit</a>y<br> -<a href="x-richdoclink:RL-bTO0wx6YhU3ttPzhEhzrbg">Image Analysis</a><br> -<a href="x-richdoclink:RL-dRhU2ksUBfNV1Cu-w0h9Ug">Integration of imagery, point clouds and (3D) map data</a><br> -<a href="x-richdoclink:RL-pERBro9D3uz5WexVMfrwkA">Mapping and modeling indoor environments using RGB-D data</a></p> <p class="normal">-<a href="x-richdoclink:RL-cPcYGbGYA1px2vhfJr93jA">Information extraction from Airborne and Mobile Laser Scanner data</a></p> </blockquote><p class="normal"> </p></td> <td valign="top" width="44%"><h2 class="heading2"><b>As of </b> 1 July 2013</h2><p class="normal"> </p><ul class="unordered"> <li>Chair: Prof. Dr. Ir. M.G. <a href="x-richdoclink:RL-gTsQBWJl4JpTRnMZd6zSZw">Vosselman </a></li> <li>Vice chair and Portfolio manager Research: Prof. Dr. Ir. A. <a href="x-richdoclink:RL-9MWCnpkvLj24KK6MYXkT_Q">Stein</a></li> <li>Portfolio manager Education: J.P.G. <a href="x-richdoclink:RL-scfCzYW37BL4OSucbXQPDA">Bakx</a></li> <li>Portfolio manager Capacity Building: Ms. Dr. Ir. W. <a href="x-richdoclink:RL-a-Ww243zTGe49fM7EMWDvg">Bijker </a></li> <li>Management Assistant : Ms. T.K.A. <a href="x-richdoclink:RL-oXnNjmGVSoKydKQv_asmdQ">Brefeld </a></li> </ul> </td> <td valign="top" width="23%"><p class="normal"> </p><p class="normal"> </p><ul class="unordered" style="margin-bottom: 0;"> <li><a href="x-richdoclink:RL-2mvQUwmPnR2JS1NWKXP40w" style="margin-bottom: 0">Minutes</a> and other <a href="x-richdoclink:RL-oYM_WaUo8OP-NXHMMx-B9Q">social</a> information for department members only </li> </ul></td> </tr>'
                               + '<tr> <td><p class="normal">1</p>'
                                 + '<table class="table"><tbody><tr><td><p class="normal">2</p></td><td>3</td><td>4</td></tr></tbody></table>'
                               + '<p class="normal">9</p></td></tr>'
                             + '</tbody></table>');

         let body = rte.getContentBodyNode();
         let trs = body.querySelectorAll('tr');
         test.eq(3, trs.length);
         test.eq("wh-rtd__tablecell red", trs[0].querySelectorAll("td")[0].className);
         test.eq("wh-rtd__tablecell blue", trs[0].querySelectorAll("td")[1].className);

         rtetest.testEqHTMLEx(win, '<p class="normal">"EOS"</p><p class="normal">"Team"</p><p class="normal">"EOS private pages"</p>', trs[0]);
         rtetest.testEqHTMLEx(win, '<p class="normal">"1"</p><p class="normal">"2"</p><p class="mystyle">"3"</p><p class="mystyle">"4"</p><p class="normal">"9"</p>', trs[2]);
       }
    }

  , { name: 'insertcolumnbefore'
    , test: async function(doc,win)
      {
        var rte=win.rte.getEditor();
        rte.setCursor(rte.getContentBodyNode().querySelectorAll('td > p')[1],0);
        await rtetest.runWithUndo(rte, () => rte.executeAction('table-addcolumn-before'));

        let colgroups = rte.getContentBodyNode().querySelectorAll('col');
        test.eq(4, colgroups.length);
        test.true(parseInt(colgroups[1].style.width)<40); //properly inserted and smallest
      }
    }

  , { name: 'insertrowafter'
    , test: async function(doc,win)
      {
        var rte=win.rte.getEditor();
        let extendfromcell = rte.getContentBodyNode().querySelectorAll('td')[2];
        rte.setCursor(extendfromcell.querySelector('p'),0);
        await rtetest.runWithUndo(rte, () => rte.executeAction('table-addrow-after'));

        let trs = rte.getContentBodyNode().querySelectorAll('tr');
        test.eq(4, trs.length);

        //Adding a row should not change our selection
        test.true(extendfromcell == dompack.closest(rte.getSelectionRange().getAncestorElement(),'td'));

        let newtd = trs[1].cells[2];
        test.eq("", newtd.textContent, "new cell must be empty");
        test.true(newtd.classList.contains("wh-rtd__tablecell"), 'new cell must be proper');
        test.eq(1, newtd.colSpan);
        test.false(newtd.hasAttribute("colspan"), 'no need to explicitly set the colspan attribute');
      }
    }

  , { name: 'insertrowabove'
    , test: async function(doc,win)
      {
        var rte=win.rte.getEditor();
        let extendfromcell = rte.getContentBodyNode().querySelectorAll('tr')[2].cells[0];
        rte.setCursor(extendfromcell.querySelector('p'),0);
        await rtetest.runWithUndo(rte, () => rte.executeAction('table-addrow-before'));

        let trs = rte.getContentBodyNode().querySelectorAll('tr');
        let newtd = trs[2].cells[2];
        test.true(newtd.offsetHeight < 50, "shouldn't have copied height from original row");
      }
    }

  , { name: 'mergetoright'
    , test: async function(doc,win)
      {
        var rte=win.rte.getEditor();
        rte.setContentsHTML('<table class="table"><tbody>'
                               + '<tr> <td><p class="normal">1</p></td> <td><p class="normal">2</p></td> <td><p class="normal">3</p></td> </tr>'
                               + '<tr> <td><p class="normal">4</p></td> <td><p class="normal">5</p></td> <td><p class="normal">6</p></td> </tr>'
                               + '<tr> <td><p class="normal">7</p></td> <td><p class="normal">8</p></td> <td><p class="normal">9</p></td> </tr>'
                             + '</tbody></table>');

        let tdp = rte.getContentBodyNode().querySelectorAll('td > p')[4];
        rte.setCursor(tdp,0);
        await rtetest.runWithUndo(rte, () => rte.executeAction('table-mergeright'));
        test.eq(2, tdp.parentNode.colSpan);
        test.eq('56', tdp.parentNode.textContent);
        test.eq(8, rte.getContentBodyNode().querySelectorAll('td').length);

        rte.setCursor(tdp,0);
        await rtetest.runWithUndo(rte, () => rte.executeAction('table-splitcols'));
        test.eq(1, tdp.parentNode.colSpan);
        test.eq('56', tdp.parentNode.textContent);
        test.eq(9, rte.getContentBodyNode().querySelectorAll('td').length);

        tdp = rte.getContentBodyNode().querySelectorAll('td > p')[0];
        rte.setCursor(tdp,0);
        await rtetest.runWithUndo(rte, () => rte.executeAction('table-mergeright'));
        test.eq(8, rte.getContentBodyNode().querySelectorAll('td').length);
        await rtetest.runWithUndo(rte, () => rte.executeAction('table-splitcols'));
        test.eq(9, rte.getContentBodyNode().querySelectorAll('td').length);
        test.eq('12', tdp.parentNode.textContent);
      }
    }

  , { name: 'mergedown'
    , test: async function(doc,win)
      {
        var rte=win.rte.getEditor();
        rte.setContentsHTML('<table class="table"><tbody>'
                               + '<tr> <td><p class="normal">1</p></td> <td><p class="normal">2</p></td> <td><p class="normal">3</p></td> </tr>'
                               + '<tr> <td><p class="normal">4</p></td> <td><p class="normal">5</p></td> <td><p class="normal">6</p></td> </tr>'
                               + '<tr> <td><p class="normal">7</p></td> <td><p class="normal">8</p></td> <td><p class="normal">9</p></td> </tr>'
                             + '</tbody></table>');

        let tdp = rte.getContentBodyNode().querySelectorAll('td > p')[4];
        rte.setCursor(tdp,0);
        await rtetest.runWithUndo(rte, () => rte.executeAction('table-mergedown'));
        test.eq(2, tdp.parentNode.rowSpan);
        test.eq('58', tdp.parentNode.textContent);
        test.eq(8, rte.getContentBodyNode().querySelectorAll('td').length);

        rte.setCursor(tdp,0);
        await rtetest.runWithUndo(rte, () => rte.executeAction('table-splitrows'));
        test.eq(1, tdp.parentNode.rowSpan);
        test.eq('58', tdp.parentNode.textContent);
        test.eq(9, rte.getContentBodyNode().querySelectorAll('td').length);

        tdp = rte.getContentBodyNode().querySelectorAll('td > p')[0];
        rte.setCursor(tdp,0);
        await rtetest.runWithUndo(rte, () => rte.executeAction('table-mergedown'));
        test.eq(8, rte.getContentBodyNode().querySelectorAll('td').length);
        await rtetest.runWithUndo(rte, () => rte.executeAction('table-splitrows'));
        test.eq(9, rte.getContentBodyNode().querySelectorAll('td').length);
        test.eq('14', tdp.parentNode.textContent);
      }
    }

  , { name: 'complicatedsplit'
    , test: async function(doc,win)
      {
        let rte=win.rte.getEditor();
        let tdp;

        rte.setContentsHTML('<table class="table"><tbody>'
                               + '<tr> <td rowspan="2" colspan="2"><p class="normal">1</p></td>          <td><p class="normal">3</p></td> </tr>'
                               + '<tr>                                                                   <td><p class="normal">6</p></td> </tr>'
                               + '<tr> <td><p class="normal">7</p></td> <td><p class="normal">8</p></td> <td><p class="normal">9</p></td> </tr>'
                             + '</tbody></table>');

        tdp = rte.getContentBodyNode().querySelectorAll('td > p')[0];
        rte.setCursor(tdp,0);
        await rtetest.runWithUndo(rte, () => rte.executeAction('table-splitcols'));

        test.eq(1, tdp.parentNode.colSpan);
        test.eq(2, tdp.parentNode.rowSpan);
        test.eq(1, tdp.parentNode.nextSibling.colSpan);
        test.eq(2, tdp.parentNode.nextSibling.rowSpan);
        test.eq('1', tdp.parentNode.textContent);
        test.eq('', tdp.parentNode.nextSibling.textContent);
        test.eq('3', tdp.parentNode.nextSibling.nextSibling.textContent);

        rte.setContentsHTML('<table class="table"><tbody>'
                               + '<tr> <td rowspan="2" colspan="2"><p class="normal">1</p></td>          <td><p class="normal">3</p></td> </tr>'
                               + '<tr>                                                                   <td><p class="normal">6</p></td> </tr>'
                               + '<tr> <td><p class="normal">7</p></td> <td><p class="normal">8</p></td> <td><p class="normal">9</p></td> </tr>'
                             + '</tbody></table>');

        tdp = rte.getContentBodyNode().querySelectorAll('td > p')[0];
        rte.setCursor(tdp,0);
        await rtetest.runWithUndo(rte, () => rte.executeAction('table-splitrows'));

        let trs = rte.getContentBodyNode().querySelectorAll('tr');

        test.eq(2, trs[0].firstChild.colSpan);
        test.eq(1, trs[0].firstChild.rowSpan);
        test.eq(2, trs[1].firstChild.colSpan);
        test.eq(1, trs[0].firstChild.rowSpan);
        test.eq('1', trs[0].firstChild.textContent);
        test.eq('', trs[1].firstChild.textContent);
        test.eq('7', trs[2].firstChild.textContent);
      }
    }

  , { name: 'insertrowwithspans'
    , test: async function(doc,win)
      {
        var rte=win.rte.getEditor();

        // In combination with col/rowspans
        rte.setContentsHTML(
'<table class="table"><tbody>'
+ '<tr> <td            ><p class="normal">0</p></td> <td><p class="normal">1</p></td> <td rowspan="2"><p class="normal">2</p></td> <td            ><p class="normal">3</p></td> </tr>'
+ '<tr> <td colspan="2"><p class="normal">4</p></td>                                                                               <td rowspan="2"><p class="normal">5</p>'
+ '<tr> <td            ><p class="normal">6</p></td> <td><p class="normal">7</p></td> <td            ><p class="normal">8</p></td> </tr>'
+'</tbody></table>');

        test.eq(
`td-1-1,td-1-1,td-2-1,td-1-1\n` +
`td-1-2,` +          `td-2-1\n` +
`td-1-1,td-1-1,td-1-1`,
          Array.from(rte.getContentBodyNode().querySelectorAll("tr")).map(tr => Array.from(tr.querySelectorAll("td,th")).map(td => `${td.nodeName.toLowerCase()}-${td.rowSpan}-${td.colSpan}`).join(",")).join("\n"));

        let tdp = rte.getContentBodyNode().querySelectorAll('td > p')[4];
        rte.setCursor(tdp,0);
        await rtetest.runWithUndo(rte, () => rte.executeAction('table-addrow-after'));

        rte.setCursor(tdp,0);
        await rtetest.runWithUndo(rte, () => rte.executeAction('table-addrow-before'));

        test.eq(
`td-1-1,td-1-1,td-3-1,td-1-1\n` +
`td-1-2,` +          `td-1-1\n` +
`td-1-2,` +          `td-3-1\n` +
`td-1-2,` +   `td-1-1` +   `\n` +
`td-1-1,td-1-1,td-1-1` +   ``,
          Array.from(rte.getContentBodyNode().querySelectorAll("tr")).map(tr => Array.from(tr.querySelectorAll("td,th")).map(td => `${td.nodeName.toLowerCase()}-${td.rowSpan}-${td.colSpan}`).join(",")).join("\n"));
      }
    }

  , "Remove the table"
  , async function()
    {
      //select a cell
      const driver = new rtetest.RTEDriver;
      driver.setSelection(driver.qS("td p"));

      let cellaction = await driver.executeProperties();
      driver.rte.updateTarget(cellaction.detail.actiontarget, { removetable: true });

      test.false(driver.qS("table"));
    }

  ]);
