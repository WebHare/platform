/** @require: var testapi = require('@mod-system/js/wh/testframework');
*/

import * as dompack from 'dompack';
import * as browser from 'dompack/extra/browser';
import { URL } from 'dompack/browserfix/url';

var domfocus = require('@mod-system/js/dom/focus');
var domlevel = require('@mod-tollium/web/ui/components/richeditor/internal/domlevel');
import jstestsrpc from '@mod-system/js/internal/jstests.rpc.json';

import * as test from 'dompack/testframework';
import { testDeepEq } from 'dompack/testframework/expect';
import * as pointer from 'dompack/testframework/pointer';
import * as keyboard from 'dompack/testframework/keyboard';
import * as diff from 'diff';

let module_exports;

if(!keyboard.normalizeKeys)
  keyboard.normalizeKeys = function (key, props) //FIXME a dompack update will soon ship this, then this can go
  {
    let keys = Array.isArray(key) ? key : [key];
    let shift = props && props.shiftKey;
    //match single-char keys (real keys) to upper or lowercase depending on shift state
    keys = keys.map(key => key.length > 1 ? key : shift ? key.toUpperCase() : key.toLowerCase());
    return keys;
  };


//basic test functions
var testfw = window.parent ? window.parent.__testframework : null;
var seleniumref;

//if(testfw && testfw.takeconsolelog)
//  testfw.doConsoleTakeover(window);

let callbacks = null;

// Returns something like an ecmascript completion record
function setTestSuiteCallbacks(cb)
{
  callbacks = cb;
}

function initialize_tests(steps)
{
  var res = testfw.runTestSteps(steps, setTestSuiteCallbacks, module_exports);
  seleniumref = res.seleniumref;
}

function rewriteNodeAttributes(node)
{
  // Make sure the order of the attributes is predictable, by getting them, removing them all and reinserting them
  // with a function that tries to keep it stable.
  var attrs = domlevel.getAllAttributes(node);
  var keys = Object.keys(attrs);
  for (var i = 0; i < keys.length; ++i)
    node.removeAttribute(keys[i]);
  domlevel.setAttributes(node, attrs);
}

function isequal(a, b)
{
  try
  {
    testDeepEq(a,b,'');
    return true;
  }
  catch(e)
  {
    return false;
  }
}

function registerJSTests(steps)
{
  //get our parent test framework
  if(!testfw)
    return console.error("This page is not being invoked by the test framework");

  let outsteps = steps.map(node =>
  {
    if(typeof node == "string")
      return { name: node };
    if(typeof node == "function")
    {
      if (node.name)
        return { test: node, name: node.name };
      else
        return { test: node };
    }
    return node;
  });

  document.addEventListener("DOMContentLoaded", () => initialize_tests(outsteps));
}
function getTestArgument(idx)
{
  if(idx > testfw.args.length)
    throw new Error("No argument #" + idx);
  return testfw.args[idx];
}
function logExplanation(explanation)
{
  if(typeof explanation=="function")
    explanation=explanation();
  console.error(explanation);
  testfw.log("* " + explanation + "\n");
}
window.testEq = function(expected, actual, explanation)
{
  if (arguments.length < 2)
    throw new Error("Missing argument to test.eq");

  if(isequal(expected,actual))
    return;

  let expected_str = expected;
  let actual_str = actual;

  try { expected_str = typeof expected == "string" ? unescape(escape(expected).split('%u').join('/u')) : JSON.stringify(expected); } catch(e){}
  try { actual_str = typeof actual == "string" ? unescape(escape(actual).split('%u').join('/u')) : JSON.stringify(actual); } catch(e){}

  if(explanation)
    logExplanation(explanation);

  console.log("testEq fails: expected", expected_str);
  testfw.log("testEq fails: expected " + (typeof expected_str == "string" ? "'" + expected_str + "'" : expected_str));

  console.log("testEq fails: actual  ", actual_str);
  testfw.log("testEq fails: actual " + (typeof actual_str == "string" ? "'" + actual_str + "'" : actual_str));

  if(typeof expected == "string" && typeof actual == "string")
  {
    testfw.log("E: " + encodeURIComponent(expected));
    testfw.log("A: " + encodeURIComponent(actual));

    let str = "diff: ";
    let colors = [];
    for (const change of diff.diffChars(actual, expected))
    {
      str += `%c${change.value}`;
      colors.push(change.added ? "background-color:red; color: white" : change.removed ? "background-color:green; color: white" : "");
    }
    console.log(str, ...colors);
  }

  testDeepEq(expected, actual, '');
};
function testEqMatch(regexp, actual, explanation)
{
  if(actual.match(regexp))
    return;

  if(explanation)
    logExplanation(explanation);

  console.log("testEqMatch fails: regex", regexp.toString());
  testfw.log("testEqMatch fails: regexp " + regexp.toString());

  let actual_str = actual;
  try { actual_str = typeof actual == "string" ? unescape(escape(actual).split('%u').join('/u')) : JSON.stringify(actual); } catch(e){}
  console.log("testEqMatch fails: actual  ", actual_str);
  testfw.log("testEqMatch fails: actual " + (typeof actual_str == "string" ? "'" + actual_str + "'" : actual_str));

  throw new Error("testEqMatch failed");
}

