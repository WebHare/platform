/** @import: import * as test from "@mod-system/js/wh/testframework";
*/

import * as dompack from 'dompack';
import * as browser from 'dompack/extra/browser';

import * as domfocus from "dompack/browserfix/focus";
var domlevel = require('@mod-tollium/web/ui/components/richeditor/internal/domlevel');
import jstestsrpc from '@mod-system/js/internal/jstests.rpc.json';

import * as test from 'dompack/testframework';
import { testDeepEq } from 'dompack/testframework/expect';
import * as pointer from 'dompack/testframework/pointer';
import * as keyboard from 'dompack/testframework/keyboard';
import * as diff from 'diff';

let module_exports;

//basic test functions
var testfw = window.parent ? window.parent.__testframework : null;

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
  testfw.runTestSteps(steps, setTestSuiteCallbacks, module_exports);
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
    throw new Error("This page is not being invoked by the test framework");

  let lasttestname, finalsteps = [];
  for(let step of steps)
  {
    if(!step)
      continue;  //strip empty items. allows you to be careless with commas when commenting out tests

    if(typeof step == "string")
    {
      lasttestname = step;
      continue;
    }

    if(typeof step == "function")
      step = { test: step };

    if(lasttestname && !step.name) //merge name into the next test for more reliable counters
    {
      step.name = lasttestname;
      lasttestname = null;
    }
    finalsteps.push(step);
  }
  dompack.onDomReady( () => initialize_tests(finalsteps));
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
function testEq(expected, actual, explanation)
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
}
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

function testEqHTML(expected, actual, explanation)
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

  testEq(expected, actual, explanation);
}

function testEqIn(expected_in, actual, explanation)
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
}

function testEqFloat(expected, actual, delta, explanation)
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

/** Compare specific cells of two values (recursive)
    @param expected Expected value
    @param got Gotten value
    @param keys Comma-separated list of members to check. Use '*' as first member to match all, and `-<cellname>` to excluded members after that.
    @param annotation Message to display when the test fails
*/
function testEqMembers(expect, got, { keys = null, explation } = {})
{
  testEqMembersRecurse(expect, got, "got", keys);
}

function testEqMembersRecurse(expect, got, path, keys, explation)
{
  switch (typeof expect)
  {
    case "undefined":   return;
    case "object":
    {
      if (expect === null)
      {
        if (expect !== got)
        {
          console.log({ expect, got });
          throw Error(`Expected ${expect}, got ${got}, at ${path}`);
        }
        return;
      }
      const expectarray = Array.isArray(expect);
      if (expectarray != Array.isArray(got))
      {
        console.log({ expect, got });
        throw Error(`Expected ${expectarray ? "array" : "object"}, got ${!expectarray ? "array" : "object"}, at ${path}`);
      }
      if (expectarray)
      {
        if (expect.length != got.length)
        {
          console.log({ expect, got });
          throw Error(`Expected array of length ${expect.length}, got array of length ${got.length}, at ${path}`);
        }
        for (let i = 0; i < expect.length; ++i)
          testEqMembersRecurse(expect[i], got[i], `${path}[${i}]`);
        return;
      }
      const gotkeys = Object.keys(got);
      for (const i of Object.entries(expect))
      {
        if (keys && !keys.includes[i[0]])
          continue;

        if (!gotkeys.includes(i[0]))
        {
          console.log({ expect, got });
          throw Error(`Expected property ${i[0]}, didn't find it, at ${path}`);
        }
        testEqMembersRecurse(i[1], got[i[0]], `${path}.${i[0]}`);
      }
      return;
    }
    default:
      if (expect !== got)
        throw Error(`Expected ${expect}, got ${got}, at ${path}`);
  }
}

function testTrue(actual, explanation)
{
  testEq(true, Boolean(actual), explanation);
}

function testFalse(actual, explanation)
{
  testEq(false, Boolean(actual), explanation);
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
    return e;
  }

  if(explanation)
    logExplanation(explanation);

  console.trace();
  console.log("testThrows fails: expected async function to throw");
  testfw.log("testThrows fails: expected async function to throw");
  throw new Error("testThrows failed for async function");
}

//test whether the specified call throws. we accept functions, promises, or functions returning promises
function testThrows(waitfor, explanation)
{
  try
  {
    if(typeof waitfor == "function")
      waitfor = waitfor();
    if(waitfor && waitfor.then)  // thenable?
      return testThrowsAsync(waitfor, explanation);

    if(explanation)
      logExplanation(explanation);

    console.trace();
    console.log("testThrows fails: expected function to throw");
    testfw.log("testThrows fails: expected function to throw");
  }
  catch (e)
  {
    return e;
  }
  throw new Error("testThrows failed");
}

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

function dragTransition(pos)
{
  // Decelerate more than accelerate
  let transition = p => Math.pow(p, 2);
  let easeOut = 1 - transition(1 - pos);
  let easeInOut = (pos <= 0.5 ? transition(2 * pos) : (2 - transition(2 * (1 - pos)))) / 2;
  return easeOut * easeInOut;
}

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

