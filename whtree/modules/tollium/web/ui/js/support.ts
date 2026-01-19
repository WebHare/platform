import * as dompack from '@webhare/dompack';
import * as whintegration from '@mod-system/js/wh/integration';
import type { ApplicationBase } from './application';
import { debugFlags } from '@webhare/env';
import type { FlagSet, SelectionMatch, TolliumMessage } from './types';
import type { ObjFrame } from '@mod-tollium/webdesigns/webinterface/components/frame/frame';

// eslint-disable-next-line @typescript-eslint/no-require-imports
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
export const debugTargets = ["distribute", "actionenabler", "rpc", "communication", "messages", "ui", "dimensions", "all"] as const;
export type DebugTarget = typeof debugTargets[number];

const enabledlogtypes = new Set<DebugTarget>;

export const gridlineTopMargin = 2; // pixels to add to the top of a grid line
export const gridlineBottomMargin = 3; // pixels to add to the bottom of a grid line
export const gridlineTotalMargin = gridlineTopMargin + gridlineBottomMargin;
export const gridlineHeight = 28; //grid vertical size (28 pixels) including margins
export const gridlineInnerHeight = gridlineHeight - gridlineTotalMargin;
export const gridlineSnapMax = 8; //never add more than this amount of pixels to snap. an attempt to prevent inlineblocks from wildly generating empty space. this is mostly manually tuning and maybe we shouldn't do it

export const settings =
{
  tab_stacked_vpadding_inactive: 1, // border-bottom: 1px (only for inactive!)
  textedit_defaultwidth: 150,
  list_column_padding: 8, // 2x4 padding
  list_column_minwidth: 24, // minimum width for an icon (16) + 2x4 padding
  gridline_topmargin: gridlineTopMargin,
  gridline_bottommargin: gridlineBottomMargin, // pixels to add to the top of a grid line
  grid_vsize: gridlineHeight, //grid vertical size (28 pixels) including margins
  tabspace_vsize: 32, //vertical size inside the tab-space layout

  //size of spacers in a sync with apps.scss. SYNC-SPACERS/SYNC-SPACERS-DEBUG
  spacer_top: 10,
  spacer_bottom: 10,
  spacer_left: 10,
  spacer_right: 10,
  //margin between line components. SYNC-SPACERWIDTH
  spacerwidth: 4,
  //size of spacers in a sync with apps.scss. SYNC-BORDERS
  border_top: 1,
  border_bottom: 1,
  border_left: 1,
  border_right: 1,

  listview_padleft: 8,
  listview_padright: 8,
  listview_checkboxholder_width: 20,
  listview_expanderholder_width: 12, //
  listview_iconholder_width: 20,     // iconholder (image 16px + margin 4px)

  fullscreen_maxx: 0.9, //maximum fraction of x width to use for fullscreen windows
  fullscreen_maxy: 1.0, //maximum fraction of y height to use for fullscreen windows

  buttonheight_intoolbar: 72,
  buttonheight_intabsspace: 27

};

export const applicationstack: ApplicationBase[] = [];
export const applications: ApplicationBase[] = [];
export const resourcebase = new URL(whintegration.config.obj.toddroot as string, location.href).toString();
export const customactions: Record<string, (data: { action: string; screen: ObjFrame }) => void> = {};

export function getActiveApplication() {
  return applicationstack.at(-1);
}


/****************************************************************************************************************************
 * Layout
 */

export interface Size {
  x: number;
  y: number;
}

export const textsize = {
  cache: {} as Record<string, Size>,
  styles: {
    "font-size": "",
    "font-style": "",
    "font-weight": "",
    "text-decoration": ""
  }
};

export function UpToGridsize(size: number, gridsize?: number) {
  if (!gridsize || gridsize <= 1)
    return size;

  const remainder = size % gridsize;
  if (remainder !== 0)
    size += gridsize - remainder;
  return size;
}



export function ResetCachedTextSizes() {
  textsize.cache = {};
}

