/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from '@mod-tollium/js/testframework';
import * as tt from "@mod-webhare_testsuite/js/tolliumtest-wts";

function getexpanded(row) {
  if (row.querySelector(".fa-caret-down"))
    return true;
  if (row.querySelector(".fa-caret-right"))
    return false;
  return null;
}
function clickRowExpander(row) {
  const expander = row.querySelector('span.expander');
  if (!expander)
    throw new Error("Unable to find exapnder");
  test.click(expander);
}
function getListRowCells(list, findtext) {
  const row = test.qSA(list, '.listrow').filter(listrow => listrow.textContent.includes(findtext))[0];
  const rowcells = Array.from(row.childNodes).filter(node => node.matches("span"));
  return rowcells;
}

test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen('tests/lists.basetest');
    },
    {
      name: 'statictree-headersize',
      test: function (doc, win) {
        //Test whether distribute sizes bothered to make use of all available room for the columns
        const list = test.qSA('.wh-ui-listview')[0];
        const headers = test.qSA(list, '.listheader > span');
        let totalwidth = 2; // borders
        headers.forEach(function (el) { totalwidth += el.offsetWidth; });
        test.eq(list.offsetWidth, totalwidth);
      }
    },

    {
      name: 'statictree-initialsort',
      test: function (doc, win) {
        /* Study the list! It should be sorted like this:
           Row #1, Row #1.1, Row #2, Row #3 */
        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #1|').getBoundingClientRect().top < test.getCurrentScreen().getListRow('staticlist', 'Row #1.1').getBoundingClientRect().top);
        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #1.1').getBoundingClientRect().top < test.getCurrentScreen().getListRow('staticlist', 'Row #1.2').getBoundingClientRect().top);
        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #1.2').getBoundingClientRect().top < test.getCurrentScreen().getListRow('staticlist', 'Row #2|').getBoundingClientRect().top);
        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #2|').getBoundingClientRect().top < test.getCurrentScreen().getListRow('staticlist', 'Row #3|').getBoundingClientRect().top);

        // Test if highlighted class is present
        const rownode = test.getCurrentScreen().getListRow('staticlist', 'Row #1|');
        test.assert(rownode !== null);
        test.assert(rownode.classList.contains("highlighted"));
      }
    },

    {
      name: 'statictree',
      test: function (doc, win) {
        //should be initially selected
        const listrow = test.getCurrentScreen().getListRow('staticlist', 'Row #2|');
        test.assert(listrow.classList.contains("wh-list__row--selected"));
        //should have 'grayedout' class
        test.assert(listrow.classList.contains("rowclass-grayedout"));

        const M02 = test.getMenu(['M01', 'M02']);
        test.assert(M02.classList.contains('disabled'));
        const B01 = test.compByName("forevenbutton");
        test.assert(B01.classList.contains('todd--disabled'));

        const M03 = test.getMenu(['M01', 'M03']);
        test.assert(!M03.classList.contains('disabled'));
        const B02 = test.compByName("foroddbutton");
        test.assert(!B02.classList.contains('todd--disabled'));

        //Select the first row
        test.click(test.getCurrentScreen().getListRow('staticlist', 'Row #1|'));
      },
      waits: ["ui"]
    },

    {
      test: function (doc, win) {
        test.eq('1', test.compByName("staticlistselection").textContent); //we didn't even touch it...

        //Row #1.1 is initially expanded, check for visibility
        test.assert(getexpanded(test.getCurrentScreen().getListRow('staticlist', 'Row #1|')));
        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #1.1') !== null);

        // Must have selected class
        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #1|').classList.contains("wh-list__row--selected"));

        //Row #2.1 is not initially expanded, and should NOT be visible
        test.assert(!getexpanded(test.getCurrentScreen().getListRow('staticlist', 'Row #2|')));
        test.assert(!test.getCurrentScreen().getListRow('staticlist', 'Row #2.1') !== null);

        const staticlist = test.compByName("staticlist");
        let cells = getListRowCells(staticlist, "Row #1|");
        test.eq("Row #1 is expanded", cells[2].textContent);

        cells = getListRowCells(staticlist, "Row #2|");
        test.eq("Row #2 doesn't care", cells[2].textContent);

        cells = getListRowCells(staticlist, "Row #3|");
        test.eq("Row #3 is ok", cells[2].textContent);

        //Expand row #2
        clickRowExpander(test.getCurrentScreen().getListRow('staticlist', 'Row #2|'));

        cells = getListRowCells(staticlist, "Row #2|");
        test.eq("Row #2 doesn't care", cells[2].textContent);

        //Expanding a row should not change the selection
        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #1|').classList.contains("wh-list__row--selected"));
        test.assert(!test.getCurrentScreen().getListRow('staticlist', 'Row #2|').classList.contains("wh-list__row--selected"));

        //Row #2.1 should be there now
        test.assert(getexpanded(test.getCurrentScreen().getListRow('staticlist', 'Row #2|')));
        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #2.1') !== null);

        //collapse row #1
        clickRowExpander(test.getCurrentScreen().getListRow('staticlist', 'Row #1|'));
        test.assert(!getexpanded(test.getCurrentScreen().getListRow('staticlist', 'Row #1|')));
        test.assert(getexpanded(test.getCurrentScreen().getListRow('staticlist', 'Row #2|')));
        test.assert(!test.getCurrentScreen().getListRow('staticlist', 'Row #1.1') !== null);
        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #2.1') !== null);

        cells = getListRowCells(staticlist, "Row #1|");
        test.eq("Row #1 is collapsed", cells[2].textContent);
      }
      //    , waits:["ui"]
    },

    {
      name: 'statictree-buttonplay',
      test: function (doc, win) {
        //note: the rowkeys are generated dynamically, row 1=1, etc
        //check selection
        test.eq('1', test.compByName("staticlistselection").textContent); //we didn't even touch it...

        //check button/menu
        const M02 = test.getMenu(['M01', 'M02']);
        test.assert(!M02.classList.contains('disabled'));
        const B01 = test.compByName("forevenbutton");
        test.assert(!B01.classList.contains('todd--disabled'));

        const M03 = test.getMenu(['M01', 'M03']);
        test.assert(M03.classList.contains('disabled'));
        const B02 = test.compByName("foroddbutton");
        test.assert(B02.classList.contains('todd--disabled'));

        const M05 = test.getMenu(['M01', 'M05']);
        test.assert(!M05.classList.contains('disabled'));
        const B05 = test.compByName("forevenbutton2");
        test.assert(!B05.classList.contains('todd--disabled'));

        //test.click(B05); //racy on IE/Edge
        test.sendMouseGesture([
          { el: B05, down: 0, x: "50%", y: "50%" },
          { el: B05, up: 0, x: "50%", y: "50%", delay: 500 }
        ]);
      },
      waits: ["pointer", "ui"]
    },

    {
      name: 'statictree-buttonplay2',
      test: function (doc, win) {
        //this should have selected and expanded Row#1.1
        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #1.1') !== null);
        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #1.1').classList.contains("wh-list__row--selected"));
        test.eq('2', test.compByName("staticlistselection").textContent); //we didn't even touch it...
      }
    },

    {
      name: 'statictree-sort',
      test: function (doc, win) {
        const spancol = test.qSA('.listheader span').filter(span => span.textContent.includes("Integer column"))[0];
        test.eq(null, spancol.querySelector(".sortdirection"));
        test.click(spancol);
        test.assert(spancol.classList.contains("sortascending"));
        test.click(spancol);
        test.assert(spancol.classList.contains("sortdescending"));

        /* Study the list! It should be sorted like this:
           Row #3, Row #2, Row #2.2, Row #2.1, Row #1, Row #1.2, Row #1.1 */
        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #4|').getBoundingClientRect().top < test.getCurrentScreen().getListRow('staticlist', 'Row #3|').getBoundingClientRect().top);
        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #3|').getBoundingClientRect().top < test.getCurrentScreen().getListRow('staticlist', 'Row #2|').getBoundingClientRect().top);
        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #2|').getBoundingClientRect().top < test.getCurrentScreen().getListRow('staticlist', 'Row #2.2').getBoundingClientRect().top);
        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #2.2').getBoundingClientRect().top < test.getCurrentScreen().getListRow('staticlist', 'Row #2.1').getBoundingClientRect().top);
        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #2.1').getBoundingClientRect().top < test.getCurrentScreen().getListRow('staticlist', 'Row #1|').getBoundingClientRect().top);
        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #1|').getBoundingClientRect().top < test.getCurrentScreen().getListRow('staticlist', 'Row #1.2').getBoundingClientRect().top);
        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #1.2').getBoundingClientRect().top < test.getCurrentScreen().getListRow('staticlist', 'Row #1.1').getBoundingClientRect().top);
      },
      waits: ["ui"]
    },
    {
      name: 'select invisible element',
      test: function (doc, win) {
        const M10 = test.getMenu(['M01', 'M10']);
        console.log("Click M10");
        test.click(M10);
      },
      waits: ["ui"]
    },

    {
      name: 'dynamictree',
      test: function (doc, win) {
        test.eq(0, test.qSA('.listheader span').filter(span => span.textContent.includes("Text col (asc)")).length);//should not be there, list is not sortable
        test.assert(test.getCurrentScreen().getListRow('dynamiclist', 'haschildren 10').getBoundingClientRect().top < test.getCurrentScreen().getListRow('dynamiclist', '0 nochildren 10').getBoundingClientRect().top); //should retain original order


        test.assert(getexpanded(test.getCurrentScreen().getListRow('dynamiclist', 'haschildren 10')), 'expected children10 to be expanded');
        test.assert(!getexpanded(test.getCurrentScreen().getListRow('dynamiclist', 'haschildren 20')));

        //select nochildren row
        test.click(test.getCurrentScreen().getListRow('dynamiclist', '0 nochildren 10'));
        test.assert(test.getCurrentScreen().getListRow('dynamiclist', '0 nochildren 10').classList.contains("wh-list__row--selected"));

        clickRowExpander(test.getCurrentScreen().getListRow('dynamiclist', 'haschildren 20'));
        //the feedback should be immediate..
        test.assert(getexpanded(test.getCurrentScreen().getListRow('dynamiclist', 'haschildren 20')));
      },
      //, waits:["ui"]
      waits: [function () { return test.getCurrentScreen().getListRow('dynamiclist', 'haschildren 30') !== null; }]
    },


    {
      name: 'dynamictree-dynexpand',
      test: function (doc, win) {
        //FIXME Inspecting the JSON output, it looks like the entire list is re-sent by Tollium in NG mode (old Todd is better). should only send new rows...

        test.assert(getexpanded(test.getCurrentScreen().getListRow('dynamiclist', 'haschildren 20')));
        test.assert(!getexpanded(test.getCurrentScreen().getListRow('dynamiclist', 'haschildren 30')));

        //should still be selected
        test.assert(test.getCurrentScreen().getListRow('dynamiclist', '0 nochildren 10').classList.contains("wh-list__row--selected"));
        test.eq('11', test.compByName("dynamiclistselection").textContent); //we didn't even touch it...

        //test multi selection
        test.click(test.getCurrentScreen().getListRow('dynamiclist', '0 nochildren 20'), { cmd: true });
      },
      waits: ["ui"]
    },

    {
      name: 'dynamictree-multiselect',
      test: function (doc, win) {
        test.assert(getexpanded(test.getCurrentScreen().getListRow('dynamiclist', 'haschildren 20')));
        test.assert(!getexpanded(test.getCurrentScreen().getListRow('dynamiclist', 'haschildren 30')));
        test.assert(test.getCurrentScreen().getListRow('dynamiclist', '0 nochildren 10').classList.contains("wh-list__row--selected"));
        test.assert(test.getCurrentScreen().getListRow('dynamiclist', '0 nochildren 20').classList.contains("wh-list__row--selected"));
        test.eq('11 21', test.compByName("dynamiclistselection").textContent);
      }
    },

    {
      name: 'contextmenu',
      test: function (doc, win) {
        let ctxtmenu = test.qS('.toddContextMenu');
        test.assert(ctxtmenu === null);

        test.sendMouseGesture([
          { el: test.getCurrentScreen().getListRow('staticlist', 'Row #2|'), down: 2 },
          { up: 2 }
        ]);
        ctxtmenu = test.getOpenMenu();
        test.assert(ctxtmenu);

        //odd and something should be available (note: failing these test may also point to focus issues, if the list isn't receiving focus at contextmenu click)
        const MC01 = test.qSA(ctxtmenu, "li").filter(li => li.textContent.includes('MC01'))[0];
        const MC02 = test.qSA(ctxtmenu, "li").filter(li => li.textContent.includes('MC02'))[0];
        const MC03 = test.qSA(ctxtmenu, "li").filter(li => li.textContent.includes('MC03'))[0];
        test.assert(!MC01);
        test.assert(MC02);
        test.assert(MC03);

        //ensure that the divider there is invisible
        const divider = ctxtmenu.querySelector("li.divider");
        test.assert(divider.classList.contains('hidden'));

        //move the mouse to option MC02. it should hover and be auto selected (as the menu is active)
        test.sendMouseGesture([{ el: MC02 }]);
        test.assert(MC02.classList.contains('selected'));

        //select option MC03
        test.click(MC03); //'do something'
      },
      waits: ["ui"]
    },


    {
      name: 'contextmenu-checkclick',
      test: function (doc, win) {
        //the menu should have left the DOM
        test.eq(null, test.qS('.toddContextMenu'));
        //check selection after clicking 'do something'
        test.eq('1', test.compByName("staticlistselection").textContent);

        // focusdependentactions
        test.click(test.getCurrentScreen().getListRow('staticlist', 'Row #1.2'));
        const B05 = test.compByName("forevenbutton2");
        test.assert(!B05.classList.contains('todd--disabled'));

        const M05 = test.getMenu(['M01', 'M05']);
        test.assert(!M05.classList.contains('disabled'));
        test.click(M05);
      },
      waits: ['ui']
    },

    {
      test: function (doc, win) {
        test.eq('2', test.getCurrentScreen().getText("staticlistselection"));

        //collapse Row #2
        clickRowExpander(test.getCurrentScreen().getListRow('staticlist', 'Row #2|'));
      }
    },

    async function checkBoxes() {
      //verify checkboxes
      test.eq('2', test.getCurrentScreen().getText("staticlistselection"));
      test.eq('', test.getCurrentScreen().getText("staticlistchecked"));//should still be empty, as the event isn't triggered yet
      //click the checkbox of row#1.1
      test.click(test.getCurrentScreen().getListRow('staticlist', 'Row #1.1').querySelector('input[type="checkbox"]'));
      await test.waitForUI();

      // checkbox click result'
      test.eq('[2,cbox] 4 3 7', test.getCurrentScreen().getText("staticlistchecked"));
      test.click(test.getCurrentScreen().getListRow('staticlist', 'Row #3|').querySelector('input[type="checkbox"]'));
      await test.waitForUI({ optional: true });

      // disabled checkbox click result
      test.eq('[2,cbox] 4 3 7', test.getCurrentScreen().getText("staticlistchecked"));

      // clicking on the label for the hidden checkbox
      test.click(test.qSA(test.getCurrentScreen().getListRow('staticlist', 'Row #1.2'), 'span').filter(node => node.textContent === "3")[0]);
      await test.waitForUI({ optional: true });
      test.eq('[2,cbox] 4 3 7', test.getCurrentScreen().getText("staticlistchecked"));

      // Move to selectmode 'none'
      test.click(test.getMenu(['M01', 'M14']));
      await test.waitForUI();

      // repeat label click for invisible checkbox
      test.click(test.qSA(test.getCurrentScreen().getListRow('staticlist', 'Row #1.2'), 'span').filter(node => node.textContent === "3")[0]);
      await test.waitForUI();
      test.eq('[2,cbox] 4 3 7', test.getCurrentScreen().getText("staticlistchecked"));

      // Restore selectmode 'single'
      test.click(test.getMenu(['M01', 'M14']));
      await test.waitForUI();
    },

    {
      name: 'empty text is hidden',
      test: function (doc, win) {
        test.eq(0, test.qSA('.emptytextholder')[0].offsetHeight);
        test.eq('', test.qSA('.emptytext')[0].textContent);

        test.click(test.getMenu(['M01', 'M07']));
      },
      waits: ['ui']
    },

    {
      name: 'empty text is shown but empty',
      test: function (doc, win) {
        test.assert(test.qSA('.emptytextholder')[0].offsetHeight !== 0);
        test.eq('', test.qSA('.emptytext')[0].textContent);

        test.click(test.getMenu(['M01', 'M08']));
      },
      waits: ['ui']
    },

    {
      name: 'empty text is shown and non-empty',
      test: function (doc, win) {
        test.assert(test.qSA('.emptytextholder')[0].offsetHeight !== 0);
        test.eq('empty 1', test.qSA('.emptytext')[0].textContent);

        test.click(test.getMenu(['M01', 'M08']));
      },
      waits: ['ui']
    },

    {
      name: 'empty text is changed, multiline',
      test: function (doc, win) {
        test.assert(test.qSA('.emptytextholder')[0].offsetHeight !== 0);
        test.eq('empty 2\nsecond line', test.qSA('.emptytext')[0].textContent);

        // Show some lines again
        test.click(test.getMenu(['M01', 'M06']));
      },
      waits: ['ui']
    },

    {
      name: 'empty text is hidden again',
      test: function (doc, win) {
        test.assert(test.qSA('.emptytextholder')[0].offsetHeight === 0);
      }
    },

    {
      name: 'sort-fallback',
      test: function (doc, win) {
        let spancol = test.qSA('.listheader span').filter(span => span.textContent.includes("Text col"))[0];
        test.click(spancol);

        // Sort on integer column, see if the server sort is used as fallback for equal values
        spancol = test.qSA('.listheader span').filter(span => span.textContent.includes("Integer column"))[0];
        test.eq(null, spancol.querySelector(".sortdirection"));
        test.click(spancol);
        test.assert(spancol.classList.contains("sortascending"));

        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #001').getBoundingClientRect().top < test.getCurrentScreen().getListRow('staticlist', 'Row #299').getBoundingClientRect().top);
        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #299').getBoundingClientRect().top < test.getCurrentScreen().getListRow('staticlist', 'Row #002').getBoundingClientRect().top);
        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #002').getBoundingClientRect().top < test.getCurrentScreen().getListRow('staticlist', 'Row #298').getBoundingClientRect().top);
        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #298').getBoundingClientRect().top < test.getCurrentScreen().getListRow('staticlist', 'Row #003').getBoundingClientRect().top);

        test.click(spancol);
        test.assert(spancol.classList.contains("sortdescending"));

        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #150').getBoundingClientRect().top < test.getCurrentScreen().getListRow('staticlist', 'Row #151').getBoundingClientRect().top);
        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #151').getBoundingClientRect().top < test.getCurrentScreen().getListRow('staticlist', 'Row #149').getBoundingClientRect().top);
        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #149').getBoundingClientRect().top < test.getCurrentScreen().getListRow('staticlist', 'Row #152').getBoundingClientRect().top);
        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #152').getBoundingClientRect().top < test.getCurrentScreen().getListRow('staticlist', 'Row #148').getBoundingClientRect().top);

        // Init sort by ordering
        test.click(test.getMenu(['M01', 'M09']));
      },
      waits: ["ui"]
    },

    {
      name: 'sort-by-ordering',
      test: function (doc, win) {
        let spancol = test.qSA('.listheader span').filter(span => span.textContent.includes("Text col"))[0];
        test.eq(null, spancol.querySelector(".sortdirection"));
        spancol = test.qSA('.listheader span').filter(span => span.textContent.includes("Integer column"))[0];
        test.eq(null, spancol.querySelector(".sortdirection"));

        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #001').getBoundingClientRect().top < test.getCurrentScreen().getListRow('staticlist', 'Row #299').getBoundingClientRect().top);
        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #299').getBoundingClientRect().top < test.getCurrentScreen().getListRow('staticlist', 'Row #002').getBoundingClientRect().top);
        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #002').getBoundingClientRect().top < test.getCurrentScreen().getListRow('staticlist', 'Row #298').getBoundingClientRect().top);
        test.assert(test.getCurrentScreen().getListRow('staticlist', 'Row #298').getBoundingClientRect().top < test.getCurrentScreen().getListRow('staticlist', 'Row #003').getBoundingClientRect().top);
      }
    },

    {
      name: 'column-resize',
      test: async function (doc, win) {
        // Test if column resize is at least functional
        const splittercol = test.qS('.listheader .splitter');

        const oldleft = splittercol.offsetLeft;
        await test.sendMouseGesture([
          { el: splittercol, down: 0, x: 0 },
          { el: splittercol, up: 0, x: -20 }
        ]);

        test.eq(oldleft - 20, splittercol.offsetLeft);
      }
    },

    {
      name: 'focusin',
      test: async function (doc, win) {
        test.eq('0', test.compByName("staticlistfocusincount").textContent);

        test.click(test.compByName("dynamiclist"));

        // enable focusin
        test.click(test.getMenu(['M01', 'M15']));
        await test.wait("ui");
        test.click(test.compByName("staticlist"));
        await test.wait("ui");

        test.eq('1', test.compByName("staticlistfocusincount").textContent);

        test.click(test.compByName("dynamiclist"));
        test.click(test.compByName("staticlist"));

        await test.wait("ui");
        test.eq('2', test.compByName("staticlistfocusincount").textContent);

        test.click(test.getCurrentScreen().getListRow('staticlist', 'Row #001').querySelector('input[type="checkbox"]'));
        await test.wait("ui");
        test.eq('2', test.compByName("staticlistfocusincount").textContent);

        test.click(test.compByName("dynamiclist"));
        test.click(test.compByName("staticlist"));
        await test.wait("ui");
        test.eq('3', test.compByName("staticlistfocusincount").textContent);
      }
    }
  ]);
