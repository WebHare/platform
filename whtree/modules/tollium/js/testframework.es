import * as dompack from 'dompack';
import * as test from "@mod-system/js/wh/testframework";

var overridetoken = '';

function escapeRegExp(str) {
  return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
}

function isStringOrRegexpMatch(intext, pattern)
{
  if(typeof pattern == 'string')
    return intext === pattern;
  if(pattern instanceof RegExp)
    return Boolean(intext.match(pattern));
  throw new Error(`Not sure how to match against '${pattern}'`);
}

class AppProxy
{ constructor(win, toddapp)
  {
    this.win = win;
    this.app = toddapp;
  }
  getNumOpenScreens()
  {
    return this.app.screenstack.length;
  }
  getScreenBySeqnr(idx)
  {
    if(idx<0 || idx >= this.app.screenstack.length)
      throw new Error("Invalid screen index requested");
    return new ScreenProxy(this, idx);
  }
  getActiveScreen()
  {
    return new ScreenProxy(this, this.app.screenstack.length-1);
  }
  isBusy()
  {
    return this.app.isBusy();
  }
}

class ScreenProxy
{ constructor(appproxy, idx)
  {
    this.appproxy = appproxy;
    this.idx = idx;
    this.win = appproxy.app.screenstack[idx];
    if(!this.win)
      throw new Error("No window #"+idx);
  }

  getParent()
  {
    return new ScreenProxy(this.appproxy, this.idx-1);
  }

  /** Return the <li> node for a specific menu item
      @param (stringarray) levels Full path to the menu item (parts of the menu names)
  */
  getMenu(levels, { autoclickhamburger = true } = {})
  {
    var curitem = this.win.node.querySelector('.wh-menubar');
    if (!curitem && autoclickhamburger)
    {
      // test clicking the hamburger menu
      const hamburger_img = this.win.node.ownerDocument.querySelector(`t-toolbar .t-toolbar-buttongroup__right t-button.ismenubutton img[data-toddimg="tollium:actions/menu|24|24|w,b"]`);
      if (hamburger_img)
      {
        test.click(hamburger_img.closest(`t-button`));
        curitem = this.win.node.ownerDocument.querySelectorAll('.wh-menulist.open')[0];
      }
    }
    if(levels)
      for(var i=0;curitem && i<levels.length;++i)
      {
        if(curitem.nodeName=='LI')
        {
          // Move to the item first, maybe we're in auto-select mode
          test.sendMouseGesture( [ { el: curitem }]);

          // If not selected yet, click the menu item to open it
          if (!curitem.classList.contains('selected'))
            test.click(curitem);

          // Get the relevant detached menu
          curitem = this.win.node.ownerDocument.querySelectorAll('.wh-menulist.open')[i-1];
          if (!curitem)
            throw new Error('Could not find detached menu');
        }

        // Find the li with the requested text
        curitem = dompack.qSA(curitem,'li').filter(li => li.textContent.includes(levels[i]))[0];
      }
    return curitem;
  }
  getText(compname)
  {
    var el = this.getToddElement(compname);
    if(!el)
      throw new Error("No such component '" + compname + "'");

    //ADDME support more node types than just <text>
    return el.textContent;
  }
  getValue(compname)
  {
    var el = this.getToddElement(compname);
    if(!el)
      throw new Error("No such component '" + compname + "'");

    //ADDME support more node types than just <checkbox> and <pulldown>
    if (el.classList.contains("wh-checkbox"))
      return el.propTodd.getValue();
    if (el.nodeName.toLowerCase() == "t-textedit")
      return el.querySelector('input').value;
    if (el.nodeName.toLowerCase() == "t-textarea")
      return el.querySelector('textarea').value;
    throw new Error("component not yet supported by getInputValue (classes: " + el.className + ")");
  }
  getListRow(listname, pattern) //simply reget it for every test, as list may rerender at unspecifide times
  {
    var list = this.getToddElement(listname);
    if(!list)
      throw new Error("No such list '" + listname + "'");

    var rows = list.querySelectorAll('.listrow');
    for (var i=0;i<rows.length;++i)
    {
      var row=rows[i];
      for (var j=0;j<row.childNodes.length;++j)
      {
        var cell = row.childNodes[j];
        if(isStringOrRegexpMatch(cell.textContent, pattern)) //direct text check
          return rows[i];

        var textintree = cell.querySelectorAll('span')[1];
        if(textintree && isStringOrRegexpMatch(textintree.textContent, pattern)) //check inside the node next to a tree expand span
          return rows[i];
      }
    }
    return null;
  }
  qS(selector)
  {
    if(!this.win)
      return null;
    return this.win.node.querySelector(selector);
  }
  qSA(selector)
  {
    if(!this.win)
      return null;
    return Array.from(this.win.node.querySelectorAll(selector));
  }
  getElement(selector)
  {
    if(!this.win)
      return null;
    return this.win.node.getElement(selector);
  }
  getElements(selector)
  {
    if(!this.win)
      return null;
    return this.win.node.getElements(selector);
  }
  getToddElement(toddname)
  {
    let candidates = this.qSA('*[data-name]');

    let regex = new RegExp("^" + escapeRegExp(toddname).replace('\\*','.*') + "$");
    let match = candidates.filter(node => node.dataset.name.match(regex));
    if(!match.length)
    {
      regex = new RegExp(":" + escapeRegExp(toddname).replace('\\*','.*') + "$");
      match = candidates.filter(node => node.dataset.name.match(regex));
    }
    if(!match.length)
    {
      //look for pulldowns, they have an odd name
      let pulldown = this.qS(`select[data-name*=':${toddname}$']`);
      if(pulldown)
        return pulldown;
    }
    if(match.length>1)
      throw new Error("Multiple matches for name '" + toddname + "'");
    return match.length == 1 ? match[0] : null;
  }
  getNode()
  {
    return this.win ? this.win.node : null;
  }
  clickCloser()
  {
    var closer = this.win.node.querySelector('.closewindow');
    if(!closer)
      throw "Screen '" + this.win.screenname + "' has no close window";

    test.click(closer);
  }