window.testEqHTML = function(expected, actual, explanation)
{
  var fixer = document.createElement("div");

  // Normalize stuff by parsing into DOM and then extracing again
  fixer.innerHTML=expected;
  expected=fixer.innerHTML;
  fixer.innerHTML=actual;
  actual=fixer.innerHTML;
  if(expected==actual)
    return;

  // Extra round. May fix some stuff
  fixer.innerHTML=expected;
  expected=fixer.innerHTML;
  fixer.innerHTML=actual;
  actual=fixer.innerHTML;
  if(expected==actual)
    return;

  // Firefox has problems with attribute ordering. Rewrite all attributes to get them in the same order.
  fixer.innerHTML=expected;
  var list = fixer.getElementsByTagName('*');
  for (let i = 0; i < list.length; ++i)
    rewriteNodeAttributes(list[i]);
  expected=fixer.innerHTML;
  fixer.innerHTML=actual;
  list = fixer.getElementsByTagName('*');
  for (let i = 0; i < list.length; ++i)
    rewriteNodeAttributes(list[i]);
  actual=fixer.innerHTML;

  window.testEq(expected, actual, explanation);
};

window.testHTMLByRegex = function(regex, actual, explanation)
{
  var fixer = document.createElement("div");
  fixer.innerHTML=actual;
  actual=fixer.innerHTML;

  if (actual.match(regex))
    return;

  fixer.innerHTML=regex;
  regex=fixer.innerHTML;

  if (actual.match(regex))
    return;

  if(explanation)
    logExplanation(explanation);

  console.log("testHTMLRegex fails: regex ", regex);
  testfw.log("testHTMLRegex fails: regex " + regex);

  console.log("testHTMLRegex fails: actual ", actual);
  testfw.log("testHTMLRegex fails: actual " + actual);
  throw new Error("testHTMLByRegex failed");
};

window.testEqIn = function(expected_in, actual, explanation)
{
  for (var i=0;i<expected_in.length;++i)
    if(isequal(expected_in[i], actual))
      return;

  expected_in = unescape(escape(expected_in).split('%u').join('/u'));
  actual = unescape(escape(actual).split('%u').join('/u'));

  if(explanation)
    logExplanation(explanation);

  console.trace();
  console.log("testEqIn fails: expected one of ", expected_in);
  testfw.log("testEqIn fails: expected one of " + expected_in);

  console.log("testEqIn fails: actual ", actual);
  testfw.log("testEqIn fails: actual " + actual);
  throw new Error("testEqIn failed");
};

window.testEqFloat = function(expected, actual, delta, explanation)
{
  if(Math.abs(expected-actual)<=delta)
    return;

  var expected_str = expected;
  var actual_str = actual;

  try { expected_str = typeof expected == "string" ? unescape(escape(expected).split('%u').join('/u')) : JSON.stringify(expected); } catch(e){}
  try { actual_str = typeof actual == "string" ? unescape(escape(actual).split('%u').join('/u')) : JSON.stringify(actual); } catch(e){}

  if(explanation)
    logExplanation(explanation);

  console.log("testEq fails: expected", expected_str);
  testfw.log("testEq fails: expected " + (typeof expected_str == "string" ? "'" + expected_str + "'" : expected_str));

  console.log("testEq fails: actual  ", actual_str);
  testfw.log("testEq fails: actual " + (typeof actual_str == "string" ? "'" + actual_str + "'" : actual_str));

  if(typeof expected == "string" && typeof actual == "string")
  {
    testfw.log("E: " + encodeURIComponent(expected));
    testfw.log("A: " + encodeURIComponent(actual));
  }

  testDeepEq(expected, actual, '');
};

function testTrue(actual, explanation)
{
  test.eq(true, Boolean(actual), explanation);
}

