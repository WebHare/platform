/// @ts-nocheck -- TODO ... TestFramework is a LOT to port ... for now we're just providing types
import * as dompack from 'dompack';
import * as test from "@mod-system/js/wh/testframework";
import { escapeRegExp } from '@webhare/std';
import type { ApplicationBase } from '@mod-tollium/web/ui/js/application';
import type { ObjFrame } from '@mod-tollium/webdesigns/webinterface/components/frame/frame';
import type { } from "@mod-tollium/js/internal/debuginterface";
import type ObjList from '@mod-tollium/webdesigns/webinterface/components/list/list';

function isStringOrRegexpMatch(intext: string, pattern: string | RegExp) {
  if (typeof pattern === 'string')
    return intext === pattern;
  if (pattern instanceof RegExp)
    return Boolean(intext.match(pattern));
  throw new Error(`Not sure how to match against '${pattern}'`);
}

class AppProxy {
  app: ApplicationBase;
  /** @deprecated Use test.getWin() / test.getDoc() / test.qS(A) */
  get win() {
    return test.getWin();
  }
  constructor(toddapp: ApplicationBase) {
    this.app = toddapp;
  }
  getNumOpenScreens() {
    return this.app.screenstack.length;
  }
  getScreenBySeqnr(idx) {
    if (idx < 0 || idx >= this.app.screenstack.length)
      throw new Error("Invalid screen index requested");
    return new ScreenProxy(this, idx);
  }
  getActiveScreen() {
    if (!this.app.screenstack.length)
      throw new Error("No screens open");
    return new ScreenProxy(this, this.app.screenstack.length - 1);
  }
  isBusy() {
    return this.app.isBusy();
  }
}

class ScreenProxy {
  win: ObjFrame;

  constructor(appproxy, idx) {
    this.appproxy = appproxy;
    this.idx = idx;
    this.win = appproxy.app.screenstack[idx];
    if (!this.win)
      throw new Error("No window #" + idx);
  }

  getParent() {
    return new ScreenProxy(this.appproxy, this.idx - 1);
  }

  /** Return the <li> node for a specific menu item
      @param levels - Full path to the menu item (parts of the menu names)
  */
  getMenu(levels: string[], options?: { allowMissing?: boolean; autoClickHamburger?: boolean } = {}): HTMLElement;
  getMenu(levels: string[], options?: { allowMissing: true; autoClickHamburger?: boolean } = {}): HTMLElement | null;

