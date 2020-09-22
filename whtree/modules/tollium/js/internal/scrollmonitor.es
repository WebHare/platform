import * as browser from 'dompack/extra/browser.es';
import * as dompack from 'dompack';

/////////////////////////////////////////////////////////////////////////
//
// ScrollMonitor
//
// Browsers may reset scroll position if elements leave the dom or on focus.
// Watch and restore scroll position. tollium.lists.testjump tests this

//list of delayed scroll fixes
let scrollfixlist = [];

function watchScroll(evt)
{
  let node = evt.target;
  if(dompack.debugflags.scm)
    console.log("[scm] SCROLL ",node, ` to ${node.scrollLeft},${node.scrollTop}`);
  ScrollMonitor.saveScrollPosition(node);
}

function applyScrollFixList()
{
  let savedlist = scrollfixlist; //not expecting sideeffects, but save it just in case
  scrollfixlist = [];

  for(let tofix of savedlist)
  {
    if(dompack.debugflags.scm)
      console.log(`[scm] Delayed resetting scroll from ${tofix.node.scrollLeft},${tofix.node.scrollTop} to ${tofix.left},${tofix.top} for `, tofix.node);
    tofix.node.scrollLeft = tofix.left + 1;
    tofix.node.scrollLeft = tofix.left;
    tofix.node.scrollTop = tofix.top;
  }
}

function doFixScrollPosition(node)
{
  if(["ie","edge","firefox"].includes(browser.getName()))
  { //IE, EDGE and Firefox delay scroll resets, so we'll need to delay our fix.

    if(scrollfixlist.length==0)
    {
      //  Animationframe is more reliable than timeout for firefox
      if("firefox" === browser.getName())
        requestAnimationFrame(() => applyScrollFixList());
      else
        setTimeout(applyScrollFixList, 1);
    }
    else if(scrollfixlist.find(tofix => tofix.node == node))
      return; //already have this on our fixlist

    scrollfixlist.push( {node: node, top: node.dompack_savedScrollTop, left: node.dompack_savedScrollLeft } );
  }
  else //we can fix it right away
  {
    if(dompack.debugflags.scm)
      console.log(`[scm] Resetting scroll from ${node.scrollLeft},${node.scrollTop} to ${node.dompack_savedScrollLeft},${node.dompack_savedScrollTop} for `, node);
    node.scrollLeft = node.dompack_savedScrollLeft;
    node.scrollTop = node.dompack_savedScrollTop;
  }
  return true;
}

function onFocusCheckScroll()
{
  if(dompack.debugflags.scm)
    console.log("[scm] FOCUS",this, this.scrollTop, this.dompack_savedScrollTop);
  //'this' is the element on which we registered the scroll event (and the one we're watching)
  doFixScrollPosition(this); //unconditionally fix it
}

export default class ScrollMonitor
{
  constructor(node)
  {
    this.node = node;
    this.node.addEventListener('scroll', watchScroll, true);
  }
  fixupPositions()
  {
    if(dompack.debugflags.scm)
      console.log("[scm] FixupPositions()",this.node);
    for(let node of this.node.querySelectorAll('.dompack--scrollmonitor'))
      ScrollMonitor.fixScrollPosition(node);
  }
}

ScrollMonitor.fixScrollPosition = function(node)
{
  if(node.scrollTop == node.dompack_savedScrollTop && node.scrollLeft == node.dompack_savedScrollLeft)
    return false;
  doFixScrollPosition(node);
};

//can also force sync positions to be reparsed, needed after manual scrollTop/Left update
ScrollMonitor.saveScrollPosition = function(node)
{
  if(! ('dompack_savedScrollTop' in node)) //set a class for watched nodes, so we can quickly find them
  {
    if(dompack.debugflags.scm)
      console.log("[scm] Starting to record scroll positions for ",node);
    node.classList.add('dompack--scrollmonitor');

    //At least chrome will scroll back a component on focus (eg RTD) and needs restoration
    node.addEventListener('focus', onFocusCheckScroll, true);
  }

  node.dompack_savedScrollTop = node.scrollTop;
  node.dompack_savedScrollLeft = node.scrollLeft;
};
ScrollMonitor.setScrollPosition = function(node,x,y)
{
  node.scrollTop = y;
  node.scrollLeft = x;
  this.saveScrollPosition(node);
  dompack.dispatchDomEvent(node, "scroll"); //update the list immediately, this fixes some races (such as testFindAsYouType) as the scroll evnet will otherwise fire asynchronously
};