function prepareUploadTest(node, files, donecallback)
{
  if(window.top.wh_testapi_fakeupload)
    throw new Error("The window already has a pending upload");

  var uploadclass = new FakeUploadSession(files,donecallback);
  window.top.wh_testapi_fakeupload = uploadclass.runUpload.bind(uploadclass);
}

async function prepareUpload(files)
{
  let deferred = dompack.createDeferred();
  var uploadclass = new FakeUploadSession(files, function() { deferred.resolve(); });
  window.top.wh_testapi_fakeupload = uploadclass.runUpload.bind(uploadclass);
  await deferred.promise;
}

function getOpenMenu()
{
  return qSA('ul:last-of-type.wh-menulist.open')[0] || null;
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

function fill(element,newvalue)
{
  element = pointer._resolveToSingleElement(element);
  element.focus();
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

function getListViewHeader(text)
{
  var headers = qSA('#listview .listheader > span').filter(node => node.textContent.includes(text));
  if(headers.length>1)
    console.error("Multiple header matches for '" + text + "'");
  return headers.length==1 ? headers[0] : null;
}
function getListViewRow(text) //simply reget it for every test, as list may rerender at unspecifide times
{
  var rows = qSA('#listview .listrow').filter(node => node.textContent.includes(text));
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

function qS(node_or_selector, selector)
{
  if(typeof node_or_selector !== 'string')
    return node_or_selector.querySelector(selector);

  let iframe = window.parent.document.querySelector('#testframeholder iframe');
  return iframe.contentDocument.querySelector(node_or_selector);
}

function qSA(node_or_selector, selector)
{
  if(typeof node_or_selector !== 'string')
    return Array.from(node_or_selector.querySelectorAll(selector));

  let iframe = window.parent.document.querySelector('#testframeholder iframe');
  return Array.from(iframe.contentDocument.querySelectorAll(node_or_selector));
}

async function invoke(libfunc, ...params)
{
  if(!libfunc.includes('#'))
  {
    libfunc += '#' + params[0];
    params.shift();
    console.warn("The two-parameter form of test.invoke() is deprecated. Replace the first two parameters with:",libfunc);
  }

  console.log(`test.invoke ${libfunc}`,params);
  let result = await jstestsrpc.invoke(libfunc, params);
  if (typeof result == "object" && result && result.__outputtoolsdata)
  {
    dompack.dispatchCustomEvent(window, 'wh:outputtools-extradata', { bubbles:false, cancelable: false, detail: result.__outputtoolsdata});
    delete result.__outputtoolsdata;
  }
  console.log(`test.invoke result`,result);

  return result;
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

async function wait(waitfor, annotation)
{
  if(annotation && typeof annotation !== "string")
    throw new Error("wait()ing on multiple things is no longer supported");

  return await callbacks.executeWait(waitfor);
}

// email: The email address to look for
// options.timeout: The timeout in ms, defaults to 0 (don't wait)
// options.count: The number of emails to wait for, defaults to 1
async function waitForEmails(email, options)
{
  return await testfw.waitForEmails(email, options);
}

async function subtest(name)
{
  callbacks.subtest(name);
}

async function load(page)
{
  if(typeof page != "string")
  {
    console.error(`test.load expects a string, got`,page);
    throw new Error(`test.load exects a string`);
  }
  getWin().location.href = page;
  await wait("load");
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
  return domfocus.canFocusTo(element);
}

function hasFocus(element)
{
  element = pointer._resolveToSingleElement(element);
  return element == domfocus.getActiveElement(element.ownerDocument);
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

function getWebhareVersionNumber()
{
  return parseInt(window.parent.document.documentElement.dataset.webhareversionnumber);
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
                 , findElementWithText: findElementWithText
                 , getWebhareVersionNumber
                 , waitForEvent: test.waitForEvent
                 , eq: testEq
                 , eqFloat: testEqFloat
                 , eqMatch: testEqMatch
                 , eqMembers: testEqMembers
                 , eqIn: testEqIn
                 , eqHTML: testEqHTML
                 , true: testTrue
                 , false: testFalse
                 , throws: testThrows
                 , canFocus: canFocus
                 , hasFocus: hasFocus
                 , qS: qS
                 , qSA: qSA
                 , fail: fail
                 , sendMouseGesture: pointer.sendMouseGesture
                 , gesturesDone: gesturesDone
                 , prepareUpload: prepareUpload
                 , pressKey
                 , getValidatedElementFromPoint: pointer.getValidatedElementFromPoint
                 , dragTransition: dragTransition
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
                 , waitForEmails
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

                 , startExternalFileDrag: pointer.startExternalFileDrag
                 , getCurrentDragDataStore: pointer.getCurrentDragDataStore
                 , cancelDrag: pointer.cancelDrag

                 , getFileFromURL

                 , getListViewExpanded
                 , getListViewHeader
                 , getListViewRow
                 , getPxlLog
                 , prepareUploadTest
                 };

module_exports = module.exports;
