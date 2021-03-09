/** @import: import * as domscroll from 'dompack/browserfix/scroll';
*/

import * as dompack from 'dompack';

let debugscrolling = false;

var clamp = function(min, max, val) { return val < min ? min : val > max ? max : val; };
var parsepx = function(val)
{
  if (val == "0")
    return parseInt(val,10);
  if (!/^-?[0-9]+(\.[0-9]*)?px$/.test(val))
    throw new Error("Only 'px' unit is allowed in scrollToElement context");
  val = parseFloat(val);
  if (val < 0)
    throw new Error("Negative values are not allowed scrollToElement context");
  return val;
};


var addContextToRect = function(rect, context)
{
  return (
    { top:      rect.top - context.top
    , right:    rect.right + context.right
    , bottom:   rect.bottom + context.bottom
    , left:     rect.left - context.left
    , width:    rect.width + context.left + context.right
    , height:   rect.height + context.top + context.bottom
    , node:     rect.node || null
    });
};

function aniHookSetScrollStyle(node, style)
{
  if(node == node.ownerDocument.documentElement) //scroll its window instead
  {
    var win = node.ownerDocument.defaultView;
    var setx = "scrollLeft" in style ? style.scrollLeft : win.pageXOffset || win.scrollLeft || 0;
    var sety = "scrollTop" in style ? style.scrollTop : win.pageYOffset || win.scrollTop || 0;
    win.scrollTo(setx, sety);
  }
  else
  {
    console.warn('aniHookSetScrollStyle', node, style);
    /* FIXME Will we return wh-scrollable view support ?
    if (node.classList.contains('wh-scrollableview'))
    {
      var view = $wh.ScrollableView.getFrom(node);
      if (view)
      {
        var pos = view.getScroll();
        if ("scrollLeft" in style)
          pos.x = style.scrollLeft;
        if ("scrollTop" in style)
          pos.y = style.scrollTop;

        view.scrollTo(pos.x, pos.y);

        console.warn('scroll result', view.getScrollSize(), view.getScroll());
      }
    }
    else*/
    {
      if ("scrollLeft" in style)
      {
        node.scrollLeft = style.scrollLeft;
        if(debugscrolling && node.scrollLeft != style.scrollLeft)
          console.warn('scrollLeft update failed, wanted ' + style.scrollLeft + ' got ' + node.scrollLeft,node);
      }
      if ("scrollTop" in style)
      {
        node.scrollTop = style.scrollTop;
        if(debugscrolling && node.scrollTop != style.scrollTop)
          console.warn('scrollTop update failed, wanted ' + style.scrollTop + ' got ' + node.scrollTop,node);
      }
    }
  }
  delete style.scrollLeft;
  delete style.scrollTop;
  return style;
}

var getMovedBoxes = function(boxes, x, y)
{
  var newboxes = [];

  // Correct box positions for new scrolling params
  boxes.forEach(function(item)
    {
      newboxes.push(
        { top :     item.top + y
        , right:    item.right + x
        , bottom:   item.bottom + y
        , left:     item.left + x
        , width:    item.width
        , height:   item.height
        , node:     item.node || null
        });
    });

  return newboxes;
};

var getClampedBoxes = function(boxes, max_x, max_y)
{
  var newboxes = [];

  // Correct box positions for new scrolling params
  boxes.forEach(function(item)
    {
      var newbox =
        { top :     clamp(0, max_y, item.top)
        , right:    clamp(0, max_x, item.right)
        , bottom:   clamp(0, max_y, item.bottom)
        , left:     clamp(0, max_x, item.left)
        , width:    0
        , height:   0
        , node:     item.node || null
        };
      newbox.width = newbox.right - newbox.left;
      newbox.height = newbox.bottom - newbox.top;
      newboxes.push(newbox);
    });

  return newboxes;
};


/** Scrolls elements so that a specific node is visible. If an (x,y) coordinate is given, that point is
    scrolled into view. If not, the left top is scrolled into view , with as much of the element as possible.
    Also, a number of pixels around the point is placed into view (context).
    @param node Node to get in view
    @param options Options
    @cell options.x X offset within node to get into view
    @cell options.y Y offset within node to get into view
    @cell options.context Context pixels to use. Use number or css syntax (eg: "0 20px 30px". Only unit 'px' is supported)
    @cell options.limitnode Parent top stop scrolling at
*/
export function scrollToElement(node, options)
{
  var animations = getScrollToElementAnimations(node, options);
  animations.forEach(function(item) { item.hooksetstyles(item.to); }); //FIXME remove hooksetstyles
}