let calcsizenode: HTMLDivElement | undefined;
export function CalculateSize(node: HTMLElement): Size {
  // if(@canvas)

  if (!calcsizenode) {
    calcsizenode = dompack.create("div", {
      style: {
        "backgroundColor": "#ffffff",
        color: "#000000",
        position: "absolute",
        visibility: "hidden", // Comment this out for debugging
        width: '1px' //Encourage content collapsing (shrink-wrap)
      }
    });
    dompack.qR('#todd-measurements').appendChild(calcsizenode);
  }
  calcsizenode.appendChild(node);
  const size = node.getBoundingClientRect();
  node.remove();
  return { x: Math.ceil(size.width), y: Math.ceil(size.height) };
}

/** @param text - string with text to calculate size for
 * @param width - maximum width in pixels for wrapping text, or 0 for no wrapping
 * @param fontSize - override font size
 *
*/
let textsizenode: HTMLDivElement | undefined;
export function calculateTextSize(text: string, { width = 0, fontSize = "" } = {}) {
  if (!textsizenode) {
    textsizenode = dompack.create("div", {
      style: {
        "backgroundColor": "#ffffff",
        color: "#000000",
        position: "absolute",
        visibility: "hidden" // Comment this out for debugging
      }
    });
    dompack.qR('#todd-measurements').appendChild(textsizenode);
  }

  //apparently people are doing this? fix the callers!
  if (typeof (text) !== "string")
    throw new Error("Shouldn't pass non-strings to calculateTextSize");
  if (typeof (width) !== "number")
    throw new Error("Shouldn't pass non-numbers to calculateTextSize");

  // Check if we have calculated this before
  const key = encodeURIComponent(text) + "\t" + width + "\t" + fontSize;
  let size = textsize.cache[key];
  if (size)
    return size;

  textsizenode.style.fontSize = fontSize;
  textsizenode.style.width = width ? width + 'px' : "auto";
  textsizenode.style.whiteSpace = width ? "normal" : "nowrap";
  textsizenode.textContent = text;

  const rect = textsizenode.getBoundingClientRect();
  // Rounding up here to avoid returning rounded-down values which would result in elements too small to contain the given text
  // (getBoundingClientRect should return frational values, and not return rounded values)
  size = {
    x: Math.ceil(rect.width),
    y: Math.ceil(rect.height)
  };
  textsize.cache[key] = size;
  return size;
}

type ReadSizeResult = { type: 1 | 2 | 3 | 4 | 5; size: number };

export function ReadSize(sizeval: string): ReadSizeResult | null {
  if (!sizeval)
    return null;
  if (sizeval.substr(sizeval.length - 2) === 'gr')
    return { type: 5, size: parseInt(sizeval, 10) };
  if (sizeval.substr(sizeval.length - 2) === 'px')
    return { type: 2, size: parseInt(sizeval, 10) };
  if (sizeval.substr(sizeval.length - 2) === 'pr')
    return { type: 1, size: parseInt(sizeval, 10) };
  if (sizeval.substr(sizeval.length - 1) === 'x')
    return { type: 3, size: parseInt(sizeval, 10) };
  if (sizeval === 'sp')
    return { type: 4, size: 1 };
  return null;
}

// Return the set width/height, or the xml width/height, for a component's size object
export function ReadSetWidth(sizeobj: SizeObj) {
  return ReadSetSize(sizeobj, true);
}
export function ReadSetHeight(sizeobj: SizeObj) {
  return ReadSetSize(sizeobj, false);
}
export function ReadSetSize(sizeobj: SizeObj, horizontal: boolean) {
  let size = sizeobj.new_set;
  if (size === null) {
    const xml = ReadSize(sizeobj.xml_set);
    size = IsFixedSize(sizeobj.xml_set) ? CalcAbsSize(xml, horizontal) : 0;
  }
  return size;
}
export function calcAbsWidth(size: number | string | ReadSizeResult) {
  return calcAbsSize(size, true);
}
export const CalcAbsWidth = calcAbsWidth;