function testFalse(actual, explanation)
{
  test.eq(false, Boolean(actual), explanation);
}


function fail(reason)
{
  logExplanation(reason);
  throw new Error("Test failed: " + reason);
}

async function testThrowsAsync(promise, explanation)
{
  try
  {
    await promise;
  }
  catch (e)
  {
    return;
  }

  if(explanation)
    logExplanation(explanation);

  console.trace();
  console.log("testThrows fails: expected async function to throw");
  testfw.log("testThrows fails: expected async function to throw");
  throw new Error("testThrows failed for async function");
}

window.testThrows = function(func, explanation)
{
  let didthrow;
  try
  {
    let res = func();
    if (res && res.then) // thenable?
      return testThrowsAsync(res, explanation);

    if(explanation)
      logExplanation(explanation);

    console.trace();
    console.log("testThrows fails: expected function to throw");
    testfw.log("testThrows fails: expected function to throw");
  }
  catch (e)
  {
    didthrow=true;
  }
  if(!didthrow)
    throw new Error("testThrows failed");
};

function findElementWithText(doc, tagname, text)
{
  var els = (doc || getDoc()).querySelectorAll(tagname);
  for(var i=0;i<els.length;++i)
    if(els[i].textContent == text)
      return els[i];
  return null;
}

var mousestate = { cx: 0
                 , cy: 0
                 , downel: null
                 , downelrect: null
                 , downbuttons: []
                 , samplefreq: 50
                 , gesturequeue: []
                 , gesturetimeout:null
                 , waitcallbacks:[]
                 , lastoverel:null
                 , cursorel:null
                 , lastdoc:null
                 , lastwin:null
                 , previousclickel:null
                 , previousclicktime:null
                 , previousclickpos:null
                 , dndcandidate:null
                 , dndstate:null
                 };


window.__waitForGestures=function(callback)
{
  if(mousestate.gesturequeue.length==0)
    callback();
  else
    mousestate.waitcallbacks.push(callback);
};

/// Returns a promise for when all gestures have been processed
function gesturesDone()
{
  return new Promise(resolve => window.waitForGestures(resolve));
}

window.dragTransition = function(pos)
{
  // Decelerate more than accelerate
  let transition = p => Math.pow(p, 2);
  let easeOut = 1 - transition(1 - pos);
  let easeInOut = (pos <= 0.5 ? transition(2 * pos) : (2 - transition(2 * (1 - pos)))) / 2;
  return easeOut * easeInOut;
};

window.generateKeyboardEvent = keyboard.generateKeyboardEvent;

async function pressKey(key, options)
{
  if(!testfw.haveDevtoolsUplink())
    return await keyboard.pressKey(key, options);

  return await testfw.sendDevtoolsRequest({type:"pressKeys", keys: keyboard.normalizeKeys(key, options), options});
}

//ADDME non-LMB support for the non-haveDevtoolsUplink paths
async function asyncMouseMove(x, y, options)
{
  if(!testfw.haveDevtoolsUplink())
  {
    await pointer.sendMouseGesture([{ doc: test.getDoc(), clientx:x, clienty:y }]);
    return;
  }

  y += test.getWin().frameElement.getBoundingClientRect().top; //devtools see the full page, so add our testiframe position
  return await testfw.sendDevtoolsRequest({type:"mouseMove", x, y, options});
}
async function asyncMouseDown(type, options)
{
  if(!testfw.haveDevtoolsUplink())
  {
    await pointer.sendMouseGesture([{ doc: test.getDoc(), down: 0 }]);
    return;
  }
  return await testfw.sendDevtoolsRequest({type:"mouseDown", options});
}
async function asyncMouseUp(type, options)
{
  if(!testfw.haveDevtoolsUplink())
  {
    await pointer.sendMouseGesture([{ doc: test.getDoc(), up: 0 }]);
    return;
  }
  return await testfw.sendDevtoolsRequest({type:"mouseUp", options});
}
async function asyncMouseClick(x, y, options)
{
  if(!testfw.haveDevtoolsUplink())
  {
    await pointer.sendMouseGesture([{ doc: test.getDoc(), clientx: x, clienty: y, down: 0 }]);
    await pointer.sendMouseGesture([{ up: 0 }]);
    return;
  }

  y += test.getWin().frameElement.getBoundingClientRect().top; //devtools see the full page, so add our testiframe position
  return await testfw.sendDevtoolsRequest({type:"mouseClick", x, y, options});
}

