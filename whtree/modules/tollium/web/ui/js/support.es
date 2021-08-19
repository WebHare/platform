import * as dompack from 'dompack';

require("../common.lang.json");

/****************************************************************************************************************************
 *                                                                                                                          *
 *  SUPPORT FUNCTIONS                                                                                                       *
 *                                                                                                                          *
 ****************************************************************************************************************************/

/* Log messages only when the given target is enabled. A user can specify targets in the URL by using the hash bookmark (e.g.
   ?$tolliumdebug=true#dimensions,communication will show messages with targets 'dimensions' and 'communication'). Currently
   the following targets are used:
   - dimensions (calculating component sizes)
   - rpc (show the individual components/messages being rfcd)
   - communication (communication between the web application and the server)
   - actionenabler (how the enabled state of actions is determined using enableons)
   - messages (the messages, updates and components being processed by the screens)
   - ui (generic UI stuff, eg focus handling)
   - all (show all messages)
*/

let enabledlogtypes = [];

var $todd = {};

export const gridlineTopMargin = 2; // pixels to add to the top of a grid line
export const gridlineBottomMargin = 3; // pixels to add to the bottom of a grid line
export const gridlineTotalMargin = gridlineTopMargin + gridlineBottomMargin;
export const gridlineHeight = 28; //grid vertical size (28 pixels) including margins
export const gridlineInnerHeight = gridlineHeight - gridlineTotalMargin;
export const gridlineSnapMax = 8; //never add more than this amount of pixels to snap. an attempt to prevent inlineblocks from wildly generating empty space. this is mostly manually tuning and maybe we shouldn't do it

//workaround not having fully switched to export yet:
$todd.gridlineTopMargin = gridlineTopMargin;
$todd.gridlineBottomMargin = gridlineBottomMargin;
$todd.gridlineTotalMargin = gridlineTotalMargin;
$todd.gridlineHeight = gridlineHeight;
$todd.gridlineInnerHeight = gridlineInnerHeight;
$todd.gridlineSnapMax = gridlineSnapMax;

$todd.settings =
{ tab_stacked_vpadding_inactive: 1 // border-bottom: 1px (only for inactive!)
, textedit_defaultwidth: 150
, list_column_padding: 8 // 2x4 padding
, list_column_minwidth: 24 // minimum width for an icon (16) + 2x4 padding
, gridline_topmargin: gridlineTopMargin
, gridline_bottommargin: gridlineBottomMargin // pixels to add to the top of a grid line
, grid_vsize: gridlineHeight //grid vertical size (28 pixels) including margins
, tabspace_vsize: 32 //vertical size inside the tab-space layout

//size of spacers in a sync with apps.scss. SYNC-SPACERS/SYNC-SPACERS-DEBUG
, spacer_top: 10
, spacer_bottom: 10
, spacer_left: 10
, spacer_right: 10
//margin between line components. SYNC-SPACERWIDTH
, spacerwidth: 4
//size of spacers in a sync with apps.scss. SYNC-BORDERS
, border_top: 1
, border_bottom: 1
, border_left: 1
, border_right: 1

, listview_padleft: 8
, listview_padright: 8
, listview_checkboxholder_width: 20
, listview_expanderholder_width: 12 //
, listview_iconholder_width: 20     // iconholder (image 16px + margin 4px)

, fullscreen_maxx: 0.9 //maximum fraction of x width to use for fullscreen windows
, fullscreen_maxy: 1.0 //maximum fraction of y height to use for fullscreen windows

, buttonheight_intoolbar: 72
, buttonheight_intabsspace: 27

};


$todd.applications = [];
$todd.applicationstack = [];
$todd.resourcebase = "";
$todd.customactions = {};
$todd.dummyimage = null;

$todd.intolerant = window.location.href.indexOf('intolerant=1') != -1;
$todd.fastunload= window.location.href.indexOf('fastunload=1') != -1;

$todd.getActiveApplication = function()
{
  return $todd.applicationstack.slice(-1)[0];
};

/****************************************************************************************************************************
 * Text functions
 */


// Replaces "{param_[n]}" with p[n] in str for n in [1, 4]
$todd.FormatString = function(str, p1, p2, p3, p4)
{
  return str.substitute({ param_1: p1, param_2: p2, param_3: p3, param_4: p4 });
};


/****************************************************************************************************************************
 * Layout
 */