//Calculate the absolute height for a block element (where 2gr = 56)
export function CalcAbsHeight(size: number | string | ReadSizeResult) {
  return calcAbsSize(size, false);
}
//Calculate the absolute height for an inline element (where 2gr = 51)
export function CalcAbsInlineHeight(size: string) {
  return calcAbsSize(size, false, true);
}
export function calcAbsSize(size: number | string | ReadSizeResult | null, horizontal: boolean, inline?: boolean) {
  if (!size)
    return 0;

  if (typeof (size) === "number")
    return size;

  if (typeof (size) === "string") { // XML size specification
    if (size.endsWith('px'))
      return parseInt(size, 10);
    if (size.endsWith('gr')) {
      if (horizontal) {
        console.error("'gr' units not supported horizontally");
        if (debugFlags.col)
          throw new Error("'gr' units not supported horizontally");
      }

      return parseInt(size, 10) * gridlineHeight - (inline ? gridlineTotalMargin : 0);
    }
    if (size.substr(size.length - 1) === 'x') {
      if (horizontal)
        return parseInt(size, 10) * desktop.x_width;
      // Round to grid size
      return UpToGridsize(parseInt(size, 10) * desktop.x_height);
    }
    if (size === 'sp')
      return settings.spacerwidth;
    return parseInt(size, 10);
  }

  if (typeof (size) === "object") { // Internal size record (as returned by ReadSize)
    if (size.type === 2)
      return size.size;
    if (size.type === 3) {
      if (horizontal)
        return size.size * desktop.x_width;
      return UpToGridsize(size.size * desktop.x_height);
    }
    if (size.type === 4)
      return settings.spacerwidth;
    if (size.type === 5) //'gr' FIXME prune. the code here contained a fatal bug so this if() was never followed in practice.
      return size.size * gridlineHeight - (inline ? gridlineTotalMargin : 0);
  }

  return 0;
}
export const CalcAbsSize = calcAbsSize;

export function isFixedSize(size: string) {
  return size && (size.substr(size.length - 1) === 'x' //matches both 'px' and 'x' :)
    || size.substr(size.length - 2) === 'gr'
    || size === 'sp'
    || ((String(parseInt(size))) === size) // matches numbers in strings
  );
}
export const IsFixedSize = isFixedSize;

export interface SizeObj {
  serverset: string;
  calc: number;
  /** min width as set by xml */
  xml_min: number;
  /** width as set by xml (absolute or proportional size) */
  xml_set: string;
  xml_set_parsed: ReadSizeResult | null;
  /** The unparsed versions. deprecate xml_min,xml_set,xml_min_parsed! */
  servermin: string;
  /** Whether 'calc' should be recalculated */
  dirty: boolean;
  min: number;
  new_set: number | null;
  isinline?: boolean;
  pref?: number;
  prop?: number;
  set: number;
}

function readXMLSize(min: string, set: string, iswidth: boolean, inline: boolean): SizeObj {
  // Initialize width settings (ADDME switch all code to use xml_set_parsed?)
  return {
    xml_min: iswidth ? CalcAbsWidth(min) : inline ? CalcAbsInlineHeight(min) : CalcAbsHeight(min),
    xml_set: set, // width as set by xml (absolute or proportional size)
    xml_set_parsed: ReadSize(set),
    servermin: min, //The unparsed versions. deprecate xml_min,xml_set,xml_min_parsed!
    serverset: set,
    dirty: true, // calc should be recalculated
    min: 0, // min required width
    calc: 0, // calculated width
    set: 0, // allocated width
    new_set: null
  };
}

export interface XMLWidthAttributes {
  minwidth?: string;
  width?: string;
}
export interface XMLHeightAttributes {
  minheight?: string;
  height?: string;
}

//ADDME why can't we receive widths already in the proper format as much as possible?
export function ReadXMLWidths(xmlnode: XMLWidthAttributes): SizeObj { //xmlnode may be null to init a default width object
  return readXMLSize(xmlnode && xmlnode.minwidth ? xmlnode.minwidth : '',
    xmlnode && xmlnode.width ? xmlnode.width : '',
    true,
    false
  );
}
export function ReadXMLHeights(xmlnode: XMLHeightAttributes, inline: boolean): SizeObj {
  return readXMLSize(xmlnode && xmlnode.minheight ? xmlnode.minheight : '',
    xmlnode && xmlnode.height ? xmlnode.height : '',
    false,
    inline
  );
}