function debugKeyEvent(event)
{
  console.log("KBD " + event.type,"keycode=",event.keyCode,"charcode=",event.charCode,"event=",event);
}

window.setupKeyboardDebugEvents=function(win)
{
  if(win.haskbddebug)
    return;
  win.haskbddebug=true;

  if(win.addEventListener)
  {
    win.addEventListener('keydown', debugKeyEvent, true);
    win.addEventListener('keypress', debugKeyEvent, true);
    win.addEventListener('keyup', debugKeyEvent, true);
  }
};

window.checkBSN=function(bsn)
{
  bsn=''+bsn;
  if(bsn.length!=9 || !(parseInt(bsn,10) > 1000000))
    return false;

  var check= 9*parseInt(bsn[0]) + 8*parseInt(bsn[1]) + 7*parseInt(bsn[2])
           + 6*parseInt(bsn[3]) + 5*parseInt(bsn[4]) + 4*parseInt(bsn[5])
           + 3*parseInt(bsn[6]) + 2*parseInt(bsn[7]) - 1*parseInt(bsn[8]);
  return (check%11)==0;
};
window.generateBSN=function()
{
  //sofinummers lopen vanaf 00100000x t/m 39999999x
  var basesofi = Math.floor(Math.random() * (399999900-1000000) + 1000000);
  while(true)
  {
    var propersofi = ('00000000' + basesofi).slice(-9);
    if(window.checkBSN(propersofi))
      return propersofi;
    ++basesofi;
  }
};

class FakeUploadSession
{
  constructor(files, donecallback)
  {
    this.blobs = [];
    this.files = files;
    this.donecallback = donecallback;
    files.forEach(file => this.blobs.push(null));
  }
  runUpload(inputnode, callback)
  {
    var self=this;
    this.inputnode = inputnode;

    this.files.forEach(function(file, idx)
    {
      getFileFromURL(file.url, file.filename).then(blob => self.doneUpload(blob, idx));
    });
  }
  doneUpload(blob, idx)
  {
    if(this.blobs[idx])
      throw new Error("Duplicate upload completion for blob #" + idx);
    this.blobs[idx] = blob;
    if(this.blobs.filter(val=>val).length < this.blobs.length) //we don't have all files yet
      return;

    dompack.dispatchCustomEvent(this.inputnode, 'wh:upload-fake', { bubbles:false, cancelable: false, detail: {files: this.blobs }});
    if (this.donecallback)
      setTimeout(() => this.donecallback(), 1);
  }
}

window.prepareUploadTest = function(node, files, donecallback)
{
  if(window.top.wh_testapi_fakeupload)
    throw "The window already has a pending upload";

  var uploadclass = new FakeUploadSession(files,donecallback);
  window.top.wh_testapi_fakeupload = uploadclass.runUpload.bind(uploadclass);
};

async function prepareUpload(files)
{
  let deferred = dompack.createDeferred();
  var uploadclass = new FakeUploadSession(files, function() { deferred.resolve(); });
  window.top.wh_testapi_fakeupload = uploadclass.runUpload.bind(uploadclass);
  await deferred.promise;
}

window.testDuplicateSlickIds = function(doc)
{
  var ids={};
  Array.from(doc.getElementsByTagName("*")).forEach(
    function(el)
    {
      if(!el.uniqueNumber)
        return;
      if(ids[el.uniqueNumber])
      {
        console.log("Duplicate slick #" + el.uniqueNumber, ids[el.uniqueNumber], el);
      }
      else
      {
        ids[el.uniqueNumber] = el;
      }
    });
};

window.testNLAddressLookup = function(zip, nrdetail, callback)
{
  if(zip=='7521 AM')
  {
    if(nrdetail == '296')
    {
      setTimeout(() => callback({success:true, street: 'Hengelosestraat', city: 'ENSCHEDE' }), 1);
      return;
    }
  }
  setTimeout(() => callback({success:false}), 1);
};

window.testClickElement = function(link,name,waits)
{
  if(!name)
    name = "Click: " + link;
  return { name: name
         , test: function(doc,win)
                 {
                   var elts = $qSA(link);
                   if(elts.length == 0)
                     throw new Error("No elements returned by selector: " + link);

                   pointer.click(elts[0]);
                 }
         , waits: (waits || ["pageload"])
         };
};

var buttonsources = [ { selector:'input[type="submit"],input[type="reset"]', property:'value' }
                    , { selector:'button', property:'text' }
                    ];

