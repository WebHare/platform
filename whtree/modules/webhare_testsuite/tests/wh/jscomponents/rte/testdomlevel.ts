/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from "@mod-tollium/js/testframework";
import * as richdebug from '@mod-tollium/web/ui/components/richeditor/internal/richdebug';
import * as domlevel from '@mod-tollium/web/ui/components/richeditor/internal/domlevel';
import Range from '@mod-tollium/web/ui/components/richeditor/internal/dom/range';

function cloneWithLocatorText(node: Node, locators: domlevel.Locator[], options?: { textQuote: string }) {
  options = { textQuote: '"', ...options };
  if (node.nodeType === 3) {
    let text = options.textQuote;
    for (let i = 0; i <= node.nodeValue!.length; ++i) {
      for (let l = 0; l < locators.length; ++l)
        if (locators[l].element === node && locators[l].offset === i)
          text += '(*' + l + '*)';
      text += node.nodeValue!.substring(i, i + 1);
    }
    return document.createTextNode(text + options.textQuote);
  }

  //var nodes = [];
  const copy = node.cloneNode(false) as HTMLElement;

  for (let i = 0; i <= node.childNodes.length; ++i) {
    for (let l = 0; l < locators.length; ++l)
      if (locators[l].element === node && locators[l].offset === i) {
        copy.append('(*' + l + '*)');
      }
    const child = node.childNodes[i];
    if (child)
      copy.appendChild(cloneWithLocatorText(child, locators, options));
  }

  return copy;
}

function testEqHTMLEx(expect: string, node: HTMLElement, locators: domlevel.Locator[], options?: { textQuote: string }) {
  options = { textQuote: '"', ...options };
  const actual = cloneWithLocatorText(node, locators || [], { textQuote: options.textQuote }).innerHTML;
  test.eqHTML(expect, actual);
}

function getAllLocators(win, node): domlevel.Locator[] {
  return richdebug.getAllLocatorsInNode(node);
}

function InitLocatorsId(locators) {
  for (let i = 0; i < locators.length; ++i)
    locators[i].id = i;
}

// Sample code:
//  console.log('data', domlevel.getStructuredOuterHTML(rte.getBody(), { }));

const useblockfill = true;