  getMenu(levels: string[], { allowMissing = false, autoClickHamburger = true } = {}): HTMLElement | null {
    let curitem: HTMLElement | null = this.win.node.querySelector('.wh-menubar');
    if (!curitem && autoClickHamburger) {
      // test clicking the hamburger menu
      const hamburger_img = this.win.node.querySelector(`t-toolbar .t-toolbar-buttongroup__right button.ismenubutton img[data-toddimg="tollium:actions/menu|24|24|w,b"]`);
      if (hamburger_img) {
        test.click(hamburger_img.closest(`button`)!);
        curitem = this.win.node.ownerDocument.querySelectorAll<HTMLElement>('.wh-menulist.open')[0];
      }
    }
    if (levels)
      for (let i = 0; curitem && i < levels.length; ++i) {
        if (curitem.nodeName === 'LI') {
          // Move to the item first, maybe we're in auto-select mode
          void test.sendMouseGesture([{ el: curitem }]);

          // If not selected yet, click the menu item to open it
          if (!curitem.classList.contains('selected'))
            test.click(curitem);

          // Get the relevant detached menu
          curitem = this.win.node.ownerDocument.querySelectorAll<HTMLElement>('.wh-menulist.open')[i - 1];
          if (!curitem)
            throw new Error('Could not find detached menu');
        }

        // Find the li with the requested text
        curitem = dompack.qSA(curitem, 'li').filter(li => li.textContent?.includes(levels[i]))[0];
      }

    if (!curitem)
      if (allowMissing)
        return null;
      else
        throw new Error("Could not find menu item '" + levels.join(" > ") + "'");

    return curitem;
  }
  getText(compname: string) {
    const el = this.getToddElement(compname);
    if (!el)
      throw new Error("No such component '" + compname + "'");

    //ADDME support more node types than just <text>
    return el.textContent;
  }
  getValue(compname: string) {
    const el = this.getToddElement(compname);
    if (!el)
      throw new Error("No such component '" + compname + "'");

    //ADDME support more node types than just <checkbox> and <pulldown>
    if (el.classList.contains("t-checkbox"))
      return el.checked;
    if (el.nodeName.toLowerCase() === "t-textedit")
      return el.querySelector('input').value;
    if (el.nodeName.toLowerCase() === "t-textarea")
      return el.querySelector('textarea').value;
    throw new Error("component not yet supported by getInputValue (classes: " + el.className + ")");
  }
  getListRow(listname: string, pattern: string | RegExp) { //simply reget it for every test, as list may rerender at unspecifide times
    const list = this.getToddElement(listname);
    if (!list)
      throw new Error("No such list '" + listname + "'");

    const rows = list.querySelectorAll('.listrow');
    for (let i = 0; i < rows.length; ++i) {
      const row = rows[i];
      for (let j = 0; j < row.childNodes.length; ++j) {
        const cell = row.childNodes[j];
        if (isStringOrRegexpMatch(cell.textContent, pattern)) //direct text check
          return rows[i];

        const textintree = cell.querySelectorAll('span')[1];
        if (textintree && isStringOrRegexpMatch(textintree.textContent, pattern)) //check inside the node next to a tree expand span
          return rows[i];
      }
    }
    return null;
  }
  qS(selector) {
    if (!this.win)
      return null;
    return this.win.node.querySelector(selector);
  }
  qSA(selector) {
    if (!this.win)
      return null;
    return Array.from(this.win.node.querySelectorAll(selector));
  }
  getElement(selector) {
    if (!this.win)
      return null;
    return this.win.node.getElement(selector);
  }
  getElements(selector) {
    if (!this.win)
      return null;
    return this.win.node.getElements(selector);
  }
  getToddElement(toddname) {
    const candidates = this.qSA('*[data-name]');

    let regex = new RegExp("^" + escapeRegExp(toddname).replace('\\*', '.*') + "$");
    let match = candidates.filter(node => node.dataset.name.match(regex));
    if (!match.length) {
      regex = new RegExp(":" + escapeRegExp(toddname).replace('\\*', '.*') + "$");
      match = candidates.filter(node => node.dataset.name.match(regex));
    }
    if (!match.length) {
      //look for pulldowns, they have an odd name
      const pulldown = this.qS(`select[data-name*=':${toddname}$']`);
      if (pulldown)
        return pulldown;
    }
    if (match.length > 1)
      throw new Error("Multiple matches for name '" + toddname + "'");
    return match.length === 1 ? match[0] : null;
  }
  getNode() {
    return this.win ? this.win.node : null;
  }
  clickCloser() {
    const closer = this.win.node.querySelector('.closewindow');
    if (!closer)
      throw new Error("Screen '" + this.win.screenname + "' has no close window");

    test.click(closer);
  }

  getFrameTitle() {
    return this.win.node.querySelector(".windowheader .title").textContent;
  }
}

function $screen(win) {
  return getCurrentApp().getActiveScreen();
}

function getCurrentApp() {
  const app = test.getWin().$tollium?.getActiveApplication();
  if (!app)
    throw new Error("No active tollium application");
  return new AppProxy(app);
}
function getCurrentScreen() {
  return getCurrentApp().getActiveScreen();
}
function getMenu(levels, { allowMissing = false, autoClickHamburger = true } = {}) {
  return getCurrentScreen().getMenu(levels, { allowMissing, autoClickHamburger });
}
function compByName(toddname) {
  return getCurrentScreen().getToddElement(toddname);
}
export function compByTitle(title) {
  const elts = getCurrentScreen().qSA('t-text.label,button').filter(label => (label.textContent === (title + ":") || label.textContent === title));
  if (elts.length === 0)
    throw new Error(`No component with title '${title}'`);
  if (elts.length > 1)
    throw new Error(`Multiple components with title '${title}'`);
  if (elts[0].nodeName.toLowerCase() === "button")
    return elts[0];
  return compByName(elts[0].dataset.labelfor || elts[0].for);
}
function getTestScreen(testscreen) {
  const baseurl = test.getTestSiteRoot() + 'testsuiteportal/?app=webhare_testsuite:runscreen(' + encodeURIComponent(testscreen) + ')&' + getTolliumDebugVariables();
  return baseurl;
}
function getCompTestPage(componentname, params?) {
  const baseurl = test.getTestSiteRoot() + 'testsuiteportal/?app=webhare_testsuite:anycomponent(' + encodeURIComponent(componentname) + ',' + encodeURIComponent(JSON.stringify(params || null)).replace(/,/g, '%2C') + ')&' + getTolliumDebugVariables();
  return baseurl;
}
function getTolliumButton(toddbuttontitle) {
  return test.qSA("button").filter(button => button.textContent.includes(toddbuttontitle))[0];
}
function clickTolliumButton(toddbuttontitle) {
  const button = getTolliumButton(toddbuttontitle);
  if (!button)
    throw new Error(`No button titled '${toddbuttontitle}'`);
  test.click(button);
}
function testClickTolliumButton(toddbuttontitle, options?, _deprecated_waits?) {
  options = typeof options === "string" ? { name: options } : { ...options };
  if (_deprecated_waits)
    options.waits = _deprecated_waits;

  return {
    name: options.name || "Click button: " + toddbuttontitle,
    test: function () {
      clickTolliumButton(toddbuttontitle);
    },
    waits: (options.waits || ["ui"])
  };
}
function getTolliumLabel(toddlabel: string) {
  return test.qSA('t-text').filter(text => text.textContent?.includes(toddlabel))[0];
}
function clickTolliumLabel(toddlabel: string) {
  const label = getTolliumLabel(toddlabel);
  if (!label)
    throw new Error("No label titled '" + toddlabel + "'");
  test.click(label);
}
function testClickTolliumLabel(toddlabel: string, options?: { name?: string }) {
  options = typeof options === "string" ? { name: options } : { ...options };

  return {
    name: options.name || ("Click label: " + toddlabel),
    test: function () {
      clickTolliumLabel(toddlabel);
    },
    waits: ["ui"]
  };
}