function getOpenMenu()
{
  return $qSA('ul:last-of-type.wh-menulist.open')[0] || null;
}
function getOpenMenuItem(containstext)
{
  let menu = getOpenMenu();
  if(!menu)
    return null;
  let item = dompack.qSA(menu,'li').filter(item => item.textContent.includes(containstext));
  if(item.length>1)
    throw new Error("Multiple items contain the text '" + containstext + "'");
  return item[0]||null;
}
function getWin()
{
  return testfw.pageframewin;
}
function getDoc()
{
  return testfw.pageframedoc;
}
function setFormsapiFileElement (el, filedata, filename)
{
  //formsapi permits a hack to allow us to fake submissions to input type=file fields
  //unfortunately we can't change the type of an input element, so we'll have to recreate it

  var newinput = el.ownerDocument.createElement('input');
  newinput.name = el.name + '$filename=' + filename;
  newinput.type = 'text';
  newinput.value = filedata;
  newinput.id = el.id;
  el.parentNode.replaceChild(newinput,el);

//  $(el).destroy();
}

function _resolveToSingleElement(element)
{
  if(element instanceof NodeList)
  {
    if(element.length==0)
      throw new Error("Passed an empty $$()");
    if(element.length>1)
    {
      console.log(element);
      throw new Error("Passed multiple elements using $$(), make sure the selector only matches one!");
    }
    return element[0];
  }
  else if(typeof element == "string")
  {
    var elements = $qSA(element);
    if(elements.length==0)
    {
      elements = $qSA('*[id="' + element + '"]');
      if(elements.length != 0)
      {
        console.error(`Invoking _resolveToSingleElement with an id '${element}'`);
        throw new Error(`Invoking _resolveToSingleElement with an id '${element}'`);
      }
    }
    if(elements.length==0)
    {
      elements = $qSA('*[name="' + element + '"]');
      if(elements.length != 0)
      {
        console.error(`Invoking _resolveToSingleElement with a name '${element}'`);
        throw new Error(`Invoking _resolveToSingleElement with an id '${element}'`);
      }
    }
    if(elements.length==0)
      throw new Error("Selector '" + element + "'' evaluated to no elements");
    if(elements.length>1)
    {
      console.log(elements);
      throw new Error("Selector '" + element + "'' evaluated to multiple elements, make sure the selector only matches one!");
    }
    return elements[0];
  }

  if(!element)
  {
    throw new Error("Invalid element passed");
  }
  return element;
}

function fill(element,newvalue)
{
  element = _resolveToSingleElement(element);
  domfocus.getFocusableElement(element).focus();
  dompack.changeValue(element, newvalue);
}
function fillUpload(element, files)
{
  let blobs = files.map( file =>
  {
    if(!file.mimetype)
      throw new Error("Missing mimetype");
    if(!file.filename)
      throw new Error("Missing filename");

    let output = new Blob([ file.data], { type: file.mimetype });
    output.name = file.filename;
    return output;
  });
  Object.defineProperty(element, 'files', { get: function() { return blobs; }, configurable:true});
}
function getTestSiteRoot()
{
  var topdoc = window.parent.document.documentElement;
  if(!topdoc.hasAttribute("data-testsiteroot"))
    throw new Error("No testsite specified for this test");
  return (new URL(topdoc.getAttribute("data-testsiteroot"), location.href)).toString();
}

let $t = window.parent.$t;
let $$t = window.parent.$$t;

window.$t = $t;
window.$$t = $$t;

function getListViewHeader(text)
{
  var headers = $qSA('#listview .listheader > span').filter(node => node.textContent.includes(text));
  if(headers.length>1)
    console.error("Multiple header matches for '" + text + "'");
  return headers.length==1 ? headers[0] : null;
}
function getListViewRow(text) //simply reget it for every test, as list may rerender at unspecifide times
{
  var rows = $qSA('#listview .listrow').filter(node => node.textContent.includes(text));
  if(rows.length>1)
    console.error("Multiple row matches for '" + text + "'");
  return rows.length==1 ? rows[0] : null;
}
function getListViewExpanded(row)
{
  if(row.querySelector(".fa-caret-down"))
    return true;
  if(row.querySelector(".fa-caret-right"))
    return false;
  return null;
}

function $qS(node_or_selector, selector)
{
  if(typeof node_or_selector !== 'string')
    return node_or_selector.querySelector(selector);

  let iframe = window.parent.document.querySelector('#testframeholder iframe');
  return iframe.contentDocument.querySelector(node_or_selector);
}