/** Returns the animation needed to make a specific node visible. If an (x,y) coordinate is given, that point is
    scrolled into view. If not, the left top is scrolled into view , with as much of the element as possible.
    Also, a number of pixels around the point is placed into view (context).
    @param node Node to get in view
    @param options Options
    @cell options.x X offset within node to get into view
    @cell options.y Y offset within node to get into view
    @cell options.context Context pixels to use. Use number or css syntax (eg: "0 20px 30px". Only unit 'px' is supported)
    @cell options.limitnode Parent top stop scrolling at
    @cell options.duration Duration
    @cell options.allownodes List of nodes to explicitly allow scrolling (compensate for overflow: hidden)
    @return List of scroll animations (can be fed into animation timeline)
    @cell return.target
    @cell return.from
    @cell return.to
    @cell return.hooksetstyles
    @cell return.duration
*/
function getScrollToElementAnimations(node, options)
{
   if(debugscrolling)
     console.log("--------------------- Scroll to element: ",node,options);

// make sure options is a valid object
  options = options || {};

  // Get location within node to get into view
  var x = options.x || 0;
  var y = options.y || 0;

  // Extra context (when x & y aren't specified)
//  var boundrec = node.getBoundingClientRect();
//  var extra_context_right = typeof options.x != "number" ? boundrec.right - boundrec.left : 0;
//  var extra_context_bottom = typeof options.y != "number" ? boundrec.bottom - boundrec.top : 0;

  // Parse context string (accept CSS format eg "20px 0 30px")
  options.context = options.context || "20px";
  if (typeof options.context == "number")
      options.context = options.context + "px";

  var contextparts = options.context.split(' ');
  var context =
    { top:      parsepx(contextparts[0])
    , right:    parsepx(contextparts[1] || contextparts[0])
    , bottom:   parsepx(contextparts[2] || contextparts[0])
    , left:     parsepx(contextparts[3] || contextparts[1] || contextparts[0])
    };

  // Convert body to documentElement in options.limitnode
  if (options.limit && options.limit == options.limit.ownerDocument.body)
    options.limit = options.limit.ownerDocument.documentElement;

  // List of actions
  var actions = [];

  // Calculate 2 boxes - first for if context is really to big
  var boxes =
    [ { top:      y - 1
      , right:    x + 1
      , bottom:   y + 1
      , left:     x - 1
      , width:    2
      , height:   2
      , node:     node
      }
    , { top:      y - context.top
      , right:    x + context.right
      , bottom:   y + context.bottom
      , left:     x - context.left
      , width:    context.left + context.right
      , height:   context.top + context.bottom
      , node:     node
      }
    ];

  // Add a whole element box
  boxes.push(addContextToRect(dompack.getRelativeBounds(node, node), context));

//  var orgnode = node;
  var parent;

  for (; node; node=parent)
  {
    var doc = node.ownerDocument;
    var wnd = doc.defaultView;

//    var parent;
    if (node == doc.documentElement) //at the root
    {
      var iframe = wnd.frameElement;
      if (!iframe)
        break;
      node = iframe;
    }

    parent = node.parentNode;
    if (parent == doc.body)
      parent = doc.documentElement;
    if(!parent)
      return []; //we were out of the dom..

    if(debugscrolling)
      console.log('pre boxes', boxes.clone());

    // Calculate offset of node within parent. Mootools getPosition(relative) doesn't work, sometimes
    // returns NaN and doesn't account for borders
    var position =
        { x: node.offsetLeft - (parent == node.offsetParent ? 0 : parent.offsetLeft)
        , y: node.offsetTop - (parent == node.offsetParent ? 0 : parent.offsetTop)
        };

    if (parent.classList.contains('wh-scrollableview')) // Scrollable view
      position = { x: 0, y: 0 };

    if(debugscrolling)
      console.log('iter ', node, parent, position);

    // Correct the box positions for the offset within the parent
    boxes = getMovedBoxes(boxes, position.x, position.y);

    if(debugscrolling)
      console.log('moved boxes', boxes.clone());

    // For the html-tag, we also allow '' & 'visible' as scrollable
    var match_overflow_set = parent.nodeName != 'HTML'
      ? [ "scroll", "auto" ]
      : [ "scroll", "auto", "", "visible" ]; // "" for IE8

    //var can_scroll = [ "scroll", "auto", top_default ].includes(getComputedStyle(parent,"overflow"));
    var general_scroll = getComputedStyle(parent).overflow;
    var can_scroll_x = match_overflow_set.includes(getComputedStyle(parent).overflowX || general_scroll) || parent.classList.contains("wh-scrollableview-canscroll-h");
    var can_scroll_y = match_overflow_set.includes(getComputedStyle(parent).overflowY || general_scroll) || parent.classList.contains("wh-scrollableview-canscroll-v");

    if (!can_scroll_x && options.allownodes)
      can_scroll_x = options.allownodes.includes(parent);
    if (!can_scroll_y && options.allownodes)
      can_scroll_y = options.allownodes.includes(parent);

    if(debugscrolling)
      console.log('can scroll', parent, 'x:', can_scroll_x, 'y:', can_scroll_y);

    if (!can_scroll_x && !can_scroll_y)
      continue;

    var clientsize = { x: parent.clientWidth, y: parent.clientHeight };
    var scrollsize = { x: parent.scrollWidth, y:parent.scrollHeight };
    if (parent.classList.contains('wh-scrollableview')) // Scrollable view
    {
      scrollsize =
          { x:  node.offsetWidth
          , y:  node.offsetHeight
          };
    }

    if(scrollsize.x <= clientsize.x && scrollsize.y <= clientsize.y)//nothing to scroll
      continue;

    // Get current scroll
    var scrollpos = { x: parent.scrollLeft, y:parent.scrollTop};
    if (parent.classList.contains('wh-scrollableview')) // Scrollable view
    {
      scrollpos.x = -node.offsetLeft;
      scrollpos.y = -node.offsetTop;
    }

    if(debugscrolling)
    {
      console.log(' parent is scrollable', parent);
      console.log(' scroll ', scrollsize.x, '/', scrollsize.y,'client ', clientsize.x, '/', clientsize.y, 'curpos:', scrollpos.x, '/', scrollpos.y);
    }

    var range =
      { minleft: 0
      , maxleft: Math.max(0, scrollsize.x - clientsize.x)
      , mintop: 0
      , maxtop: Math.max(0, scrollsize.y - clientsize.y)
      };

    //if(debugscrolling) console.log('range pre', range);

    boxes.forEach(function(item)
      {
        range.maxleft = clamp(range.minleft, range.maxleft, item.left);
        range.minleft = clamp(range.minleft, range.maxleft, item.right - clientsize.x);

        range.maxtop = clamp(range.mintop, range.maxtop, item.top);
        range.mintop = clamp(range.mintop, range.maxtop, item.bottom - clientsize.y);
      });

    //if(debugscrolling) console.log('range post', range);

    // Get clamped scroll position. Ignore if we can't scroll in this direction
    var newscrollleft = can_scroll_x ? clamp(range.minleft, range.maxleft, scrollpos.x) : scrollpos.x;
    var newscrolltop = can_scroll_y ? clamp(range.mintop, range.maxtop, scrollpos.y) : scrollpos.y;

    if (debugscrolling)
    {
      console.log(' range', range, 'oldscroll', scrollpos.x, '/', scrollpos.y);
      console.log('  newscroll', newscrollleft, '/', newscrolltop);
    }

    // Only schedule an action when something changed
    if (newscrollleft != scrollpos.x || newscrolltop != scrollpos.y)
    {
      var action =
          { duration:       options.duration || 0
          , target:         parent
          , from:           {}
          , to:             {}
          , hooksetstyles:  aniHookSetScrollStyle.bind(null, parent)
          };

      if (newscrollleft != scrollpos.x)
      {
        action.from.scrollLeft = scrollpos.x;
        action.to.scrollLeft = newscrollleft;
      }

      if (newscrolltop != scrollpos.y)
      {
        action.from.scrollTop = scrollpos.y;
        action.to.scrollTop = newscrolltop;
      }

      if (debugscrolling)
        console.log('scheduled action', action);

      actions.push(action);
    }

    // Correct the boxes for the scrolling
    boxes = getMovedBoxes(boxes, -newscrollleft, -newscrolltop);

    // Clamp for the client window (don't need to scroll for invisible part of boxes)
    boxes = getClampedBoxes(boxes, clientsize.x, clientsize.y);

    // Add box for parent
    if(debugscrolling)
      console.log('parentbox', dompack.getRelativeBounds(parent, parent));

    boxes.push(addContextToRect(dompack.getRelativeBounds(parent, parent), context));
  }
  return actions;
}

if(debugscrolling)
  console.warn("debugscrolling in designfiles domscroll.es is enabled");
