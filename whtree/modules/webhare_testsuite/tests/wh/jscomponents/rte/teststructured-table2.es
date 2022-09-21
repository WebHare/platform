import * as test from "@mod-tollium/js/testframework";
import * as rtetest from "@mod-tollium/js/testframework-rte";

test.registerTests(
  [
    { loadpage: '/.webhare_testsuite/tests/pages/rte/?editor=structured&fill=tables2'
    // Wait 5 seconds for the RTE to fully load so the tableeditor has a change to correctly position itself
    //, waits: [ 'ui', 5000 ] //  { wait:  }
    }


  , { name: 'checktable'
    , test: function(doc, win)
      {
        var rte = win.rte.getEditor();
        var tables = rte.getContentBodyNode().getElementsByTagName('table');
        test.eq(2, tables.length);
      }
    }

  , 'paste paragraph in cell'
  , async function(doc, win)
    {
      // STORY: paste of entiry paragraph at end of table cell left an empty paragraph
      // STORY: paste of entiry paragraph at end of table cell broke the table into two subtables
      let rte = win.rte.getEditor();
      let body = rte.getContentBodyNode();
      await test.wait(10);
      body.focus();

      rtetest.setStructuredContent(win, `<table class="table wh-rtd-table wh-rtd__table" style="width: 200px;"><colgroup class="wh-tableeditor-colgroup"><col style="width: 199px;"></colgroup><tbody>` +
`<tr style="height: 18px;"><td class="wh-rtd__tablecell"><p class="normal">"aap"</p></td></tr>` +
`<tr style="height: 18px;"><td class="wh-rtd__tablecell"><p class="normal">"noot(*0*)(*1*)"</p></td></tr>` +
`<tr style="height: 18px;"><td class="wh-rtd__tablecell"><p class="normal">"mies"</p></td></tr>` +
`</tbody></table><p class="normal">"insert me"</p><p class="normal">"extra paragraph"</p>`);

      // Paste of whole paragraph at end of cell paragraph broke the table into two tables
      await rtetest.runWithUndo(rte, () => rtetest.paste(rte,
                                          { typesdata: { "text/html": `<meta charset='utf-8'><p class="normal" style="box-sizing: border-box; padding: 0px; margin: 0px; font-weight: 400; color: rgb(0, 0, 0); font-family: Arial, sans-serif; font-size: 13.3333px; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; letter-spacing: normal; orphans: 2; text-align: -webkit-left; text-indent: 0px; text-transform: none; white-space: normal; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; background-color: rgb(255, 255, 255); text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial;">ddd</p><br class="Apple-interchange-newline">` }
                                          , files: []
                                          , items: []
                                          }), { waits: 1 });

      // table not split into two tables?
      let tables = rte.getContentBodyNode().getElementsByTagName('table');
      test.eq(1, tables.length);

      // no trailing empty paragraph left?
      test.eq(`<p class="normal">nootddd</p>`, tables[0].querySelectorAll("td")[1].innerHTML);
    }
  ]);