  getFrameTitle()
  {
    return this.win.node.querySelector(".windowheader .title").textContent;
  }
}

function $app(win)
{
  return new AppProxy(win,win.__todd.applicationstack.slice(-1)[0]);
}
function $screen(win)
{
  return getCurrentApp().getActiveScreen();
}
window.$app = $app;
window.$screen = $screen;

function getCurrentApp()
  {
    return new AppProxy(test.getWindow(), test.getWindow().__todd.applicationstack.slice(-1)[0]);
  }
function getCurrentScreen()
  {
    return getCurrentApp().getActiveScreen();
  }
function getMenu(levels)
  {
   return getCurrentScreen().getMenu(levels);
  }
function compByName(toddname)
  {
    return getCurrentScreen().getToddElement(toddname);
  }
export function compByTitle(title)
{
  let elts = getCurrentScreen().qSA('t-text.label,t-button').filter(label => (label.textContent === (title + ":") || label.textContent === title));
  if (elts.length == 0)
    throw new Error(`No component with title '${title}'`);
  if (elts.length > 1)
    throw new Error(`Multiple components with title '${title}'`);
  if (elts[0].nodeName.toLowerCase() === "t-button")
    return elts[0];
  return compByName(elts[0].dataset.labelfor || elts[0].for);
}
function getTestScreen(testscreen, whdebug)
  {
    let allowtestfw = [ "1", "true" ].includes(document.documentElement.dataset.exclusive) ? ",allowtestfw" : "";
    var debugvars = "";
    if (whdebug && whdebug.length)
      debugvars = "&wh-debug=" + (typeof whdebug == "string" ? whdebug.split(" ") : whdebug).join(",");
    var baseurl = test.getTestSiteRoot() + 'testsuiteportal/?app=webhare_testsuite:runscreen(' + testscreen + allowtestfw + ')&' + getTolliumDebugVariables() + debugvars;
    return baseurl;
  }
function getCompTestPage(componentname, params, whdebug)
  {
    var debugvars = "";
    if (whdebug && whdebug.length)
    {
      debugvars = "&wh-debug=" + (typeof whdebug == "string" ? whdebug.split(" ") : whdebug).concat(Object.keys(dompack.debugflags)).join(",");
    }
    var baseurl = test.getTestSiteRoot() + 'testsuiteportal/?app=webhare_testsuite:anycomponent(' + encodeURIComponent(componentname) + ','+encodeURIComponent(JSON.stringify(params||null)).replace(/,/g, '%2C')+')&' + getTolliumDebugVariables() + debugvars;
    return baseurl;
  }