/****************************************************************************************************************************
 * Events
 */

// Desktop properties, will be calculated after initialization (and on resizing/zooming)
export const desktop =
{
  node: null,
  // Dimensions
  top: 0,
  left: 0,
  width: 0,
  height: 0,
  // Orientation
  orientation: 0,          // Browser orientation (portable devices) in degrees
  portrait: true,          // If device is oriented vertically
  landscape: false,        // If device is oriented horizontally
  // x dimensions
  x_width: 7,              // The width of an 'x' character
  x_height: 16             // The (line) height of an 'x' character
};


/****************************************************************************************************************************
 * Some experimental and implementation test functions
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- This API is hard to make meaningfully typesafe. We should reconsider the entire approach - why not let frontend apps directly instantiate the needed components ?
export type ComponentsForMessages = Record<string, any>;

export function componentsToMessages(components: ComponentsForMessages): TolliumMessage[] {
  /* ADDME: updateScreen is currently an attempt at a 'prettier' API for screen management but we should probably merge with processMessages eventually (perhaps todd controller should change its format)
   */
  const messages: TolliumMessage[] = [];
  Object.keys(components).forEach(name => {
    const obj = components[name];
    if (!obj.messages || Object.keys(obj).length > 1) { //not only sending messages
      const compmsg = {
        ...obj,
        instr: "component",
        target: name,
        type: obj.type || '-shouldalreadyexist',
        name: name,
        width: obj.width,
        height: obj.height,
        minwidth: obj.minwidth,
        minheight: obj.minheight,
        enabled: obj.enabled !== false
      };
      delete compmsg.messages;
      messages.push(compmsg);
    }

    if (obj.messages)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see functionlevel comment
      obj.messages.forEach((msg: any) => {
        const copymsg = {
          ...msg,
          msg: 'message',
          target: name
        }; //FIXME copying is probably overkill, but i'm trying to avoid touching source objects.. need to better align various syntaxes

        messages.push(copymsg);
      });
  });

  return messages;
}

export function isDebugTypeEnabled(target: DebugTarget) {
  if (target === "all" || !debugTargets.includes(target))
    throw new Error(`Invalid debug type: ${target}`);

  return enabledlogtypes.has('all') || enabledlogtypes.has(target) || debugFlags["tollium-" + target];
}
export const IsDebugTypeEnabled = isDebugTypeEnabled;

/** @param target - Debug target. (Used to accept a colon separated list but that's no longer used anywhere) */
export function DebugTypedLog(target: DebugTarget, ...args: unknown[]) {
  // Check if the requested type should be shown
  if (!IsDebugTypeEnabled(target))
    return;

  // Strip first element (type) from arguments
  console.log(`[${target}]`, ...args);
}

function checkLogTypes() {
  // Check for specific debug log types (see DebugTypedLog)
  if (document.location.hash) {
    const hash = document.location.hash.substring(1);
    enabledlogtypes.clear();
    for (const tok of hash.split(","))
      if (debugTargets.includes(tok as DebugTarget))
        enabledlogtypes.add(tok as DebugTarget);
  }

  if (enabledlogtypes.has('all'))
    console.warn("Showing all typed debug messages");
  else if (enabledlogtypes.size) {
    console.warn("Showing typed debug messages with types " + [...enabledlogtypes.values()].join(", "));
  }
}

/* The CSS Color Module Working Draft[1] defines hex notation for RGB color with an alpha value, but these are not supported
   by (all?) browser (yet?). This functions rewrites them to rgba() notation.
   [1] https://drafts.csswg.org/css-color/#hex-notation
   https://caniuse.com/#search=rgba - IE11 still fails */
