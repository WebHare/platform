import * as test from "@mod-tollium/js/testframework";
var richdebug = require('@mod-tollium/web/ui/components/richeditor/internal/richdebug');
var domlevel = require('@mod-tollium/web/ui/components/richeditor/internal/domlevel');
import Range from '@mod-tollium/web/ui/components/richeditor/internal/dom/range';

function cloneWithLocatorText(node, locators)
{
  if (node.nodeType == 3)
  {
    let text = '"';
    for (let i = 0; i <= node.nodeValue.length; ++i)
    {
      for (let l = 0; l < locators.length; ++l)
        if (locators[l].element == node && locators[l].offset == i)
          text += '(*' + l + '*)';
      text += node.nodeValue.substr(i, 1);
    }
    return node.ownerDocument.createTextNode(text + '"');
  }

  //var nodes = [];
  var copy = node.cloneNode(false);

  for (let i = 0; i <= node.childNodes.length; ++i)
  {
    for (let l = 0; l < locators.length; ++l)
      if (locators[l].element == node && locators[l].offset == i)
      {
        let text = '(*' + l + '*)';
        var textnode = node.ownerDocument.createTextNode(text);
        copy.appendChild(textnode);
      }
    var child = node.childNodes[i];
    if (child)
      copy.appendChild(cloneWithLocatorText(child, locators));
  }

  return copy;
}

function testEqHTMLEx(expect, node, locators)
{
  var actual = cloneWithLocatorText(node, locators || []).innerHTML;
  test.eqHTML(expect, actual);
}

function getAllLocators(win, node)
{
  return richdebug.getAllLocatorsInNode(node);
}

function InitLocatorsId(locators)
{
  for (var i = 0; i < locators.length; ++i)
    locators[i].id = i;
}

class UndoTest
{
  constructor(win)
  {
    this.rootitem = win.rte.getEditor().getContentBodyNode();
    this.win = win;
    this.xcount = 0;
    this.item = new domlevel.UndoItem(this.rootitem);
    this.tree = this.getTree();
    this.item.onitemadded = this.gotItem.bind(this);
    this.item.onstatechange = this.gotStateChange.bind(this);
    this.trees = [ this.tree ];
  }

  gotItem(event)
  {
    //console.log('item added');
    //console.trace();
    this.trees.push(this.getTree());
    //console.log('state ', this.item.items.length, this.domlevel.getStructuredOuterHTML(this.rootitem, null, true));
  }

  gotStateChange(e)
  {
    //console.log('new state: ', e.pos);
    test.eq(this.trees[e.pos], this.getTree());
  }

  getTree()
  {
    return { node: this.rootitem, nodeType: this.rootitem.nodeType, children: this.getSubTree(this.rootitem) };
  }

  getSubTree(node)
  {
    var res = [];
    for (var i = 0; i < node.childNodes.length; ++i)
    {
      var child = node.childNodes[i];
      if (!child._xtest)
        child._xtest = this.item.items.length + '/' + (++this.xcount);

      var elt =
          { node: child
          , type: node.nodeType
          };
      switch (child.nodeType)
      {
        case 3:
        case 4:
          elt.value = child.nodeValue; break;
        case 1:
          elt.children = this.getSubTree(child); break;
        default:
          throw new Error("Unsupported elt type " + child.nodeType);
      }
      res.push(elt);
    }
    return res;
  }

  test()
  {
    //console.log('start undo test');
    this.aftertree = this.getTree();
    this.item.undo();
    test.eq(this.tree, this.getTree());
    this.item.redo();
    test.eq(this.aftertree, this.getTree());
    //console.log('finish undo test');
  }
}


// Sample code:
//  console.log('data', domlevel.getStructuredOuterHTML(rte.getContentBodyNode(), { }));

var useblockfill = true;