test.registerTests(
  [
    {
      loadpage: '/.webhare_testsuite/tests/pages/rte/?editor=free'
    },

    "Locator comparing", //test first because the RTE init might even fail otherwise
    function () {
      const testel = document.createElement("div");
      testel.innerHTML = '<i><b>abc</b>def<u>ghi</u></i>';

      const locators = getAllLocators(null, testel.firstChild);
      testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a(*3*)b(*4*)c(*5*)"(*6*)</b>(*7*)"(*8*)d(*9*)e(*10*)f(*11*)"(*12*)<u>(*13*)"(*14*)g(*15*)h(*16*)i(*17*)"(*18*)</u>(*19*)</i>', testel, locators);

      for (let a = 0; a < locators.length; ++a)
        for (let b = 0; b < locators.length; ++b) {
          test.eq(a === b ? 0 : a < b ? -1 : 1, locators[a].compare(locators[b]));
        }
    },
    {
      name: 'firsttest',
      test: function (doc, win) {
        const rte = win.rte.getEditor();

        // First test, place to paste failing tests
        const movetests =
          [
            '<div>"a(*0*)(*2*)b(*1*)(*3*)c"</div>',
            '<div>"a"<b>"(*0*)(*2*)b(*1*)(*3*)"</b>"c"</div>',
            '<div>"a"<img></img>"test"<b>"(*0*)(*2*)b(*1*)(*3*)"</b>"c"</div>',
            '<p>"hmmm hmm"</p><img src="/tests/webhare.png">"test"<b>"(*0*)(*2*)Bo ld!(*1*)(*3*)"</b>"en nog een "<a href="http://example.org/">"hyperlink"</a>"!"<p>"regel 2"</p><p>"image met "<a href="#link">"een hyperlink: "<img src="/tests/webhare.png"></a></p>'
          ];

        for (let i = 0; i < movetests.length; ++i) {
          console.log('test ', i, movetests[i]);

          rte.setContentsHTML(movetests[i]);
          const locators = richdebug.unstructureDom(rte.getBody());
          const range = new Range(locators[0], locators[1]);
          range.normalize(rte.getBody());

          test.assert(range.start.equals(locators[2]));
          test.assert(range.end.equals(locators[3]));
        }
      }
    },

    {
      name: 'locators',
      test: function (doc, win) {
        const rte = win.rte.getEditor();

        rte.setContentsHTML('<i><b>abc</b>def<u>ghi</u></i>');
        test.eq('<i><b>abc</b>def<u>ghi</u></i>', win.rte.getValue().toLowerCase());

        // Locator ascending
        rte.setContentsHTML('<i><b><br><br></b></i>');

        const locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<br>(*2*)<br>(*3*)</b>(*4*)</i>', rte.getBody(), locators);

        const italicnode = locators[0].element;

        // Test moveToParent
        let loc = locators[1].clone();
        test.assert(loc.moveToParent(false));
        test.assert(loc.equals(locators[0]));

        loc = locators[2].clone();
        test.assert(!loc.moveToParent(false));
        test.assert(loc.equals(locators[2]));

        loc = locators[3].clone();
        test.assert(loc.moveToParent(false));
        test.assert(loc.equals(locators[4]));

        loc = locators[2].clone();
        test.assert(loc.moveToParent(false, true));
        test.assert(loc.equals(locators[0]));

        loc = locators[2].clone();
        test.assert(loc.moveToParent(true, true));
        test.assert(loc.equals(locators[4]));

        // Test ascend
        test.assert(locators[0].equals(locators[1].clone().ascend(italicnode)));
        test.assert(locators[2].equals(locators[2].clone().ascend(italicnode)));
        test.assert(locators[4].equals(locators[3].clone().ascend(italicnode)));

        test.assert(locators[0].equals(locators[1].clone().ascend(italicnode, false, true)));
        test.assert(locators[0].equals(locators[2].clone().ascend(italicnode, false, true)));
        test.assert(locators[4].equals(locators[3].clone().ascend(italicnode, false, true)));

        test.assert(locators[0].equals(locators[1].clone().ascend(italicnode, true, true)));
        test.assert(locators[4].equals(locators[2].clone().ascend(italicnode, true, true)));
        test.assert(locators[4].equals(locators[3].clone().ascend(italicnode, true, true)));
      }
    },

    {
      name: 'locatoractions',
      test: function (doc, win) {
        const rte = win.rte.getEditor();

        rte.setContentsHTML('<div><p>a</p><p><br _moz_editor_bogus_node="_moz"></p></div>');
        let locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('<div>(*0*)<p>(*1*)"(*2*)a(*3*)"(*4*)</p>(*5*)<p>(*6*)<br _moz_editor_bogus_node="_moz">(*7*)</p>(*8*)</div>', rte.getBody(), locators);

        let newelt = document.createElement('br');
        locators[4].insertNode(newelt, locators);
        testEqHTMLEx('<div>(*0*)<p>(*1*)"(*2*)a(*3*)"<br>(*4*)</p>(*5*)<p>(*6*)<br _moz_editor_bogus_node="_moz">(*7*)</p>(*8*)</div>', rte.getBody(), locators);

        newelt = document.createElement('br');
        locators[7].insertNode(newelt, locators);
        testEqHTMLEx('<div>(*0*)<p>(*1*)"(*2*)a(*3*)"<br>(*4*)</p>(*5*)<p>(*6*)<br><br>(*7*)</p>(*8*)</div>', rte.getBody(), locators);

        rte.setContentsHTML('<div><p>a<br></p><p><br><br></p></div>');
        locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('<div>(*0*)<p>(*1*)"(*2*)a(*3*)"(*4*)<br>(*5*)</p>(*6*)<p>(*7*)<br>(*8*)<br>(*9*)</p>(*10*)</div>', rte.getBody(), locators);
        locators[4].removeNode(locators);
        testEqHTMLEx('<div>(*0*)<p>(*1*)"(*2*)a(*3*)"(*4*)(*5*)</p>(*6*)<p>(*7*)<br>(*8*)<br>(*9*)</p>(*10*)</div>', rte.getBody(), locators);
      }
    },

    {
      name: 'locatormove',
      test: function (doc, win) {
        const rte = win.rte.getEditor();

        /* Locator is put at (*0*)
            (*1*): move past last visible
            (*2*): move past last visible, place in text
            (*3*): move to first visible, place in text
            (*4*): move to first visible
            (*5*): previous block boundary
            (*6*): pext block boundary
        */

        const movetests =
          [
            '<div>(*5*)"a (*0*)(*1*)(*2*)(*3*)(*4*)b"(*6*)</div>',

            '<div>(*0*)(*1*)(*5*)"(*2*)(*3*)(*4*)a  b "<br>"ab"(*6*)<div>"babla"</div></div>',
            '<div>(*1*)(*5*)"(*0*)(*2*)(*3*)(*4*)a  b "<br>"ab"(*6*)<div>"babla"</div></div>',
            '<div>(*5*)"a(*0*)(*1*)(*2*)(*3*)(*4*)  b "<br>"ab"(*6*)<div>"babla"</div></div>',
            '<div>(*5*)"a (*0*)(*1*)(*2*) (*3*)(*4*)b "<br>"ab"(*6*)<div>"babla"</div></div>',
            '<div>(*5*)"a (*1*)(*2*) (*0*)(*3*)(*4*)b "<br>"ab"(*6*)<div>"babla"</div></div>',
            '<div>(*5*)"a (*1*)(*2*) (*0*)(*3*)(*4*)b "<br>"ab"(*6*)<div>"babla"</div></div>',
            '<div>(*5*)"a  b(*0*)(*1*)(*2*)(*3*)(*4*) "<br>"ab"(*6*)<div>"babla"</div></div>',
            '<div>(*5*)"a  b (*0*)(*1*)(*2*)(*3*)"(*4*)<br>"ab"(*6*)<div>"babla"</div></div>',
            '<div>(*5*)"a  b (*1*)(*2*)(*3*)"(*0*)(*4*)<br>"ab"(*6*)<div>"babla"</div></div>',
            '<div>(*5*)"a  b"<br>(*0*)(*1*)"(*2*)(*3*)(*4*)ab"(*6*)<div>"babla"</div></div>',
            '<div>(*5*)"a  b"<br>(*1*)"(*0*)(*2*)(*3*)(*4*)ab"(*6*)<div>"babla"</div></div>',
            '<div>(*5*)"a  b"<br>"a(*0*)(*1*)(*2*)(*3*)(*4*)b"(*6*)<div>"babla"</div></div>',
            '<div>(*5*)"a  b"<br>"ab(*0*)(*1*)(*2*)(*3*)"(*4*)(*6*)<div>"babla"</div></div>',
            '<div>(*5*)"a  b"<br>"ab(*1*)(*2*)(*3*)"(*0*)(*4*)(*6*)<div>"babla"</div></div>',
            '<div>"a  b"<br>"ab"<div>(*0*)(*1*)(*5*)"(*2*)(*3*)(*4*)babla"(*6*)</div></div>',
            '<div>"a  b"<br>"ab"<div>(*1*)(*5*)"(*0*)(*2*)(*3*)(*4*)babla"(*6*)</div></div>',
            '<div>"a  b"<br>"ab"<div>(*5*)"b(*0*)(*1*)(*2*)(*3*)(*4*)abla"(*6*)</div></div>',
            // ...
            '<div>"a  b"<br>"ab"<div>(*5*)"babla(*0*)(*1*)(*2*)(*3*)"(*4*)(*6*)</div></div>',
            '<div>"a  b"<br>"ab"<div>(*5*)"babla(*1*)(*2*)(*3*)"(*0*)(*4*)(*6*)</div></div>',
            useblockfill
              ? '<div>"a  "<br>"ab"<div>"babla(*1*)(*2*)(*3*)"(*4*)</div>(*0*)(*5*)(*6*)</div>'
              : '<div>"a  "<br>"ab"<div>"babla(*1*)(*2*)(*3*)"(*4*)</div>(*0*)(*5*)(*6*)</div>',

            '<div>(*0*)(*5*)(*6*)<div>(*1*)"(*2*)(*3*)(*4*)a"</div></div>', // better!
            '<div><p class="normal">"a"</p><p class="normal">(*1*)(*5*)"(*0*)(*2*) (*3*)"(*4*)<br>(*6*)</p><p class="normal"><br></p></div>'

            //FIXME: determine what the resolution should be in thise cases
            //            , '<div>(*0*)(*1*)(*2*)(*5*)(*6*)<div>"(*3*)(*4*)a"</div></div>'
            //            , '<div><ol><li>"ab"<ol><li>"c"</li><li><br></br>(*1*)(*2*)(*3*)(*4*)</li>(*0*)(*5*)(*6*)</ol>"d"</li></ol><p>"a"</p><div>'
            //            , '<div><ol><li>"ab"<ol><li>"c"</li><li>(*5*)<br>(*0*)(*6*)</li></ol>(*1*)"(*2*)(*3*)(*4*)d"</li></ol></div>'

          ];

        for (let i = 0; i < movetests.length; ++i) {
          console.log('test ', i, movetests[i]);
          rte.setContentsHTML(movetests[i]);
          const locators = richdebug.unstructureDom(rte.getBody());
          const result = [locators[0].clone(), locators[0].clone(), locators[0].clone(), locators[0].clone(), locators[0].clone(), locators[0].clone(), locators[0].clone()];

          result[1].movePastLastVisible(rte.getBody().firstChild, false, false);
          result[2].movePastLastVisible(rte.getBody().firstChild, false, true);
          result[3].moveToFirstVisible(rte.getBody().firstChild, false, true);
          result[4].moveToFirstVisible(rte.getBody().firstChild, false, false);
          result[5].moveToPreviousBlockBoundary(rte.getBody().firstChild);
          result[6].moveToNextBlockBoundary(rte.getBody().firstChild);

          testEqHTMLEx(movetests[i], rte.getBody(), result);
        }
      }
    },

    {
      name: 'locatorwalkleftright',
      test: function (doc, win) {
        const rte = win.rte.getEditor();

        rte.setContentsHTML('<ol><li>ab<ol><li>c</li><li><br></li></ol>d</ol><p><br></p><p>a<svg></svg></p>');
        const locators = getAllLocators(win, rte.getBody());
        testEqHTMLEx('(*0*)<ol>(*1*)<li>(*2*)"(*3*)a(*4*)b(*5*)"(*6*)<ol>(*7*)<li>(*8*)"(*9*)c(*10*)"(*11*)</li>(*12*)<li>(*13*)<br>(*14*)</li>(*15*)</ol>(*16*)"(*17*)d(*18*)"(*19*)</li>(*20*)</ol>(*21*)<p>(*22*)<br>(*23*)</p>(*24*)<p>(*25*)"(*26*)a(*27*)"(*28*)<svg></svg>(*29*)</p>(*30*)', rte.getBody(), locators);

        // Calculate the equivalence ranges (from moveToFirstVisible)
        const eqranges = [];
        let start = -1;
        let last = -1;
        for (let i = 0; i < locators.length; ++i) {
          const loc = locators[i].clone();
          loc.moveToFirstVisible(rte.getBody());

          let match = -1;
          for (let a = 0; a < locators.length; ++a)
            if (locators[a].compare(loc) === 0) {
              //console.log(i,'->',a);
              match = a;
            }
          if (last !== match) {
            if (last > match) {
              console.log('ordering fail', i, richdebug.getStructuredOuterHTML(rte.getBody(), { afrom: locators[i - 1], ato: locators[last], bfrom: locators[i], bto: locators[match] }));
              test.assert(false);
            }

            if (start !== -1)
              eqranges.push({ left: start, right: i - 1, match: match });
            last = match;
            start = i;
          }
        }
        eqranges.push({ left: start, right: locators.length - 1 });

        for (let i = 0; i < locators.length; ++i) {
          if (i === 114)//[14,15,16,17].contains(i))
          {
            console.log('** skip ', i);
            continue;
          }

          let rangenr = 0;
          for (let a = 0; a < eqranges.length; ++a)
            if (i >= eqranges[a].left && i <= eqranges[a].right)
              rangenr = a;

          const mrange = new Range(locators[eqranges[rangenr].left], locators[eqranges[rangenr].right]);
          const lrangenr = rangenr === 0 ? 0 : rangenr - 1;
          const lrange = new Range(locators[eqranges[lrangenr].left], locators[eqranges[lrangenr].right]);
          const rrangenr = rangenr === eqranges.length - 1 ? eqranges.length - 1 : rangenr + 1;
          const rrange = new Range(locators[eqranges[rrangenr].left], locators[eqranges[rrangenr].right]);

          const tfv = locators[i].clone();
          tfv.moveToFirstVisible(rte.getBody());

          //console.log('*', i);
          //console.log('pre', richdebug.getStructuredOuterHTML(rte.getBody(), { locator: locators[i], mrange: mrange, lrange: lrange, rrange: rrange, tfv: tfv }, { indent: true }));

          const lcopy = tfv.clone();//locators[i].clone();
          lcopy.moveLeft(rte.getBody());
          const rcopy = tfv.clone();//locators[i].clone();
          rcopy.moveRight(rte.getBody());

          //console.log('post', i, domlevel.getStructuredOuterHTML(rte.getBody(), { locator: locators[i], mrange: mrange, lcopy: lcopy, rcopy: rcopy, lrange: lrange, rrange: rrange, tfv: tfv }));
          const leftfail = lcopy.compare(lrange.start) < 0 || lcopy.compare(lrange.end) > 0;
          const rightfail = rcopy.compare(rrange.start) < 0 || rcopy.compare(rrange.end) > 0;

          if (leftfail || rightfail)
            console.log('fail', i, leftfail, rightfail, richdebug.getStructuredOuterHTML(rte.getBody(), { locator: locators[i], mrange: mrange, gotleft: lcopy, gotright: rcopy, expectleft: lrange, expectright: rrange, tfv: tfv }));

          test.assert(!leftfail);
          test.assert(!rightfail);
        }
      }
    },

    {
      name: 'rangestuff',
      test: function (doc, win) {
        const rte = win.rte.getEditor();

        rte.setContentsHTML('<i><b>abc</b>def<u>ghi</u></i>');
        test.eq('<i><b>abc</b>def<u>ghi</u></i>', win.rte.getValue().toLowerCase());

        const locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a(*3*)b(*4*)c(*5*)"(*6*)</b>(*7*)"(*8*)d(*9*)e(*10*)f(*11*)"(*12*)<u>(*13*)"(*14*)g(*15*)h(*16*)i(*17*)"(*18*)</u>(*19*)</i>', rte.getBody(), locators);

        const range = new Range(locators[0], locators[7]);
        range.insertBefore(document.createElement('br'), locators);

        testEqHTMLEx('<i><br>(*0*)<b>(*1*)"(*2*)a(*3*)b(*4*)c(*5*)"(*6*)</b>(*7*)"(*8*)d(*9*)e(*10*)f(*11*)"(*12*)<u>(*13*)"(*14*)g(*15*)h(*16*)i(*17*)"(*18*)</u>(*19*)</i>', rte.getBody(), locators);
        testEqHTMLEx('<i><br>(*0*)<b>"abc"</b>(*1*)"def"<u>"ghi"</u></i>', rte.getBody(), [range.start, range.end]);
      }
    },


    {
      name: 'datasplit',
      test: function (doc, win) {
        const rte = win.rte.getEditor();

        rte.setContentsHTML('<i><b>ab</b>c</i>');
        let locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a(*3*)b(*4*)"(*5*)</b>(*6*)"(*7*)c(*8*)"(*9*)</i>', rte.getBody(), locators);
        domlevel.splitDataNode(locators[3], locators, null); // use a locator from the preservelocators
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a""(*3*)b(*4*)"(*5*)</b>(*6*)"(*7*)c(*8*)"(*9*)</i>', rte.getBody(), locators);

        rte.setContentsHTML('<i><b>ab</b>c</i>');
        locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a(*3*)b(*4*)"(*5*)</b>(*6*)"(*7*)c(*8*)"(*9*)</i>', rte.getBody(), locators);
        domlevel.splitDataNode(locators[3], locators, 'end'); // use a locator from the preservelocators
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a""(*3*)b(*4*)"(*5*)</b>(*6*)"(*7*)c(*8*)"(*9*)</i>', rte.getBody(), locators);

        rte.setContentsHTML('<i><b>ab</b>c</i>');
        locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a(*3*)b(*4*)"(*5*)</b>(*6*)"(*7*)c(*8*)"(*9*)</i>', rte.getBody(), locators);
        domlevel.splitDataNode(locators[3], locators, 'start'); // use a locator from the preservelocators
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a(*3*)""b(*4*)"(*5*)</b>(*6*)"(*7*)c(*8*)"(*9*)</i>', rte.getBody(), locators);
      }
    },

    {
      name: 'elementsplit',
      test: function (doc, win) {
        const rte = win.rte.getEditor();

        rte.setContentsHTML('<i><b><u><br><br></u></b><u><br></u></i>');
        let locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)<br>(*3*)<br>(*4*)</u>(*5*)</b>(*6*)<u>(*7*)<br>(*8*)</u>(*9*)</i>', rte.getBody(), locators);
        domlevel.splitElement(locators[3], locators, null); // use a locator from the preservelocators
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)<br></u><u>(*3*)<br>(*4*)</u>(*5*)</b>(*6*)<u>(*7*)<br>(*8*)</u>(*9*)</i>', rte.getBody(), locators);

        rte.setContentsHTML('<i><b><u><br><br></u></b><u><br></u></i>');
        locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)<br>(*3*)<br>(*4*)</u>(*5*)</b>(*6*)<u>(*7*)<br>(*8*)</u>(*9*)</i>', rte.getBody(), locators);
        domlevel.splitElement(locators[3], locators, 'end'); // use a locator from the preservelocators
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)<br></u><u>(*3*)<br>(*4*)</u>(*5*)</b>(*6*)<u>(*7*)<br>(*8*)</u>(*9*)</i>', rte.getBody(), locators);

        rte.setContentsHTML('<i><b><u><br><br></u></b><u><br></u></i>');
        locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)<br>(*3*)<br>(*4*)</u>(*5*)</b>(*6*)<u>(*7*)<br>(*8*)</u>(*9*)</i>', rte.getBody(), locators);
        domlevel.splitElement(locators[3], locators, 'start'); // use a locator from the preservelocators
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)<br>(*3*)</u><u><br>(*4*)</u>(*5*)</b>(*6*)<u>(*7*)<br>(*8*)</u>(*9*)</i>', rte.getBody(), locators);

      }
    },

    {
      name: 'moveSimpleRangeTo',
      test: function (doc, win) {
        const rte = win.rte.getEditor();

        // Subnode forward to root
        rte.setContentsHTML('<i><b>x<br></b>a<u>b</u><br>c</i>');
        let locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)x(*3*)"(*4*)<br>(*5*)</b>(*6*)"(*7*)a(*8*)"(*9*)<u>(*10*)"(*11*)b(*12*)"(*13*)</u>(*14*)<br>(*15*)"(*16*)c(*17*)"(*18*)</i>', rte.getBody(), locators);

        const range = new Range(locators[1], locators[5]);
        domlevel.moveSimpleRangeTo(range, locators[14], locators);

        testEqHTMLEx('<i>(*0*)<b>(*1*)</b>"a"<u>"b"</u>"(*2*)x(*3*)"(*4*)<br>(*5*)(*6*)(*7*)(*8*)(*9*)(*10*)(*11*)(*12*)(*13*)(*14*)<br>(*15*)"(*16*)c(*17*)"(*18*)</i>', rte.getBody(), locators);

        // Root forward to root
        rte.setContentsHTML('<i>a<br>b<br>c<br>d<br>e</i>');
        locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)"(*3*)<br>(*4*)"(*5*)b(*6*)"(*7*)<br>(*8*)"(*9*)c(*10*)"(*11*)<br>(*12*)"(*13*)d(*14*)"(*15*)<br>(*16*)"(*17*)e(*18*)"(*19*)</i>', rte.getBody(), locators);

        domlevel.moveSimpleRangeTo(new Range(locators[3], locators[11]), locators[15], locators);

        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)"(*3*)<br>"d"<br>(*4*)"(*5*)b(*6*)"(*7*)<br>(*8*)"(*9*)c(*10*)"(*11*)(*12*)(*13*)(*14*)(*15*)<br>(*16*)"(*17*)e(*18*)"(*19*)</i>', rte.getBody(), locators);

        // Root forward to subnode
        rte.setContentsHTML('<i>a<br>b<br>c<br><b></b><br>e</i>');
        locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)"(*3*)<br>(*4*)"(*5*)b(*6*)"(*7*)<br>(*8*)"(*9*)c(*10*)"(*11*)<br>(*12*)<b>(*13*)</b>(*14*)<br>(*15*)"(*16*)e(*17*)"(*18*)</i>', rte.getBody(), locators);
        domlevel.moveSimpleRangeTo(new Range(locators[0], locators[4]), locators[13], locators);

        testEqHTMLEx('<i>(*0*)"b"<br>"c"<br><b>"(*1*)a(*2*)"(*3*)<br>(*4*)(*5*)(*6*)(*7*)(*8*)(*9*)(*10*)(*11*)(*12*)(*13*)</b>(*14*)<br>(*15*)"(*16*)e(*17*)"(*18*)</i>', rte.getBody(), locators);

        // Subnode backward to root
        rte.setContentsHTML('<i>a<br><u>b</u><b>x<br></b><br>c</i>');
        locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)"(*3*)<br>(*4*)<u>(*5*)"(*6*)b(*7*)"(*8*)</u>(*9*)<b>(*10*)"(*11*)x(*12*)"(*13*)<br>(*14*)</b>(*15*)<br>(*16*)"(*17*)c(*18*)"(*19*)</i>', rte.getBody(), locators);

        domlevel.moveSimpleRangeTo(new Range(locators[10], locators[14]), locators[4], locators);
        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)"(*3*)<br>(*4*)(*5*)(*6*)(*7*)(*8*)(*9*)(*10*)"(*11*)x(*12*)"(*13*)<br><u>"b"</u><b>(*14*)</b>(*15*)<br>(*16*)"(*17*)c(*18*)"(*19*)</i>', rte.getBody(), locators);

        // Root backward to root
        rte.setContentsHTML('<i>a<br>b<br>c<br>d<br>e</i>');
        locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)"(*3*)<br>(*4*)"(*5*)b(*6*)"(*7*)<br>(*8*)"(*9*)c(*10*)"(*11*)<br>(*12*)"(*13*)d(*14*)"(*15*)<br>(*16*)"(*17*)e(*18*)"(*19*)</i>', rte.getBody(), locators);

        domlevel.moveSimpleRangeTo(new Range(locators[11], locators[15]), locators[3], locators);
        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)"(*3*)(*4*)(*5*)(*6*)(*7*)(*8*)(*9*)(*10*)(*11*)<br>(*12*)"(*13*)d(*14*)"<br>"b"<br>"c"(*15*)<br>(*16*)"(*17*)e(*18*)"(*19*)</i>', rte.getBody(), locators);

        // Root backward to subnode
        rte.setContentsHTML('<i>b<br>c<br><b>a<br></b><br>e</i>', rte.getBody(), locators);
        locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('<i>(*0*)"(*1*)b(*2*)"(*3*)<br>(*4*)"(*5*)c(*6*)"(*7*)<br>(*8*)<b>(*9*)"(*10*)a(*11*)"(*12*)<br>(*13*)</b>(*14*)<br>(*15*)"(*16*)e(*17*)"(*18*)</i>', rte.getBody(), locators);

        domlevel.moveSimpleRangeTo(new Range(locators[9], locators[13]), locators[4], locators);
        testEqHTMLEx('<i>(*0*)"(*1*)b(*2*)"(*3*)<br>(*4*)(*5*)(*6*)(*7*)(*8*)(*9*)"(*10*)a(*11*)"(*12*)<br>"c"<br><b>(*13*)</b>(*14*)<br>(*15*)"(*16*)e(*17*)"(*18*)</i>', rte.getBody(), locators);

        // Test move data
        rte.setContentsHTML('abcdefg', rte.getBody(), locators);
        locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('"(*0*)a(*1*)b(*2*)c(*3*)d(*4*)e(*5*)f(*6*)g(*7*)"', rte.getBody(), locators);

        domlevel.moveSimpleRangeTo(new Range(locators[4], locators[6]), locators[2], locators);
        testEqHTMLEx('"(*0*)a(*1*)b(*2*)(*3*)(*4*)e(*5*)fcd(*6*)g(*7*)"', rte.getBody(), locators);
      }
    },

    {
      name: 'removeSimpleRange',
      test: function (doc, win) {
        const rte = win.rte.getEditor();

        // Node with contents
        rte.setContentsHTML('<i>a<b>x</b>cd<br></i>');
        let locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)"(*3*)<b>(*4*)"(*5*)x(*6*)"(*7*)</b>(*8*)"(*9*)c(*10*)d(*11*)"(*12*)<br>(*13*)</i>', rte.getBody(), locators);

        domlevel.removeSimpleRange(new Range(locators[3], locators[8]), locators);
        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)"(*3*)(*4*)(*5*)(*6*)(*7*)(*8*)"(*9*)c(*10*)d(*11*)"(*12*)<br>(*13*)</i>', rte.getBody(), locators);

        // Text
        rte.setContentsHTML('abcdefg');
        locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('"(*0*)a(*1*)b(*2*)c(*3*)d(*4*)e(*5*)f(*6*)g(*7*)"', rte.getBody(), locators);

        domlevel.removeSimpleRange(new Range(locators[3], locators[5]), locators);
        testEqHTMLEx('"(*0*)a(*1*)b(*2*)c(*3*)(*4*)(*5*)f(*6*)g(*7*)"', rte.getBody(), locators);
      }
    },


    {
      name: 'elementcombine',
      test: function (doc, win) {
        const rte = win.rte.getEditor();

        rte.setContentsHTML('<i><b><u><br></u><u><br></u></b><u><br></u></i>');
        let locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)<br>(*3*)</u>(*4*)<u>(*5*)<br>(*6*)</u>(*7*)</b>(*8*)<u>(*9*)<br>(*10*)</u>(*11*)</i>', rte.getBody(), locators);
        domlevel.combineNodeWithPreviousNode(locators[5].element, locators); // use a locator from the preservelocators
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)<br>(*3*)(*4*)(*5*)<br>(*6*)</u>(*7*)</b>(*8*)<u>(*9*)<br>(*10*)</u>(*11*)</i>', rte.getBody(), locators);

        rte.setContentsHTML('<i><b><u>a</u></b></i>');
        locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)"(*3*)a(*4*)"(*5*)</u>(*6*)</b>(*7*)</i>', rte.getBody(), locators);
        let res = domlevel.combineNodes(locators[0], locators[2].element, locators);
        testEqHTMLEx('<i>(*0*)(*1*)(*2*)"(*3*)a(*4*)"(*5*)<b>(*6*)</b>(*7*)</i>', rte.getBody(), locators);
        test.eq(locators[0].element, res.node);
        test.assert(res.locator.equals(locators[0]));
        test.assert(res.afterlocator.equals(locators[5]));

        rte.setContentsHTML('<i><b>ab</b></i>');
        locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a(*3*)b(*4*)"(*5*)</b>(*6*)</i>', rte.getBody(), locators);
        res = domlevel.combineNodes(locators[0], locators[1].element, locators);
        testEqHTMLEx('<i>(*0*)(*1*)"(*2*)a(*3*)b(*4*)"(*5*)(*6*)</i>', rte.getBody(), locators);
        test.eq(locators[0].element, res.node);
        test.assert(res.locator.equals(locators[0]));
        test.assert(res.afterlocator.equals(locators[5]));

        rte.setContentsHTML('<i><b>ab</b></i>');
        locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a(*3*)b(*4*)"(*5*)</b>(*6*)</i>', rte.getBody(), locators);
        res = domlevel.combineNodes(locators[6], locators[1].element, locators);
        testEqHTMLEx('<i>(*0*)(*1*)"(*2*)a(*3*)b(*4*)"(*5*)(*6*)</i>', rte.getBody(), locators);
        testEqHTMLEx('<i>(*0*)"ab"(*1*)</i>', rte.getBody(), [res.locator, res.afterlocator]);
        test.eq(locators[0].element, res.node);

        rte.setContentsHTML('<i><u></u><u><b>ab</b></u></i>');
        locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('<i>(*0*)<u>(*1*)</u>(*2*)<u>(*3*)<b>(*4*)"(*5*)a(*6*)b(*7*)"(*8*)</b>(*9*)</u>(*10*)</i>', rte.getBody(), locators);
        res = domlevel.combineNodes(locators[1], locators[4].element, locators);
        testEqHTMLEx('<i>(*0*)<u>(*1*)(*2*)(*3*)(*4*)"(*5*)a(*6*)b(*7*)"(*8*)</u><u>(*9*)</u>(*10*)</i>', rte.getBody(), locators);
        testEqHTMLEx('<i>(*0*)<u>(*1*)"ab"(*2*)</u><u></u></i>', rte.getBody(), [domlevel.Locator.newPointingTo(res.node), res.locator, res.afterlocator]);

        rte.setContentsHTML('<i><u><b>ab</b></u><u></u></i>');
        locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('<i>(*0*)<u>(*1*)<b>(*2*)"(*3*)a(*4*)b(*5*)"(*6*)</b>(*7*)</u>(*8*)<u>(*9*)</u>(*10*)</i>', rte.getBody(), locators);
        res = domlevel.combineNodes(locators[9], locators[2].element, locators);
        testEqHTMLEx('<i>(*0*)<u>(*1*)</u><u>(*2*)"(*3*)a(*4*)b(*5*)"(*6*)(*7*)(*8*)(*9*)</u>(*10*)</i>', rte.getBody(), locators);
        testEqHTMLEx('<i><u></u>(*0*)<u>(*1*)"ab"(*2*)</u></i>', rte.getBody(), [domlevel.Locator.newPointingTo(res.node), res.locator, res.afterlocator]);

        rte.setContentsHTML('<i><b><u>a</u>b<br></b></i>');
        locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)"(*3*)a(*4*)"(*5*)</u>(*6*)"(*7*)b(*8*)"(*9*)<br>(*10*)</b>(*11*)</i>', rte.getBody(), locators);
        res = domlevel.combineNodes(locators[4], locators[7].element, locators);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)"(*3*)a(*4*)(*5*)(*6*)(*7*)b(*8*)"</u>(*9*)<br>(*10*)</b>(*11*)</i>', rte.getBody(), locators);

      }
    },

    {
      name: 'elementreplacewithchildren',
      test: function (doc, win) {
        const rte = win.rte.getEditor();

        rte.setContentsHTML('<i><b><u><br><br></u><br></b><br></i>');

        const body = rte.getBody();
        const italicelement = body.firstChild;
        const boldelement = italicelement.firstChild;
        const firstunderlined = boldelement.firstChild;

        const locators = getAllLocators(win, italicelement);

        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)<br>(*3*)<br>(*4*)</u>(*5*)<br>(*6*)</b>(*7*)<br>(*8*)</i>', rte.getBody(), locators);
        domlevel.replaceSingleNodeWithItsContents(firstunderlined, locators);
        testEqHTMLEx('<i>(*0*)<b>(*1*)(*2*)<br>(*3*)<br>(*4*)(*5*)<br>(*6*)</b>(*7*)<br>(*8*)</i>', rte.getBody(), locators);
      }
    },

    {
      name: 'elementwrap',
      test: function (doc, win) {
        const rte = win.rte.getEditor();

        rte.setContentsHTML('<i><b><br>a<br><br></b><br></i>');

        const body = rte.getBody();
        const italicelement = body.firstChild;
        //        var boldelement = italicelement.firstChild;
        //        var brelements = body.getElementsByTagName('br');
        //        var firsttext = brelements[0].nextSibling;

        let locators = getAllLocators(win, italicelement);

        testEqHTMLEx('<i>(*0*)<b>(*1*)<br>(*2*)"(*3*)a(*4*)"(*5*)<br>(*6*)<br>(*7*)</b>(*8*)<br>(*9*)</i>', rte.getBody(), locators);

        let newnode = doc.createElement('u');
        domlevel.wrapNodesInNewNode(locators[2], 2, newnode, locators);

        testEqHTMLEx('<i>(*0*)<b>(*1*)<br><u>(*2*)"(*3*)a(*4*)"(*5*)<br>(*6*)</u><br>(*7*)</b>(*8*)<br>(*9*)</i>', rte.getBody(), locators);

        rte.setContentsHTML('<i><b>a<br>b</b><br></i>');
        locators = getAllLocators(win, rte.getBody().firstChild);

        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a(*3*)"(*4*)<br>(*5*)"(*6*)b(*7*)"(*8*)</b>(*9*)<br>(*10*)</i>', rte.getBody(), locators);
        const range = new Range(locators[1], locators[8]);

        newnode = doc.createElement('u');
        domlevel.wrapSimpleRangeInNewNode(range, newnode, locators);

        testEqHTMLEx('<i>(*0*)<b><u>(*1*)"(*2*)a(*3*)"(*4*)<br>(*5*)"(*6*)b(*7*)"(*8*)</u></b>(*9*)<br>(*10*)</i>', rte.getBody(), locators);
        testEqHTMLEx('<i><b><u>(*0*)"a"<br>"b"(*1*)</u></b><br></i>', rte.getBody(), [range.start, range.end]);
      }
    },

    {
      name: 'removeNodesFromTree',
      test: function (doc, win) {
        const rte = win.rte.getEditor();

        rte.setContentsHTML('<i><b><u><br><u><br></u><br></u><br></b><br></i>');

        const body = rte.getBody();
        const italicelement = body.firstChild;

        const locators = getAllLocators(win, italicelement);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)<br>(*3*)<u>(*4*)<br>(*5*)</u>(*6*)<br>(*7*)</u>(*8*)<br>(*9*)</b>(*10*)<br>(*11*)</i>', rte.getBody(), locators);

        domlevel.removeNodesFromTree(italicelement, 'u', locators);

        testEqHTMLEx('<i>(*0*)<b>(*1*)(*2*)<br>(*3*)(*4*)<br>(*5*)(*6*)<br>(*7*)(*8*)<br>(*9*)</b>(*10*)<br>(*11*)</i>', rte.getBody(), locators);
      }
    },

    {
      name: 'splitdom',
      test: function (doc, win) {
        const rte = win.rte.getEditor();


        rte.setContentsHTML('<b>ab</b>');

        test.eq('<b>ab</b>', win.rte.getValue().toLowerCase());
        let body = rte.getBody();
        let boldelement = body.firstChild;

        let locators = getAllLocators(win, body);
        testEqHTMLEx('(*0*)<b>(*1*)"(*2*)a(*3*)b(*4*)"(*5*)</b>(*6*)', rte.getBody(), locators);

        let res = domlevel.splitDom(
          body,
          [
            {
              locator: new domlevel.Locator(boldelement.firstChild, 'a'.length),
              toward: 'start'
            }
          ], locators);

        testEqHTMLEx('(*0*)<b>"a"</b>(*1*)(*2*)<b>"b"</b>(*3*)', body, [res[0].start, res[0].end, res[1].start, res[1].end]);
        testEqHTMLEx('(*0*)<b>(*1*)"(*2*)a"</b><b>"(*3*)b(*4*)"(*5*)</b>(*6*)', rte.getBody(), locators);

        // Also works for splitting text nodes?
        rte.setContentsHTML('<b>ab</b>');
        body = rte.getBody();
        boldelement = body.firstChild;

        locators = getAllLocators(win, body);
        testEqHTMLEx('(*0*)<b>(*1*)"(*2*)a(*3*)b(*4*)"(*5*)</b>(*6*)', rte.getBody(), locators);

        res = domlevel.splitDom(
          boldelement,
          [
            {
              locator: locators[3],
              toward: 'start'
            }
          ], locators);

        testEqHTMLEx('<b>(*0*)"a"(*1*)(*2*)"b"(*3*)</b>', body, [res[0].start, res[0].end, res[1].start, res[1].end]);
        testEqHTMLEx('(*0*)<b>(*1*)"(*2*)a""(*3*)b(*4*)"(*5*)</b>(*6*)', rte.getBody(), locators);

        rte.setContentsHTML('<p>123</p>');
        body = rte.getBody();
        let p = body.getElementsByTagName('p')[0];
        res = domlevel.splitDom(
          body,
          [
            {
              locator: new domlevel.Locator(p.firstChild, 1),
              toward: 'start'
            },
            {
              locator: new domlevel.Locator(p.firstChild, 2),
              toward: 'end'
            }
          ], []);

        testEqHTMLEx('(*0*)<p>"1"</p>(*1*)(*2*)<p>"2"</p>(*3*)(*4*)<p>"3"</p>(*5*)', rte.getBody(),
          [
            res[0].start,
            res[0].end,
            res[1].start,
            res[1].end,
            res[2].start,
            res[2].end
          ]);

        rte.setContentsHTML('<p>12</p>');
        body = rte.getBody();
        p = body.getElementsByTagName('p')[0];
        res = domlevel.splitDom(
          body,
          [
            {
              locator: new domlevel.Locator(p.firstChild, 1),
              toward: 'start'
            },
            {
              locator: new domlevel.Locator(p.firstChild, 1),
              toward: 'end'
            }
          ], null);

        testEqHTMLEx('(*0*)<p>"1"</p>(*1*)(*2*)(*3*)(*4*)<p>"2"</p>(*5*)', rte.getBody(),
          [
            res[0].start,
            res[0].end,
            res[1].start,
            res[1].end,
            res[2].start,
            res[2].end
          ]);

        rte.setContentsHTML('<p>1<br>23</p>');
        body = rte.getBody();
        p = body.getElementsByTagName('p')[0];
        const splitpoints =
          [
            {
              locator: new domlevel.Locator(p, 2),
              toward: 'start'
            },
            {
              locator: new domlevel.Locator(p.childNodes[2], 1),
              toward: 'end'
            },
            {
              locator: new domlevel.Locator(p, "end"),
              toward: 'end'
            }
          ];

        res = domlevel.splitDom(body, splitpoints, null);

        testEqHTMLEx('(*0*)<p>"1"<br></p>(*1*)(*2*)<p>"2"</p>(*3*)(*4*)<p>"3"</p>(*5*)(*6*)(*7*)', rte.getBody(),
          [
            res[0].start,
            res[0].end,
            res[1].start,
            res[1].end,
            res[2].start,
            res[2].end,
            res[3].start,
            res[3].end
          ]);

        rte.setContentsHTML('<div><p>a<br>b</p></div>');
        locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('<div>(*0*)<p>(*1*)"(*2*)a(*3*)"(*4*)<br>(*5*)"(*6*)b(*7*)"(*8*)</p>(*9*)</div>', rte.getBody(), locators);

        const splitpoint = locators[4];
        res = domlevel.splitDom(body.firstChild, [{ locator: splitpoint, toward: 'start' }, { locator: splitpoint, toward: 'end' }, { locator: splitpoint, toward: 'end' }], locators);
        testEqHTMLEx('<div>(*0*)<p>(*1*)"(*2*)a(*3*)"</p><p>(*4*)<br>(*5*)"(*6*)b(*7*)"(*8*)</p>(*9*)</div>', rte.getBody(), locators);
        testEqHTMLEx('<div>(*0*)<p>"a"</p>(*1*)(*2*)(*3*)(*4*)(*5*)(*6*)<p><br>"b"</p>(*7*)</div>', rte.getBody(),
          [res[0].start, res[0].end, res[1].start, res[1].end, res[2].start, res[2].end, res[3].start, res[3].end]);

        rte.setContentsHTML('<ol class="ordered"><li>a<br>b</li></ol>');
        locators = getAllLocators(win, rte.getBody().firstChild);
        InitLocatorsId(locators);
        testEqHTMLEx('<ol class="ordered">(*0*)<li>(*1*)"(*2*)a(*3*)"(*4*)<br>(*5*)"(*6*)b(*7*)"(*8*)</li>(*9*)</ol>', rte.getBody(), locators);
        let range = new Range(locators[3], locators[3]);
        domlevel.splitDom(rte.getBody().firstChild, [{ locator: range.start, toward: 'start' }], locators);
        testEqHTMLEx('<ol class="ordered">(*0*)<li>(*1*)"(*2*)a"</li><li>(*3*)(*4*)<br>(*5*)"(*6*)b(*7*)"(*8*)</li>(*9*)</ol>', rte.getBody(), locators);

        rte.setContentsHTML('<ol class="ordered"><li>a<br>b</li></ol>');
        locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('<ol class="ordered">(*0*)<li>(*1*)"(*2*)a(*3*)"(*4*)<br>(*5*)"(*6*)b(*7*)"(*8*)</li>(*9*)</ol>', rte.getBody(), locators);
        range = new Range(locators[6], locators[6]);
        domlevel.splitDom(rte.getBody().firstChild, [{ locator: range.start, toward: 'start' }], locators);
        testEqHTMLEx('<ol class="ordered">(*0*)<li>(*1*)"(*2*)a(*3*)"(*4*)<br>(*5*)</li><li>"(*6*)b(*7*)"(*8*)</li>(*9*)</ol>', rte.getBody(), locators);
      }
    },

    {
      name: 'removeNodesFromRange',
      test: function (doc, win) {
        const rte = win.rte.getEditor();

        // Test with normal range
        rte.setContentsHTML('<i><b><u><u>abc</u>de</u>f<u><i>gh</i>i</u>j</b>k</i>');

        let body = rte.getBody();
        let italicelement = body.firstChild;
        let underlinenodes = body.getElementsByTagName('U');

        // Get locators, test if we have correct html & locator positions
        let locators = getAllLocators(win, italicelement);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)<u>(*3*)"(*4*)a(*5*)b(*6*)c(*7*)"(*8*)</u>(*9*)"(*10*)d(*11*)e(*12*)"(*13*)</u>(*14*)"(*15*)f(*16*)"(*17*)<u>(*18*)<i>(*19*)"(*20*)g(*21*)h(*22*)"(*23*)</i>(*24*)"(*25*)i(*26*)"(*27*)</u>(*28*)"(*29*)j(*30*)"(*31*)</b>(*32*)"(*33*)k(*34*)"(*35*)</i>', rte.getBody(), locators);

        let range = new Range(
          new domlevel.Locator(underlinenodes[1].firstChild, 1),
          new domlevel.Locator(underlinenodes[0].nextSibling));

        // Test if range is what we want
        testEqHTMLEx('<i><b><u><u>"a(*0*)bc"</u>"de"</u>"(*1*)f"<u><i>"gh"</i>"i"</u>"j"</b>"k"</i>', rte.getBody(), [range.start, range.end]);

        domlevel.removeNodesFromRange(range, body, 'u', locators);

        testEqHTMLEx('<i><b><u><u>"a"</u></u>"bc""de""f"<u><i>"gh"</i>"i"</u>"j"</b>"k"</i>', rte.getBody());
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)<u>(*3*)"(*4*)a"</u></u>"(*5*)b(*6*)c(*7*)"(*8*)(*9*)"(*10*)d(*11*)e(*12*)"(*13*)(*14*)"(*15*)f(*16*)"(*17*)<u>(*18*)<i>(*19*)"(*20*)g(*21*)h(*22*)"(*23*)</i>(*24*)"(*25*)i(*26*)"(*27*)</u>(*28*)"(*29*)j(*30*)"(*31*)</b>(*32*)"(*33*)k(*34*)"(*35*)</i>', rte.getBody(), locators);

        // Test where deep ancestor of range is removed too
        rte.setContentsHTML('<i>a<u>b<b>c<u>def</u>g</b>h</u>i</i>');
        body = rte.getBody();
        italicelement = body.firstChild;
        underlinenodes = body.getElementsByTagName('U');

        // Get locators, test if we have correct html & locator positions
        locators = getAllLocators(win, italicelement);
        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)"(*3*)<u>(*4*)"(*5*)b(*6*)"(*7*)<b>(*8*)"(*9*)c(*10*)"(*11*)<u>(*12*)"(*13*)d(*14*)e(*15*)f(*16*)"(*17*)</u>(*18*)"(*19*)g(*20*)"(*21*)</b>(*22*)"(*23*)h(*24*)"(*25*)</u>(*26*)"(*27*)i(*28*)"(*29*)</i>', rte.getBody(), locators);

        range = new Range(
          new domlevel.Locator(underlinenodes[1].firstChild, 1),
          new domlevel.Locator(underlinenodes[1].firstChild, 2));

        // Test if range is what we want
        testEqHTMLEx('<i>"a"<u>"b"<b>"c"<u>"d(*0*)e(*1*)f"</u>"g"</b>"h"</u>"i"</i>', rte.getBody(), [range.start, range.end]);

        domlevel.removeNodesFromRange(range, body, 'u', locators);

        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)"(*3*)<u>(*4*)"(*5*)b(*6*)"(*7*)<b>(*8*)"(*9*)c(*10*)"(*11*)<u>(*12*)"(*13*)d"</u></b></u><b>"(*14*)e"</b><u><b><u>"(*15*)f(*16*)"(*17*)</u>(*18*)"(*19*)g(*20*)"(*21*)</b>(*22*)"(*23*)h(*24*)"(*25*)</u>(*26*)"(*27*)i(*28*)"(*29*)</i>', rte.getBody(), locators);
      }
    },

    {
      name: 'wrapRange',
      test: function (doc, win) {
        const rte = win.rte.getEditor();

        // Test with normal range
        rte.setContentsHTML('<i>abc</i>');
        let body = rte.getBody();
        let italicelement = body.firstChild;
        const textnode = italicelement.firstChild;

        let locators = getAllLocators(win, italicelement);
        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)b(*3*)c(*4*)"(*5*)</i>', rte.getBody(), locators);

        let range = new Range(
          new domlevel.Locator(textnode, 1),
          new domlevel.Locator(textnode, 2));

        testEqHTMLEx('<i>"a(*0*)b(*1*)c"</i>', rte.getBody(), [range.start, range.end]);

        domlevel.wrapRange(range, () => document.createElement('u'), { preserveLocators: locators });
        testEqHTMLEx('<i>(*0*)"(*1*)a"<u>"(*2*)b"</u>"(*3*)c(*4*)"(*5*)</i>', rte.getBody(), locators);

        // Test with two ranges
        rte.setContentsHTML('<i><b>ab</b>cd</i>');
        body = rte.getBody();
        italicelement = body.firstChild;
        const boldelement = italicelement.firstChild;
        const firsttextnode = boldelement.firstChild;
        const secondtextnode = boldelement.nextSibling;

        locators = getAllLocators(win, italicelement);
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a(*3*)b(*4*)"(*5*)</b>(*6*)"(*7*)c(*8*)d(*9*)"(*10*)</i>', rte.getBody(), locators);

        range = new Range(new domlevel.Locator(firsttextnode, 1), new domlevel.Locator(secondtextnode, 1));
        testEqHTMLEx('<i><b>"a(*0*)b"</b>"c(*1*)d"</i>', rte.getBody(), [range.start, range.end]);

        domlevel.wrapRange(range, () => document.createElement('u'), { preserveLocators: locators });
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a"</b><u><b>"(*3*)b(*4*)"(*5*)</b>(*6*)"(*7*)c"</u>"(*8*)d(*9*)"(*10*)</i>', rte.getBody(), locators);

        //Test leaving parts alone
        const testdoc = document.createElement("div");
        testdoc.innerHTML = `<div><i>dont</i><u>This is a text</u><i>dont</i><u>do</u></div>`
          + `<div><i>dont</i><u>Another text</u><i>dont</i></div>`;

        range = new Range(new domlevel.Locator(testdoc.querySelectorAll("u")[0].firstChild, 5), new domlevel.Locator(testdoc.querySelectorAll("u")[2].firstChild, 2)); //"is a text" ... "An"
        testEqHTMLEx(`<div><i>dont</i><u>This (*0*)is a text</u><i>dont</i><u>do</u></div>`
          + `<div><i>dont</i><u>An(*1*)other text</u><i>dont</i></div>`, testdoc, [range.start, range.end], { textQuote: "" });

        domlevel.wrapRange(range, () => document.createElement('del'), { onCanWrapNode: () => false, onAllowIn: (node: HTMLElement) => node.matches("div,u") });
        testEqHTMLEx(`<div><i>dont</i><u>This <del>(*0*)is a text</del></u><i>dont</i><u><del>do</del></u></div>`
          + `<div><i>dont</i><u><del>An</del>(*1*)other text</u><i>dont</i></div>`, testdoc, [range.start, range.end], { textQuote: "" });
      }
    },

    {
      name: 'combineNodes',
      test: function (doc, win) {
        const rte = win.rte.getEditor();

        rte.setContentsHTML('<i><b><u>a</u></b><b><u>b</u></b></i>');
        let italicelement = rte.getBody().firstChild;
        let locators = getAllLocators(win, italicelement);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)"(*3*)a(*4*)"(*5*)</u>(*6*)</b>(*7*)<b>(*8*)<u>(*9*)"(*10*)b(*11*)"(*12*)</u>(*13*)</b>(*14*)</i>', rte.getBody(), locators);
        domlevel.combineWithPreviousNodesAtLocator(locators[4], italicelement, false, ["b", "u"], locators);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)"(*3*)a(*4*)(*5*)(*6*)(*7*)(*8*)(*9*)(*10*)b(*11*)"(*12*)</u>(*13*)</b>(*14*)</i>', rte.getBody(), locators);

        rte.setContentsHTML('<i><b><u>a</u></b><b><u>b</u></b></i>');
        italicelement = rte.getBody().firstChild;
        locators = getAllLocators(win, italicelement);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)"(*3*)a(*4*)"(*5*)</u>(*6*)</b>(*7*)<b>(*8*)<u>(*9*)"(*10*)b(*11*)"(*12*)</u>(*13*)</b>(*14*)</i>', rte.getBody(), locators);
        domlevel.combineWithPreviousNodesAtLocator(locators[4], italicelement, false, ["b"], locators);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)"(*3*)a(*4*)"(*5*)</u>(*6*)(*7*)(*8*)<u>(*9*)"(*10*)b(*11*)"(*12*)</u>(*13*)</b>(*14*)</i>', rte.getBody(), locators);

        rte.setContentsHTML('<i><b><u>a</u></b><b><u>b</u></b></i>');
        italicelement = rte.getBody().firstChild;
        locators = getAllLocators(win, italicelement);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)"(*3*)a(*4*)"(*5*)</u>(*6*)</b>(*7*)<b>(*8*)<u>(*9*)"(*10*)b(*11*)"(*12*)</u>(*13*)</b>(*14*)</i>', rte.getBody(), locators);
        domlevel.combineWithPreviousNodesAtLocator(locators[4], italicelement, false, function () { return false; }, locators);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)"(*3*)a(*4*)"(*5*)</u>(*6*)</b>(*7*)<b>(*8*)<u>(*9*)"(*10*)b(*11*)"(*12*)</u>(*13*)</b>(*14*)</i>', rte.getBody(), locators);

        // Towards start on empty node
        rte.setContentsHTML('<i><b><u></u></b><b><u>b</u></b></i>');
        italicelement = rte.getBody().firstChild;
        locators = getAllLocators(win, italicelement);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)</u>(*3*)</b>(*4*)<b>(*5*)<u>(*6*)"(*7*)b(*8*)"(*9*)</u>(*10*)</b>(*11*)</i>', rte.getBody(), locators);
        domlevel.combineWithPreviousNodesAtLocator(locators[2], italicelement, false, ["b", "u"], locators);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)</u>(*3*)</b>(*4*)<b>(*5*)<u>(*6*)"(*7*)b(*8*)"(*9*)</u>(*10*)</b>(*11*)</i>', rte.getBody(), locators);

        // Towards end on empty node
        rte.setContentsHTML('<i><b><u></u></b><b><u>b</u></b></i>');
        italicelement = rte.getBody().firstChild;
        locators = getAllLocators(win, italicelement);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)</u>(*3*)</b>(*4*)<b>(*5*)<u>(*6*)"(*7*)b(*8*)"(*9*)</u>(*10*)</b>(*11*)</i>', rte.getBody(), locators);
        domlevel.combineWithPreviousNodesAtLocator(locators[2], italicelement, true, ["b", "u"], locators);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)(*3*)(*4*)(*5*)(*6*)"(*7*)b(*8*)"(*9*)</u>(*10*)</b>(*11*)</i>', rte.getBody(), locators);
      }
    },

    {
      name: 'combineAdjacentTextNodes',
      test: function (doc, win) {
        const rte = win.rte.getEditor();
        let placedlocators, alllocators, italicelement;

        rte.setContentsHTML('<i>"a(*0*)"(*1*)</i>');
        placedlocators = richdebug.unstructureDom(rte.getBody());

        const testcontents = '<i>"a(*0*)"(*1*)"(*2*)b"</i>';
        rte.setContentsHTML(testcontents);
        placedlocators = richdebug.unstructureDom(rte.getBody());
        italicelement = rte.getBody().firstChild;
        alllocators = getAllLocators(win, italicelement);
        domlevel.combineAdjacentTextNodes(placedlocators[0], alllocators);
        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)(*3*)(*4*)b(*5*)"(*6*)</i>', rte.getBody(), alllocators);
      }
    },

    {
      name: 'range.splitStartBoundary & insertbefore',
      test: function (doc, win) {
        const rte = win.rte.getEditor();

        rte.setContentsHTML('<i><b>abc</b>def</i>');
        test.eq('<i><b>abc</b>def</i>', win.rte.getValue().toLowerCase());
        let body = rte.getBody();
        let italicelement = body.firstChild;
        let boldelement = italicelement.firstChild;
        let firsttext = boldelement.firstChild;
        let nexttext = boldelement.nextSibling;

        let loca = new domlevel.Locator(firsttext, 1);
        let locb = new domlevel.Locator(firsttext, 1);
        let range = new Range(loca, locb);

        //        console.log('pre', domlevel.getStructuredOuterHTML(rte.getBody(), range));
        range.splitStartBoundary(null);
        //        console.log('post', domlevel.getStructuredOuterHTML(rte.getBody(), range));

        test.eq(firsttext.nextSibling, range.start.getPointedNode());
        test.eq(firsttext.nextSibling, range.end.element);
        test.eq(0, range.end.offset);

        rte.setContentsHTML('<i><b>abc</b>def</i>');
        test.eq('<i><b>abc</b>def</i>', win.rte.getValue().toLowerCase());
        body = rte.getBody();
        italicelement = body.firstChild;
        boldelement = italicelement.firstChild;
        firsttext = boldelement.firstChild;
        nexttext = boldelement.nextSibling;

        loca = new domlevel.Locator(firsttext, 1);
        locb = new domlevel.Locator(firsttext, 2);
        range = new Range(loca, locb);

        range.splitStartBoundary(null);
        test.eq(firsttext.nextSibling, range.start.getPointedNode());
        test.eq(firsttext.nextSibling, range.end.element);
        test.eq(1, range.end.offset);

        rte.setContentsHTML('<i><b>abc</b>def</i>');
        test.eq('<i><b>abc</b>def</i>', win.rte.getValue().toLowerCase());
        body = rte.getBody();
        italicelement = body.firstChild;
        boldelement = italicelement.firstChild;
        firsttext = boldelement.firstChild;
        nexttext = boldelement.nextSibling;

        loca = new domlevel.Locator(firsttext, 1);
        locb = new domlevel.Locator(firsttext, 3);
        range = new Range(loca, locb);

        range.splitStartBoundary(null);
        test.eq(firsttext.nextSibling, range.start.getPointedNode());
        test.eq(boldelement, range.end.element);
        test.eq(2, range.end.offset);

        rte.setContentsHTML('<i><b>abc</b>def</i>');
        test.eq('<i><b>abc</b>def</i>', win.rte.getValue().toLowerCase());
        body = rte.getBody();
        italicelement = body.firstChild;
        boldelement = italicelement.firstChild;
        firsttext = boldelement.firstChild;
        nexttext = boldelement.nextSibling;

        loca = new domlevel.Locator(firsttext, 1);
        locb = new domlevel.Locator(italicelement, 1);
        range = new Range(loca, locb);

        range.splitStartBoundary(null);

        test.eq(firsttext.nextSibling, range.start.getPointedNode());
        test.eq(nexttext, range.end.getPointedNode());

        rte.setContentsHTML('<i><b>abc</b>def</i>');
        const locators = getAllLocators(win, rte.getBody().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a(*3*)b(*4*)c(*5*)"(*6*)</b>(*7*)"(*8*)d(*9*)e(*10*)f(*11*)"(*12*)</i>', rte.getBody(), locators);
        range = new Range(locators[3], locators[4]);
        const newnode = document.createElement('br');

        range.insertBefore(newnode, locators);
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a"<br>"(*3*)b(*4*)c(*5*)"(*6*)</b>(*7*)"(*8*)d(*9*)e(*10*)f(*11*)"(*12*)</i>', rte.getBody(), locators);
      }
    },

    {
      name: 'importNode',
      test: function (doc, win) {
        const rte = win.rte.getEditor();

        rte.setContentsHTMLRaw('<i><a href="link">link</a></i>');
        const imported = doc.importNode(rte.getBody(), true);
        test.eq('<i><a href="link">link</a></i>', imported.innerHTML.toLowerCase());
      }
    },

    {
      name: 'rewriteWhitespace',
      test: function (doc, win) {
        const rte = win.rte.getEditor();
        let placedlocators, alllocators, italicelement;

        rte.setContentsHTML('<i>"a (*0*) b"</i>');
        placedlocators = richdebug.unstructureDom(rte.getBody());
        italicelement = rte.getBody().firstChild;
        alllocators = getAllLocators(win, italicelement);
        domlevel.rewriteWhitespace(rte.getBody(), placedlocators[0], alllocators);
        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*) (*3*)\u00a0(*4*)b(*5*)"(*6*)</i>', rte.getBody(), alllocators);

        rte.setContentsHTML('<i>"(*0*) b"</i>');
        placedlocators = richdebug.unstructureDom(rte.getBody());
        italicelement = rte.getBody().firstChild;
        alllocators = getAllLocators(win, italicelement);
        domlevel.rewriteWhitespace(rte.getBody(), placedlocators[0], alllocators);
        testEqHTMLEx('<i>(*0*)"(*1*)\u00a0(*2*)b(*3*)"(*4*)</i>', rte.getBody(), alllocators);

        rte.setContentsHTML('<i>"a\u00a0(*0*)  \u00a0   b"</i>');
        placedlocators = richdebug.unstructureDom(rte.getBody());
        italicelement = rte.getBody().firstChild;
        alllocators = getAllLocators(win, italicelement);
        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)\u00a0(*3*) (*4*) (*5*)\u00a0(*6*) (*7*) (*8*) (*9*)b(*10*)"(*11*)</i>', rte.getBody(), alllocators);
        domlevel.rewriteWhitespace(rte.getBody(), placedlocators[0], alllocators);
        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)\u00a0(*3*) (*4*)(*5*)\u00a0(*6*) (*7*)(*8*)(*9*)b(*10*)"(*11*)</i>', rte.getBody(), alllocators);
      }
    }


  ]);