export function fixupColor(color: string) {
  if (color.match(/#[0-9a-z]{8}$/)) {
    return "rgba(" + parseInt(color.substr(1, 2), 16) + ","
      + parseInt(color.substr(3, 2), 16) + ","
      + parseInt(color.substr(5, 2), 16) + ","
      + (parseInt(color.substr(7, 2), 16) / 255) + ")";
  }
  if (color.match(/#[0-9a-z]{4}$/)) {
    return "rgba(" + parseInt(color.substr(1, 1) + color.substr(1, 1), 16) + ","
      + parseInt(color.substr(2, 1) + color.substr(2, 1), 16) + ","
      + parseInt(color.substr(3, 1) + color.substr(3, 1), 16) + ","
      + (parseInt(color.substr(4, 1) + color.substr(4, 1), 16) / 255) + ")";
  }
  return color;
}


/** @param flags - The flags which must be checked against (useually gathered from selected options/rows)
                 For example:
                 [\{ selectable := true,  hasurl := false \}
                 ,\{ selectable := false, hasurl := false \}
                 ]
    @param checkflags - Array of string's with the name of flags which must match to enable
                      A flag starting with '!' means that to match the flag must NOT TRUE (meaning FALSE) in each object in the 'flags' array.
                      Otherwise it's a match if the flag is TRUE in all objects in the flags array.
    @param max - maximum amount of items in the flags list
    @param min - minimum amount of items in the flags list
    @param selectionmatch - ("all", "any")
    @returns whether the action should be enabled (all checkflags match each item in flags)
*/
export function checkEnabledFlags(flags: FlagSet, checkflags: string[], min: number, max: number, selectionmatch: SelectionMatch) { //FIXME rename and move out of Screen... compbase?
  // This code should be synchronized with checkEnabledFlags in tollium/include/internal/support.whlib
  DebugTypedLog("actionenabler", "- - Checking checkflags [" + checkflags.join(", ") + "], " + flags.length + " in [" + min + "," + (max >= 0 ? max + "]" : "->") + " (" + selectionmatch + ")");

  // Check correct number of selected items
  if (flags.length < min || (max >= 0 && flags.length > max)) {
    DebugTypedLog("actionenabler", "- - Wrong number of selected items (" + flags.length + "), action should be disabled");
    return false;
  }

  // This action is enabled if the flags are enabled for each selected item
  // If the checkflags for this action are empty, the action is always enabled
  // (the right number of items is already selected) and the selected flags
  // don't have to be checked, so i is initialized with the length of the
  // selected flags.
  if (checkflags.length === 0 || (checkflags.length === 1 && checkflags[0] === '')) {
    DebugTypedLog("actionenabler", "- - No checkflags, action should be enabled");
    return true;
  }
  let i = 0;
  let any = false;
  for (; i < flags.length; ++i) {
    if (!flags[i]) {
      DebugTypedLog("actionenabler", "- - Flag " + i + " undefined, continue to next flag");
      break;
    }
    let j = 0;
    for (; j < checkflags.length; ++j) {
      let checkflag = checkflags[j];
      let checkvalue = true;
      if (checkflag.charAt(0) === '!') {
        checkflag = checkflag.slice(1);
        checkvalue = false;
      }
      DebugTypedLog("actionenabler", "- - Checkflag '" + checkflag + "': " + flags[i][checkflag] + "=" + checkvalue + "?");
      if (flags[i][checkflag] !== checkvalue) {
        DebugTypedLog("actionenabler", "- - Checkflag '" + checkflag + "' not enabled for selected item " + i);
        break;
      }
    }
    if (j < checkflags.length) {
      // This item does not match, so if all must match, the action should be disabled
      if (selectionmatch === "all")
        break;
    } else if (selectionmatch === "any") {
      // This item does match, so if any must match, the action should be enabled
      any = true;
      break;
    }
  }
  // If selectionmatch = "all", i should point beyond the end of the flags list (all items are checked and all passed)
  // If selectionmatch = "any", any should be true
  const enabled = (selectionmatch === "all" && i >= flags.length) || (selectionmatch === "any" && any);
  DebugTypedLog("actionenabler", "- - Action should be " + (enabled ? "enabled" : "disabled"));
  return enabled;
}

if (typeof window !== "undefined") {
  checkLogTypes();
  window.addEventListener("hashchange", checkLogTypes);
}