function getTolliumButton(toddbuttontitle)
{
  return test.qSA("t-button").filter(button => button.textContent.includes(toddbuttontitle))[0];
}
function clickTolliumButton(toddbuttontitle)
{
  let button = getTolliumButton(toddbuttontitle);
  if(!button)
    throw new Error(`No button titled '${toddbuttontitle}'`);
  test.click(button);
}
function testClickTolliumButton(toddbuttontitle, options, _deprecated_waits)
{
  options = typeof options === "string" ? { name: options } : { ...options };
  if (_deprecated_waits)
    options.waits = _deprecated_waits;

  return { name: options.name || "Click button: " + toddbuttontitle
         , test: function(doc,win)
                 {
                   clickTolliumButton(toddbuttontitle);
                 }
         , waits: (options.waits || ["ui"])
         };
}
function getTolliumLabel(toddlabel)
{
  return test.qSA('t-text').filter(text=>text.textContent.includes(toddlabel))[0];
}
function clickTolliumLabel(toddlabel)
{
  var label = getTolliumLabel(toddlabel);
  if(!label)
    throw new Error("No label titled '" + toddlabel + "'");
  test.click(label);
}
function testClickTolliumLabel (toddlabel, options,_deprecated_waits)
{
  options = typeof options === "string" ? { name: options } : { ...options };
  if (_deprecated_waits)
    options.waits = _deprecated_waits;

  return { name: options.name || "Click label: " + toddlabel
         , test: function(doc,win)
                 {
                   clickTolliumLabel(toddlabel)
                 }
         , waits: (options.waits || ["ui"])
         };
}

function testClickTolliumToolbarButton(toddlabel, submenulabel, options = {})
{
  let name = options.name || "Click toolbar button: " + toddlabel + (submenulabel ? ", submenu: " + submenulabel : "");

  return { name: name
         , test: function(doc,win)
           {
             clickToddToolbarButton(toddlabel, submenulabel);
           }
         , waits: (options.waits || ["ui"])
        };
}

async function selectListRow(listname, textinrow, options = {})
{
   let el = await waitForResult( () =>
   {
     var selector = 'div.wh-ui-listview';
     if(listname)
       selector += '[data-name$=":' + listname + '"]';
     selector += ' div.listrow';

     var rows = getCurrentScreen().qSA(selector);
     return rows.filter(node => node.textContent.includes(textinrow))[0];
   });

   if(!el)
   {
     throw new Error("Cannot find row with text '" + textinrow + "'");
   }
   console.log(el);


   var button = options&&options.rightclick ? 2 : 0;
   if(options&&options.doubleclick)
     test.sendMouseGesture([ {el:el, down:button}, {up: button}, {el:el, down:button}, {up: button} ]);
   else
     test.sendMouseGesture([ {el:el, down:button}, {up: button} ]);

  await test.wait(options && options.waits ? options.waits : ['ui-nocheck']); //there may be UI interaction..
}

function testSelectListRow(listname, textinrow, options = {})
{
  return { name: options.name || `Click list row from ${listname} with text '${textinrow}'`
         , test: () => selectListRow(listname, textinrow, options)
         };
}

function getTolliumHost()
  {
    return test.getTestSiteRoot() + 'testsuiteportal/';
  }

function setTolliumOverrideToken(token)
  {
    token = token || "";
    overridetoken = token;
    var pos = token.indexOf("overridetoken=");
    if (pos != -1)
      overridetoken = token.substr(pos + 14);
  }

function getTolliumDebugVariables()
  {
    var addurl = 'intolerant=1';
    try
    {
      var parenturi = new URL(window.parent.location.href);
      if(parenturi.searchParams.get('debug'))
        addurl += '&debug=' + parenturi.searchParams.get('debug');
      if(parenturi.searchParams.get('wh-debug'))
        addurl += '&wh-debug=' + parenturi.searchParams.get('wh-debug');
      if(parenturi.searchParams.get('transport'))
        addurl += '&transport=' + encodeURIComponent(parenturi.searchParams.get('transport'));
      if (overridetoken)
        addurl += "&language=debug&overridetoken=" + overridetoken;
      if(parenturi.hash)
        addurl += parenturi.hash;
    }
    catch(e)
    {
    }
    return addurl;
  }