$todd.textsize = { cache: {}
                 , node: null
                 , styles: { "font-size": ""
                           , "font-style": ""
                           , "font-weight": ""
                           , "text-decoration": ""
                           }
                 };

$todd.UpToGridsize = function (size, gridsize)
{
  if(!gridsize || gridsize<=1)
    return size;

  var remainder = size % gridsize;
  if(remainder !== 0)
    size += gridsize - remainder;
  return size;
};



$todd.ResetCachedTextSizes = function()
{
  $todd.textsize.cache = {};
};

$todd.GetCalculateTextStyles = function()
{
  return Object.keys($todd.textsize.styles);
};

$todd.CalculateSize=function(node)
{
  if (!$todd.calcsizenode)
  {
    $todd.calcsizenode = dompack.create("div", { style: { "backgroundColor": "#ffffff"
                                                        , color: "#000000"
                                                        , position: "absolute"
                                                        , visibility: "hidden" // Comment this out for debugging
                                                        , width: '1px' //Encourage content collapsing (shrink-wrap)
                                                        }});
    dompack.qS('#todd-measurements').appendChild($todd.calcsizenode);
  }
  $todd.calcsizenode.appendChild(node);
  var size = node.getBoundingClientRect();
  node.remove();
  return { x: Math.ceil(size.width), y: Math.ceil(size.height) };
};

// text: string with text to calculate size for
// width: maximum width in pixels for wrapping text, or 0 for no wrapping
// styles: getStyle-compatible object with font/text settings
$todd.CalculateTextSize = function(text, width, styles, ishtml)
{
  if (!$todd.textsize.node)
  {
    $todd.textsize.node = dompack.create("div", { style: { "backgroundColor": "#ffffff"
                                                         , color: "#000000"
                                                         , position: "absolute"
                                                         , visibility: "hidden" // Comment this out for debugging
                                                         }
                                                });
    dompack.qS('#todd-measurements').appendChild($todd.textsize.node);
  }

  if (typeof (text) != "string")
    text = "";
  if (typeof (width) != "number")
    width = 0;

  // Apply only the sanctioned styles
  var applystyles = $todd.textsize.styles;
  if (typeof (styles) == "object")
  {
    // merge modifies the first argument, so clone it first
    applystyles = { ...applystyles
                  };
    // take the subset of styles we seem to care about
    $todd.GetCalculateTextStyles().forEach(subsetstyle =>
    {
      if(subsetstyle in styles)
        applystyles[subsetstyle] = styles[subsetstyle];
    });
  }

  // Check if we have calculated this before
  var key = encodeURIComponent(text) + "\t" + width + "\t" + JSON.stringify(applystyles) + "\t" + (ishtml?1:0);
  var size = $todd.textsize.cache[key];
  if (size)
    return size;

  // Set node width if specified
  if (width)
  {
    $todd.textsize.node.style.width = width + 'px';
    $todd.textsize.node.style.whiteSpace = "normal";
  }
  else
  {
    $todd.textsize.node.style.width = "auto";
    $todd.textsize.node.style.whiteSpace = "nowrap";
  }

  dompack.setStyles($todd.textsize.node, applystyles);

  // Calculate and cache text size
  $todd.textsize.node[ishtml ? "innerHTML" : "textContent"] = text;
  var rect = $todd.textsize.node.getBoundingClientRect();
  // Rounding up here to avoid returning rounded-down values which would result in elements too small to contain the given text
  // (getBoundingClientRect should return frational values, and not return rounded values)
  size = { x: Math.ceil(rect.width)
         , y: Math.ceil(rect.height)
         };
  $todd.textsize.cache[key] = size;
  return size;
};

$todd.ReadSize = function(sizeval)
{
  if(!sizeval)
    return null;
  if(sizeval.substr(sizeval.length-2)=='gr')
    return { type: 5, size: parseInt(sizeval, 10) };
  if(sizeval.substr(sizeval.length-2)=='px')
    return { type: 2, size: parseInt(sizeval, 10) };
  if(sizeval.substr(sizeval.length-2)=='pr')
    return { type: 1, size: parseInt(sizeval, 10) };
  if(sizeval.substr(sizeval.length-1)=='x')
    return { type: 3, size: parseInt(sizeval, 10) };
  if(sizeval=='sp')
    return { type: 4, size: 1 };
  return null;
};
$todd.IsAbsoluteParsedSize = function(size)
{
  return size && size.type != 1;
};

