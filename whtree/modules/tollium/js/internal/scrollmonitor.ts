import * as browser from 'dompack/extra/browser';
import * as dompack from 'dompack';

/////////////////////////////////////////////////////////////////////////
//
// ScrollMonitor
//
// Browsers may reset scroll position if elements leave the dom or on focus.
// Watch and restore scroll position. tollium.lists.testjump tests this

//list of delayed scroll fixes
let scrollfixlist: Array<
  { /** Node we're tracking */
    node: HTMLElement;
    /** Last seen scrollTop */
    top: number;
    /** Last sceen scrollLeft */
    left: number;
  }> = [];

function watchScroll(evt: Event) {
  const node = evt.target as HTMLElement;
  if (!node)
    return;
  if (dompack.debugflags.scm)
    console.log("[scm] SCROLL ", node, ` to ${node.scrollLeft},${node.scrollTop}`);
  saveScrollPosition(node);
}

function applyScrollFixList() {
  const savedlist = scrollfixlist; //not expecting sideeffects, but save it just in case
  scrollfixlist = [];

  for (const tofix of savedlist) {
    if (dompack.debugflags.scm)
      console.log(`[scm] Delayed resetting scroll from ${tofix.node.scrollLeft},${tofix.node.scrollTop} to ${tofix.left},${tofix.top} for `, tofix.node);
    tofix.node.scrollLeft = tofix.left + 1;
    tofix.node.scrollLeft = tofix.left;
    tofix.node.scrollTop = tofix.top;
  }
}

function doFixScrollPosition(node: HTMLElement) {
  if (browser.getName() === "firefox") { // Firefox delays scroll resets, so we'll need to delay our fix.

    if (scrollfixlist.length === 0) {
      //  Animationframe is more reliable than timeout for firefox
      requestAnimationFrame(applyScrollFixList);
    } else if (scrollfixlist.find(tofix => tofix.node === node))
      return; //already have this on our fixlist

    scrollfixlist.push({
      node,
      top: parseFloat(node.dataset.dompackSavedScrollTop || ""),
      left: parseFloat(node.dataset.dompackSavedScrollLeft || "")
    });
  } else { //we can fix it right away
    if (dompack.debugflags.scm)
      console.log(`[scm] Resetting scroll from ${node.scrollLeft},${node.scrollTop} to ${node.dataset.dompackSavedScrollLeft},${node.dataset.dompackSavedScrollTop} for `, node);
    node.scrollLeft = parseFloat(node.dataset.dompackSavedScrollLeft || "");
    node.scrollTop = parseFloat(node.dataset.dompackSavedScrollTop || "");
  }
  return true;
}

function onFocusCheckScroll(node: HTMLElement) {
  if (dompack.debugflags.scm)
    console.log("[scm] FOCUS", node, node.scrollTop, node.dataset.dompackSavedScrollTop);
  //'this' is the element on which we registered the scroll event (and the one we're watching)
  doFixScrollPosition(node); //unconditionally fix it
}

export class Monitor {
  node: HTMLElement;

  constructor(node: HTMLElement) {
    this.node = node;
    this.node.addEventListener('scroll', evt => watchScroll(evt), true);
  }
  fixupPositions() {
    if (dompack.debugflags.scm)
      console.log("[scm] FixupPositions()", this.node);
    for (const node of this.node.querySelectorAll<HTMLElement>('.dompack--scrollmonitor'))
      fixScrollPosition(node);
  }
}

export function fixScrollPosition(node: HTMLElement) {
  if (node.scrollTop === parseFloat(node.dataset.dompackSavedScrollTop || "") && node.scrollLeft === parseFloat(node.dataset.dompackSavedScrollLeft || ""))
    return false;

  doFixScrollPosition(node);
}

//can also force sync positions to be reparsed, needed after manual scrollTop/Left update
export function saveScrollPosition(node: HTMLElement) {
  if (node.dataset.dompackSavedScrollTop === undefined) { //set a class for watched nodes, so we can quickly find them
    if (dompack.debugflags.scm)
      console.log("[scm] Starting to record scroll positions for ", node);
    node.classList.add('dompack--scrollmonitor');

    //At least chrome will scroll back a component on focus (eg RTD) and needs restoration
    node.addEventListener('focus', () => onFocusCheckScroll(node), true);
  }

  node.dataset.dompackSavedScrollTop = String(node.scrollTop);
  node.dataset.dompackSavedScrollLeft = String(node.scrollLeft);
}

export function setScrollPosition(node: HTMLElement, x: number, y: number) {
  node.scrollTop = y;
  node.scrollLeft = x;
  saveScrollPosition(node);
  dompack.dispatchDomEvent(node, "scroll"); //update the list immediately, this fixes some races (such as testFindAsYouType) as the scroll evnet will otherwise fire asynchronously
}