test.registerTests(
  [ { loadpage: '/.webhare_testsuite/tests/pages/rte/?editor=free'
    }
  , { name: 'firsttest'
    , test: function(doc,win)
      {
        var rte = win.rte.getEditor();

        // First test, place to paste failing tests
        var movetests =
            [ '<div>"a(*0*)(*2*)b(*1*)(*3*)c"</div>'
            , '<div>"a"<b>"(*0*)(*2*)b(*1*)(*3*)"</b>"c"</div>'
            , '<div>"a"<img></img>"test"<b>"(*0*)(*2*)b(*1*)(*3*)"</b>"c"</div>'
            , '<p>"hmmm hmm"</p><img src="/tests/webhare.png">"test"<b>"(*0*)(*2*)Bo ld!(*1*)(*3*)"</b>"en nog een "<a href="http://example.org/">"hyperlink"</a>"!"<p>"regel 2"</p><p>"image met "<a href="#link">"een hyperlink: "<img src="/tests/webhare.png"></a></p>'
            ];

        for (var i = 0; i < movetests.length; ++i)
        {
          console.log('test ', i, movetests[i]);

          rte.setContentsHTML(movetests[i]);
          var locators = richdebug.unstructureDom(win, rte.getContentBodyNode());
          var range = new Range(locators[0], locators[1]);
          range.normalize(rte.getContentBodyNode());

          test.true(range.start.equals(locators[2]));
          test.true(range.end.equals(locators[3]));
        }
      }
    }

  , { name: 'locators'
    , test: function(doc,win)
      {
        var rte = win.rte.getEditor();

        rte.setContentsHTML('<i><b>abc</b>def<u>ghi</u></i>');
        test.eq('<i><b>abc</b>def<u>ghi</u></i>', win.rte.getValue().toLowerCase());

        var locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a(*3*)b(*4*)c(*5*)"(*6*)</b>(*7*)"(*8*)d(*9*)e(*10*)f(*11*)"(*12*)<u>(*13*)"(*14*)g(*15*)h(*16*)i(*17*)"(*18*)</u>(*19*)</i>', rte.getContentBodyNode(), locators);

        for (var a = 0; a < locators.length; ++a)
          for (var b = 0; b < locators.length; ++b)
            test.eq(a==b?0:a<b?-1:1, locators[a].compare(locators[b]));

        // Locator ascending
        rte.setContentsHTML('<i><b><br><br></b></i>');

        locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<br>(*2*)<br>(*3*)</b>(*4*)</i>', rte.getContentBodyNode(), locators);

        var italicnode = locators[0].element;

        // Test moveToParent
        var loc = locators[1].clone();
        test.true(loc.moveToParent(false));
        test.true(loc.equals(locators[0]));

        loc = locators[2].clone();
        test.false(loc.moveToParent(false));
        test.true(loc.equals(locators[2]));

        loc = locators[3].clone();
        test.true(loc.moveToParent(false));
        test.true(loc.equals(locators[4]));

        loc = locators[2].clone();
        test.true(loc.moveToParent(false, true));
        test.true(loc.equals(locators[0]));

        loc = locators[2].clone();
        test.true(loc.moveToParent(true, true));
        test.true(loc.equals(locators[4]));

        // Test ascend
        test.true(locators[0].equals(locators[1].clone().ascend(italicnode)));
        test.true(locators[2].equals(locators[2].clone().ascend(italicnode)));
        test.true(locators[4].equals(locators[3].clone().ascend(italicnode)));

        test.true(locators[0].equals(locators[1].clone().ascend(italicnode, false, true)));
        test.true(locators[0].equals(locators[2].clone().ascend(italicnode, false, true)));
        test.true(locators[4].equals(locators[3].clone().ascend(italicnode, false, true)));

        test.true(locators[0].equals(locators[1].clone().ascend(italicnode, true, true)));
        test.true(locators[4].equals(locators[2].clone().ascend(italicnode, true, true)));
        test.true(locators[4].equals(locators[3].clone().ascend(italicnode, true, true)));
      }
    }

  , { name: 'locatoractions'
    , test: function(doc,win)
      {
        var rte = win.rte.getEditor();

        rte.setContentsHTML('<div><p>a</p><p><br _moz_editor_bogus_node="_moz"></p></div>');
        var utest = new UndoTest(win);
        var locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<div>(*0*)<p>(*1*)"(*2*)a(*3*)"(*4*)</p>(*5*)<p>(*6*)<br _moz_editor_bogus_node="_moz">(*7*)</p>(*8*)</div>', rte.getContentBodyNode(), locators);

        var newelt = document.createElement('br');
        locators[4].insertNode(newelt, locators, utest.item);
        testEqHTMLEx('<div>(*0*)<p>(*1*)"(*2*)a(*3*)"<br>(*4*)</p>(*5*)<p>(*6*)<br _moz_editor_bogus_node="_moz">(*7*)</p>(*8*)</div>', rte.getContentBodyNode(), locators);
        utest.test();

        utest = new UndoTest(win);
        newelt = document.createElement('br');
        locators[7].insertNode(newelt, locators, utest.item);
        testEqHTMLEx('<div>(*0*)<p>(*1*)"(*2*)a(*3*)"<br>(*4*)</p>(*5*)<p>(*6*)<br><br>(*7*)</p>(*8*)</div>', rte.getContentBodyNode(), locators);
        utest.test();

        rte.setContentsHTML('<div><p>a<br></p><p><br><br></p></div>');
        locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<div>(*0*)<p>(*1*)"(*2*)a(*3*)"(*4*)<br>(*5*)</p>(*6*)<p>(*7*)<br>(*8*)<br>(*9*)</p>(*10*)</div>', rte.getContentBodyNode(), locators);
        utest = new UndoTest(win);
        locators[4].removeNode(locators, utest.item);
        testEqHTMLEx('<div>(*0*)<p>(*1*)"(*2*)a(*3*)"(*4*)(*5*)</p>(*6*)<p>(*7*)<br>(*8*)<br>(*9*)</p>(*10*)</div>', rte.getContentBodyNode(), locators);
        utest.test();
      }
    }

  , { name: 'locatormove'
    , test: function(doc,win)
      {
        var rte = win.rte.getEditor();

        /* Locator is put at (*0*)
            (*1*): move past last visible
            (*2*): move past last visible, place in text
            (*3*): move to first visible, place in text
            (*4*): move to first visible
            (*5*): previous block boundary
            (*6*): pext block boundary
        */

        var movetests =
            [ '<div>(*5*)"a (*0*)(*1*)(*2*)(*3*)(*4*)b"(*6*)</div>'

            , '<div>(*0*)(*1*)(*5*)"(*2*)(*3*)(*4*)a  b "<br>"ab"(*6*)<div>"babla"</div></div>'
            , '<div>(*1*)(*5*)"(*0*)(*2*)(*3*)(*4*)a  b "<br>"ab"(*6*)<div>"babla"</div></div>'
            , '<div>(*5*)"a(*0*)(*1*)(*2*)(*3*)(*4*)  b "<br>"ab"(*6*)<div>"babla"</div></div>'
            , '<div>(*5*)"a (*0*)(*1*)(*2*) (*3*)(*4*)b "<br>"ab"(*6*)<div>"babla"</div></div>'
            , '<div>(*5*)"a (*1*)(*2*) (*0*)(*3*)(*4*)b "<br>"ab"(*6*)<div>"babla"</div></div>'
            , '<div>(*5*)"a (*1*)(*2*) (*0*)(*3*)(*4*)b "<br>"ab"(*6*)<div>"babla"</div></div>'
            , '<div>(*5*)"a  b(*0*)(*1*)(*2*)(*3*)(*4*) "<br>"ab"(*6*)<div>"babla"</div></div>'
            , '<div>(*5*)"a  b (*0*)(*1*)(*2*)(*3*)"(*4*)<br>"ab"(*6*)<div>"babla"</div></div>'
            , '<div>(*5*)"a  b (*1*)(*2*)(*3*)"(*0*)(*4*)<br>"ab"(*6*)<div>"babla"</div></div>'
            , '<div>(*5*)"a  b"<br>(*0*)(*1*)"(*2*)(*3*)(*4*)ab"(*6*)<div>"babla"</div></div>'
            , '<div>(*5*)"a  b"<br>(*1*)"(*0*)(*2*)(*3*)(*4*)ab"(*6*)<div>"babla"</div></div>'
            , '<div>(*5*)"a  b"<br>"a(*0*)(*1*)(*2*)(*3*)(*4*)b"(*6*)<div>"babla"</div></div>'
            , '<div>(*5*)"a  b"<br>"ab(*0*)(*1*)(*2*)(*3*)"(*4*)(*6*)<div>"babla"</div></div>'
            , '<div>(*5*)"a  b"<br>"ab(*1*)(*2*)(*3*)"(*0*)(*4*)(*6*)<div>"babla"</div></div>'
            , '<div>"a  b"<br>"ab"<div>(*0*)(*1*)(*5*)"(*2*)(*3*)(*4*)babla"(*6*)</div></div>'
            , '<div>"a  b"<br>"ab"<div>(*1*)(*5*)"(*0*)(*2*)(*3*)(*4*)babla"(*6*)</div></div>'
            , '<div>"a  b"<br>"ab"<div>(*5*)"b(*0*)(*1*)(*2*)(*3*)(*4*)abla"(*6*)</div></div>'
            // ...
            , '<div>"a  b"<br>"ab"<div>(*5*)"babla(*0*)(*1*)(*2*)(*3*)"(*4*)(*6*)</div></div>'
            , '<div>"a  b"<br>"ab"<div>(*5*)"babla(*1*)(*2*)(*3*)"(*0*)(*4*)(*6*)</div></div>'
            , useblockfill
                ? '<div>"a  "<br>"ab"<div>"babla(*1*)(*2*)(*3*)"(*4*)</div>(*0*)(*5*)(*6*)</div>'
                : '<div>"a  "<br>"ab"<div>"babla(*1*)(*2*)(*3*)"(*4*)</div>(*0*)(*5*)(*6*)</div>'

            , '<div>(*0*)(*5*)(*6*)<div>(*1*)"(*2*)(*3*)(*4*)a"</div></div>' // better!
            , '<div><p class="normal">"a"</p><p class="normal">(*1*)(*5*)"(*0*)(*2*) (*3*)"(*4*)<br>(*6*)</p><p class="normal"><br></p></div>'

//FIXME: determine what the resolution should be in thise cases
//            , '<div>(*0*)(*1*)(*2*)(*5*)(*6*)<div>"(*3*)(*4*)a"</div></div>'
//            , '<div><ol><li>"ab"<ol><li>"c"</li><li><br></br>(*1*)(*2*)(*3*)(*4*)</li>(*0*)(*5*)(*6*)</ol>"d"</li></ol><p>"a"</p><div>'
//            , '<div><ol><li>"ab"<ol><li>"c"</li><li>(*5*)<br>(*0*)(*6*)</li></ol>(*1*)"(*2*)(*3*)(*4*)d"</li></ol></div>'

            ];

        for (var i = 0; i < movetests.length; ++i)
        {
          console.log('test ', i, movetests[i]);
          rte.setContentsHTML(movetests[i]);
          var locators = richdebug.unstructureDom(win, rte.getContentBodyNode());
          var result = [ locators[0].clone(), locators[0].clone(), locators[0].clone(), locators[0].clone(), locators[0].clone(), locators[0].clone(), locators[0].clone() ];

          result[1].movePastLastVisible(rte.getContentBodyNode().firstChild, false, false);
          result[2].movePastLastVisible(rte.getContentBodyNode().firstChild, false, true);
          result[3].moveToFirstVisible(rte.getContentBodyNode().firstChild, false, true);
          result[4].moveToFirstVisible(rte.getContentBodyNode().firstChild, false, false);
          result[5].moveToPreviousBlockBoundary(rte.getContentBodyNode().firstChild);
          result[6].moveToNextBlockBoundary(rte.getContentBodyNode().firstChild);

          testEqHTMLEx(movetests[i], rte.getContentBodyNode(), result);
        }
      }
    }

  , { name: 'locatorwalkleftright'
    , test: function(doc,win)
      {
        var rte = win.rte.getEditor();

        rte.setContentsHTML('<ol><li>ab<ol><li>c</li><li><br></li></ol>d</ol><p><br></p><p>a<svg></svg></p>');
        var locators = getAllLocators(win, rte.getContentBodyNode());
        testEqHTMLEx('(*0*)<ol>(*1*)<li>(*2*)"(*3*)a(*4*)b(*5*)"(*6*)<ol>(*7*)<li>(*8*)"(*9*)c(*10*)"(*11*)</li>(*12*)<li>(*13*)<br>(*14*)</li>(*15*)</ol>(*16*)"(*17*)d(*18*)"(*19*)</li>(*20*)</ol>(*21*)<p>(*22*)<br>(*23*)</p>(*24*)<p>(*25*)"(*26*)a(*27*)"(*28*)<svg></svg>(*29*)</p>(*30*)', rte.getContentBodyNode(), locators);

        // Calculate the equivalence ranges (from moveToFirstVisible)
        var eqranges = [];
        var start = -1;
        var last = -1;
        for (let i = 0; i < locators.length; ++i)
        {
          var loc = locators[i].clone();
          loc.moveToFirstVisible(rte.getContentBodyNode());

          var match = -1;
          for (let a = 0; a < locators.length; ++a)
            if (locators[a].compare(loc) == 0)
            {
              //console.log(i,'->',a);
              match = a;
            }
          if (last != match)
          {
            if (last > match)
            {
              console.log('ordering fail', i, richdebug.getStructuredOuterHTML(rte.getContentBodyNode(), { afrom: locators[i - 1], ato: locators[last], bfrom: locators[i], bto: locators[match] }));
              test.true(false);
            }

            if (start != -1)
              eqranges.push({ left: start, right: i - 1, match: match });
            last = match;
            start = i;
          }
        }
        eqranges.push({ left: start, right: locators.length - 1 });

        for (let i = 0; i < locators.length; ++i)
        {
          if (i==114)//[14,15,16,17].contains(i))
          {
            console.log('** skip ', i);
            continue;
          }

          var rangenr = 0;
          for (let a = 0; a < eqranges.length; ++a)
            if (i >= eqranges[a].left && i <= eqranges[a].right)
              rangenr = a;

          var mrange = new Range(locators[eqranges[rangenr].left], locators[eqranges[rangenr].right]);
          var lrangenr = rangenr == 0 ? 0 : rangenr - 1;
          let lrange = new Range(locators[eqranges[lrangenr].left], locators[eqranges[lrangenr].right]);
          var rrangenr = rangenr == eqranges.length - 1 ? eqranges.length - 1 : rangenr + 1;
          let rrange = new Range(locators[eqranges[rrangenr].left], locators[eqranges[rrangenr].right]);

          var tfv = locators[i].clone();
          tfv.moveToFirstVisible(rte.getContentBodyNode());

          //console.log('*', i);
          //console.log('pre', richdebug.getStructuredOuterHTML(rte.getContentBodyNode(), { locator: locators[i], mrange: mrange, lrange: lrange, rrange: rrange, tfv: tfv }, { indent: true }));

          var lcopy = tfv.clone();//locators[i].clone();
          lcopy.moveLeft(rte.getContentBodyNode());
          var rcopy = tfv.clone();//locators[i].clone();
          rcopy.moveRight(rte.getContentBodyNode());

          //console.log('post', i, domlevel.getStructuredOuterHTML(rte.getContentBodyNode(), { locator: locators[i], mrange: mrange, lcopy: lcopy, rcopy: rcopy, lrange: lrange, rrange: rrange, tfv: tfv }));
          var leftfail = lcopy.compare(lrange.start) < 0 || lcopy.compare(lrange.end) > 0;
          var rightfail = rcopy.compare(rrange.start) < 0 || rcopy.compare(rrange.end) > 0;

          if (leftfail || rightfail)
            console.log('fail', i, leftfail, rightfail, richdebug.getStructuredOuterHTML(rte.getContentBodyNode(), { locator: locators[i], mrange: mrange, gotleft: lcopy, gotright: rcopy, expectleft: lrange, expectright: rrange, tfv: tfv }));

          test.false(leftfail);
          test.false(rightfail);
        }
      }
    }

  , { name: 'rangestuff'
    , test: function(doc,win)
      {
        var rte = win.rte.getEditor();

        rte.setContentsHTML('<i><b>abc</b>def<u>ghi</u></i>');
        test.eq('<i><b>abc</b>def<u>ghi</u></i>', win.rte.getValue().toLowerCase());

        var locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a(*3*)b(*4*)c(*5*)"(*6*)</b>(*7*)"(*8*)d(*9*)e(*10*)f(*11*)"(*12*)<u>(*13*)"(*14*)g(*15*)h(*16*)i(*17*)"(*18*)</u>(*19*)</i>', rte.getContentBodyNode(), locators);

        var range = new Range(locators[0], locators[7]);
        range.insertBefore(document.createElement('br'), locators);

        testEqHTMLEx('<i><br>(*0*)<b>(*1*)"(*2*)a(*3*)b(*4*)c(*5*)"(*6*)</b>(*7*)"(*8*)d(*9*)e(*10*)f(*11*)"(*12*)<u>(*13*)"(*14*)g(*15*)h(*16*)i(*17*)"(*18*)</u>(*19*)</i>', rte.getContentBodyNode(), locators);
        testEqHTMLEx('<i><br>(*0*)<b>"abc"</b>(*1*)"def"<u>"ghi"</u></i>', rte.getContentBodyNode(), [ range.start, range.end ]);
      }
    }


  , { name: 'datasplit'
    , test: function(doc,win)
      {
        var rte = win.rte.getEditor();

        rte.setContentsHTML('<i><b>ab</b>c</i>');
        var utest = new UndoTest(win);
        var locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a(*3*)b(*4*)"(*5*)</b>(*6*)"(*7*)c(*8*)"(*9*)</i>', rte.getContentBodyNode(), locators);
        domlevel.splitDataNode(locators[3], locators, null, utest.item); // use a locator from the preservelocators
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a""(*3*)b(*4*)"(*5*)</b>(*6*)"(*7*)c(*8*)"(*9*)</i>', rte.getContentBodyNode(), locators);
        utest.test();

        rte.setContentsHTML('<i><b>ab</b>c</i>');
        utest = new UndoTest(win);
        locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a(*3*)b(*4*)"(*5*)</b>(*6*)"(*7*)c(*8*)"(*9*)</i>', rte.getContentBodyNode(), locators);
        domlevel.splitDataNode(locators[3], locators, 'end', utest.item); // use a locator from the preservelocators
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a""(*3*)b(*4*)"(*5*)</b>(*6*)"(*7*)c(*8*)"(*9*)</i>', rte.getContentBodyNode(), locators);
        utest.test();

        rte.setContentsHTML('<i><b>ab</b>c</i>');
        utest = new UndoTest(win);
        locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a(*3*)b(*4*)"(*5*)</b>(*6*)"(*7*)c(*8*)"(*9*)</i>', rte.getContentBodyNode(), locators);
        domlevel.splitDataNode(locators[3], locators, 'start', utest.item); // use a locator from the preservelocators
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a(*3*)""b(*4*)"(*5*)</b>(*6*)"(*7*)c(*8*)"(*9*)</i>', rte.getContentBodyNode(), locators);
        utest.test();
      }
    }

  , { name: 'elementsplit'
    , test: function(doc,win)
      {
        var rte = win.rte.getEditor();

        rte.setContentsHTML('<i><b><u><br><br></u></b><u><br></u></i>');
        var utest = new UndoTest(win);
        var locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)<br>(*3*)<br>(*4*)</u>(*5*)</b>(*6*)<u>(*7*)<br>(*8*)</u>(*9*)</i>', rte.getContentBodyNode(), locators);
        domlevel.splitElement(locators[3], locators, null, utest.item); // use a locator from the preservelocators
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)<br></u><u>(*3*)<br>(*4*)</u>(*5*)</b>(*6*)<u>(*7*)<br>(*8*)</u>(*9*)</i>', rte.getContentBodyNode(), locators);
        utest.test();

        rte.setContentsHTML('<i><b><u><br><br></u></b><u><br></u></i>');
        utest = new UndoTest(win);
        locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)<br>(*3*)<br>(*4*)</u>(*5*)</b>(*6*)<u>(*7*)<br>(*8*)</u>(*9*)</i>', rte.getContentBodyNode(), locators);
        domlevel.splitElement(locators[3], locators, 'end', utest.item); // use a locator from the preservelocators
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)<br></u><u>(*3*)<br>(*4*)</u>(*5*)</b>(*6*)<u>(*7*)<br>(*8*)</u>(*9*)</i>', rte.getContentBodyNode(), locators);
        utest.test();

        rte.setContentsHTML('<i><b><u><br><br></u></b><u><br></u></i>');
        utest = new UndoTest(win);
        locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)<br>(*3*)<br>(*4*)</u>(*5*)</b>(*6*)<u>(*7*)<br>(*8*)</u>(*9*)</i>', rte.getContentBodyNode(), locators);
        domlevel.splitElement(locators[3], locators, 'start', utest.item); // use a locator from the preservelocators
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)<br>(*3*)</u><u><br>(*4*)</u>(*5*)</b>(*6*)<u>(*7*)<br>(*8*)</u>(*9*)</i>', rte.getContentBodyNode(), locators);
        utest.test();

      }
    }

  , { name: 'moveSimpleRangeTo'
    , test: function(doc,win)
      {
        var rte = win.rte.getEditor();

        // Subnode forward to root
        rte.setContentsHTML('<i><b>x<br></b>a<u>b</u><br>c</i>');
        var utest = new UndoTest(win);
        var locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)x(*3*)"(*4*)<br>(*5*)</b>(*6*)"(*7*)a(*8*)"(*9*)<u>(*10*)"(*11*)b(*12*)"(*13*)</u>(*14*)<br>(*15*)"(*16*)c(*17*)"(*18*)</i>', rte.getContentBodyNode(), locators);

        var range = new Range(locators[1], locators[5]);
        domlevel.moveSimpleRangeTo(range, locators[14], locators, utest.item);

        testEqHTMLEx('<i>(*0*)<b>(*1*)</b>"a"<u>"b"</u>"(*2*)x(*3*)"(*4*)<br>(*5*)(*6*)(*7*)(*8*)(*9*)(*10*)(*11*)(*12*)(*13*)(*14*)<br>(*15*)"(*16*)c(*17*)"(*18*)</i>', rte.getContentBodyNode(), locators);
        utest.test();

        // Root forward to root
        rte.setContentsHTML('<i>a<br>b<br>c<br>d<br>e</i>');
        utest = new UndoTest(win);
        locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)"(*3*)<br>(*4*)"(*5*)b(*6*)"(*7*)<br>(*8*)"(*9*)c(*10*)"(*11*)<br>(*12*)"(*13*)d(*14*)"(*15*)<br>(*16*)"(*17*)e(*18*)"(*19*)</i>', rte.getContentBodyNode(), locators);

        domlevel.moveSimpleRangeTo(new Range(locators[3], locators[11]), locators[15], locators, utest.item);

        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)"(*3*)<br>"d"<br>(*4*)"(*5*)b(*6*)"(*7*)<br>(*8*)"(*9*)c(*10*)"(*11*)(*12*)(*13*)(*14*)(*15*)<br>(*16*)"(*17*)e(*18*)"(*19*)</i>', rte.getContentBodyNode(), locators);
        utest.test();

        // Root forward to subnode
        rte.setContentsHTML('<i>a<br>b<br>c<br><b></b><br>e</i>');
        utest = new UndoTest(win);
        locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)"(*3*)<br>(*4*)"(*5*)b(*6*)"(*7*)<br>(*8*)"(*9*)c(*10*)"(*11*)<br>(*12*)<b>(*13*)</b>(*14*)<br>(*15*)"(*16*)e(*17*)"(*18*)</i>', rte.getContentBodyNode(), locators);
        domlevel.moveSimpleRangeTo(new Range(locators[0], locators[4]), locators[13], locators, utest.item);

        testEqHTMLEx('<i>(*0*)"b"<br>"c"<br><b>"(*1*)a(*2*)"(*3*)<br>(*4*)(*5*)(*6*)(*7*)(*8*)(*9*)(*10*)(*11*)(*12*)(*13*)</b>(*14*)<br>(*15*)"(*16*)e(*17*)"(*18*)</i>', rte.getContentBodyNode(), locators);
        utest.test();

        // Subnode backward to root
        rte.setContentsHTML('<i>a<br><u>b</u><b>x<br></b><br>c</i>');
        utest = new UndoTest(win);
        locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)"(*3*)<br>(*4*)<u>(*5*)"(*6*)b(*7*)"(*8*)</u>(*9*)<b>(*10*)"(*11*)x(*12*)"(*13*)<br>(*14*)</b>(*15*)<br>(*16*)"(*17*)c(*18*)"(*19*)</i>', rte.getContentBodyNode(), locators);

        domlevel.moveSimpleRangeTo(new Range(locators[10], locators[14]), locators[4], locators, utest.item);
        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)"(*3*)<br>(*4*)(*5*)(*6*)(*7*)(*8*)(*9*)(*10*)"(*11*)x(*12*)"(*13*)<br><u>"b"</u><b>(*14*)</b>(*15*)<br>(*16*)"(*17*)c(*18*)"(*19*)</i>', rte.getContentBodyNode(), locators);
        utest.test();

        // Root backward to root
        rte.setContentsHTML('<i>a<br>b<br>c<br>d<br>e</i>');
        utest = new UndoTest(win);
        locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)"(*3*)<br>(*4*)"(*5*)b(*6*)"(*7*)<br>(*8*)"(*9*)c(*10*)"(*11*)<br>(*12*)"(*13*)d(*14*)"(*15*)<br>(*16*)"(*17*)e(*18*)"(*19*)</i>', rte.getContentBodyNode(), locators);

        domlevel.moveSimpleRangeTo(new Range(locators[11], locators[15]), locators[3], locators, utest.item);
        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)"(*3*)(*4*)(*5*)(*6*)(*7*)(*8*)(*9*)(*10*)(*11*)<br>(*12*)"(*13*)d(*14*)"<br>"b"<br>"c"(*15*)<br>(*16*)"(*17*)e(*18*)"(*19*)</i>', rte.getContentBodyNode(), locators);
        utest.test();

        // Root backward to subnode
        rte.setContentsHTML('<i>b<br>c<br><b>a<br></b><br>e</i>', rte.getContentBodyNode(), locators);
        utest = new UndoTest(win);
        locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<i>(*0*)"(*1*)b(*2*)"(*3*)<br>(*4*)"(*5*)c(*6*)"(*7*)<br>(*8*)<b>(*9*)"(*10*)a(*11*)"(*12*)<br>(*13*)</b>(*14*)<br>(*15*)"(*16*)e(*17*)"(*18*)</i>', rte.getContentBodyNode(), locators);

        domlevel.moveSimpleRangeTo(new Range(locators[9], locators[13]), locators[4], locators, utest.item);
        testEqHTMLEx('<i>(*0*)"(*1*)b(*2*)"(*3*)<br>(*4*)(*5*)(*6*)(*7*)(*8*)(*9*)"(*10*)a(*11*)"(*12*)<br>"c"<br><b>(*13*)</b>(*14*)<br>(*15*)"(*16*)e(*17*)"(*18*)</i>', rte.getContentBodyNode(), locators);
        utest.test();

        // Test move data
        rte.setContentsHTML('abcdefg', rte.getContentBodyNode(), locators);
        utest = new UndoTest(win);
        locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('"(*0*)a(*1*)b(*2*)c(*3*)d(*4*)e(*5*)f(*6*)g(*7*)"', rte.getContentBodyNode(), locators);

        domlevel.moveSimpleRangeTo(new Range(locators[4], locators[6]), locators[2], locators, utest.item);
        testEqHTMLEx('"(*0*)a(*1*)b(*2*)(*3*)(*4*)e(*5*)fcd(*6*)g(*7*)"', rte.getContentBodyNode(), locators);
        utest.test();
      }
    }

  , { name: 'removeSimpleRange'
    , test: function(doc,win)
      {
        var rte = win.rte.getEditor();

        // Node with contents
        rte.setContentsHTML('<i>a<b>x</b>cd<br></i>');
        var utest = new UndoTest(win);
        var locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)"(*3*)<b>(*4*)"(*5*)x(*6*)"(*7*)</b>(*8*)"(*9*)c(*10*)d(*11*)"(*12*)<br>(*13*)</i>', rte.getContentBodyNode(), locators);

        domlevel.removeSimpleRange(new Range(locators[3], locators[8]), locators, utest.item);
        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)"(*3*)(*4*)(*5*)(*6*)(*7*)(*8*)"(*9*)c(*10*)d(*11*)"(*12*)<br>(*13*)</i>', rte.getContentBodyNode(), locators);
        utest.test();

        // Text
        rte.setContentsHTML('abcdefg');
        utest = new UndoTest(win);
        locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('"(*0*)a(*1*)b(*2*)c(*3*)d(*4*)e(*5*)f(*6*)g(*7*)"', rte.getContentBodyNode(), locators);

        domlevel.removeSimpleRange(new Range(locators[3], locators[5]), locators, utest.item);
        testEqHTMLEx('"(*0*)a(*1*)b(*2*)c(*3*)(*4*)(*5*)f(*6*)g(*7*)"', rte.getContentBodyNode(), locators);
        utest.test();
      }
    }


  , { name: 'elementcombine'
    , test: function(doc,win)
      {
        var rte = win.rte.getEditor();

        rte.setContentsHTML('<i><b><u><br></u><u><br></u></b><u><br></u></i>');
        var locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)<br>(*3*)</u>(*4*)<u>(*5*)<br>(*6*)</u>(*7*)</b>(*8*)<u>(*9*)<br>(*10*)</u>(*11*)</i>', rte.getContentBodyNode(), locators);
        var utest = new UndoTest(win);
        domlevel.combineNodeWithPreviousNode(locators[5].element, locators, utest.item); // use a locator from the preservelocators
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)<br>(*3*)(*4*)(*5*)<br>(*6*)</u>(*7*)</b>(*8*)<u>(*9*)<br>(*10*)</u>(*11*)</i>', rte.getContentBodyNode(), locators);
        utest.test();

        rte.setContentsHTML('<i><b><u>a</u></b></i>');
        utest = new UndoTest(win);
        locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)"(*3*)a(*4*)"(*5*)</u>(*6*)</b>(*7*)</i>', rte.getContentBodyNode(), locators);
        var res = domlevel.combineNodes(locators[0], locators[2].element, locators, utest.item);
        testEqHTMLEx('<i>(*0*)(*1*)(*2*)"(*3*)a(*4*)"(*5*)<b>(*6*)</b>(*7*)</i>', rte.getContentBodyNode(), locators);
        test.eq(locators[0].element, res.node);
        test.true(res.locator.equals(locators[0]));
        test.true(res.afterlocator.equals(locators[5]));
        utest.test();

        rte.setContentsHTML('<i><b>ab</b></i>');
        utest = new UndoTest(win);
        locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a(*3*)b(*4*)"(*5*)</b>(*6*)</i>', rte.getContentBodyNode(), locators);
        res = domlevel.combineNodes(locators[0], locators[1].element, locators, utest.item);
        testEqHTMLEx('<i>(*0*)(*1*)"(*2*)a(*3*)b(*4*)"(*5*)(*6*)</i>', rte.getContentBodyNode(), locators);
        test.eq(locators[0].element, res.node);
        test.true(res.locator.equals(locators[0]));
        test.true(res.afterlocator.equals(locators[5]));
        utest.test();

        rte.setContentsHTML('<i><b>ab</b></i>');
        utest = new UndoTest(win);
        locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a(*3*)b(*4*)"(*5*)</b>(*6*)</i>', rte.getContentBodyNode(), locators);
        res = domlevel.combineNodes(locators[6], locators[1].element, locators, utest.item);
        testEqHTMLEx('<i>(*0*)(*1*)"(*2*)a(*3*)b(*4*)"(*5*)(*6*)</i>', rte.getContentBodyNode(), locators);
        testEqHTMLEx('<i>(*0*)"ab"(*1*)</i>', rte.getContentBodyNode(), [ res.locator, res.afterlocator ]);
        test.eq(locators[0].element, res.node);
        utest.test();

        rte.setContentsHTML('<i><u></u><u><b>ab</b></u></i>');
        utest = new UndoTest(win);
        locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<i>(*0*)<u>(*1*)</u>(*2*)<u>(*3*)<b>(*4*)"(*5*)a(*6*)b(*7*)"(*8*)</b>(*9*)</u>(*10*)</i>', rte.getContentBodyNode(), locators);
        res = domlevel.combineNodes(locators[1], locators[4].element, locators, utest.item);
        testEqHTMLEx('<i>(*0*)<u>(*1*)(*2*)(*3*)(*4*)"(*5*)a(*6*)b(*7*)"(*8*)</u><u>(*9*)</u>(*10*)</i>', rte.getContentBodyNode(), locators);
        testEqHTMLEx('<i>(*0*)<u>(*1*)"ab"(*2*)</u><u></u></i>', rte.getContentBodyNode(), [ domlevel.Locator.newPointingTo(res.node), res.locator, res.afterlocator ]);
        utest.test();

        rte.setContentsHTML('<i><u><b>ab</b></u><u></u></i>');
        utest = new UndoTest(win);
        locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<i>(*0*)<u>(*1*)<b>(*2*)"(*3*)a(*4*)b(*5*)"(*6*)</b>(*7*)</u>(*8*)<u>(*9*)</u>(*10*)</i>', rte.getContentBodyNode(), locators);
        res = domlevel.combineNodes(locators[9], locators[2].element, locators, utest.item);
        testEqHTMLEx('<i>(*0*)<u>(*1*)</u><u>(*2*)"(*3*)a(*4*)b(*5*)"(*6*)(*7*)(*8*)(*9*)</u>(*10*)</i>', rte.getContentBodyNode(), locators);
        testEqHTMLEx('<i><u></u>(*0*)<u>(*1*)"ab"(*2*)</u></i>', rte.getContentBodyNode(), [ domlevel.Locator.newPointingTo(res.node), res.locator, res.afterlocator ]);
        utest.test();

        rte.setContentsHTML('<i><b><u>a</u>b<br></b></i>');
        utest = new UndoTest(win);
        locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)"(*3*)a(*4*)"(*5*)</u>(*6*)"(*7*)b(*8*)"(*9*)<br>(*10*)</b>(*11*)</i>', rte.getContentBodyNode(), locators);
        res = domlevel.combineNodes(locators[4], locators[7].element, locators, utest.item);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)"(*3*)a(*4*)(*5*)(*6*)(*7*)b(*8*)"</u>(*9*)<br>(*10*)</b>(*11*)</i>', rte.getContentBodyNode(), locators);
        utest.test();

      }
    }

  , { name: 'elementreplacewithchildren'
    , test: function(doc,win)
      {
        var rte = win.rte.getEditor();

        rte.setContentsHTML('<i><b><u><br><br></u><br></b><br></i>');
        var utest = new UndoTest(win);

        var body = rte.getContentBodyNode();
        var italicelement = body.firstChild;
        var boldelement = italicelement.firstChild;
        var firstunderlined = boldelement.firstChild;

        var locators = getAllLocators(win, italicelement);

        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)<br>(*3*)<br>(*4*)</u>(*5*)<br>(*6*)</b>(*7*)<br>(*8*)</i>', rte.getContentBodyNode(), locators);
        domlevel.replaceSingleNodeWithItsContents(firstunderlined, locators, utest.item);
        testEqHTMLEx('<i>(*0*)<b>(*1*)(*2*)<br>(*3*)<br>(*4*)(*5*)<br>(*6*)</b>(*7*)<br>(*8*)</i>', rte.getContentBodyNode(), locators);
        utest.test();
      }
    }

  , { name: 'elementwrap'
    , test: function(doc,win)
      {
        var rte = win.rte.getEditor();

        rte.setContentsHTML('<i><b><br>a<br><br></b><br></i>');
        var utest = new UndoTest(win);

        var body = rte.getContentBodyNode();
        var italicelement = body.firstChild;
//        var boldelement = italicelement.firstChild;
//        var brelements = body.getElementsByTagName('br');
//        var firsttext = brelements[0].nextSibling;

        var locators = getAllLocators(win, italicelement);

        testEqHTMLEx('<i>(*0*)<b>(*1*)<br>(*2*)"(*3*)a(*4*)"(*5*)<br>(*6*)<br>(*7*)</b>(*8*)<br>(*9*)</i>', rte.getContentBodyNode(), locators);

        var newnode = doc.createElement('u');
        domlevel.wrapNodesInNewNode(locators[2], 2, newnode, locators, utest.item);

        testEqHTMLEx('<i>(*0*)<b>(*1*)<br><u>(*2*)"(*3*)a(*4*)"(*5*)<br>(*6*)</u><br>(*7*)</b>(*8*)<br>(*9*)</i>', rte.getContentBodyNode(), locators);
        utest.test();

        rte.setContentsHTML('<i><b>a<br>b</b><br></i>');
        utest = new UndoTest(win);
        locators = getAllLocators(win, rte.getContentBodyNode().firstChild);

        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a(*3*)"(*4*)<br>(*5*)"(*6*)b(*7*)"(*8*)</b>(*9*)<br>(*10*)</i>', rte.getContentBodyNode(), locators);
        var range = new Range(locators[1], locators[8]);

        newnode = doc.createElement('u');
        domlevel.wrapSimpleRangeInNewNode(range, newnode, locators, utest.item);

        testEqHTMLEx('<i>(*0*)<b><u>(*1*)"(*2*)a(*3*)"(*4*)<br>(*5*)"(*6*)b(*7*)"(*8*)</u></b>(*9*)<br>(*10*)</i>', rte.getContentBodyNode(), locators);
        testEqHTMLEx('<i><b><u>(*0*)"a"<br>"b"(*1*)</u></b><br></i>', rte.getContentBodyNode(), [ range.start, range.end ]);
        utest.test();
      }
    }

  , { name: 'removeNodesFromTree'
    , test: function(doc,win)
      {
        var rte = win.rte.getEditor();

        rte.setContentsHTML('<i><b><u><br><u><br></u><br></u><br></b><br></i>');
        var utest = new UndoTest(win);

        var body = rte.getContentBodyNode();
        var italicelement = body.firstChild;

        var locators = getAllLocators(win, italicelement);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)<br>(*3*)<u>(*4*)<br>(*5*)</u>(*6*)<br>(*7*)</u>(*8*)<br>(*9*)</b>(*10*)<br>(*11*)</i>', rte.getContentBodyNode(), locators);

        domlevel.removeNodesFromTree(italicelement, 'u', locators, utest.item);

        testEqHTMLEx('<i>(*0*)<b>(*1*)(*2*)<br>(*3*)(*4*)<br>(*5*)(*6*)<br>(*7*)(*8*)<br>(*9*)</b>(*10*)<br>(*11*)</i>', rte.getContentBodyNode(), locators);
        utest.test();
      }
    }

  , { name: 'splitdom'
    , test: function(doc,win)
      {
        var rte = win.rte.getEditor();


        rte.setContentsHTML('<b>ab</b>');
        var utest = new UndoTest(win);

        test.eq('<b>ab</b>', win.rte.getValue().toLowerCase());
        var body = rte.getContentBodyNode();
        var boldelement = body.firstChild;

        var locators = getAllLocators(win, body);
        testEqHTMLEx('(*0*)<b>(*1*)"(*2*)a(*3*)b(*4*)"(*5*)</b>(*6*)', rte.getContentBodyNode(), locators);

        var res = domlevel.splitDom(
            body,
            [ { locator: new domlevel.Locator(boldelement.firstChild, 'a'.length)
              , toward: 'start'
              }
            ], locators, utest.item);

        testEqHTMLEx('(*0*)<b>"a"</b>(*1*)(*2*)<b>"b"</b>(*3*)', body, [ res[0].start, res[0].end, res[1].start, res[1].end]);
        testEqHTMLEx('(*0*)<b>(*1*)"(*2*)a"</b><b>"(*3*)b(*4*)"(*5*)</b>(*6*)', rte.getContentBodyNode(), locators);
        utest.test();

        // Also works for splitting text nodes?
        rte.setContentsHTML('<b>ab</b>');
        utest = new UndoTest(win);
        body = rte.getContentBodyNode();
        boldelement = body.firstChild;

        locators = getAllLocators(win, body);
        testEqHTMLEx('(*0*)<b>(*1*)"(*2*)a(*3*)b(*4*)"(*5*)</b>(*6*)', rte.getContentBodyNode(), locators);

        res = domlevel.splitDom(
            boldelement,
            [ { locator: locators[3]
              , toward: 'start'
              }
            ], locators, utest.item);

        testEqHTMLEx('<b>(*0*)"a"(*1*)(*2*)"b"(*3*)</b>', body, [ res[0].start, res[0].end, res[1].start, res[1].end]);
        testEqHTMLEx('(*0*)<b>(*1*)"(*2*)a""(*3*)b(*4*)"(*5*)</b>(*6*)', rte.getContentBodyNode(), locators);
        utest.test();

        rte.setContentsHTML('<p>123</p>');
        utest = new UndoTest(win);
        body = rte.getContentBodyNode();
        var p = body.getElementsByTagName('p')[0];
        res = domlevel.splitDom(
            body,
            [ { locator: new domlevel.Locator(p.firstChild, 1)
              , toward: 'start'
              }
            , { locator: new domlevel.Locator(p.firstChild, 2)
              , toward: 'end'
              }
            ], null, utest.item);

        testEqHTMLEx('(*0*)<p>"1"</p>(*1*)(*2*)<p>"2"</p>(*3*)(*4*)<p>"3"</p>(*5*)', rte.getContentBodyNode(),
            [ res[0].start
            , res[0].end
            , res[1].start
            , res[1].end
            , res[2].start
            , res[2].end
            ]);
        utest.test();

        rte.setContentsHTML('<p>12</p>');
        utest = new UndoTest(win);
        body = rte.getContentBodyNode();
        p = body.getElementsByTagName('p')[0];
        res = domlevel.splitDom(
            body,
            [ { locator: new domlevel.Locator(p.firstChild, 1)
              , toward: 'start'
              }
            , { locator: new domlevel.Locator(p.firstChild, 1)
              , toward: 'end'
              }
            ], null, utest.item);

        testEqHTMLEx('(*0*)<p>"1"</p>(*1*)(*2*)(*3*)(*4*)<p>"2"</p>(*5*)', rte.getContentBodyNode(),
            [ res[0].start
            , res[0].end
            , res[1].start
            , res[1].end
            , res[2].start
            , res[2].end
            ]);
        utest.test();

        rte.setContentsHTML('<p>1<br>23</p>');
        utest = new UndoTest(win);
        body = rte.getContentBodyNode();
        p = body.getElementsByTagName('p')[0];
        var splitpoints =
            [ { locator: new domlevel.Locator(p, 2)
              , toward: 'start'
              }
            , { locator: new domlevel.Locator(p.childNodes[2], 1)
              , toward: 'end'
              }
            , { locator: new domlevel.Locator(p, "end")
              , toward: 'end'
              }
            ];

        res = domlevel.splitDom(body, splitpoints, null, utest.item);

        testEqHTMLEx('(*0*)<p>"1"<br></p>(*1*)(*2*)<p>"2"</p>(*3*)(*4*)<p>"3"</p>(*5*)(*6*)(*7*)', rte.getContentBodyNode(),
            [ res[0].start
            , res[0].end
            , res[1].start
            , res[1].end
            , res[2].start
            , res[2].end
            , res[3].start
            , res[3].end
            ]);
        utest.test();

        rte.setContentsHTML('<div><p>a<br>b</p></div>');
        utest = new UndoTest(win);
        locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<div>(*0*)<p>(*1*)"(*2*)a(*3*)"(*4*)<br>(*5*)"(*6*)b(*7*)"(*8*)</p>(*9*)</div>', rte.getContentBodyNode(), locators);

        var splitpoint = locators[4];
        res = domlevel.splitDom(body.firstChild, [ { locator: splitpoint, toward: 'start' }, { locator: splitpoint, toward: 'end' }, { locator: splitpoint, toward: 'end' } ], locators, utest.item);
        testEqHTMLEx('<div>(*0*)<p>(*1*)"(*2*)a(*3*)"</p><p>(*4*)<br>(*5*)"(*6*)b(*7*)"(*8*)</p>(*9*)</div>', rte.getContentBodyNode(), locators);
        testEqHTMLEx('<div>(*0*)<p>"a"</p>(*1*)(*2*)(*3*)(*4*)(*5*)(*6*)<p><br>"b"</p>(*7*)</div>', rte.getContentBodyNode(),
            [ res[0].start, res[0].end, res[1].start, res[1].end, res[2].start, res[2].end, res[3].start, res[3].end ]);
        utest.test();

        rte.setContentsHTML('<ol class="ordered"><li>a<br>b</li></ol>');
        utest = new UndoTest(win);
        locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        InitLocatorsId(locators);
        testEqHTMLEx('<ol class="ordered">(*0*)<li>(*1*)"(*2*)a(*3*)"(*4*)<br>(*5*)"(*6*)b(*7*)"(*8*)</li>(*9*)</ol>', rte.getContentBodyNode(), locators);
        var range = new Range(locators[3], locators[3]);
        domlevel.splitDom(rte.getContentBodyNode().firstChild, [ { locator: range.start, toward: 'start' } ], locators, utest.item);
        testEqHTMLEx('<ol class="ordered">(*0*)<li>(*1*)"(*2*)a"</li><li>(*3*)(*4*)<br>(*5*)"(*6*)b(*7*)"(*8*)</li>(*9*)</ol>', rte.getContentBodyNode(), locators);
        utest.test();

        rte.setContentsHTML('<ol class="ordered"><li>a<br>b</li></ol>');
        utest = new UndoTest(win);
        locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<ol class="ordered">(*0*)<li>(*1*)"(*2*)a(*3*)"(*4*)<br>(*5*)"(*6*)b(*7*)"(*8*)</li>(*9*)</ol>', rte.getContentBodyNode(), locators);
        range = new Range(locators[6], locators[6]);
        domlevel.splitDom(rte.getContentBodyNode().firstChild, [ { locator: range.start, toward: 'start' } ], locators, utest.item);
        testEqHTMLEx('<ol class="ordered">(*0*)<li>(*1*)"(*2*)a(*3*)"(*4*)<br>(*5*)</li><li>"(*6*)b(*7*)"(*8*)</li>(*9*)</ol>', rte.getContentBodyNode(), locators);
        utest.test();
      }
    }

  , { name: 'removeNodesFromRange'
    , test: function(doc,win)
      {
        var rte = win.rte.getEditor();

        // Test with normal range
        rte.setContentsHTML('<i><b><u><u>abc</u>de</u>f<u><i>gh</i>i</u>j</b>k</i>');
        var utest = new UndoTest(win);

        var body = rte.getContentBodyNode();
        var italicelement = body.firstChild;
        var underlinenodes = body.getElementsByTagName('U');

        // Get locators, test if we have correct html & locator positions
        var locators = getAllLocators(win, italicelement);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)<u>(*3*)"(*4*)a(*5*)b(*6*)c(*7*)"(*8*)</u>(*9*)"(*10*)d(*11*)e(*12*)"(*13*)</u>(*14*)"(*15*)f(*16*)"(*17*)<u>(*18*)<i>(*19*)"(*20*)g(*21*)h(*22*)"(*23*)</i>(*24*)"(*25*)i(*26*)"(*27*)</u>(*28*)"(*29*)j(*30*)"(*31*)</b>(*32*)"(*33*)k(*34*)"(*35*)</i>', rte.getContentBodyNode(), locators);

        var range = new Range(
            new domlevel.Locator(underlinenodes[1].firstChild, 1),
            new domlevel.Locator(underlinenodes[0].nextSibling));

        // Test if range is what we want
        testEqHTMLEx('<i><b><u><u>"a(*0*)bc"</u>"de"</u>"(*1*)f"<u><i>"gh"</i>"i"</u>"j"</b>"k"</i>', rte.getContentBodyNode(), [ range.start, range.end ]);

        domlevel.removeNodesFromRange(range, body, 'u', locators, utest.item);

        testEqHTMLEx('<i><b><u><u>"a"</u></u>"bc""de""f"<u><i>"gh"</i>"i"</u>"j"</b>"k"</i>', rte.getContentBodyNode());
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)<u>(*3*)"(*4*)a"</u></u>"(*5*)b(*6*)c(*7*)"(*8*)(*9*)"(*10*)d(*11*)e(*12*)"(*13*)(*14*)"(*15*)f(*16*)"(*17*)<u>(*18*)<i>(*19*)"(*20*)g(*21*)h(*22*)"(*23*)</i>(*24*)"(*25*)i(*26*)"(*27*)</u>(*28*)"(*29*)j(*30*)"(*31*)</b>(*32*)"(*33*)k(*34*)"(*35*)</i>', rte.getContentBodyNode(), locators);
        utest.test();

        // Test where deep ancestor of range is removed too
        rte.setContentsHTML('<i>a<u>b<b>c<u>def</u>g</b>h</u>i</i>');
        utest = new UndoTest(win);
        body = rte.getContentBodyNode();
        italicelement = body.firstChild;
        underlinenodes = body.getElementsByTagName('U');

        // Get locators, test if we have correct html & locator positions
        locators = getAllLocators(win, italicelement);
        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)"(*3*)<u>(*4*)"(*5*)b(*6*)"(*7*)<b>(*8*)"(*9*)c(*10*)"(*11*)<u>(*12*)"(*13*)d(*14*)e(*15*)f(*16*)"(*17*)</u>(*18*)"(*19*)g(*20*)"(*21*)</b>(*22*)"(*23*)h(*24*)"(*25*)</u>(*26*)"(*27*)i(*28*)"(*29*)</i>', rte.getContentBodyNode(), locators);

        range = new Range(
            new domlevel.Locator(underlinenodes[1].firstChild, 1),
            new domlevel.Locator(underlinenodes[1].firstChild, 2));

        // Test if range is what we want
        testEqHTMLEx('<i>"a"<u>"b"<b>"c"<u>"d(*0*)e(*1*)f"</u>"g"</b>"h"</u>"i"</i>', rte.getContentBodyNode(), [ range.start, range.end ]);

        domlevel.removeNodesFromRange(range, body, 'u', locators, utest.item);

        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)"(*3*)<u>(*4*)"(*5*)b(*6*)"(*7*)<b>(*8*)"(*9*)c(*10*)"(*11*)<u>(*12*)"(*13*)d"</u></b></u><b>"(*14*)e"</b><u><b><u>"(*15*)f(*16*)"(*17*)</u>(*18*)"(*19*)g(*20*)"(*21*)</b>(*22*)"(*23*)h(*24*)"(*25*)</u>(*26*)"(*27*)i(*28*)"(*29*)</i>', rte.getContentBodyNode(), locators);
        utest.test();
      }
    }

  , { name: 'wrapRange'
    , test: function(doc,win)
      {
        var rte = win.rte.getEditor();

        // Test with normal range
        rte.setContentsHTML('<i>abc</i>');
        var utest = new UndoTest(win);
        var body = rte.getContentBodyNode();
        var italicelement = body.firstChild;
        var textnode = italicelement.firstChild;

        var locators = getAllLocators(win, italicelement);
        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)b(*3*)c(*4*)"(*5*)</i>', rte.getContentBodyNode(), locators);

        var range = new Range(
            new domlevel.Locator(textnode, 1),
            new domlevel.Locator(textnode, 2));

        testEqHTMLEx('<i>"a(*0*)b(*1*)c"</i>', rte.getContentBodyNode(), [ range.start, range.end ]);

        domlevel.wrapRange(
             range,
             function() { return document.createElement('u'); },
             null,
             null,
             locators,
             utest.item);

        testEqHTMLEx('<i>(*0*)"(*1*)a"<u>"(*2*)b"</u>"(*3*)c(*4*)"(*5*)</i>', rte.getContentBodyNode(), locators);
        utest.test();

        // Test with two ranges
        rte.setContentsHTML('<i><b>ab</b>cd</i>');
        utest = new UndoTest(win);
        body = rte.getContentBodyNode();
        italicelement = body.firstChild;
        var boldelement = italicelement.firstChild;
        var firsttextnode = boldelement.firstChild;
        var secondtextnode = boldelement.nextSibling;

        locators = getAllLocators(win, italicelement);
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a(*3*)b(*4*)"(*5*)</b>(*6*)"(*7*)c(*8*)d(*9*)"(*10*)</i>', rte.getContentBodyNode(), locators);

        range = new Range(new domlevel.Locator(firsttextnode, 1), new domlevel.Locator(secondtextnode, 1));
        testEqHTMLEx('<i><b>"a(*0*)b"</b>"c(*1*)d"</i>', rte.getContentBodyNode(), [ range.start, range.end ]);

        domlevel.wrapRange(
             range,
             function() { return document.createElement('u'); },
             null,
             null,
             locators,
             utest.item);

        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a"</b><u><b>"(*3*)b(*4*)"(*5*)</b>(*6*)"(*7*)c"</u>"(*8*)d(*9*)"(*10*)</i>', rte.getContentBodyNode(), locators);
        utest.test();

        // Test with two ranges and split prohibits
        rte.setContentsHTML('<i><b>ab</b>c<b>de</b></i>');
        utest = new UndoTest(win);

        locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a(*3*)b(*4*)"(*5*)</b>(*6*)"(*7*)c(*8*)"(*9*)<b>(*10*)"(*11*)d(*12*)e(*13*)"(*14*)</b>(*15*)</i>', rte.getContentBodyNode(), locators);

        domlevel.wrapRange(
             new Range(locators[3], locators[12]),
             function() { return document.createElement('u'); },
             function(node) { return false; }, // may not split at all
             null,
             locators,
             utest.item);

        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a"<u>"(*3*)b(*4*)"(*5*)</u></b><u>(*6*)"(*7*)c(*8*)"(*9*)</u><b><u>(*10*)"(*11*)d"</u>"(*12*)e(*13*)"(*14*)</b>(*15*)</i>', rte.getContentBodyNode(), locators);
        utest.test();

        // Test with two ranges and split prohibits
        rte.setContentsHTML('<i><b>ab</b>c<sub>de</sub></i>');
        utest = new UndoTest(win);

        locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a(*3*)b(*4*)"(*5*)</b>(*6*)"(*7*)c(*8*)"(*9*)<sub>(*10*)"(*11*)d(*12*)e(*13*)"(*14*)</sub>(*15*)</i>', rte.getContentBodyNode(), locators);

        domlevel.wrapRange(
             new Range(locators[3], locators[12]),
             function() { return document.createElement('u'); },
             function(node) { return false; }, // may not split at all
             function(node) { return ['sub'].includes(node.nodeName.toLowerCase()); }, // but MUST wrap 'u's
             locators,
             utest.item);

        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a"<u>"(*3*)b(*4*)"(*5*)</u></b><u>(*6*)"(*7*)c(*8*)"(*9*)<sub>(*10*)"(*11*)d"</sub></u><sub>"(*12*)e(*13*)"(*14*)</sub>(*15*)</i>', rte.getContentBodyNode(), locators);
        utest.test();
      }
    }

  , { name: 'combineNodes'
    , test: function(doc,win)
      {
        var rte = win.rte.getEditor();

        rte.setContentsHTML('<i><b><u>a</u></b><b><u>b</u></b></i>');
        var utest = new UndoTest(win);
        var italicelement = rte.getContentBodyNode().firstChild;
        var locators = getAllLocators(win, italicelement);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)"(*3*)a(*4*)"(*5*)</u>(*6*)</b>(*7*)<b>(*8*)<u>(*9*)"(*10*)b(*11*)"(*12*)</u>(*13*)</b>(*14*)</i>', rte.getContentBodyNode(), locators);
        domlevel.combineWithPreviousNodesAtLocator(locators[4], italicelement, false, ["b","u"], locators, utest.item);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)"(*3*)a(*4*)(*5*)(*6*)(*7*)(*8*)(*9*)(*10*)b(*11*)"(*12*)</u>(*13*)</b>(*14*)</i>', rte.getContentBodyNode(), locators);
        utest.test();

        rte.setContentsHTML('<i><b><u>a</u></b><b><u>b</u></b></i>');
        utest = new UndoTest(win);
        italicelement = rte.getContentBodyNode().firstChild;
        locators = getAllLocators(win, italicelement);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)"(*3*)a(*4*)"(*5*)</u>(*6*)</b>(*7*)<b>(*8*)<u>(*9*)"(*10*)b(*11*)"(*12*)</u>(*13*)</b>(*14*)</i>', rte.getContentBodyNode(), locators);
        domlevel.combineWithPreviousNodesAtLocator(locators[4], italicelement, false, ["b"], locators, utest.item);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)"(*3*)a(*4*)"(*5*)</u>(*6*)(*7*)(*8*)<u>(*9*)"(*10*)b(*11*)"(*12*)</u>(*13*)</b>(*14*)</i>', rte.getContentBodyNode(), locators);
        utest.test();

        rte.setContentsHTML('<i><b><u>a</u></b><b><u>b</u></b></i>');
        utest = new UndoTest(win);
        italicelement = rte.getContentBodyNode().firstChild;
        locators = getAllLocators(win, italicelement);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)"(*3*)a(*4*)"(*5*)</u>(*6*)</b>(*7*)<b>(*8*)<u>(*9*)"(*10*)b(*11*)"(*12*)</u>(*13*)</b>(*14*)</i>', rte.getContentBodyNode(), locators);
        domlevel.combineWithPreviousNodesAtLocator(locators[4], italicelement, false, function(){return false;}, locators, utest.item);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)"(*3*)a(*4*)"(*5*)</u>(*6*)</b>(*7*)<b>(*8*)<u>(*9*)"(*10*)b(*11*)"(*12*)</u>(*13*)</b>(*14*)</i>', rte.getContentBodyNode(), locators);
        utest.test();

        // Towards start on empty node
        rte.setContentsHTML('<i><b><u></u></b><b><u>b</u></b></i>');
        utest = new UndoTest(win);
        italicelement = rte.getContentBodyNode().firstChild;
        locators = getAllLocators(win, italicelement);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)</u>(*3*)</b>(*4*)<b>(*5*)<u>(*6*)"(*7*)b(*8*)"(*9*)</u>(*10*)</b>(*11*)</i>', rte.getContentBodyNode(), locators);
        domlevel.combineWithPreviousNodesAtLocator(locators[2], italicelement, false, ["b","u"], locators, utest.item);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)</u>(*3*)</b>(*4*)<b>(*5*)<u>(*6*)"(*7*)b(*8*)"(*9*)</u>(*10*)</b>(*11*)</i>', rte.getContentBodyNode(), locators);
        utest.test();

        // Towards end on empty node
        rte.setContentsHTML('<i><b><u></u></b><b><u>b</u></b></i>');
        utest = new UndoTest(win);
        italicelement = rte.getContentBodyNode().firstChild;
        locators = getAllLocators(win, italicelement);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)</u>(*3*)</b>(*4*)<b>(*5*)<u>(*6*)"(*7*)b(*8*)"(*9*)</u>(*10*)</b>(*11*)</i>', rte.getContentBodyNode(), locators);
        domlevel.combineWithPreviousNodesAtLocator(locators[2], italicelement, true, ["b","u"], locators, utest.item);
        testEqHTMLEx('<i>(*0*)<b>(*1*)<u>(*2*)(*3*)(*4*)(*5*)(*6*)"(*7*)b(*8*)"(*9*)</u>(*10*)</b>(*11*)</i>', rte.getContentBodyNode(), locators);
        utest.test();
      }
    }

  , { name: 'combineAdjacentTextNodes'
    , test: function(doc,win)
      {
        const rte = win.rte.getEditor();
        let placedlocators, alllocators, utest, italicelement;

        rte.setContentsHTML('<i>"a(*0*)"(*1*)</i>');
        placedlocators = richdebug.unstructureDom(win, rte.getContentBodyNode());

        const testcontents = '<i>"a(*0*)"(*1*)"(*2*)b"</i>';
        rte.setContentsHTML(testcontents);
        placedlocators = richdebug.unstructureDom(win, rte.getContentBodyNode());
        utest = new UndoTest(win);
        italicelement = rte.getContentBodyNode().firstChild;
        alllocators = getAllLocators(win, italicelement);
        domlevel.combineAdjacentTextNodes(placedlocators[0], alllocators, utest.item);
        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)(*3*)(*4*)b(*5*)"(*6*)</i>', rte.getContentBodyNode(), alllocators);
        utest.test();
      }
    }

  , { name: 'range.splitStartBoundary & insertbefore'
    , test: function(doc,win)
      {
        var rte = win.rte.getEditor();

        rte.setContentsHTML('<i><b>abc</b>def</i>');
        var utest = new UndoTest(win);
        test.eq('<i><b>abc</b>def</i>', win.rte.getValue().toLowerCase());
        var body = rte.getContentBodyNode();
        var italicelement = body.firstChild;
        var boldelement = italicelement.firstChild;
        var firsttext = boldelement.firstChild;
        var nexttext = boldelement.nextSibling;

        var loca = new domlevel.Locator(firsttext, 1);
        var locb = new domlevel.Locator(firsttext, 1);
        var range = new Range(loca, locb);

//        console.log('pre', domlevel.getStructuredOuterHTML(rte.getContentBodyNode(), range));
        range.splitStartBoundary(null, utest.item);
//        console.log('post', domlevel.getStructuredOuterHTML(rte.getContentBodyNode(), range));

        test.eq(firsttext.nextSibling, range.start.getPointedNode());
        test.eq(firsttext.nextSibling, range.end.element);
        test.eq(0, range.end.offset);
        utest.test();

        rte.setContentsHTML('<i><b>abc</b>def</i>');
        utest = new UndoTest(win);
        test.eq('<i><b>abc</b>def</i>', win.rte.getValue().toLowerCase());
        body = rte.getContentBodyNode();
        italicelement = body.firstChild;
        boldelement = italicelement.firstChild;
        firsttext = boldelement.firstChild;
        nexttext = boldelement.nextSibling;

        loca = new domlevel.Locator(firsttext, 1);
        locb = new domlevel.Locator(firsttext, 2);
        range = new Range(loca, locb);

        range.splitStartBoundary(null, utest.item);
        test.eq(firsttext.nextSibling, range.start.getPointedNode());
        test.eq(firsttext.nextSibling, range.end.element);
        test.eq(1, range.end.offset);
        utest.test();

        rte.setContentsHTML('<i><b>abc</b>def</i>');
        utest = new UndoTest(win);
        test.eq('<i><b>abc</b>def</i>', win.rte.getValue().toLowerCase());
        body = rte.getContentBodyNode();
        italicelement = body.firstChild;
        boldelement = italicelement.firstChild;
        firsttext = boldelement.firstChild;
        nexttext = boldelement.nextSibling;

        loca = new domlevel.Locator(firsttext, 1);
        locb = new domlevel.Locator(firsttext, 3);
        range = new Range(loca, locb);

        range.splitStartBoundary(null, utest.item);
        test.eq(firsttext.nextSibling, range.start.getPointedNode());
        test.eq(boldelement, range.end.element);
        test.eq(2, range.end.offset);
        utest.test();

        rte.setContentsHTML('<i><b>abc</b>def</i>');
        utest = new UndoTest(win);
        test.eq('<i><b>abc</b>def</i>', win.rte.getValue().toLowerCase());
        body = rte.getContentBodyNode();
        italicelement = body.firstChild;
        boldelement = italicelement.firstChild;
        firsttext = boldelement.firstChild;
        nexttext = boldelement.nextSibling;

        loca = new domlevel.Locator(firsttext, 1);
        locb = new domlevel.Locator(italicelement, 1);
        range = new Range(loca, locb);

        range.splitStartBoundary(null, utest.item);

        test.eq(firsttext.nextSibling, range.start.getPointedNode());
        test.eq(nexttext, range.end.getPointedNode());
        utest.test();

        rte.setContentsHTML('<i><b>abc</b>def</i>');
        utest = new UndoTest(win);
        let locators = getAllLocators(win, rte.getContentBodyNode().firstChild);
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a(*3*)b(*4*)c(*5*)"(*6*)</b>(*7*)"(*8*)d(*9*)e(*10*)f(*11*)"(*12*)</i>', rte.getContentBodyNode(), locators);
        range = new Range(locators[3], locators[4]);
        var newnode = document.createElement('br');

        range.insertBefore(newnode, locators, utest.item);
        testEqHTMLEx('<i>(*0*)<b>(*1*)"(*2*)a"<br>"(*3*)b(*4*)c(*5*)"(*6*)</b>(*7*)"(*8*)d(*9*)e(*10*)f(*11*)"(*12*)</i>', rte.getContentBodyNode(), locators);
        utest.test();
      }
    }

  , { name: 'importNode'
    , test: function(doc,win)
      {
        var rte = win.rte.getEditor();

        rte.setContentsHTMLRaw('<i><a href="link">link</a></i>');
        var imported = doc.importNode(rte.getContentBodyNode(), true);
        test.eq('<i><a href="link">link</a></i>', imported.innerHTML.toLowerCase());
      }
    }

  , { name: 'rewriteWhitespace'
    , test: function(doc,win)
      {
        const rte = win.rte.getEditor();
        let placedlocators, alllocators, utest, italicelement;

        rte.setContentsHTML('<i>"a (*0*) b"</i>');
        placedlocators = richdebug.unstructureDom(win, rte.getContentBodyNode());
        utest = new UndoTest(win);
        italicelement = rte.getContentBodyNode().firstChild;
        alllocators = getAllLocators(win, italicelement);
        domlevel.rewriteWhitespace(rte.getContentBodyNode(), placedlocators[0], alllocators, utest.item);
        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*) (*3*)\u00a0(*4*)b(*5*)"(*6*)</i>', rte.getContentBodyNode(), alllocators);
        utest.test();

        rte.setContentsHTML('<i>"(*0*) b"</i>');
        placedlocators = richdebug.unstructureDom(win, rte.getContentBodyNode());
        utest = new UndoTest(win);
        italicelement = rte.getContentBodyNode().firstChild;
        alllocators = getAllLocators(win, italicelement);
        domlevel.rewriteWhitespace(rte.getContentBodyNode(), placedlocators[0], alllocators, utest.item);
        testEqHTMLEx('<i>(*0*)"(*1*)\u00a0(*2*)b(*3*)"(*4*)</i>', rte.getContentBodyNode(), alllocators);
        utest.test();

        rte.setContentsHTML('<i>"a\u00a0(*0*)  \u00a0   b"</i>');
        placedlocators = richdebug.unstructureDom(win, rte.getContentBodyNode());
        utest = new UndoTest(win);
        italicelement = rte.getContentBodyNode().firstChild;
        alllocators = getAllLocators(win, italicelement);
        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)\u00a0(*3*) (*4*) (*5*)\u00a0(*6*) (*7*) (*8*) (*9*)b(*10*)"(*11*)</i>', rte.getContentBodyNode(), alllocators);
        domlevel.rewriteWhitespace(rte.getContentBodyNode(), placedlocators[0], alllocators, utest.item);
        testEqHTMLEx('<i>(*0*)"(*1*)a(*2*)\u00a0(*3*) (*4*)(*5*)\u00a0(*6*) (*7*)(*8*)(*9*)b(*10*)"(*11*)</i>', rte.getContentBodyNode(), alllocators);
        utest.test();
      }
    }


  ]);