// Return the set width/height, or the xml width/height, for a component's size object
$todd.ReadSetWidth = function(sizeobj)
{
  return $todd.ReadSetSize(sizeobj, true);
};
$todd.ReadSetHeight = function(sizeobj)
{
  return $todd.ReadSetSize(sizeobj, false);
};
$todd.ReadSetSize = function(sizeobj, horizontal)
{
  var size = sizeobj.new_set;
  if (size === null)
  {
    var xml = $todd.ReadSize(sizeobj.xml_set);
    size = $todd.IsFixedSize(sizeobj.xml_set) ? $todd.CalcAbsSize(xml, horizontal) : 0;
  }
  return size;
};
$todd.CalcAbsWidth = function(size)
{
  return $todd.CalcAbsSize(size, true);
};
//Calculate the absolute height for a block element (where 2gr = 56)
$todd.CalcAbsHeight = function(size)
{
  return $todd.CalcAbsSize(size, false);
};
//Calculate the absolute height for an inline element (where 2gr = 51)
$todd.CalcAbsInlineHeight = function(size)
{
  return $todd.CalcAbsSize(size, false, true);
};
$todd.CalcAbsSize = function(size, horizontal, inline)
{
  if (!size)
    return 0;

  if (typeof(size) == "number")
    return size;

  if (typeof(size) == "string") // XML size specification
  {
    if(size.substr(size.length-2) == 'px')
      return parseInt(size, 10);
    if(size.substr(size.length-2) == 'gr')
    {
      if(horizontal)
      {
        console.error("'gr' units not supported horizontally");
        if($todd.intolerant)
          throw new Error("'gr' units not supported horizontally");
      }

      return parseInt(size, 10) * $todd.gridlineHeight - (inline ? $todd.gridlineTotalMargin : 0);
    }
    if(size.substr(size.length-1) == 'x')
    {
      if (horizontal)
        return parseInt(size, 10) * $todd.desktop.x_width;
      // Round to grid size
      return $todd.UpToGridsize(parseInt(size, 10) * $todd.desktop.x_height);
    }
    if(size == 'sp')
      return $todd.settings.spacerwidth;
    return parseInt(size, 10);
  }

  if (typeof(size) == "object") // Internal size record (as returned by ReadSize)
  {
    if (size.type == 2)
      return size.size;
    if (size.type == 3)
    {
      if (horizontal)
        return size.size * $todd.desktop.x_width;
      return $todd.UpToGridsize(size.size * $todd.desktop.x_height);
    }
    if (size.type == 4)
      return $todd.settings.spacerwidth;
    if (size.type == 5) //'gr'
      return parseInt(size, 10) * $todd.gridlineHeight - (inline ? $todd.gridlineTotalMargin : 0);
  }

  return 0;
};

$todd.IsFixedSize = function(size)
{
  return size && (size.substr(size.length-1)=='x' //matches both 'px' and 'x' :)
                  || size.substr(size.length-2)=='gr'
                  || size=='sp'
                  || ((parseInt(size) + "") == size) // matches numbers in strings
                  );
};

function readXMLSize(min, set, iswidth, inline)
{
  // Initialize width settings (ADDME switch all code to use xml_set_parsed?)
  return { xml_min:         iswidth ? $todd.CalcAbsWidth(min) : inline ? $todd.CalcAbsInlineHeight(min) : $todd.CalcAbsHeight(min) // min width as set by xml
         , xml_set:         set // width as set by xml (absolute or proportional size)
         , xml_set_parsed:  $todd.ReadSize(set)
         , servermin:       min //The unparsed versions. deprecate xml_min,xml_set,xml_min_parsed!
         , serverset:       set
         , dirty:           true // calc should be recalculated
         , min:             0 // min required width
         , calc:            0 // calculated width
         , set:             0 // allocated width
         , new_set:         null
         };
}

//ADDME why can't we receive widths already in the proper format as much as possible?
$todd.ReadXMLWidths = function(xmlnode) //xmlnode may be null to init a default width object
{
  return readXMLSize(xmlnode && xmlnode.minwidth ? xmlnode.minwidth : ''
                    ,xmlnode && xmlnode.width ? xmlnode.width : ''
                    ,true
                    );
};
$todd.ReadXMLHeights = function(xmlnode, inline)
{
  return readXMLSize(xmlnode && xmlnode.minheight ? xmlnode.minheight : ''
                    ,xmlnode && xmlnode.height ? xmlnode.height : ''
                    ,false
                    ,inline
                    );
};