function $qSA(node_or_selector, selector)
{
  if(typeof node_or_selector !== 'string')
    return Array.from(node_or_selector.querySelectorAll(selector));

  let iframe = window.parent.document.querySelector('#testframeholder iframe');
  return Array.from(iframe.contentDocument.querySelectorAll(node_or_selector));
}

// ---------------------------------------------------------------------------
//
// Selenium support
//

var scheduledefer;

/** Schedules a selenium post. Returns a promise that will be fulfilled when the query has finished
*/
async function doSeleniumRequest(method, params)
{
  if (!seleniumref)
    throw new Error("This test must be run with selenium!");

  if (!scheduledefer)
    scheduledefer = Promise.resolve(true);

  let newdefer = dompack.createDeferred();

  // Wait until current request is done, then run the new one.
  try
  {
    await scheduledefer;
  }
  finally
  {
    // Replace the scheduledefer by the new deferred promise
    scheduledefer = newdefer;

    let topass = [ seleniumref, method, params ? Array.from(params) : [] ];
    newdefer.resolve(jstestsrpc.seleniumRequest(...topass).then(result => result.value));
  }

  return newdefer.promise;
}

var id_counter = 0;
function requireElementId(element)
{
  if (!element.id)
    element.id = "__selenium_" + (++id_counter);
  return element.id;
}

var $selenium =
{ // Testframe used for element lookups
  framepath: [ 'testframe' ]

, _keys:
      { "add": '\ue025'
      , "alt": '\ue00a'
      , "arrow_down": '\ue015'
      , "arrow_left": '\ue012'
      , "arrow_right": '\ue014'
      , "arrow_up": '\ue013'
      , "backspace": '\ue003'
      , "back_space": '\ue003'
      , "cancel": '\ue001'
      , "clear": '\ue005'
      , "command": '\ue03d'
      , "control": '\ue009'
      , "decimal": '\ue028'
      , "delete": '\ue017'
      , "divide": '\ue029'
      , "down": '\ue015'
      , "end": '\ue010'
      , "enter": '\ue007'
      , "equals": '\ue019'
      , "escape": '\ue00c'
      , "f1": '\ue031'
      , "f10": '\ue03a'
      , "f11": '\ue03b'
      , "f12": '\ue03c'
      , "f2": '\ue032'
      , "f3": '\ue033'
      , "f4": '\ue034'
      , "f5": '\ue035'
      , "f6": '\ue036'
      , "f7": '\ue037'
      , "f8": '\ue038'
      , "f9": '\ue039'
      , "help": '\ue002'
      , "home": '\ue011'
      , "insert": '\ue016'
      , "left": '\ue012'
      , "left_alt": '\ue00a'
      , "left_control": '\ue009'
      , "left_shift": '\ue008'
      , "meta": '\ue03d'
      , "multiply": '\ue024'
      , "null": '\ue000'
      , "numpad0": '\ue01a'
      , "numpad1": '\ue01b'
      , "numpad2": '\ue01c'
      , "numpad3": '\ue01d'
      , "numpad4": '\ue01e'
      , "numpad5": '\ue01f'
      , "numpad6": '\ue020'
      , "numpad7": '\ue021'
      , "numpad8": '\ue022'
      , "numpad9": '\ue023'
      , "page_down": '\ue00f'
      , "page_up": '\ue00e'
      , "pause": '\ue00b'
      , "return": '\ue006'
      , "right": '\ue014'
      , "semicolon": '\ue018'
      , "separator": '\ue026'
      , "shift": '\ue008'
      , "space": '\ue00d'
      , "subtract": '\ue027'
      , "tab": '\ue004'
      , "up": '\ue013'

        // More in line with spec: https://w3c.github.io/webdriver/webdriver-spec.html#dfn-element-send-keys
      , "NULL":         '\uE000'
      , "Add":          '\uE025'
      , "Alt":          '\uE00A'
      , "ArrowDown":    '\uE015'
      , "ArrowLeft":    '\uE012'
      , "ArrowRight":   '\uE014'
      , "ArrowUp":      '\uE013'
      , "Backspace":    '\uE003'
      , "Cancel":       '\uE001'
      , "Clear":        '\uE005'
      , "Command":      '\uE03D'
      , "Control":      '\uE009'
      , "Decimal":      '\uE028'
      , "Delete":       '\uE017'
      , "Divide":       '\uE029'
      , "End":          '\uE010'
      , "Enter":        '\uE007'
      , "Equals":       '\uE019'
      , "Escape":       '\uE00C'
      , "F1":           '\uE031'
      , "F2":           '\uE032'
      , "F3":           '\uE033'
      , "F4":           '\uE034'
      , "F5":           '\uE035'
      , "F6":           '\uE036'
      , "F7":           '\uE037'
      , "F8":           '\uE038'
      , "F9":           '\uE039'
      , "F10":          '\uE03A'
      , "F11":          '\uE03B'
      , "F12":          '\uE03C'
      , "Help":         '\uE002'
      , "Home":         '\uE011'
      , "Insert":       '\uE016'
      , "AltLeft":      '\uE00A'
      , "ControlLeft":  '\uE009'
      , "ShiftLeft":    '\uE008'
      , "Meta":         '\uE03D'
      , "Multiply":     '\uE024'
      , "PageDown":     '\uE00F'
      , "PageUp":       '\uE00E'
      , "Pause":        '\uE00B'
      , "Return":       '\uE006'
      , "Semicolon":    '\uE018'
      , "Separator":    '\uE026'
      , "Shift":        '\uE008'
      , "Space":        '\uE00D'
      , "Subtract":     '\uE027'
      , "Tab":          '\uE004'
      , "OSLeft":       "\uE03D"
      , "OSRight":      "\uE053"
      , "AltRight":     "\uE052"
      , "ControlRight": "\uE051"
      , "ShiftRight":   "\uE050"
      }

, haveSelenium: function()
  {
    console.log('hs', seleniumref);

    return !!seleniumref;
  }

  // Returns a promise with the element id
, getElementSeleniumId: async function(element)
  {
    // FIXME: lookup and compare the frame path
    let seleniumid = element.retrieve('seleniumid');
    if (seleniumid)
      return seleniumid;

    let id = requireElementId(element);

    //Lookup the element
    seleniumid = await doSeleniumRequest('LookupElement', [ 'id', id, { framepath: this.framepath } ]);
    element.store('seleniumid', seleniumid);
    return seleniumid;
  }

, clickElement: function(element)
  {
    // First lookup the element, when we have the id click on it
    return this.getElementSeleniumId(element).then(function(seleniumid)
    {
      return doSeleniumRequest('ClickElement', [ seleniumid ]);
    });
  }

, getKey: function(name)
  {
    var res = this._keys[name];
    if (!res)
      throw new Error("No such special key '" + name + "'");
    return res;
  }

/* not supported in W3C webdriver spec anymore, FF doesn't implement it.
, sendKeys: function(keys)
  {
    keys = Array.from(keys);
    return doSeleniumRequest('SendKeys', [ keys ]);
  }
*/
, sendKeysToElement: function(element, keys)
  {
    keys = Array.from(keys);

    return this.getElementSeleniumId(element).then(function(seleniumid)
    {
      return doSeleniumRequest('SendKeysToElement', [ seleniumid, keys ]);
    });
  }
};