export function testClickTolliumToolbarButton(toddlabel: string, submenulabel: string, options?: { name?: string; waits?: test.TestWaitItem[] }): test.RegisteredTestStep {
  const name = options?.name || ("Click toolbar button: " + toddlabel + (submenulabel ? ", submenu: " + submenulabel : ""));

  return {
    name: name,
    test: function () {
      clickToddToolbarButton(toddlabel, submenulabel);
    },
    waits: (options?.waits || ["ui"])
  };
}

async function selectListRow(listname: string, textinrow: string, options: { rightclick?: boolean; doubleclick?: boolean; waits?: test.TestWaitItem[] } = {}) {
  const el = await waitForResult(() => {
    let selector = 'div.wh-ui-listview';
    if (listname)
      selector += '[data-name$=":' + listname + '"]';
    selector += ' div.listrow';

    const rows = getCurrentScreen().qSA(selector);
    return rows.filter(node => node.textContent.includes(textinrow))[0];
  });

  if (!el) {
    throw new Error("Cannot find row with text '" + textinrow + "'");
  }
  console.log(el);


  const button = options && options.rightclick ? 2 : 0;
  if (options && options.doubleclick)
    await test.sendMouseGesture([{ el: el, down: button }, { up: button }, { el: el, down: button }, { up: button }]);
  else
    await test.sendMouseGesture([{ el: el, down: button }, { up: button }]);

  if (options && options.waits) {
    for (const waitstep of options.waits)
      await test.wait(waitstep);
  } else {
    await test.wait('ui-nocheck'); //there may be UI interaction..
  }
}

export function testSelectListRow(listname: string, textinrow: string, options?: { name?: string; rightclick?: boolean; doubleclick?: boolean; waits?: string[] }) {
  return {
    name: options?.name || `Click list row from ${listname} with text '${textinrow}'`,
    test: () => selectListRow(listname, textinrow, options)
  };
}

function getTolliumHost() {
  return test.getTestSiteRoot() + 'testsuiteportal/';
}

function getTolliumDebugVariables() {
  let addurl = '';
  try {
    const parenturi = new URL(window.parent.location.href);
    if (parenturi.searchParams.get('debug'))
      addurl += '&debug=' + parenturi.searchParams.get('debug');
    if (parenturi.searchParams.get('wh-debug'))
      addurl += '&wh-debug=' + parenturi.searchParams.get('wh-debug');
    if (parenturi.searchParams.get('transport'))
      addurl += '&transport=' + encodeURIComponent(parenturi.searchParams.get('transport'));
    if (parenturi.hash)
      addurl += parenturi.hash;
  } catch (e) {
  }
  return addurl;
}

function setTodd(name, value) {
  const toddel = getCurrentScreen().getToddElement(name);
  if (!toddel)
    throw new Error(`Can't find toddElement '${name}'`);

  const textedit = toddel.matches('input') ? toddel : toddel.querySelector('input,textarea');
  if (textedit) {
    test.fill(textedit, value);
    return;
  }

  if (toddel.matches('select')) {
    test.fill(toddel, value);
    return;
  }

  throw new Error(`Don't know how to set toddElement '${toddel}'`);
}

function clickToddButton(buttonlabel) {
  const elt = getCurrentScreen().qSA('button').filter(button => button.textContent.includes(buttonlabel))[0];
  if (!elt)
    throw new Error("Cannot find button with text '" + buttonlabel + "'");
  test.click(elt);
}