/****************************************************************************************************************************
 * Events
 */

$todd.highpriority = false;
$todd.mousedragthreshold = 3; // Amount of pixels to move before drag kicks in
$todd.globalevents = {}; // Global event handlers

// Fallback settings for user preferences
$todd.fallback =
  { lang: "en"
  , dateformat: "%d-%m-%Y"
  , timeformat: "%H:%M"
  };

// Desktop properties, will be calculated after initialization (and on resizing/zooming)
$todd.desktop =
  { node: null
    // Dimensions
  , top: 0
  , left: 0
  , width: 0
  , height: 0
    // Orientation
  , orientation: 0          // Browser orientation (portable devices) in degrees
  , portrait: true          // If device is oriented vertically
  , landscape: false        // If device is oriented horizontally
    // x dimensions
  , x_width: 7              // The width of an 'x' character
  , x_height: 16             // The (line) height of an 'x' character
  };

$todd.uploadmethod = '';
$todd.downloadmethod = '';
$todd.tolliumservice = '';


/****************************************************************************************************************************
 * Window events
 */

$todd.mouse = { clickstatus: null
              , hoverstatus: { tooltipshowtimeout: null
                             , tooltiphidetimeout: null
                             , curcomp: null
                             , dragcomp: null
                             }
              , dragstatus: null
              };


$todd.globalevents.OnDragFiles = function(event)
{
  // We want to handle this ourselves
  event.preventDefault();
};

/****************************************************************************************************************************
 * Globally unique id's
 */

$todd.globalidcounter = 0;
$todd.getGlobalId = function()
{
  return (++$todd.globalidcounter).toString(16); //FIXME deprecate
};


/****************************************************************************************************************************
 * Some experimental and implementation test functions
 */

$todd.componentsToMessages=function(components)
{
  /* ADDME: updateScreen is currently an attempt at a 'prettier' API for screen management but we should probably merge with processMessages eventually (perhaps todd controller should change its format)
   */
  var messages=[];
  Object.keys(components).forEach(name =>
    {
      let obj = components[name];
      if(!obj.messages || Object.keys(obj).length>1) //not only sending messages
      {
        var compmsg = {...obj
                      , instr: "component"
                      , target: name
                      , type: obj.type || '-shouldalreadyexist'
                      , name: name
                      , width: obj.width
                      , height: obj.height
                      , minwidth: obj.minwidth
                      , minheight: obj.minheight
                      , enabled: obj.enabled !== false
                      };
        delete compmsg.messages;
        messages.push(compmsg);
      }

      if(obj.messages)
        obj.messages.forEach(msg =>
        {
          var copymsg = { ...msg
                        , msg: 'message'
                        , target: name
                        }; //FIXME copying is probably overkill, but i'm trying to avoid touching source objects.. need to better align various syntaxes

          messages.push(copymsg);
        });
    });

  return messages;
};

$todd.IsDebugTypeEnabled = function(type)
{
  return enabledlogtypes.includes('all') || enabledlogtypes.includes(type);
};

$todd.DebugTypedLog = function(target)
{
  var type;
  if (typeof(target) == "string")
  {
    target = target.split(":");
    type = target[0];
    if (target.length > 1)
      target = target[1];
  }

  if (typeof(target) != "string" || !([ "log", "info", "warn", "error" ].includes(target)))
    target = "log";

  // Check if the requested type should be shown
  if (!$todd.IsDebugTypeEnabled(type))
    return;

  // Strip first element (type) from arguments
  var args = Array.prototype.slice.call(arguments);
  args.splice(0, 1);
  console[target].apply(console, args);
};

function checkLogTypes()
{
  // Check for specific debug log types (see DebugTypedLog)
  if (document.location.hash)
  {
    var hash = document.location.hash.substr(1);
    enabledlogtypes = hash.split(",");
  }

  if (enabledlogtypes.includes('all'))
    console.warn("Showing all typed debug messages");
  else if (enabledlogtypes.length)
  {
    console.warn("Showing typed debug messages with types " + enabledlogtypes.join(", "));
  }
}

/* The CSS Color Module Working Draft[1] defines hex notation for RGB color with an alpha value, but these are not supported
   by (all?) browser (yet?). This functions rewrites them to rgba() notation.
   [1] https://drafts.csswg.org/css-color/#hex-notation
   https://caniuse.com/#search=rgba - IE11 still fails */