function invoke(lib, func, ...params)
{
  return jstestsrpc.invoke(lib, func, params);
}
function getWrdLogoutUrl(returnurl)
{
  return new URL('/.wrd/auth/logout.shtml?b=' + encodeURIComponent(returnurl.split('/').slice(3).join('/')), returnurl).toString();
}
function wrdAuthLogout()
{
  let redirectto = getWrdLogoutUrl(getWin().location.href);
  window.parent.document.querySelector('#testframeholder iframe').src = redirectto;
}


function sleep(delay)
{
  return new Promise(resolve => setTimeout(resolve, delay));
}

async function wait(...waits)
{
  for (let waitelt of waits)
    if (Array.isArray(waitelt))
      await wait(...waitelt);
    else
      await callbacks.executeWait(waitelt);
}

async function subtest(name)
{
  callbacks.subtest(name);
}

async function load(page)
{
  getWin().location.href = page;
  await wait("pageload");
}

function pasteHTML(content)
{
  let target = domfocus.getCurrentlyFocusedElement();
  let htmltext = typeof content == 'string' ? content : content.innerHTML;

  /* event spec: https://w3c.github.io/clipboard-apis/#clipboard-event-interfaces
     only firefox is said to implement clipboard currently so we'll create a plain event */
  let evt = target.ownerDocument.createEvent('Event');

  let cpdata = { types: [ 'text/html' ]
               , getData: type =>
                 {
                   if(type != 'text/html')
                     return null;
                   return htmltext;
                 }
               };

  evt.initEvent('paste', true, true);
  Object.defineProperty(evt, 'clipboardData', { get: () => cpdata });

  let dodefault = target.dispatchEvent(evt);
  if(dodefault)
  {
    console.error("FIXME: default action!");
  }
  return dodefault;
}

