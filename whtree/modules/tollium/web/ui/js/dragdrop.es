/**
@import * as dragdrop from '@mod-tollium/web/ui/js/dragdrop';
*/

import * as browser from 'dompack/extra/browser';
import KeyboardHandler from "dompack/extra/keyboard";

// Our custom data url
var webharedataurl = "webhare://data/";

// The custom data type we're using to store our drag and drop data
const webharedatatypebase = "x-webhare/data/";
const webharedatatype = webharedatatypebase + Math.floor(Math.random() * 42949672965).toString(16); // 32 bits of entropy

// IE doesn't seem to support setting "url", so we'll fall back to "text"
const fallbackdatatype = "Text";

/// Effects, ordered so that the combination of effect[x] and effect[y] is effect[x | y]
const effectstrs = [ 'none', 'copy', 'move', 'copyMove', 'link', 'copyLink', 'linkMove', 'all' ];

function isDropEffectAllowed(dropEffect, effectAllowed)
{
  const mask = effectstrs.indexOf(effectAllowed === "uninitialized" ? "all" : effectAllowed);
  const pos = effectstrs.indexOf(dropEffect);
  return pos >= 0 && (mask & pos);
}

function getDefaultDropEffect(event, effectAllowed)
{
  let dropeffect = "none";

  /* safari and chrome on mac reset the effectAllowed based on the modifier keys.
     Getting default drop effect will handle that case
  */
  // Get default drop effect for allowed effects
  for (let effect of [ "move", "copy", "link" ])
    if (isDropEffectAllowed(effect, effectAllowed))
    {
      dropeffect = effect;
      break;
    }

  // get the keyboard override, apply it when effectAllowed allows it (so safari will be handled correctly)
  const keyboardoverride = KeyboardHandler.getDragModeOverride(event);
  if (keyboardoverride && isDropEffectAllowed(keyboardoverride, effectAllowed))
    dropeffect = keyboardoverride;

  return dropeffect;
}

export function fixupDNDEvent(event)
{
  if (event.type === "dragend")
    return;

  /* FireFox adjusts the dropeffect based on the pressed keys. Chrome, Safari and IE don't, so just
     implement that behaviour for them. Also, override the mouse cursor in IE
  */
  if ((event.type == 'drop' || event.type.indexOf('drag') == 0) && browser.getName()!='firefox')
  {
    // Set default drop effect for allowed effects
    let effectAllowed = "all";
    try
    {
      // IE 11 throws when accessing effectAllowed while dragging content from another document
      effectAllowed = event.dataTransfer.effectAllowed;
    }
    catch (e)
    { }

    event.dataTransfer.dropEffect = getDefaultDropEffect(event, effectAllowed);
  }

  // Chrome workaround for bug https://bugs.chromium.org/p/chromium/issues/detail?id=808344
  if (event.type === "dragstart" && browser.getName() === 'chrome')
  {
    // Chromium auto-cancels the drag without dragend event when the current *selection* lies in a password field
    const range = document.getSelection();
    if (range
        && range.anchorNode
        && range.baseNode === range.extentNode
        && range.baseOffset === range.extentOffset
        && range.anchorNode.nodeType === 1
        && range.anchorNode.querySelector("input[type=password]"))
    {
      // Just remove the selection, losing selection in a password field shouldn't be that bad when dragging something
      range.removeAllRanges();
    }
  }
}


// Retrieve the WebHare data stored from our custom data url
function getWebHareData(event)
{
  // Get the event's dataTransfer object
  const transfer = event.dataTransfer;
  if (!transfer)
    return;

  // Determine the type to retrieve
  let gettype = webharedatatype;
  for (let type of Array.from(transfer.types))
    if (type.startsWith(webharedatatypebase))
      gettype = type;

  // Get the data from the dataTransfer object
  let data;
  try
  {
    // Prefer our custom data type
    data = transfer.getData(gettype);
  }
  catch (e)
  {
    // Using our custom data type failed, use the fallback data type
    data = transfer.getData(fallbackdatatype);
  }

  if (!data)
    return;

  // Check if this is a WebHare data URL
  if (data.substr(0, webharedataurl.length) != webharedataurl)
    return;

  // Retrieve and decode the data
  return JSON.parse(decodeURIComponent(data.substr(webharedataurl.length)), true);
}

// Store the WebHare data in our custom data url
function setWebHareData(event, data)
{
  // Get the event's dataTransfer object
  var transfer = event.dataTransfer;
  if (!transfer)
    return;

  // The data, encoded within a URL
  data = webharedataurl + encodeURIComponent(JSON.stringify(data));

  // Clear any existing data
  transfer.clearData();

  try
  {
    // Prefer our custom data type
    transfer.setData(webharedatatype, data);
  }
  catch (e)
  {
    // Using our custom data type failed, use the fallback data type
    transfer.setData(fallbackdatatype, data);
  }
}