$todd.fixupColor = function(color)
{
  if (color.match(/\#[0-9a-z]{8}$/))
  {
    return "rgba(" + parseInt(color.substr(1, 2), 16) + ","
         + parseInt(color.substr(3, 2), 16) + ","
         + parseInt(color.substr(5, 2), 16) + ","
         + (parseInt(color.substr(7, 2), 16) / 255) + ")";
  }
  if (color.match(/\#[0-9a-z]{4}$/))
  {
    return "rgba(" + parseInt(color.substr(1, 1) + color.substr(1, 1), 16) + ","
         + parseInt(color.substr(2, 1) + color.substr(2, 1), 16) + ","
         + parseInt(color.substr(3, 1) + color.substr(3, 1), 16) + ","
         + (parseInt(color.substr(4, 1) + color.substr(4, 1), 16) / 255) + ")";
  }
  return color;
};


/** @short
    @param flags The flags which must be checked against (useually gathered from selected options/rows)
                 For example:
                 [{ selectable := true,  hasurl := false }
                 ,{ selectable := false, hasurl := false }
                 ]
    @param checkflags Array of string's with the name of flags which must match to enable
                      A flag starting with '!' means that to match the flag must NOT TRUE (meaning FALSE) in each object in the 'flags' array.
                      Otherwise it's a match if the flag is TRUE in all objects in the flags array.
    @param min minimum amount of items in the flags list
    @param max maximum amount of items in the flags list
    @param selectionmatch ("all", "any")
    @return whether the action should be enabled (all checkflags match each item in flags)
*/
$todd.checkEnabledFlags = function(flags, checkflags, min, max, selectionmatch) //FIXME rename and move out of Screen... compbase?
{
  // This code should be synchronized with checkEnabledFlags in tollium/include/internal/support.whlib
  $todd.DebugTypedLog("actionenabler", "- - Checking checkflags ["+checkflags.join(", ")+"], "+flags.length+" in ["+min+","+(max >= 0 ? max+"]" : "->")+" ("+selectionmatch+")");

  // Check correct number of selected items
  if (flags.length < min || (max >= 0 && flags.length > max))
  {
    $todd.DebugTypedLog("actionenabler", "- - Wrong number of selected items ("+flags.length+"), action should be disabled");
    return false;
  }

  // This action is enabled if the flags are enabled for each selected item
  // If the checkflags for this action are empty, the action is always enabled
  // (the right number of items is already selected) and the selected flags
  // don't have to be checked, so i is initialized with the length of the
  // selected flags.
  if (checkflags.length == 0 || (checkflags.length == 1 && checkflags[0] == ''))
  {
    $todd.DebugTypedLog("actionenabler", "- - No checkflags, action should be enabled");
    return true;
  }
  var i = 0;
  var any = false;
  for (; i < flags.length; ++i)
  {
    if (!flags[i])
    {
      $todd.DebugTypedLog("actionenabler", "- - Flag "+i+" undefined, continue to next flag");
      break;
    }
    var j = 0;
    for (; j < checkflags.length; ++j)
    {
      var checkflag = checkflags[j];
      var checkvalue = true;
      if (checkflag.charAt(0) == '!')
      {
        checkflag = checkflag.slice(1);
        checkvalue = false;
      }
      $todd.DebugTypedLog("actionenabler", "- - Checkflag '"+checkflag+"': "+flags[i][checkflag]+"="+checkvalue+"?");
      if (flags[i][checkflag] != checkvalue)
      {
        $todd.DebugTypedLog("actionenabler", "- - Checkflag '"+checkflag+"' not enabled for selected item "+i);
        break;
      }
    }
    if (j < checkflags.length)
    {
      // This item does not match, so if all must match, the action should be disabled
      if (selectionmatch == "all")
        break;
    }
    else if (selectionmatch == "any")
    {
      // This item does match, so if any must match, the action should be enabled
      any = true;
      break;
    }
  }
  // If selectionmatch = "all", i should point beyond the end of the flags list (all items are checked and all passed)
  // If selectionmatch = "any", any should be true
  var enabled = (selectionmatch == "all" && i >= flags.length) || (selectionmatch == "any" && any);
  $todd.DebugTypedLog("actionenabler", "- - Action should be "+(enabled ? "enabled" : "disabled"));
  return enabled;
};

export default $todd;
window.__todd = $todd; //test framework currently requires it. FIX THAT

checkLogTypes();
window.addEventListener("hashchange", checkLogTypes);