function setTodd(name, value)
{
  var textedit = getCurrentScreen().getToddElement(name).querySelector('input,textarea');
  if(textedit)
  {
    test.fill(textedit, value);
    return;
  }

  throw new Error("Can't find '" + name + "'");
}

function clickToddButton(buttonlabel)
{
  let elt = getCurrentScreen().qSA('t-button').filter(button => button.textContent.includes(buttonlabel))[0];
  if (!elt)
    throw new Error("Cannot find button with text '" + buttonlabel + "'");
  test.click(elt);
}

function clickToddToolbarButton(buttonlabel, submenulabel)
{
  let elt = getCurrentScreen().qSA('t-toolbar t-button').filter(button => button.textContent.includes(buttonlabel))[0];
  if (!elt)
    throw new Error("Cannot find toolbar button with text '" + buttonlabel + "'");
  test.click(elt);
  if (submenulabel)
  {
    elt = test.qSA('.wh-menulist.open li').filter(li=>li.textContent.includes(submenulabel));
    if (!elt.length)
      throw new Error("Cannot find toolbar button menu item with text '" + submenulabel + "'");
    test.click(elt[0]);
  }
}

function waitForResult(fn)
{
  let timeout = Date.now() + 15000;
  let defer = dompack.createDeferred();

  let waiter = () =>
  {
    let result = fn();
    if(result)
    {
      defer.resolve(result);
      return;
    }
    if(Date.now() > timeout)
    {
      defer.reject(new Error("Timeout"));
      return;
    }
    requestAnimationFrame(waiter);
  };
  requestAnimationFrame(waiter);
  return defer.promise;
}

window.ToddTest =
{
  toolbarButton: function(name, toddlabel, submenulabel)
  {
    return testClickTolliumToolbarButton(toddlabel, submenulabel, { name });
  }
, plainButton: function(name, buttonlabel)
  {
    return { name: name
           , test: function(doc,win)
             {
               clickToddButton(buttonlabel);
             }
          , waits: [ 'ui' ]
          };
  }
, selectListRow:function(name, listname, textinrow, options)
  {
    options = { name, ...options };
    return testSelectListRow(listname, textinrow, options);
  }
};

function getOpenSelectList()
{
  return test.qSA('div').filter(node => Array.from(node.classList).some(name => name.match(/__items--open$/)))[0];
}
function getSelectListVisibleItems()
{
  return test.qSA('.t-selectlist__items .t-selectlist__item').filter(node => test.canClick(node));
}

/** wait for a todd component to appear in the current screen
    @long sometimes just waiting for a component is the easiest way to navigate app transitions */
export async function waitForToddComponent(name)
{
  await test.wait(() =>
  {
    try
    {
      let comp = compByName(name);
      if(comp)
        return true;
    }
    catch(ignore)
    {
    }
    return false;
  });
  return compByName(name);
}

export * from "@mod-system/js/wh/testframework";

export { clickToddButton };
export { clickToddToolbarButton };
export { compByName };
export { getCompTestPage };
export { getCurrentApp };
export { getCurrentScreen };
export { getMenu };
export { getTestScreen };
export { getTolliumDebugVariables };
export { getTolliumHost };
export { setTodd };
export { setTolliumOverrideToken };
export { testClickTolliumButton };
export { testClickTolliumLabel };
export { testClickTolliumToolbarButton };
export { testSelectListRow };
export { $screen };
export function getGridVsize() { return 28; }
export { getOpenSelectList };
export { getSelectListVisibleItems };
export { getTolliumButton };
export { clickTolliumButton };
export { selectListRow };
export { getTolliumLabel };
export { clickTolliumLabel };
export async function expectWindowOpen(code)
{
  test.getWin()._testfw_oldopen = test.getWin().open;
  try
  {
    let promise = new Promise((resolve, reject) =>
    {
      test.getWin().open = (url, target) => resolve({ url, target });
      setTimeout(() => reject(new Error("Timeout waiting for window.open")), 30000);
    });
    if (code)
      await code();
    let result = await promise;
    if (/filetransfer.shtml/.exec(result.url))
      result = { ...result, ...await test.invoke("mod::tollium/lib/testframework.whlib#GetFileTransferData", result.url) };
    return result;
  }
  finally
  {
    test.getWin().open = test.getWin()._testfw_oldopen;
  }
}