// Get the canonical effect name from a effect / list of effects.
function parseEffectList(effects)
{
  effects = Array.from(effects || 'all');
  let mask = 0;
  for (let effect of effects)
  {
    const pos = effectstrs.indexOf(effect);
    if (pos >= 0)
      mask = mask | pos;
  }
  return effectstrs[mask];
}

let currentdrag = null;

function initWebhareDragEvent(event, data)
{
  currentdrag =
      { effectAllowed:    parseEffectList(data.effectAllowed)
      , externaldata:     data.externaldata || null
      , localdata:        data.localdata || null
      , file:             data.file || null
      , typehash:         ""
      };

  event.dataTransfer.effectAllowed = currentdrag.effectallowed;
  setWebHareData(event, currentdrag.externaldata || null);

  if (currentdrag.file)
  {
    try
    {
      const url = currentdrag.file.mimetype + ':' + currentdrag.file.filename + ':' + currentdrag.file.url;

      event.dataTransfer.setData('DownloadURL', url);
      event.dataTransfer.setData('URL', currentdrag.file.url);
    }
    catch(e)
    {
      //IE9 fails on dataTransfer.setData
    }
  }

  currentdrag.typehash = getEventItemsTypeHash(event);
}

class CurrentDragData
{
  constructor(event, localdrag)
  {
    /// Current event
    this.event = event;

    // DataTranfer object of event
    this.dataTransfer = event.dataTransfer;

    /// Local associated drag
    this.localdrag = localdrag;
  }

  /// Drag from external source?
  hasExternalSource()
  {
    return !this.localdrag;
  }

  haveDataAccess()
  {
    return this.localdrag || this.event.type == 'drop';
  }

  isFileDrag()
  {
    return this.getTypes().includes("Files");
  }

  /// Data (local from local source, external for external sources)
  getData()
  {
    return this.localdrag ? this.localdrag.localdata : getWebHareData(this.event);
  }

  getFiles()
  {
    return this.dataTransfer ? Array.from(this.dataTransfer.files) : [];
  }

  getItems()
  {
    // IE 11 doesn't have an items array
    return this.dataTransfer && this.dataTransfer.items ? Array.from(this.dataTransfer.items) : [];
  }

  getTypes()
  {
    return this.dataTransfer ? Array.from(this.dataTransfer.types) : [];
  }

  getDropEffect()
  {
    const mode = this.dataTransfer ? this.dataTransfer.dropEffect : "";
    return [ 'copy', 'move', 'link' ].includes(mode) ? mode : 'move';
  }

  setDropEffect(mode)
  {
    if (!this.dataTransfer)
      return;
    if ([ 'copy', 'move', 'link', 'none' ].includes(mode))
      this.dataTransfer.dropEffect = mode;
  }

  setDefaultDropEffect()
  {
    if (!this.dataTransfer)
      return;
    // Set default drop effect for allowed effects
    this.dataTransfer.dropEffect = getDefaultDropEffect(this.event, this.dataTransfer.effectAllowed);
  }
}

function getEventItemsTypeHash(event)
{
  return Array.from(event.dataTransfer.types).sort().join("\t");
}

export function getDragData(event)
{
  if (currentdrag && currentdrag.typehash !== getEventItemsTypeHash(event))
    currentdrag = null;

  return new CurrentDragData(event, currentdrag);
}

/// Reset the current drag when a local drag has ended
document.addEventListener('dragend', () => currentdrag = null);

/** Try to start a drag action
    @param items
    @cell items.id
    @cell items.info
    @cell items.info.type
    @cell items.info.candownload
    @cell items.info.data
    @cell items.info.data.filename
    @cell items.info.data.mimetype
    @cell items.info.data.flags
*/
export function tryStartDrag(comp, items, event)
{
//  console.log('tryStartDrag');
  if (!items.length)
    return false;

  var infos = [];
  for (var i = 0; i < items.length; ++i)
    if (!items[i].info)
      return false;
    else
      infos.push({ type: items[i].info.type, data: items[i].info.data, id: items[i].id });

  var download = null;
  if (items.length == 1 && items[0].info.candownload)
  {
    //ADDME: rowkey?
    var url = comp.getFileTransferURL('download', { type: 'dragout', rowkey: items[0].id }, { filename: items[0].info.data.filename }).url;
    download =
        { filename:     items[0].info.data.filename
        , mimetype:     items[0].info.data.mimetype
        , url:          url
        };
  }

  initWebhareDragEvent(event,
      { effectsAllowed:   "all"
      , localdata:        { source: comp, items: infos }
      , file:             download
      });

  return true;
}