function clickToddToolbarButton(buttonlabel, submenulabel?) {
  let elt = getCurrentScreen().qSA('t-toolbar button').filter(button => button.textContent.includes(buttonlabel))[0];
  if (!elt)
    throw new Error("Cannot find toolbar button with text '" + buttonlabel + "'");
  test.click(elt);
  if (submenulabel) {
    elt = test.qSA('.wh-menulist.open li').filter(li => li.textContent.includes(submenulabel));
    if (!elt.length)
      throw new Error("Cannot find toolbar button menu item with text '" + submenulabel + "'");
    test.click(elt[0]);
  }
}

function waitForResult(fn) {
  const timeout = Date.now() + 15000;
  const defer = Promise.withResolvers();

  const waiter = () => {
    const result = fn();
    if (result) {
      defer.resolve(result);
      return;
    }
    if (Date.now() > timeout) {
      defer.reject(new Error("Timeout"));
      return;
    }
    requestAnimationFrame(waiter);
  };
  requestAnimationFrame(waiter);
  return defer.promise;
}

function getOpenSelectList() {
  return test.qSA('div').filter(node => Array.from(node.classList).some(name => name.match(/__items--open$/)))[0];
}
function getSelectListVisibleItems() {
  return test.qSA('.t-selectlist__items .t-selectlist__item').filter(node => test.canClick(node));
}

export function getListRowData(listrow: HTMLElement): Record<string, unknown> {
  if (!listrow.classList.contains(".wh-list__row")) {
    const thelistrow = listrow.closest<HTMLElement>(".wh-list__row");
    if (!thelistrow) {
      console.error("cannot find listrow for element", listrow);
      throw new Error("No list row found");
    }

    listrow = thelistrow;
  }

  const rownum = parseInt(listrow.dataset.row || '');

  const listel = listrow.closest(".wh-list");
  const list = listel?.propTodd as ObjList | undefined;
  if (!list)
    throw new Error("Cannot find list component");

  const rowdata = list.flatrows[rownum];
  const result: Record<string, unknown> = {};
  for (const col of list.datacolumns)
    result[col.name] = rowdata[col.dataidx];

  return result;
}

/** wait for a todd component to appear in the current screen
    sometimes just waiting for a component is the easiest way to navigate app transitions */
export async function waitForToddComponent(name) {
  await test.wait(() => {
    try {
      const comp = compByName(name);
      if (comp)
        return true;
    } catch (ignore) {
    }
    return false;
  });
  return compByName(name);
}

export async function runTolliumLogout() {
  test.click(await test.waitForElement("#dashboard-logout"));
  await test.waitForUI();
  clickToddButton('Yes');

  await test.wait('load');
  await test.waitForUI();
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
export { testClickTolliumButton };
export { testClickTolliumLabel };
export { $screen };
export { getOpenSelectList };
export { getSelectListVisibleItems };
export { getTolliumButton };
export { clickTolliumButton };
export { selectListRow };
export { getTolliumLabel };
export { clickTolliumLabel };
export async function expectWindowOpen(code: () => void | Promise<void>) {
  const _testfw_oldopen = test.getWin().open;
  try {
    const promise = new Promise<{ url: string; target?: string }>((resolve, reject) => {
      //@ts-ignore -- FIXME cleanup this hack!!
      test.getWin().open = (url: string, target?: string) => {
        console.log("window.open request, returning fake WindowProxy", { url, target });
        resolve({ url, target });
        return { __expectWindowOpen: "Returned by testframework expectWindowOpen" };
      };
      setTimeout(() => reject(new Error("Timeout waiting for window.open")), 30000);
    });
    if (code)
      await code();
    console.log("expectWindowOpen - waiting for open callback");
    let result = await promise;
    console.log("expectWindowOpen - got result, url", result.url);
    if (/filetransfer.shtml/.exec(result.url))
      result = { ...result, ...await test.invoke("mod::tollium/lib/testframework.whlib#GetFileTransferData", result.url) };
    return result;
  } catch (e) {
    console.log("expectWindowOpen - exception", e.toString());
    throw e;
  } finally {
    test.getWin().open = _testfw_oldopen;
  }
}

if (typeof window !== 'undefined') {
  Object.defineProperty(window, "$screen", { get: () => { throw new Error("Use ToddTest.$screen() instead of window.$screen"); } });
  Object.defineProperty(window, "ToddTest", { get: () => { throw new Error("ToddTest has been removed, use testClickTolliumToolbarButton or testSelectListRow"); } });
}