async function getFileFromURL(url, filename)
{
  const defer = dompack.createDeferred();
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);

  xhr.responseType = 'blob';
  xhr.onload = function(e)
  {
    console.log('onload', this, e, this.response);
    if (this.status == 200)
    {
      // Create a blob with the response's Content-Type as file type
      const file = createFileObject([ this.response ], filename, { type: this.response.type });
      defer.resolve(file);
    }
    else
      defer.reject(new Error(`Error ${this.status} retrieving ${url}`));
  };
  xhr.onerror = function(e) { defer.reject(new Error(`Error ${e} retrieving ${url}`)); };
  xhr.send();
  return defer.promise;
}

function createFileObject(data, name, opts)
{
  try
  {
    return new File(data, name, opts);
  }
  catch (e)
  {
    // IE 11 workaround, it does not have a File constructor. Use a blob and add a filename
    const file = new Blob(data, opts);
    file.name = name;
    return file;
  }
}

function canFocus(element)
{
  element = pointer._resolveToSingleElement(element);
  return domfocus.canFocus(element);
}

function hasFocus(element)
{
  element = pointer._resolveToSingleElement(element);
  return domfocus.hasFocus(element);
}

/** Get pxl log entries
    @param eventtypefilter Expression to match on event type
    @return Filtered log entries, or an empty array if the log hasn't started yet*/
function getPxlLog(eventtypefilter)
{
  let log = this.getWin().whPxlLog || [];
  if(eventtypefilter)
    log = log.filter(evt => evt.event.match(eventtypefilter));
  return log;
}

module.exports = { registerTests: registerJSTests
                 , getTestArgument: getTestArgument
                 , getOpenMenu: getOpenMenu
                 , getOpenMenuItem: getOpenMenuItem
                 , getWindow: getWin
                 , getDoc: getDoc
                 , isElementClickable: pointer.canClick
                 , canClick: pointer.canClick
                 , setFormsapiFileElement: setFormsapiFileElement
                 , click: pointer.click
                 , fill: fill //note: soon in dompack but not fully compatible for some selectors
                 , fillUpload: fillUpload
                 , getTestSiteRoot: getTestSiteRoot
                 , selenium: $selenium
                 , findElementWithText: findElementWithText
                 , $qS
                 , $qSA
                 , waitForEvent: test.waitForEvent
                 , eq: window.testEq
                 , eqMatch: testEqMatch
                 , eqIn: window.testEqIn
                 , eqHTML: window.testEqHTML
                 , true: testTrue
                 , false: testFalse
                 , throws: window.testThrows
                 , canFocus: canFocus
                 , hasFocus: hasFocus
                 , qS: $qS
                 , qSA: $qSA
                 , fail: fail
                 , sendMouseGesture: pointer.sendMouseGesture
                 , gesturesDone: gesturesDone
                 , prepareUpload: prepareUpload
                 , $t: window.$t
                 , $$t: window.$$t
                 , pressKey
                 , getValidatedElementFromPoint: pointer.getValidatedElementFromPoint
                 , dragTransition: window.dragTransition
                 , generateKeyboardEvent: keyboard.generateKeyboardEvent
                 , simulateTabKey: test.simulateTabKey
                 , focus: test.focus
                 , sleep

                 , keyboardCopyModifier:        { alt: browser.getPlatform()=='mac', ctrl: browser.getPlatform() != 'mac' }
                 , keyboardLinkModifier:        { ctrl: true, shift: browser.getPlatform() != 'mac' }
                 , keyboardMultiSelectModifier: { cmd: browser.getPlatform()=='mac', ctrl: browser.getPlatform() != 'mac' }
                 , load
                 , wait
                 , waitUIFree: test.waitUIFree
                 , subtest
                 , invoke
                 , loadPage: load //DEPRECATED

                 , pasteHTML
                 , wrdAuthLogout
                 , getWin
                 , getWrdLogoutUrl

                 , asyncMouseClick
                 , asyncMouseUp
                 , asyncMouseDown
                 , asyncMouseMove

                 , testClickElement: window.testClickElement

                 , startExternalFileDrag: pointer.startExternalFileDrag
                 , getCurrentDragDataStore: pointer.getCurrentDragDataStore
                 , cancelDrag: pointer.cancelDrag

                 , getFileFromURL

                 , getListViewExpanded
                 , getListViewHeader
                 , getListViewRow
                 , getPxlLog
                 };

module_exports = module.exports;
