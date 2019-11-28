import * as dompack from 'dompack';
import * as formservice from '@mod-publisher/js/forms/internal/form.rpc.json';
import * as preload from 'dompack/extra/preload';
import { qSA } from 'dompack';
import * as browser from "dompack/extra/browser";
import * as KeyboardHandler from "dompack/extra/keyboard"; //FIXME should become import KeyboardHandler as soon as our dompack has KeyboardHandler.getEventKeyNames
var SelectionInterface = require('./selection');
var tablesupport = require('./tableeditor');
var rangy = require('@mod-system/js/frameworks/rangy/rangy13');
import * as richdebug from "./richdebug";
import * as domlevel from "./domlevel";
import * as compatupload from '@mod-system/js/compat/upload';
import * as texttype from 'dompack/types/text';
import * as icons from '@mod-tollium/js/icons';

var editableFix;

  /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  //
  //  HTML values
  //

  // Get a plain text interpretation of the current rte contents
function GetOuterPlain(node)
{
  if(node.nodeType==1 || node.nodeType==11)
  {
    // Don't return contents of certain elements
    if (('|script|style|').indexOf('|' + node.nodeName.toLowerCase() + '|') >= 0)
      return '';

    // Return certain elements as-is
    if (('|br|hr|img|').indexOf('|' + node.nodeName.toLowerCase() + '|') >= 0)
      return GetNodeXML(node);

    var nodes=[];

    // Leave some element tags
    if (('|blockquote|table|tbody|tr|th|td|').indexOf('|' + node.nodeName.toLowerCase() + '|') >= 0)
      nodes.push('<' + node.nodeName.toLowerCase() + GetNodeXML_Attributes(node) + '>');

    // Get subnode texts
    for(var subnode = node.firstChild;subnode;subnode=subnode.nextSibling)
      nodes.push(GetOuterPlain(subnode));

    // Add newline after certain elements
    if (('|blockquote|div|dd|dt|fieldset|form|h1|h2|h3|h4|h5|h6|li|p|pre|').indexOf('|' + node.nodeName.toLowerCase() + '|') >= 0)
      nodes.push('<br/>');

    // Leave some element tags
    if (('|blockquote|table|tbody|tr|th|td|').indexOf('|' + node.nodeName.toLowerCase() + '|') >= 0)
      nodes.push('</' + node.nodeName.toLowerCase() + '>');

    return nodes.join('');
  }
  if(node.nodeType==3)
  {
    if (!node.nodeValue)
      return '';
    var value = texttype.encodeValue(node.nodeValue);

    // Replace newlines with <br> nodes within pre elements
    for (node = node.parentNode; node; node = node.parentNode)
      if (('|pre|').indexOf('|' + node.nodeName.toLowerCase() + '|') >= 0)
        break;
    if (node)
      value = value.split('\r\n').join('\n')   // Replace \r\n with \n
                   .split('\r').join('\n')     // Replace \r with \n
                   .split('\n').join('<br/>'); // Replace \n with <br/>

    return value;
  }
  return '';
}


function GetNodeXML(node, inner)
{
  if(!node)
    return '';

  var s = [];
  switch (node.nodeType)
  {
    case 9: // document
      if (!inner)
        s.push('<html><body>');
      s.push(GetNodeXML(node.body, true));
      if (!inner)
        s.push('</body></html>');
      break;
    case 1: // element
      if (!node.childNodes.length)
      {
        // Don't export the bogus Mozilla line break node
        if (node.nodeName.toLowerCase() == 'br'
            && (node.getAttribute('_moz_editor_bogus_node') == 'TRUE'
                || node.getAttribute('type') == '_moz'))
          break;
        if (!inner)
          s.push('<' + node.nodeName.toLowerCase() + GetNodeXML_Attributes(node) + '/>');
      }
      else
      {
        if (!inner)
          s.push('<' + node.nodeName.toLowerCase() + GetNodeXML_Attributes(node) + '>');
        for (var child = node.firstChild; child; child = child.nextSibling)
          s.push(GetNodeXML(child, false));
        if (!inner)
          s.push('</' + node.nodeName.toLowerCase() + '>');
      }
      break;
    case 3: // text
      if (node.nodeValue)
        s.push(texttype.encodeValue(node.nodeValue));
      break;
  }
  return s.join('');
}

function GetNodeXML_Attributes(node)
{
  var s = [];
  for (var i = 0; i < node.attributes.length; ++i)
    s.push(' ' + node.attributes[i].nodeName.toLowerCase() + '="' + texttype.encodeValue(node.attributes[i].nodeValue) + '"');
  return s.join('');
}

function undoMutationEvents(ancestor, records, recordrecords)
{
  let redoRecords = [];
  let redoObserver;

  if (recordrecords)
  {
    redoObserver = new MutationObserver((records) => redoRecords.push(...records));
    redoObserver.observe(ancestor,
        { childList:              true
        , subtree:                true
        , attributes:             true
        , attributeOldValue:      true
        , characterData:          true
        , characterDataOldValue:  true
        });
  }

  //console.log(`start undo of `, records);
  for (let rec of records.reverse())
  {
    //console.log(`undoing record`, rec);
    switch (rec.type)
    {
      case "attributes":
      {
        if (rec.oldValue === null)
          if (rec.attributeNamespace)
            rec.target.removeAttributeNS(rec.attributeNamespace, rec.attributeName);
          else
            rec.target.removeAttribute(rec.attributeName);
        else
          if (rec.attributeNamespace)
            rec.target.setAttributeNS(rec.attributeNamespace, rec.attributeName, rec.oldValue);
          else
            rec.target.setAttribute(rec.attributeName, rec.oldValue);
      } break;
      case "characterData":
      {
        rec.target.nodeValue = rec.oldValue;
      } break;
      case "childList":
      {
        for (let node of rec.addedNodes)
          node.remove();
        if (rec.removedNodes.length)
        {
          let nodes = Array.from(rec.removedNodes);
          if (rec.nextSibling)
            rec.nextSibling.before(...nodes);
          else
            rec.target.append(...nodes);
        }
      }
    }
  }

  //console.log(`finished undo`);

  if (redoObserver)
  {
    redoRecords.push(...redoObserver.takeRecords());
    redoObserver.disconnect();
    //console.log(`generated redo records`, redoRecords);
    return redoRecords;
  }

  return null;
}

/** This undo item works by using snapshots. The initial method was using domlevel methods that added undo/redo actions
    to an undo item, but using snapshots is easier (and a lot more memory intensive). The domlevel recording can be
    re-developed later, because it has clear time/space savings inb the browser session.
*/
class EditorUndoItem
{ constructor(editor, selection)
  {
    this.editor = editor;
    this.preselection = selection.clone();
    this.postselection = null;
    this.undoRecords = [];
    this.redoRecords = null;
    this.locks = [];
    this.undoChangeObserver = null;

    // Watch all changes happening within this undoitem
    this.undoChangeObserver = new MutationObserver((records) => this.undoRecords.push(...records));
    this.undoChangeObserver.observe(editor.getContentBodyNode(),
        { childList:              true
        , subtree:                true
        , attributes:             true
        , attributeOldValue:      true
        , characterData:          true
        , characterDataOldValue:  true
        });
  }

  finish(selection)
  {
    if (!selection)
      selection = this.editor.getSelectionRange();

    this.undoRecords.push(...this.undoChangeObserver.takeRecords());
    this.undoChangeObserver.disconnect();
    this.undoChangeObserver = null;

    this.postselection = selection.clone();
    this.finished = true;

    this.onfinish && this.onfinish(this);
  }

  undo()
  {
    this.redoRecords = undoMutationEvents(this.editor.getContentBodyNode(), this.undoRecords, !this.redoRecords) || this.redoRecords;
    this.editor.selectRange(this.preselection);
  }

  redo()
  {
    undoMutationEvents(this.editor.getContentBodyNode(), this.redoRecords, false);
    this.editor.selectRange(this.postselection);
  }
}

class UndoLock
{
  constructor(undoitem)
  {
    // FIXME: public dom-level undoitem for now - remove when domlevel undoitem is removed
    this.undoitem = null;

    this._undoitem = undoitem;
    if (undoitem)
    {
      undoitem.locks.push(this);
      this.stack = new Error("undo lock acquisition");
    }
  }

  close()
  {
    if (this._undoitem)
    {
      let closedlock = this._undoitem.locks.pop();
      if (closedlock !== this)
        throw new Error(`Inner lock was not closed!, this lock stack:`, this.stack, `inner lock stack:`, closedlock.stack);

      if (!this._undoitem.locks.length)
        this._undoitem.finish();
    }
  }
}


var defaultimgplaceholder = "data:image/png;base64,R0lGODlhHwAfAPUAAP///0h5ke7y9N7m687b4cTU27zN1uXs78vZ37bJ0+vw8uLq7cHS2brM1cbV3Nrj6Pj5+sDQ2d/o6+zx826VqGOMoYGis9Tf5ZizwbDFz4Wmtfv7/JKvvXqdr9Xg5fn6+3uer2uTpgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh/hpDcmVhdGVkIHdpdGggYWpheGxvYWQuaW5mbwAh+QQJCgAAACwAAAAAHwAfAAAG/0CAcEgUDAgFA4BiwSQexKh0eEAkrldAZbvlOD5TqYKALWu5XIwnPFwwymY0GsRgAxrwuJwbCi8aAHlYZ3sVdwtRCm8JgVgODwoQAAIXGRpojQwKRGSDCRESYRsGHYZlBFR5AJt2a3kHQlZlERN2QxMRcAiTeaG2QxJ5RnAOv1EOcEdwUMZDD3BIcKzNq3BJcJLUABBwStrNBtjf3GUGBdLfCtadWMzUz6cDxN/IZQMCvdTBcAIAsli0jOHSJeSAqmlhNr0awo7RJ19TJORqdAXVEEVZyjyKtE3Bg3oZE2iK8oeiKkFZGiCaggelSTiA2LhxiZLBSjZjBL2siNBOFQ84LxHA+mYEiRJzBO7ZCQIAIfkECQoAAAAsAAAAAB8AHwAABv9AgHBIFAwIBQPAUCAMBMSodHhAJK5XAPaKOEynCsIWqx0nCIrvcMEwZ90JxkINaMATZXfju9jf82YAIQxRCm14Ww4PChAAEAoPDlsAFRUgHkRiZAkREmoSEXiVlRgfQgeBaXRpo6MOQlZbERN0Qx4drRUcAAJmnrVDBrkVDwNjr8BDGxq5Z2MPyUQZuRgFY6rRABe5FgZjjdm8uRTh2d5b4NkQY0zX5QpjTc/lD2NOx+WSW0++2RJmUGJhmZVsQqgtCE6lqpXGjBchmt50+hQKEAEiht5gUcTIESR9GhlgE9IH0BiTkxrMmWIHDkose9SwcQlHDsOIk9ygiVbl5JgMLuV4HUmypMkTOkEAACH5BAkKAAAALAAAAAAfAB8AAAb/QIBwSBQMCAUDwFAgDATEqHR4QCSuVwD2ijhMpwrCFqsdJwiK73DBMGfdCcZCDWjAE2V347vY3/NmdXNECm14Ww4PChAAEAoPDltlDGlDYmQJERJqEhGHWARUgZVqaWZeAFZbERN0QxOeWwgAAmabrkMSZkZjDrhRkVtHYw+/RA9jSGOkxgpjSWOMxkIQY0rT0wbR2LQV3t4UBcvcF9/eFpdYxdgZ5hUYA73YGxruCbVjt78G7hXFqlhY/fLQwR0HIQdGuUrTz5eQdIc0cfIEwByGD0MKvcGSaFGjR8GyeAPhIUofQGNQSgrB4IsdOCqx7FHDBiYcOQshYjKDxliVDpRjunCjdSTJkiZP6AQBACH5BAkKAAAALAAAAAAfAB8AAAb/QIBwSBQMCAUDwFAgDATEqHR4QCSuVwD2ijhMpwrCFqsdJwiK73DBMGfdCcZCDWjAE2V347vY3/NmdXNECm14Ww4PChAAEAoPDltlDGlDYmQJERJqEhGHWARUgZVqaWZeAFZbERN0QxOeWwgAAmabrkMSZkZjDrhRkVtHYw+/RA9jSGOkxgpjSWOMxkIQY0rT0wbR2I3WBcvczltNxNzIW0693MFYT7bTumNQqlisv7BjswAHo64egFdQAbj0RtOXDQY6VAAUakihN1gSLaJ1IYOGChgXXqEUpQ9ASRlDYhT0xQ4cACJDhqDD5mRKjCAYuArjBmVKDP9+VRljMyMHDwcfuBlBooSCBQwJiqkJAgAh+QQJCgAAACwAAAAAHwAfAAAG/0CAcEgUDAgFA8BQIAwExKh0eEAkrlcA9oo4TKcKwharHScIiu9wwTBn3QnGQg1owBNld+O72N/zZnVzRApteFsODwoQABAKDw5bZQxpQ2JkCRESahIRh1gEVIGVamlmXgBWWxETdEMTnlsIAAJmm65DEmZGYw64UZFbR2MPv0QPY0hjpMYKY0ljjMZCEGNK09MG0diN1gXL3M5bTcTcyFtOvdzBWE+207pjUKpYrL+wY7MAB4EerqZjUAG4lKVCBwMbvnT6dCXUkEIFK0jUkOECFEeQJF2hFKUPAIkgQwIaI+hLiJAoR27Zo4YBCJQgVW4cpMYDBpgVZKL59cEBhw+U+QROQ4bBAoUlTZ7QCQIAIfkECQoAAAAsAAAAAB8AHwAABv9AgHBIFAwIBQPAUCAMBMSodHhAJK5XAPaKOEynCsIWqx0nCIrvcMEwZ90JxkINaMATZXfju9jf82Z1c0QKbXhbDg8KEAAQCg8OW2UMaUNiZAkREmoSEYdYBFSBlWppZl4AVlsRE3RDE55bCAACZpuuQxJmRmMOuFGRW0djD79ED2NIY6TGCmNJY4zGQhBjStPTFBXb21DY1VsGFtzbF9gAzlsFGOQVGefIW2LtGhvYwVgDD+0V17+6Y6BwaNfBwy9YY2YBcMAPnStTY1B9YMdNiyZOngCFGuIBxDZAiRY1eoTvE6UoDEIAGrNSUoNBUuzAaYlljxo2M+HIeXiJpRsRNMaq+JSFCpsRJEqYOPH2JQgAIfkECQoAAAAsAAAAAB8AHwAABv9AgHBIFAwIBQPAUCAMBMSodHhAJK5XAPaKOEynCsIWqx0nCIrvcMEwZ90JxkINaMATZXfjywjlzX9jdXNEHiAVFX8ODwoQABAKDw5bZQxpQh8YiIhaERJqEhF4WwRDDpubAJdqaWZeAByoFR0edEMTolsIAA+yFUq2QxJmAgmyGhvBRJNbA5qoGcpED2MEFrIX0kMKYwUUslDaj2PA4soGY47iEOQFY6vS3FtNYw/m1KQDYw7mzFhPZj5JGzYGipUtESYowzVmF4ADgOCBCZTgFQAxZBJ4AiXqT6ltbUZhWdToUSR/Ii1FWbDnDkUyDQhJsQPn5ZU9atjUhCPHVhgTNy/RSKsiqKFFbUaQKGHiJNyXIAAh+QQJCgAAACwAAAAAHwAfAAAG/0CAcEh8JDAWCsBQIAwExKhU+HFwKlgsIMHlIg7TqQeTLW+7XYIiPGSAymY0mrFgA0LwuLzbCC/6eVlnewkADXVECgxcAGUaGRdQEAoPDmhnDGtDBJcVHQYbYRIRhWgEQwd7AB52AGt7YAAIchETrUITpGgIAAJ7ErdDEnsCA3IOwUSWaAOcaA/JQ0amBXKa0QpyBQZyENFCEHIG39HcaN7f4WhM1uTZaE1y0N/TacZoyN/LXU+/0cNyoMxCUytYLjm8AKSS46rVKzmxADhjlCACMFGkBiU4NUQRxS4OHijwNqnSJS6ZovzRyJAQo0NhGrgs5bIPmwWLCLHsQsfhxBWTe9QkOzCwC8sv5Ho127akyRM7QQAAOwAAAAAAAAAAAA==";



/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
//  Undo stuff
//

// ---------------------------------------------------------------------------
//
// RTE single area editor
//

class EditorBase
{
  constructor(element, rte, options, undonode)
  {
    this.bodydiv = element;
    this.selectionitf = new SelectionInterface(this.bodydiv);

    this.selectingrange = false; // Currently busy selecting range. Needed for synchronous event selectionchange
    this.ignorenextfocus = false; // Needed to ignore range setting when refocusing body

    this.ultypes = [ "", "disc", "circle", "square" ];
    this.oltypes = [ "", "decimal", "lower-roman", "upper-roman" ];
    this.actiontargets = [];

    this.delayedsurrounds = [];

      // Undo stuff
    this.undostack = [];
    this.undopos = 0;
    this.undonode = undonode;
    this.undoselectitf = null;

      // input event stuff
    this.oninputhandlers = [];
    this.activeinputhandler = '';

    this.tableeditors = [];
    this.repeatupdatetableuntil = null;
    this.attachedinputevents = false;
    this.inputeventfunction = null;
    this.blockroots = [ 'body', 'td', 'th' ];

    this.tableeditorstatechangedelay = null;

    if (this.undonode)
      options.allowundo = true;

    rangy.init();
    this.options =
        { allowtags: null
        , log: false
        , contentareawidth: null
        , allowundo: false
        , imgloadplaceholder: null //image loader GIF image to use (defaults to embedded spinning loader)
        , eventnode: null
        , ...options
        , actionelements: [...((options && options.actionelements) || []) ] //elements on which we support actions, such as properties
        };

    //if(this.options.log) console.log('apply saved state');
    //this.stateHasChanged(true);

    this.onload && this.onload();

    if(this.options.log)
      console.log('onloadcompletedelayed finished');

    // Listen to focus and focusout/focusin (focusin is needed on IE11, focus runs after the element gets focus
    // (rob: my guess is that happens when the old focused element disappears, but not sure)
    this._registerFrameEventListeners();

    if(!this.options.eventnode)
      throw Error("No eventnode");
    this.rte=rte;
    this.lastselectionstate = new TextFormattingState();
    //this.InitializeBrowserCapabilities();

    this.language = options && options.language || 'en';
    this.SetBreakupNodes(options && options.breakupnodes);
    this.setupUndoNode();
//    this.stateHasChanged();
  }

  setupUndoNode()
  {
    if (this.undonode && this.options.allowundo)
    {
      this.undonode.innerHTML = '0';
      this.undoselectitf = new SelectionInterface(this.undonode);

      if (window.MutationObserver)
      {
        // Add mutation observer to undonode, so we'll get notifified on changes
        this.undoNodeMutationObserver = new MutationObserver(evt => this.gotUndoChange('mutation', evt));
        this.undoNodeMutationObserver.observe(
              this.undonode,
              { characterData: true
              , subtree: true
              , childList: true
              });
      }
      else
        this.undonode.addEventListener('input', evt => this.gotUndoChange('input', evt));

      // Revert focus back to contentEditable node ASAP
      // - Chrome gives undo node focus upon change
      // - Firefox needs focus to execute InsertHTML
      this.undonode.addEventListener('focus', evt => this.refocusAfterUndoUpdate(evt));
    }
  }

  gotUndoChange(name, event)
  {
    var elt = parseInt(this.undonode.innerHTML);
    //console.log('gotUndoChange', name, event, "new indopos: ", elt, 'current undopos: ', this.undopos);
    if (elt == this.undopos)
      return;

    //console.log('un/redo ' + name + ': ' + elt);
    this.changeUndoPosition(elt);
  }

  refocusAfterUndoUpdate()
  {
    setTimeout(() => this.getContentBodyNode().focus());
    this.stateHasChanged();
  }

  destroy()
  {
    if(this.fontslistener)
      document.fonts.removeEventListener("loadingdone", this.fontslistener);

    if (this.scheduledupdatetableeditors)
    {
      cancelAnimationFrame(this.repeatupdatetableanimframe);
      clearTimeout(this.repeatupdatetabletimeout);
    }

    this.bodydiv.contentEditable = false;
  }


  execCommand(command, p1, p2)
  {
    try
    {
      // execCommand should be called on the document, not the editable area (contenteditable/designmode)
      this.bodydiv.ownerDocument.execCommand(command, p1, p2);
    }
    catch (e)
    {
      if(this.options.log)
        console.log('ExecCommand exception',e);
      return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  //
  // Helper functions - selection
  //

  /** Make sure a range doesn't contain 2 tds or straddles into another table
      @param range
      @return
      @cell changed
      @cell range
  */
  _constrainRangeCrossTDSelections(range)
  {
    let changed = false;
    let base = range.getAncestorElement();

    range = range.clone();
    const startpath = range.start.getPathFromAncestor(base).reverse();
    for (let i = 0; i < startpath.length; ++i)
    {
      let node = startpath[i];
      if (node.nodeType === 1 && ([ "td", "th" ].includes(node.nodeName.toLowerCase())))
      {
        range.intersect(domlevel.Range.fromNodeInner(node));
        changed = true;
        break;
      }
    }

    // Get new base in case we have corrected
    base = range.getAncestorElement();

    // if the end locator points within an inner table
    let endpath = range.end.getPathFromAncestor(base).reverse();
    for (let i = 0; i < endpath.length; ++i)
    {
      let node = endpath[i];
      if (node.nodeType === 1 && node.nodeName.toLowerCase() === "table")
      {
        let locator = domlevel.Locator.newPointingTo(node);
        locator.scanBackward(this.getContentBodyNode(), { whitespace: true, blocks: true }); // if we set past the last block elt, we'll delete that linebreak too, too dangerous
        if (range.start.compare(locator) <= 0)
          range.end.assign(locator);
        else
          range.end.assign(range.start);
        changed = true;
        break;
      }
    }

    return { changed, range };
  }

  // ---------------------------------------------------------------------------
  //
  // Helper functions - focus stuff
  //

  hasFocus()
  {
    var active = document.activeElement;
    while (active && active != this.bodydiv)
      active = active.parentNode;
    return !!active;
  }

  takeFocus()
  {
    this.bodydiv.focus();
  }

  // ---------------------------------------------------------------------------
  //
  // Public API
  //

  getContentBodyNode()
  {
    return this.bodydiv;
  }

  setContentsHTML(htmlcode, options)
  {
     //note: WE don't use 'raw', but the structurededitor does! raw bypasses its cleanup
    this.bodydiv.innerHTML = htmlcode;
    this.setCursorAtLocator(new domlevel.Locator(this.getContentBodyNode()));
  }
  setContentsHTMLRaw(htmlcode)
  {
    this.setContentsHTML(htmlcode, {raw: true});
  }

  toElement()
  {
    console.error("toelement");
    return this.bodydiv;
  }

  /// Returns raw selection range (for use in tests)
  debugGetRawSelectionRange()
  {
    return this.selectionitf.getSelectionRange();
  }

  _fixChromeInitialPositionBug(range)
  {
    const bodynode = this.getContentBodyNode();

    // Fixes chrome positioning the cursor at the first node when the document starts with embedded blocks, and then selecting an empty paragraph after those blocks
    if (range.end.element === bodynode && range.end.offset === 0)
    {
      const loc = range.end.clone();
      let modified = false;
      while (true)
      {
        const node = loc.getPointedNode();
        if ((!node) || (node.nodeType !== 1) || node.isContentEditable)
          break;
        ++loc.offset;
        modified = true;
      }
      range.assign(domlevel.Range.fromLocator(loc));
      this.selectionitf.selectRange(range);

      if (modified && (domlevel.getRangeLogLevel() & 4))
        console.log('getSelectionRange native was not legal (contentEditable error). After normalize', richdebug.getStructuredOuterHTML(this.getContentBodyNode(), range, true), range.start, range.end);
    }
  }

  /** Returns a $wh.Rich.range with the current selection, constrained to body node/editelement. The returned
      range is limited to the contentbodynode, and descended into leaf nodes.

      @return Copy of the current selection
  */
  getSelectionRange(options)
  {
    var skipnormalize = options && options.skipnormalize;

    var bodynode = this.getContentBodyNode();

    if (this.hasFocus())
    {
      var range = this.selectionitf.getSelectionRange();
      if (range)
      {
        if(domlevel.getRangeLogLevel() & 4)
          console.log('getSelectionRange have native selection (limited to body node)', richdebug.getStructuredOuterHTML(this.getContentBodyNode(), range, true), Object.assign({}, range.start), Object.assign({}, range.end));

        range.limitToNode(bodynode);
        if (!range.isLegal(this.getContentBodyNode()))
        {
          console.log('normalize illegal range');
          range.normalize(this.getContentBodyNode());
          this.selectionitf.selectRange(range);

          if(domlevel.getRangeLogLevel() & 4)
            console.log('getSelectionRange native was not legal. After normalize', richdebug.getStructuredOuterHTML(this.getContentBodyNode(), range, true), range.start, range.end);
        }

        this._fixChromeInitialPositionBug(range);
        this.currentrange = range;
      }
      else if (this.currentrange)
      {
        this.currentrange.limitToNode(bodynode);

        if (domlevel.getRangeLogLevel() & 4)
          console.log('getSelectionRange no native selection, use saved', richdebug.getStructuredOuterHTML(this.getContentBodyNode(), this.currentrange, true), this.currentrange.start, this.currentrange.end);
      }
    }
    else if (this.currentrange)
    {
      this.currentrange.limitToNode(bodynode);

      if (domlevel.getRangeLogLevel() & 4)
        console.log('getSelectionRange no focus, use saved', richdebug.getStructuredOuterHTML(this.getContentBodyNode(), this.currentrange, true), this.currentrange.start, this.currentrange.end);
    }

    if (!this.currentrange)
    {
      // No focus yet, and no saved selection - use default (start of document)
      var locator = new domlevel.Locator(bodynode);
      this.currentrange = new domlevel.Range(locator, locator);
      if(domlevel.getRangeLogLevel() & 4)
        console.log('getSelectionRange no saved selection', richdebug.getStructuredOuterHTML(this.getContentBodyNode(), this.currentrange, true), this.currentrange.start, this.currentrange.end);
    }

    var retval = this.currentrange.clone();
    if (!skipnormalize)
    {
      retval.normalize(bodynode, true);
      if(domlevel.getRangeLogLevel() & 4)
        console.log('getSelectionRange normalized selection', richdebug.getStructuredOuterHTML(this.getContentBodyNode(), retval, true), retval.start, retval.end);
    }

    return retval;
  }

  /** Changes the current selection to the passed range
      @param range Range to select
  */
  selectRange(range, options)
  {
    if (!domlevel.isNodeSplittable(range.start.element))
      throw "Trying to put start of selection within an unsplittable element (" + range.start.element.nodeName + ')';
    if (!domlevel.isNodeSplittable(range.end.element))
      throw "Trying to put end of selection within an unsplittable element (" + range.end.element.nodeName + ')';

    var body = this.getContentBodyNode();
    this.currentrange = range.clone();

    if(domlevel.getRangeLogLevel() & 64)
      console.log('selectrange before limit', richdebug.getStructuredOuterHTML(body, this.currentrange, true), this.currentrange.start, this.currentrange.end);
    this.currentrange.limitToNode(body);
    if(domlevel.getRangeLogLevel() & 64)
      console.log('selectrange after limit', richdebug.getStructuredOuterHTML(body, this.currentrange, true), this.currentrange.start, this.currentrange.end);

    if (!options || !options.skipnormalize)
    {
      this.currentrange.normalize(body);
      if(domlevel.getRangeLogLevel() & 64)
        console.log('selectrange after normalize', richdebug.getStructuredOuterHTML(body, this.currentrange, true), this.currentrange.start, this.currentrange.end);
    }

    //console.log('B selectingrange set', richdebug.getStructuredOuterHTML(this.getContentBodyNode(), range, true));
    this.selectingrange = true;

    if(this.hasFocus())
      this.selectionitf.selectRange(this.currentrange);


    if(domlevel.getRangeLogLevel() & 64)
      console.log('EA selectRange', this.connected, richdebug.getStructuredOuterHTML(body, range, false));

    this.selectingrange = false;
    //console.log('B selectingrange res', richdebug.getStructuredOuterHTML(this.getContentBodyNode(), this.getSelectionRange(), true));

    this.stateHasChanged();
  }

  setCursorAtLocator(locator)
  {
    this.selectRange(new domlevel.Range(locator, locator));
  }

  selectNodeInner(node)
  {
    this.selectRange(domlevel.Range.fromNodeInner(node));
  }

  selectNodeOuter(node)
  {
    this.selectRange(domlevel.Range.fromNodeOuter(node));
  }

  collapseSelection(tostart)
  {
    var range = this.getSelectionRange();
    if (tostart)
      range.end.assign(range.start);
    else
      range.start.assign(range.end);
    this.selectRange(range);
  }

  editareaconnect()
  {
    this.bodydiv.contentEditable = true;

    // No Firefox, we don't want your fancy inline table editing or object resizing (can only be called _after_ editarea is
    // connected, i.e. contentEditable is set)
    this.execCommand("enableInlineTableEditing", null, "false");
    this.execCommand("enableObjectResizing", null, "false");

    this.stateHasChanged();
  }
  editareadisconnect()
  {
    this.bodydiv.contentEditable = false;

    this.stateHasChanged();
  }

  reprocessAfterExternalSet()
  {
    //external update to the value. reset the selection, the delayed surrounds
    this.currentrange = null;
    this.delayedsurrounds = [];

    var range = this.getSelectionRange();
    this.selectRange(range);

    this._reprocessEmbeddedAutoElements();
  }

  /// reprocess stuff like icons in embedded blocks
  _reprocessEmbeddedAutoElements()
  {
    icons.loadMissingImages({ node: this.getContentBodyNode() });
  }

  SetBackgroundColor(color) //FIXME must be unused...
  {
    this.options.backgroundcolor = color;
  }
  SetBreakupNodes(nodenames)
  {
    if (nodenames && nodenames.length)
      this.breakupnodes = nodenames;
    else
      this.breakupnodes = [];
  }
  onFocus(event)
  {
    // Restore the focus on onfocus event. But don't if focusing because of a click on editable stuff
    if (this.currentrange && !this.ignorenextfocus)
    {
      this.selectionitf.selectRange(this.currentrange);
    }

    // Need to explicitly disable inline table editing here, doing it once just isn't enough.
    if (browser.getName() === "firefox")
    {
      document.execCommand("enableInlineTableEditing", null, "false");
      document.execCommand("enableObjectResizing", null, "false");
    }

    this.ignorenextfocus = false;

    this.updateTableEditors();
  }

  onFocusOut(event)
  {
    // On focus out, try to get the current selection (will work when we still have focus)
    // This will save the current selection to this.currentrange, so we can restore upon focusin
    this.getSelectionRange({ skipnormalize: true });

    /* The RTE has a tendency to regain focus on Chrome. Easily tested by selecting
       a range, select 'create hyperlink' and immediately typing - the tollium
       hyperlink window is not taking focus.
       APply workaround from http://jsfiddle.net/pfsNx/26/ ( https://code.google.com/p/chromium/issues/detail?id=89026 )
       */
    if(/AppleWebKit\/([\d.]+)/.exec(navigator.userAgent))
    {
      if(!editableFix)
      {
        editableFix = document.createElement('input');
        editableFix.style.cssText = "width:1px;height:1px;border:none;margin:0;padding:0;position:absolute;bottom:0;left:0";
        document.body.appendChild(editableFix);
      }

      editableFix.setSelectionRange(0, 0);
      if(event.relatedTarget)
      {
        editableFix.focus(); //ensure defocus of RTD, some elements like a checkbox may not fully take focus away
        event.relatedTarget.focus();
      }
    }
  }

  onFocusIn(event)
  {
    // Restore the selection (FIXME: this might cause problems when focus lies within an embedded object)
    if (this.currentrange && !this.ignorenextfocus)
      this.selectionitf.selectRange(this.currentrange);

    // Ignore the next focus event
    this.ignorenextfocus = true;
  }


/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
//  Formatting
//
  applyTextStyle(textstyle, apply)
  {
    //ADDME proper list of textstyles we should prevent?
    if(!['b','i','u','strike','sub','sup'].includes(textstyle))
      console.warn("ADDME: Didn't test ApplyTextStyle for '" + textstyle + "' yet");

    this.DelayedSurroundSelection( { element: textstyle
                                   , wrapin: apply
                                   , splitprohibits: [ 'a' ]
                                   , splitblockelements: false
                                   } );
  }


/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
//  Contents API
//

  setCursor(element, offset)
  {
    if (!element)
      throw "Invalid element passed to setCursor";

    this.setCursorAtLocator(new domlevel.Locator(element, offset || 0));
  }

  SetSelection(newrange)
  {
    this.selectRange(domlevel.Range.fromDOMRange(newrange));
  }

  SelectAll()
  {
    this.selectNodeInner(this.getContentBodyNode());
    this.stateHasChanged();
  }

  /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  //
  //  New selection API
  //
  selectNodeContents(node)
  {
    console.warn('selectNodeContents is deprecated, use selectNodeInner!');console.trace();
    this.selectRange(domlevel.Range.withinNode(node));
  }

  insertTextAtCursor (text)
  {
    //console.log('setselt: ', richdebug.getStructuredOuterHTML(this.getContentBodyNode(), domlevel.Range.fromDOMRange(this.GetSelectionObject().GetRange())));

    var range = this.getSelectionRange();
    if (!range.isCollapsed())
      throw new Error("insertTextAtCursor does not support selections");

   // selection is collapsed, so range start = range end, so we can just use range start
//    console.log('insertTextAtCursor DescendLocatorToLeafNode locators.start');
    range.start.descendToLeafNode(this.getContentBodyNode());

    // locators.start should now point to a text node, insert the text
    var textnode = range.start.element;
    var textoffset = range.start.offset;
    if (textnode.nodeType != 3) // If it's not a text node (e.g. in an empty document), create one
    {
      if (textnode.childNodes.length)
        textnode = textnode.insertBefore(document.createTextNode(''), textnode.childNodes.item(textoffset));
      else
        textnode = textnode.appendChild(document.createTextNode(''));
      textoffset = 0;
    }
    var nodetext = textnode.nodeValue;
    nodetext = nodetext.substr(0, textoffset) + text + nodetext.substr(textoffset);
    textnode.nodeValue = nodetext;

    this.selectRange(
      new domlevel.Range(
        new domlevel.Locator(textnode, textoffset),
        new domlevel.Locator(textnode, textoffset + text.length)));
  }

  /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  //
  //  Undo API
  //

  _updateUndoNodeForNewUndoItem(item)
  {
    this.undonode.focus();

    if (browser.getName() == "ie" || browser.getName() == "edge")
    {
      /* In IE11 and edge InsertHTML doesn't work. Using ms-beginUndoUnit / ms-endUndoUnit to record the modification
         of the undonode into the undo buffer. Recording the body changes with undo unit crashed edge 16.16299, so this
         is somewhat safer. Plus, it follows the rest of the browsers.
      */
      this.undonode.ownerDocument.execCommand('ms-beginUndoUnit');
      this.undonode.textContent = this.undopos + "";
      this.undonode.ownerDocument.execCommand('ms-endUndoUnit');
    }
    else
    {
      this.undoselectitf.selectRange(domlevel.Range.fromNodeInner(this.undonode));
      this.undonode.ownerDocument.execCommand("InsertHTML", false, this.undopos + "");
    }

    this.getContentBodyNode().focus();
    this.selectRange(item.postselection);

    if(dompack.debugflags.rte)
      console.log('[rte] finished recording undo item', item);
  }


  /** Ensures the actions within the undo lock are recorded into the browser undo buffer. Nested calls
      are allowed.
  */
  getUndoLock()
  {
    if (!this.options.allowundo)
      return new UndoLock(null);

    let last = this.undostack.length && this.undostack[this.undostack.length - 1];
    if (last && !last.finished)
      return new UndoLock(last);

    // Allocate a new undo item, place it on the undo stack (erase redoable items)
    let item = new EditorUndoItem(this, this.getSelectionRange());
    this.undostack.splice(this.undopos, this.undostack.length - this.undopos, item);
    ++this.undopos;

    if(dompack.debugflags.rte)
      console.warn('[rte] start recording undo item', item);

    item.onfinish = (item) => this._updateUndoNodeForNewUndoItem(item);
    return new UndoLock(item);
  }

  resetUndoStack()
  {
    if (!this.options.allowundo)
      return;

    this.undopos = 0;
    this.undostack = [];
    if (this.undonode)
    {
      // replaces the #text node of the undonode, so the browser undo won't affect that node anymore
      this.undonode.textContent = "0";
    }
  }

  changeUndoPosition(newpos)
  {
    var nothrow = false;
    try
    {
      while (newpos < this.undopos)
      {
        --this.undopos;
        this.undostack[this.undopos].undo();
      }
      while (newpos > this.undopos && this.undopos < this.undostack.length)
      {
        this.undostack[this.undopos].redo();
        ++this.undopos;
      }
      this.undopos = newpos;
      nothrow = true;
    }
    finally
    {
      if (!nothrow)
      {
        this.undostack = [];
        this.undopos = 0;
      }
    }
  }

  /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  //
  //  Dom analyzing
  //

  /** Describes the first ancestor blocknode of a block. If no block is found, the block section node is returned
      in all values.
      @param node Block node (or child thereof)
      @return
      @cell return.node Block top node (p/h1..h6/ol/ul)
      @cell return.contentnode Block content node (li if node is the li node of a list or inside of it, otherwise equal to the block top node)
      @cell return.blockparent Parent of the block node
      @cell return.blockroot Root ancestor of the blocks (body, td, th or content body)
  */
  getBlockAtNode(node)
  {
    // Look out - can also be used within document fragments!
    let root = this.getContentBodyNode();

    let res =
        { node:         null
        , contentnode:  null
        , blockroot:    null
        , blockparent:  null
        , islist:       false
        , isintable:    false
        };

    let curnode=node;
    for(;curnode&&curnode!=root;curnode=curnode.parentNode)
      if (curnode.nodeType == 1)
      {
        if (['tr','td'].includes(curnode.nodeName.toLowerCase()))
          res.isintable = true;

        if (curnode.nodeName.toLowerCase() == 'li')
          res.contentnode = curnode;
        else if (domlevel.isNodeBlockElement(curnode))
        {
          let islist =[ 'ol', 'ul' ].includes(curnode.nodeName.toLowerCase());
          if(this.structure && this.structure.getBlockStyleByTag) //FIXME why do we care?
            res.blockstyle = curnode.className ? this.structure.getBlockStyleByTag(curnode.className) : null;
          res.node = curnode;
          res.contentnode = (islist && res.contentnode) || curnode;
          res.blockparent = curnode.parentNode;
          res.islist = islist;
          break;
        }
        else if (this.blockroots.includes(curnode.nodeName.toLowerCase())) // FIXME: better name for listunbreakablenodes
        {
          res.node = curnode;
          res.contentnode = curnode;
          res.blockroot = curnode;
          res.blockparent = curnode.parentNode;
          break;
        }
      }
      else if (curnode.nodeType == 11)
        root = curnode;

    for (;curnode&&curnode!=root;curnode=curnode.parentNode)
    {
      if (curnode.nodeType == 11)
        root = curnode;
      else if (curnode.nodeType == 1 && this.blockroots.includes(curnode.nodeName.toLowerCase())) // FIXME: better name for listunbreakablenodes
      {
        res.blockroot = curnode;
        break;
      }
    }

    res.node = res.node || root;
    res.contentnode = res.contentnode || root;
    res.blockroot = res.blockroot || root;
    res.blockparent = res.blockparent || root;


//    console.log('getBlockAtNode res: ', res);

    return res;
  }

  /** Updates a path with the next node. All elements that are not a proper ancestor of node are removed, then
      node is appended.
      @param path Current path
      @param node New node
      @return Whether the node had no ancestor in the old path
  */
  updatePathForNextNode(path, node)
  {
    var found = false;
    for (var n = path.length - 1; !found && n >= 0; --n)
    {
      if (path[n].contains(node))
      {
        // Remove all non-ancestor elements from the array
        path.splice(n + 1, path.length - n - 1);
        found = true;
        break;
      }
    }

    if (!found)
      path.splice(0, path.length);
    path.push(node);

    return found;
  }

  getLevelActionableListNodes(range)
  {
    // Keep range intact
    range = range.clone();

    // Adjust the range, so all partially selected <li>'s fall within the range (otherwise they won't be returned by
    // getElementsByTagName)
    var startliparent = domlevel.findParent(range.start.getNearestNode(), "li", this.getContentBodyNode());
    if (startliparent)
      range.start.assign(domlevel.Locator.newPointingTo(startliparent));

    var endliparent = domlevel.findParent(range.end.getNearestNode(), "li", this.getContentBodyNode());
    if (endliparent)
    {
      if (endliparent == startliparent)
      {
        range.end.assign(domlevel.Locator.newPointingAfter(startliparent));
      }
      else
      {
        range.end.ascend(this.getContentBodyNode(), false);
        var endlistart = domlevel.Locator.newPointingTo(endliparent);
        var endliend = domlevel.Locator.newPointingAfter(endliparent);
        // If the end <li> is partially selected, select the whole <li>
        if (range.end.compare(endlistart) > 0)
          range.end = endliend;
      }
    }

    let linodes = Array.from(range.getElementsByTagName('li'));

    var addable = [], removeable = [];

    // Find the nodes that can be added a level
    var path = [];
    for (let i = 0; i < linodes.length; ++i)
    {
      if (!linodes[i].isContentEditable)
        continue;

      if (!linodes[i].previousSibling)
      {
        // If this is the first li within a list, and there is another list directly before this list, it may be added to that list
        var prevlist = domlevel.Locator.newPointingTo(linodes[i].parentNode);
        prevlist.moveToPreviousBlockBoundary(linodes[i].parentNode.parentNode, true);
        //console.log('glaln prevlist:', richdebug.getStructuredOuterHTML(this.getContentBodyNode(), { prevlist: prevlist }, true));
        prevlist = prevlist.getPointedNode();
        if (!prevlist || prevlist == linodes[i].parentNode || (prevlist.nodeName.toUpperCase() != "UL" && prevlist.nodeName.toUpperCase() != "OL"))
          continue;
      }
      else if (linodes[i].previousSibling.nodeType != 1 || linodes[i].previousSibling.nodeName.toLowerCase() != 'li')
        continue;

      // Don't select partial nodes when our selection starts in a list within that node
      if (startliparent && linodes[i] != startliparent && linodes[i].contains(startliparent))
        continue;

      if (!this.updatePathForNextNode(path, linodes[i]))
        addable.push(linodes[i]);
    }

    // Find the nodes that can be removed a level
    path = [];
    for (let i = 0; i < linodes.length; ++i)
    {
      if (!linodes[i].isContentEditable)
        continue;

      if (!domlevel.findParent(linodes[i].parentNode, "li", this.getContentBodyNode()))
        continue;

      // Don't select partial nodes when our selection starts in a list within that node
      if (linodes[i] != startliparent && linodes[i].contains(startliparent))
        continue;

      if (!this.updatePathForNextNode(path, linodes[i]))
        removeable.push(linodes[i]);
    }
    return { addable: addable, removeable: removeable };
  }

  /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  //
  //  Dom manipulation, internal
  //

  /** If the after the locator, there is no visible content inside the block element where the locator is placed,
      insert a <br> (only when browser needs it, and that means IE)
      @param locator
      @param preservelocators
      @param undoitem
  */
  requireVisibleContentInBlockAfterLocator(locator, preservelocators, undoitem)
  {
    var blocknode = this.getBlockAtNode(locator.element).contentnode;
    domlevel.requireVisibleContentInBlockAfterLocator(locator, blocknode, preservelocators, undoitem);
  }

  /** Removes a range and move the contents after the ranges inside the block at the start range
      @param range Range to remove
      @param preservelocators Locators to keep valid
      @param undoitem Undo item
      @cell options.normalize Normalize the range before executing
      @return Locator at place of removed range
  */
  _removeRangeAndStitch(range, preservelocators, undoitem, { normalize = true } = {})
  {
    preservelocators = (preservelocators||[]).slice();

    // No need to do work on empty selections
    if (normalize)
      range.normalize(this.getContentBodyNode());
    if (range.isCollapsed())
      return range.start.clone();

      // Make sure we can insert at the start, and insert a temporary node to make sure splitdom
    // returns the current block in part[0]
    range.splitStartBoundary(preservelocators, undoitem);
    var insertpos = range.start.clone();

    var tnode = document.createElement("img"); // Img elements are more stable than text nodes - not combined
    range.start = range.start.insertNode(tnode, [ range.end, ...preservelocators ], undoitem);

    // Determine which blocks we start&end in
    var startblock = this.getBlockAtNode(range.start.getNearestNode());
    var endblock = this.getBlockAtNode(range.end.getNearestNode());
    var blockend = null;

    // Determine the root we are splitting in
    var root = range.getAncestorElement();

    // Spanning different blocks!
    if (startblock.contentnode != endblock.contentnode)
    {
      blockend = new domlevel.Locator(endblock.contentnode, "end");
    }
    else
    {
      blockend = new domlevel.Locator(range.end.element, "end");
    }

    //console.log('removeRangeAndStitch start:', richdebug.getStructuredOuterHTML(root, { root:root, range:range, blockend: blockend }));

    //console.log('enter presplit:  ', richdebug.getStructuredOuterHTML(root, { range_start: range.start, range_end: range.end, blockend: blockend }));
    var parts = domlevel.splitDom(root, [ { locator: range.start, toward: 'start' }, { locator: range.end, toward: 'end' }, { locator: blockend, toward: 'end' } ], preservelocators, undoitem);
    //console.log('enter postsplit: ', richdebug.getStructuredOuterHTML(root, parts));

    // Ranges:
    //    0: content before range (keep, except our temporary element)
    //    1: content within range (delete)
    //    2: content after range end until block end (append to 0)
    //    3: content after block where range end is located (keep)

    preservelocators = preservelocators.concat(parts);
    preservelocators.push(insertpos);

    // Remove the contents of range 1, keep the other part locators valid
    domlevel.removeSimpleRange(parts[1], preservelocators, undoitem);

    var insertlocator = domlevel.Locator.newPointingTo(tnode);
    insertlocator.removeNode(preservelocators, undoitem);

    // Content to append?
    if (!parts[2].start.equals(parts[2].end))
    {
      let locator = parts[2].start.clone();
      locator.descendToLeafNode(this.getContentBodyNode());

      // See if there is a block in the removed fragment. If so, move only its contents.
      var restblock = this.getBlockAtNode(locator.getNearestNode());

      // restblock.contentnode contains the data. But it might also be the rootblock. Intersect with parts[2] for that!
      range = domlevel.Range.fromNodeInner(restblock.contentnode);
      range.intersect(parts[2]);

      var res = domlevel.moveSimpleRangeTo(range, insertlocator, parts, undoitem);

      // Calculate range to remove
      range = new domlevel.Range(res.afterlocator, parts[2].end);
      range.start.ascend(root, true, true);

      domlevel.removeSimpleRange(range, preservelocators, undoitem);
    }
    else
    {
      //console.log('no preinsert');
      this.requireVisibleContentInBlockAfterLocator(insertlocator, preservelocators, undoitem);
    }

    insertlocator = this._correctWhitespaceAroundLocator(insertlocator, undoitem);

    range.start.assign(insertlocator);
    range.end.assign(insertlocator);

    //console.log('removeRangeAndStitch done:', richdebug.getStructuredOuterHTML(root, { insertlocator: insertlocator }));
    return insertlocator;
  }

  appendNodeContentsAfterRemove(insertlocator, contentnode, preservelocator, undoitem)
  {
    var nodes = domlevel.removeNodeContents(contentnode, undoitem);
    domlevel.insertNodesAtLocator(nodes, insertlocator, [], undoitem);
    return insertlocator;
  }

  /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  //
  //  Dom manipulation, unsorted/untranslated
  //

  /// Corrects whitespace around a locator, assuming the whitespace after the locator should be visible
  _correctWhitespaceAroundLocator(locator, undoitem)
  {
    // pointing to a text node?
    if ([3,4].includes(locator.getNearestNode().nodeType))
      locator = domlevel.combineAdjacentTextNodes(locator, null, undoitem);

    const prevlocator = locator.clone();
    const prevres = prevlocator.scanBackward(this.getContentBodyNode(), {});
    if (prevres.type === "whitespace")
      domlevel.rewriteWhitespace(this.getContentBodyNode(), prevlocator, [ locator ], undoitem);

    if (!prevlocator.equals(locator))
    {
      const nextlocator = locator.clone();
      const nextres = nextlocator.scanForward(this.getContentBodyNode(), {});
      if (nextres.type === "whitespace")
        domlevel.rewriteWhitespace(this.getContentBodyNode(), nextlocator, [ locator ], undoitem);
    }

    return locator;
  }

  replaceRangeWithNode(range, newnode, undoitem)
  {
    if (newnode)
      range.insertBefore(newnode, [], undoitem);

    return this._removeRangeAndStitch(range, null, undoitem);
  }

  replaceSelectionWithNode(newnode, select)
  {
    const undolock = this.getUndoLock();
    var res = this.replaceRangeWithNode(this.getSelectionRange(), newnode, undolock.undoitem);
    if(select)
      this.selectNodeOuter(newnode);
    else
      this.setCursorAtLocator(res);

    undolock.close();
  }

  /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  //
  //  Actions
  //

  executeSoftEnter()
  {
    var range = this.getSelectionRange();
    const undolock = this.getUndoLock();

    var iscollapsed = range.isCollapsed();

    // First insert the new br node
    var newbr = document.createElement('br');
    /*var res = */range.insertBefore(newbr, [], undolock.undoitem);

    // If we had a selection, then remove it
    let loc;
    if (iscollapsed)
    {
      this.requireVisibleContentInBlockAfterLocator(range.start, null, undolock.undoitem);
      loc = this._correctWhitespaceAroundLocator(range.start, undolock.undoitem);
    }
    else
      loc = this._removeRangeAndStitch(range, null, undolock.undoitem);

    loc = this._correctWhitespaceAroundLocator(loc, undolock.undoitem);
    this.setCursorAtLocator(loc);

    undolock.close();
    this.stateHasChanged();
    return false;
  }

  /** Free RTE needs to break blockquotes - the rest of the browser implementation is good enough
      @return Whether browser implementation is to be used
  */
  executeHardEnter()
  {
    var range = this.getSelectionRange();

    // Find blockquotes at start - but don't break through tables
    var breakparent = domlevel.findParent(range.start.element, [ 'blockquote', 'th', 'td' ], this.getContentBodyNode());
    var topblockquote;
    while (breakparent)
    {
      if (breakparent.nodeName.toLowerCase() != 'blockquote')
        break;

      topblockquote = breakparent;
      breakparent = domlevel.findParent(breakparent.parentNode, [ 'blockquote', 'th', 'td' ], this.getContentBodyNode());
    }

    if (topblockquote)
    {
      const undolock = this.getUndoLock();
      var parts = domlevel.splitDom(topblockquote.parentNode, [ { locator: range.start, toward: 'end' } ], range, undolock.undoitem);
      parts[1].start.insertNode(document.createElement('br'), [], undolock.undoitem);
      this.setCursorAtLocator(parts[1].start);
      undolock.close();
      this.stateHasChanged();
      return false;
    }
    return true;
  }

  /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  //
  //  Dom manipulation, rest
  //

  ReplaceSelection(splitparent, newnode)
  {
    var range = this.getSelectionRange();
    const undolock = this.getUndoLock();
    var locators = range;

    if (!splitparent)
      splitparent = domlevel.Locator.findCommonAncestorElement(locators.start, locators.end);

    // Split the splitparent at selection start (and end if selection isn't empty)
    var splitlocators = [ { locator: locators.start, toward: 'start' } ];
    if (locators.start.element != locators.end.element || locators.start.offset != locators.end.offset)
      splitlocators.push({ locator: locators.end, toward: 'end' });

    //console.log('rs presplit: ', richdebug.getStructuredOuterHTML(this.getContentBodyNode(), splitlocators.map(function(item){return item.locator;})));
    var parts = domlevel.splitDom(splitparent, splitlocators, undolock.undoitem);
      //console.log(parts);
    //console.log('rs post: ', richdebug.getStructuredOuterHTML(this.getContentBodyNode(), parts));

    // Find last node before cursor position (highest ancestor of right element of first part)
    var leftborder = parts[0].end.element;
    while (leftborder.parentNode && leftborder.parentNode != splitparent)
      leftborder = leftborder.parentNode;

    // Find first node after cursor position (highest ancestor of left element of last part)
    var rightborder = parts[parts.length - 1].start.element;
    while (rightborder.parentNode && rightborder.parentNode != splitparent)
      rightborder = rightborder.parentNode;

    //console.log('rs post: ', richdebug.getStructuredOuterHTML(this.getContentBodyNode(), { leftborder: leftborder, rightborder: rightborder, splitparent: splitparent }));

    if (leftborder.parentNode != splitparent || rightborder.parentNode != splitparent)
      return;

    // Clear all nodes between border nodes
    if (leftborder != rightborder)
      while (leftborder.nextSibling && leftborder.nextSibling != rightborder)
        leftborder.parentNode.removeChild(leftborder.nextSibling);

    if (leftborder != rightborder && leftborder.nextSibling != rightborder)
      return;

    // Insert new node between border nodes
    rightborder.parentNode.insertBefore(newnode, rightborder);

    // Select new node (outer, may be a <br> or <img>)
    this.selectNodeOuter(newnode);
    undolock.close();
  }

  insertImage(url, width, height)
  {
    var img = <img src={url} class="wh-rtd__img"/>;
    if(width && height)
    {
      img.height = height;
      img.width = width;
    }

    this.replaceSelectionWithNode(img, true);
    this.stateHasChanged();
  }

  insertHyperlink(url, options)
  {
    this._surroundSelection( { element: 'a'
                             , wrapin: true
                             , attrs: { href: url
                                      , target: options && options.target ? options.target : null
                                      }
                             , splitprohibits: []
                             , avoidwhitespace: true
                             } );
    this.stateHasChanged();
  }

  removeHyperlink()
  {
    var range = this.getSelectionRange();
    if (range.isCollapsed())
    {
      // No selection: find the A node that is the parent of the cursor and select that one
      // ADDME: unselect and keep current cursor position
      //var range = sel.GetRange();
      var path = (new domlevel.Locator(range.getAncestorElement())).getPathFromAncestor(this.getContentBodyNode());

      for (var i = path.length-1; i >= 0; --i)
        if (path[i].nodeName.toLowerCase() == 'a')
        {
          this.selectRange(domlevel.Range.withinNode(path[i]));
          break;
        }

      // No A node found
      if (i == -1)
        return;
    }

    this._surroundSelection( { element: 'a'
                            , wrapin: false
                            , splitprohibits: []
                            });
  }

  insertTable(cols, rows)
  {
    if (cols <= 0 || rows <= 0)
      return;

    var body = this.getContentBodyNode();
//    var selobj = this.GetSelectionObject();
//    var range = selobj.GetRange();
//    if (!range)
//      return;
    var locators = this.getSelectionRange();
    if (!locators)
      return;
    //$wh.Rich.Locator.getFromRange(range);

    const undolock = this.getUndoLock();

    var startelement = locators.start.element;
    if (startelement == body)
      startelement = body.firstChild;
    else
      while (startelement.parentNode != body)
        startelement = startelement.parentNode;

    var endelement = locators.end.element;
    if (endelement == body)
      endelement = body.lastChild;
    else
      while (endelement.parentNode != body)
        endelement = endelement.parentNode;
    endelement = endelement.nextSibling;

    // Create the table
    var tablenode = document.createElement('table');

    tablenode.appendChild(document.createElement('tbody'));
    for (var row = 0; row < rows; ++row)
    {
      var tr = tablenode.lastChild.appendChild(document.createElement('tr'));
      for (var col = 0; col < cols; ++col)
      {
        var td = tr.appendChild(document.createElement('td'));
        td.appendChild(document.createTextNode((col+1)+","+(row+1)));
      }
    }

    body.insertBefore(tablenode, endelement);
    this.stateHasChanged();

    undolock.close();
  }

  // Toggle bulleted list for the selection
  _toggleBulletedList()
  {
    this.execCommand('insertunorderedlist');
    this.stateHasChanged();
  }

  // Toggle numbered list for the selection
  _toggleNumberedList()
  {
    this.execCommand('insertorderedlist');
    this.stateHasChanged();
  }

  //ADDME: Use our own function instead of having the browser make something up
  _setAlignment(align)
  {
    var cmd = '';
    switch (align)
    {
      case 'center':
        cmd = 'justifycenter';
        break;
      case 'right':
        cmd = 'justifyright';
        break;
      case 'justified':
        cmd = 'justifyfull';
        break;
      default: // 'left'
        cmd = 'justifyleft';
        break;
    }
    this.execCommand(cmd);
    this.stateHasChanged();
  }

  _undo()
  {
    //this.ExecCommand('undo');
  }

  _redo()
  {
    //this.ExecCommand('redo');
  }

  _clearFormatting()
  {
    //ADDME: Only clear formatting of selected contents?
    var body = this.getContentBodyNode();
    this.setContentsHTML(GetOuterPlain(body, true));
    this.stateHasChanged();
  }

  /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  //
  //  Private API
  //

  _registerFrameEventListeners()
  {
    if(!this.bodydiv.__wh_rte_doneevents)
    {
      this.bodydiv.__wh_rte_doneevents = true;
      this.bodydiv.addEventListener('focus', this.onFocus.bind(this));
      this.bodydiv.addEventListener('focusout', this.onFocusOut.bind(this));
      this.bodydiv.addEventListener('focusin', this.onFocusIn.bind(this));
      this.bodydiv.addEventListener('keydown', this._gotKeyDown.bind(this));
      this.bodydiv.addEventListener('keypress', this._gotKeyPress.bind(this));
      this.bodydiv.addEventListener('keyup', this._gotKeyUp.bind(this));//*/
      this.bodydiv.addEventListener('mousedown', this._gotMouseDown.bind(this));
      this.bodydiv.addEventListener('mouseup', this._gotMouseUp.bind(this));
      this.bodydiv.addEventListener('click', this._gotMouseClick.bind(this));
      this.bodydiv.addEventListener('paste', this._gotPaste.bind(this));
      this.bodydiv.addEventListener('copy', this._gotCopy.bind(this));
      this.bodydiv.addEventListener('cut', this._gotCut.bind(this));
      this.bodydiv.addEventListener('dblclick', this._gotDoubleClick.bind(this));

      if (browser.getName() === "firefox")
        this.bodydiv.addEventListener('DOMNodeRemoved', this._gotDOMNodeRemoved.bind(this));
    }
  }

  _getImageDownloadURL()
  {
    return this.options.imgloadplaceholder || defaultimgplaceholder;
  }

  _createImageDownloadNode()
  {
    return <img src={this._getImageDownloadURL()} />;
  }

  _isStillImageDownloadNode(img)
  {
    return img.src == (this.options.imgloadplaceholder || defaultimgplaceholder);
  }

  _debugDataTransfer(event)
  {
    event.clipboardData.items.forEach(item=>
    {
      console.log("CP item", item, item.kind);

      if(item.kind=="string")
        item.getAsString(function(str) {console.warn(str);});
      else if(item.kind=="file")
      {
        var reader = new FileReader();
        reader.onload = function(event)
        {
          console.warn(event.target.result);
        };
        reader.readAsDataURL(item.getAsFile());
      }
    });
  }

  async uploadPastedImage(type, data, node)
  {
    let busylock = dompack.flagUIBusy();
    try
    {
      if(type == 'datatransfer')
        await this.uploadImageToServer(data, node);
      else if(type == 'url') //uploading remote image
        await this.uploadImageByURLToServer(data,node);
    }
    finally
    {
      busylock.release();
    }
  }

  _gotPaste(event)
  {
    if(dompack.debugflags.rte)
      console.log('[rte] paste', this, event);

    this.gotPaste(event);
  }

  async gotPaste(event)
  {
    if(event && event.clipboardData && event.clipboardData.items)
    {
      //this._debugDataTransfer(event);

      for(var i=0;i<event.clipboardData.items.length;++i)
      {
        var item = event.clipboardData.items[i];
        if(item.type == "image/png")
        {
          let file = item.getAsFile();
          if(!file)
            return; //giving up then

          var repl = this._createImageDownloadNode();
          this.replaceSelectionWithNode(repl, true);
          await this.uploadPastedImage('datatransfer', file, repl);
          //setTimeout(() => this.handlePasteDone(), 1); why go through this when just replacing one image ?
          return;
        }
      }
    }

    // Wait for the paste to happen, then
    setTimeout(() => this.handlePasteDone(), 1);
  }

  async handlePasteDone()
  {
    //Check for and remove hostile nodes
    dompack.qSA(this.getContentBodyNode(),"script,style,head").forEach(node => node.remove());

    let imgs = qSA(this.getContentBodyNode(),'img');
    imgs = imgs.filter(img => !this.rte.knownimages.includes(img.src) && !this._isStillImageDownloadNode(img) && img.isContentEditable);
    if(!imgs.length) //nothing to do
      return;

    let busylock = dompack.flagUIBusy();
    try
    {
      let replacementpromises = [];
      for(let img of imgs)
      {
        let downloadsrc = img.src;
        img.src = this._getImageDownloadURL();

        replacementpromises.push(formservice.getImgFromRemoteURL(downloadsrc)
          .then (result => this._handleUploadedRemoteImage(img, result) )
          .catch(result => this._handleUploadedRemoteImage(img, null) ));
      }
      await Promise.all(replacementpromises);
    }
    finally
    {
      busylock.release();
    }
  }

  _handleUploadedRemoteImage(img, properurl)
  {
    if(!properurl)
    {
      img.remove();
    }
    else
    {
      img.src = properurl;
      this.rte.knownimages.push(img.src);
    }
  }
  /* Surround selection directly if there is a selection, otherwise delay surrounding the selection until there was something
     typed */
  DelayedSurroundSelection(elementinfo)
  {
    if (this.getSelectionRange().isCollapsed())
    {
      //console.log('Delaying SurroundSelection');

      // If already on queue, see if canceling or repeating old action
      for (var i = 0; i < this.delayedsurrounds.length; ++i)
      {
        var info = this.delayedsurrounds[i];
        if (info.element == elementinfo.element)
        {
          if (info.wrapin == elementinfo.wrapin)
            return; // Already on queue

          // Canceling queued action by deleting it from the queue
          this.delayedsurrounds.splice(i, 1);
          //console.log('Currently '+this.delayedsurrounds.length+' surrounds delayed');
          this.stateHasChanged();
          return;
        }
      }
      // Add the action to the queue, execute it when there is a selection (i.e. when the user has typed something)
      this.delayedsurrounds.push(elementinfo);
      //console.log('Currently '+this.delayedsurrounds.length+' surrounds delayed');
      this.stateHasChanged();
    }
    else
    {
      // We have a selection, so execute the action immediately
      this._surroundSelection(elementinfo);
    }
  }

  ClearDelayedSurrounds()
  {
    //console.log('ClearDelayedSurrounds');console.trace();
    while (this.delayedsurrounds.length)
      this.delayedsurrounds.pop();
  }

  _createNodeFromElementInfo(elementinfo)
  {
    var newnode = document.createElement(elementinfo.element);
    if(elementinfo.attrs)
    {
      var attrnames = Object.keys(elementinfo.attrs).sort();
      for (var i = 0; i < attrnames.length; ++i)
        if(elementinfo.attrs[attrnames[i]] !== null)
          newnode.setAttribute(attrnames[i], elementinfo.attrs[attrnames[i]]);
    }
    return newnode;
  }

  _canWrapNode(elementinfo, node)
  {
    if (domlevel.isNodeBlockElement(node))
      return elementinfo.splitblockelements == true;
    return !(elementinfo.splitprohibits && elementinfo.splitprohibits.includes(node.nodeName.toLowerCase()));
  }

  _mustWrapNode(elementinfo, node)
  {
    return false;
  }

  surroundRange(range, elementinfo, undoitem)
  {
    //console.log('surroundrange start', richdebug.getStructuredOuterHTML(this.getContentBodyNode(), range));
    //var result = domlevel.surroundRange(range, elementinfo);

    domlevel.removeNodesFromRange(range, this.getContentBodyNode(), elementinfo.element, null, undoitem);

    if (elementinfo.wrapin)
    {
      console.log(elementinfo);
      domlevel.wrapRange(
            range,
            () => this._createNodeFromElementInfo(elementinfo),
            node => this._canWrapNode(elementinfo, node),
            node => this._mustWrapNode(elementinfo, node),
            null,
            undoitem);
    }

    //console.log('surroundrange end', richdebug.getStructuredOuterHTML(this.getContentBodyNode(), range));
  }

  _surroundSelection(elementinfo)
  {
    let undolock = this.getUndoLock();

    var range = this.getSelectionRange();
    if(elementinfo.avoidwhitespace)
    {
      //Try to remove spaces at begin and end iterator
      while(range.start.element.nodeType==3 && range.start.element.textContent[range.start.offset] == ' ' && range.start.compare(range.end) < 0)
        ++range.start.offset;
      while(range.end.element.nodeType==3 && range.end.element.textContent[range.end.offset-1] == ' ' && range.start.compare(range.end) < 0)
        --range.end.offset;
    }
    this.surroundRange(range, elementinfo, undolock.undoitem);
    this.selectRange(range);

    undolock.close();
  }

  stateHasChanged(firstcall) //ADDME check all code for superfluous calls (eg, invoking stateHasChange after invoking SetSelection which also did a stateHasChanged)
  {
    //save state before firing the event. save on processing with multiple getSelectionState calls, and make sure we have a selection state after display:none on firefox
    this.lastselectionstate = this.getFormattingStateForRange(this.getSelectionRange());

    // Update all table editors as tables' positions or contents may have changed
    this.updateTableEditors();

    this.onstatechange && this.onstatechange({ firstcall: firstcall });
  }

  getSelectionState(forceupdate)
  {
    if (forceupdate)
    {
      this.lastselectionstate = this.getFormattingStateForRange(this.getSelectionRange());
      this.updateTableEditors();
    }

    return this.lastselectionstate;
  }

  getTextStyleRecordFromNode(node)
  {
    var nodeName = node.nodeName.toLowerCase();
    if (nodeName == 'strong')
      nodeName = 'b';
    else if (nodeName == 'em')
      nodeName = 'i';
    else if (nodeName == 'a' && node.hasAttribute("href"))
      nodeName = "a-href";

    if(nodeName == 'b' && node.style.fontWeight == "normal")
      return null;// work around googledocs doing it

    return ({ nodeName:  nodeName });
  }

  isActionSupported(actionname) //do we support the requested (toolbar) action?
  {
    return [ "a-href"
           , "b", "i", "u", "sup", "sub", "strike"
           , "img", "action-properties", "action-clearformatting"
           ].includes(actionname);
  }

  getAvailableBlockStyles(selstate)
  {
    return [];
  }
  getAvailableTableCellStyles(selstate)
  {
    return [];
  }

  getActionsForNode(node)
  {
    var actions=[];
    for (var i=0;i<this.options.actionelements.length;++i)
    {
      var act = this.options.actionelements[i];
      if(act.element != node.nodeName.toLowerCase())
        continue;
      if(act.hasattributes)
      {
        let ismatch=true;
        for (let j=0;j<act.hasattributes.length;++j)
        {
          if(!node.hasAttribute(act.hasattributes[j]))
            ismatch=false;
        }
        if(!ismatch)
          continue;
      }
      if(act.hasclasses)
      {
        let ismatch=true;
        for (let j=0;j<act.hasclasses.length;++j)
          if(!node.classList.contains(act.hasclasses[j]))
            ismatch=false;
        if(!ismatch)
          continue;
      }
      actions.push(act);
    }
    return actions;
  }

  checkActionElements(node, formatting)
  {
    this.getActionsForNode(node).forEach(function(action)
    {
      formatting.actionelements.push(action);
      formatting.actiontargets.push(node);
    });
  }

  getFormattingStateForRange(range)
  {
    if(domlevel.getRangeLogLevel()&16)
      console.log("gFSR received range",range, range.start, range.end);

    var formatting = new TextFormattingState();

    // Range might be null, when we have an uninitialized iframe
    if (!range)
      return formatting;

    // We're modifying range in here
    range = range.clone();

    /* Word's behaviour:
       if there is a selection:
         bold, italic and underline are true if all characters in the selection hves that state
       if there is no selection:
         look at the previous character?

       Our behaviour:
       if there is any hyperlink within the selection
         hyperlink is true
       no selection:
         hyperlink at current character?
    */

    var alignment = '';

    formatting.haveselection = !range.isCollapsed();

    var locator = range.start.clone();

    if(domlevel.getRangeLogLevel()&16)
      console.log('selected before ascend', richdebug.getStructuredOuterHTML(range.getAncestorElement(), range));

//    console.log('selected after ascend', richdebug.getStructuredOuterHTML(range.getAncestorElement(), range));


    var anchornode = locator.element && locator.getNearestNode();

//    if(this.options.log)
//      console.log("Iterate parents");
//    var anchornode = sel.Node();
    for(let curnode = anchornode;curnode && curnode != this.bodydiv;curnode=curnode.parentNode)
    {
      switch(curnode.nodeName.toUpperCase())
      {
        case 'B': case 'STRONG': /* FIXME shouldn't generate STRONGs! */
        case 'I': case 'EM': /* FIXME shouldn't generate EMs! */
        case 'U':
        case 'INS':
        case 'DEL':
        case 'SUP':
        case 'SUB':
        case 'STRIKE':
          {
            let style = this.getTextStyleRecordFromNode(curnode);
            if(style)
              formatting.textstyles.push(style);
          }
          break;
        case 'A':
          formatting.textstyles.push(this.getTextStyleRecordFromNode(curnode));
          formatting.hyperlink=true;
          break;
        case 'UL':
          formatting.bulletedlist=true;
          break;
        case 'OL':
          formatting.numberedlist=true;
          break;

        case 'CENTER':
          alignment = alignment || 'center';
          break;

        case 'TABLE':
          formatting.tables.push(curnode);
          break;
      }
      if (curnode.getAttribute && curnode.getAttribute('align'))
        alignment = alignment || curnode.getAttribute('align');
      else if (curnode.style && curnode.style.textAlign)
        alignment = alignment || curnode.style.textAlign;
    }
    // Assuming left alignment when no other alignment is specified
    alignment = alignment || 'left';

    formatting.alignleft = alignment == 'left';
    formatting.aligncenter = alignment == 'center';
    formatting.alignright = alignment == 'right';
    formatting.alignjustified = alignment == 'justified';

    /* Action elements must be given back
       - first from within the range, DOM order
       - second from ancestor to root
    */

    var relevantnodes = range.getElementsByTagName('*');

    // Filter out non-contenteditable nodes (allow embbeded objects within a contenteditable parent)
    relevantnodes = relevantnodes.filter(node => node.isContentEditable || (domlevel.isEmbeddedObject(node) && node.parentNode.isContentEditable));

    for(let curnode = range.getAncestorElement();curnode && curnode != this.bodydiv;curnode=curnode.parentNode)
      relevantnodes.push(curnode);

    if(domlevel.getRangeLogLevel()&16)
      console.log('all gfsfr relevantnodes', relevantnodes);

    for (let i = 0; i < relevantnodes.length; ++i)
    {
      var node = relevantnodes[i];

      switch (node.nodeName.toUpperCase())
      {
        case 'A':
          formatting.hyperlink = true;
          break;
        case 'UL':
          formatting.bulletedlist=true;
          break;
        case 'OL':
          formatting.numberedlist=true;
          break;
      }
      this.checkActionElements(node, formatting);
    }

    // check delayed surrounds
    for (let i=0; i<this.delayedsurrounds.length; ++i)
    {
      var info = this.delayedsurrounds[i];
      var found = false;
      for (var pos = 0; pos < formatting.textstyles.length; ++pos)
      {
        if (formatting.textstyles[pos].nodeName == info.element)
        {
          formatting.textstyles.splice(pos, 1);
          found = true;
          break;
        }
      }
      if (!found)
        formatting.textstyles.push({ nodeName: info.element });
    }

    formatting.properties = formatting.actionelements.length != 0;

    var listdata = this.getLevelActionableListNodes(range);
    var actionparent = domlevel.findParent(anchornode, [ 'ol', 'ul', 'td', 'th' ], this.getContentBodyNode());
    formatting.actionparent = actionparent;

    // When the cursor is at the start of the next block, correct the end position to the end of the previous block element.
    var end_locator = range.end.clone();
    end_locator.scanBackward(this.getContentBodyNode(), { blocks: true, alwaysvisibleblocks: true });
    if (range.start.compare(end_locator) > 0) // Don't go past start
      end_locator = range.start;

    var startblock = this.getBlockAtNode(range.start.element).contentnode;
    var limitblock = this.getBlockAtNode(end_locator.element).contentnode;

    var tdparent = domlevel.findParent(anchornode, [ 'td', 'th' ], this.getContentBodyNode());
    formatting.cellparent = tdparent;

    var allow_td_actions = startblock == limitblock && tdparent;
    var tableeditor = allow_td_actions && tablesupport.getEditorForNode(tdparent.closest("table"));
    var tableactionstate = tableeditor && tableeditor.getActionState(tdparent);

    formatting.actionstate =
        { "li-increase-level":
              { available:  listdata.addable.length != 0
              }
        , "li-decrease-level":
              { available:  listdata.removeable.length != 0
              }
        , "a-href":
              { available:  !range.isCollapsed() || formatting.hyperlink
              }
        , "img":
              { available:  true//formatting.hasTextStyle("img")
              }
        , "action-properties":
              { available:  formatting.actionelements.length != 0
              }
        , "b":
              { available:  true
              , active:     formatting.hasTextStyle('b')
              }
        , "i":
              { available:  true
              , active:     formatting.hasTextStyle('i')
              }
        , "u":
              { available:  true
              , active:     formatting.hasTextStyle('u')
              }
        , "strike":
              { available:  true
              , active:     formatting.hasTextStyle('strike')
              }
        , "sub":
              { available:  true
              , active:     formatting.hasTextStyle('sub')
              }
        , "sup":
              { available:  true
              , active:     formatting.hasTextStyle('sup')
              }
        , "ol":
              { available:  true
              , active:     actionparent && actionparent.nodeName.toLowerCase() == 'ol'
              }
        , "ul":
              { available:  true
              , active:     actionparent && actionparent.nodeName.toLowerCase() == 'ul'
              }
        , "table-addrow-before":      { available: allow_td_actions }
        , "table-addrow-after":       { available: allow_td_actions }
        , "table-addpara-before":     { available: allow_td_actions }
        , "table-addpara-after":      { available: allow_td_actions }
        , "table-addcolumn-before":   { available: allow_td_actions }
        , "table-addcolumn-after":    { available: allow_td_actions }
        , "table-deleterow":          { available: allow_td_actions && tableeditor && tableeditor.numrows != 1 }
        , "table-deletecolumn":       { available: allow_td_actions && tableeditor && tableeditor.numcolumns != 1 }
        , "table-mergeright":         tableactionstate && tableactionstate["table-mergeright"] || { available: false }
        , "table-mergedown":          tableactionstate && tableactionstate["table-mergedown"] || { available: false }
        , "table-splitcols":          tableactionstate && tableactionstate["table-splitcols"] || { available: false }
        , "table-splitrows":          tableactionstate && tableactionstate["table-splitrows"] || { available: false }
        };

    if(this.options.allowtags)
      this._stripDisallowedTags(formatting);
    return formatting;
  }

  _isActionAllowed(action)
  {
    if (!this.options.allowtags)
      return true;

    var actionlist =
      [ { name: 'img',                requiretags: [ 'img' ] }
      , { name: 'a-href',             requiretags: [ 'a' ] }
      , { name: 'remove_hyperlink',   requiretags: [ 'a' ] }
      , { name: 'anchor',             requiretags: [ 'a' ] }
      , { name: 'insert_table',       requiretags: [ 'table', 'tr', 'td' ] }
      , { name: 'ul',                 requiretags: [ 'ul', 'li' ] }
      , { name: 'ol',                 requiretags: [ 'ol', 'li' ] }
      , { name: 'li-increase-level',  requiretags: [ 'li' ] }
      , { name: 'li-decrease-level',  requiretags: [ 'li' ] }
      , { name: 'b',                  requiretags: [ 'b' ] }
      , { name: 'u',                  requiretags: [ 'u' ] }
      , { name: 'i',                  requiretags: [ 'i' ] }
      , { name: 'strike',             requiretags: [ 'strike' ] }
      , { name: 'sub',                requiretags: [ 'sub' ] }
      , { name: 'sup',                requiretags: [ 'sup' ] }
      ] ;

    var actiondata;
    for (let i = 0; i < actionlist.length; ++i)
      if (actionlist[i].name == action)
      {
        actiondata = actionlist[i];
        break;
      }

    // Ignore the action if not all required tags are in the tagfilter (when supplied)
    if (actiondata)
    {
      for (let i = 0; i < actiondata.requiretags.length; ++i)
        if (!this.options.allowtags.includes(actiondata.requiretags[i]))
          return false;
    }
    return true;
  }

  _stripDisallowedTags(formatting)
  {
    if (formatting && this.options.allowtags)
    {
      Object.keys(formatting.actionstate).forEach(key =>
      {
        if (!this._isActionAllowed(key))
          formatting.actionstate[key].available = false;
      });
    }
  }

  _gotCopy(event)
  {
    // Add the copy-indicator class to the body node, to make sure embedded objects can be copied. Clear when the event is handled.
    this.getContentBodyNode().classList.add("wh-rtd-editor-bodynode--copying");
    Promise.resolve().then(() => this.getContentBodyNode().classList.remove("wh-rtd-editor-bodynode--copying"));
  }

  _gotCut(event)
  {
    // Check the dom after a cut
    this.scheduleCallbackOnInputOrDelay(this.checkDomStructure.bind(this), 'checkdom');
  }

  OnSelectionChange(event)
  {
    if (this.selectingrange) // Currently within our own selection calls, ignore
      return;

    /* This function corrects selections that give problems when replacing. It restricts selections
       that start in a table cell to that cell.

       Also, if the selection starts outside a table, and ends within one, the table is removed from the selection
    */

    //console.log.apply(console, richdebug.getStructuredOuterHTML(null, { range: range, base: base }, { title: "OSC start", colorize: true }));
    const { changed, range } = this._constrainRangeCrossTDSelections(this.getSelectionRange());

    if (changed)
      this.selectRange(range);
  }

  // Used on FF only!
  _gotDOMNodeRemoved(event)
  {
    // Node removed that's a child of the content node? Check the dom!
    // Needed because of select all+delete in context menu in ff & no selection change events
    if (event.relatedNode == this.getContentBodyNode())
      this.scheduleCallbackOnInputOrDelay(this.checkDomStructure.bind(this), 'checkdom');
  }

  SubtreeModified(target)
  {
    if(this.insubtreemod)
      return;

    this.insubtreemod=true;
    this.CleanupChildren(target);
    this.insubtreemod=false;
  }

  /** Check DOM structure
      @param range Range (optional, if range not set, use (& restore!) current selection)
  */
  checkDomStructure(range, preservelocators)
  {
  }

  tableEditorStateHasChanged()
  {
    // When the tableeditor triggers a state change, delay and coalesce the trigger
    // This because a state change triggers table editor updates again. Don't want to recurse them.
    if (!this.tableeditorstatechangedelay)
    {
      this.tableeditorstatechangedelay = setTimeout(() =>
      {
        this.tableeditorstatechangedelay = null;
        this.stateHasChanged();
      }, 0);
    }
  }

  initializeTableEditor(tablenode, resizing)
  {
    var editor = tablesupport.getEditorForNode(tablenode);
    if (editor)
    {
      editor.updateResizers();
      return;
    }

    var options = { onStatechange: this.tableEditorStateHasChanged.bind(this), getUndoLock: () => this.getUndoLock() };
    if (resizing)
    {
      options.resize_columns = resizing.includes("all") || resizing.includes("columns");
      options.resize_rows = resizing.includes("all") || resizing.includes("rows");
      options.resize_table = resizing.includes("all") || resizing.includes("table");
    }

    editor = new tablesupport.TableEditor(tablenode, this.getContentBodyNode(), options);
    this.tableeditors.push(editor);
  }

  _getResizingOptionsForTable(tablenode)
  {
    return ['all'];
  }

  _getEditableTables()
  {
    let retval = [];
    for(let node of qSA(this.getContentBodyNode(), "table"))
    {
      if (!node.isContentEditable)
        continue;
      let tableresizing = this._getResizingOptionsForTable(node);
      if(tableresizing)
        retval.push( { node, tableresizing} );
    }
    return retval;
  }

  updateTableEditors()
  {
    // Get list of all editable tables
    var list = this._getEditableTables();
    list.forEach(listitem => this.initializeTableEditor(listitem.node, listitem.tableresizing));

    // Destroy editors that are no longer active (i.e. the associated table is no longer present in the DOM), update active
    // editors
    this.tableeditors = this.tableeditors.filter(editor=>
    {
      var active = editor.isActive();
      if (!active)
        editor.destroy();
      return active;
    });

    // upon the first call we want to setup some measures to
    // be able to react to custom fonts having been loaded
    if(!this.__updateTableEditorsSetupDone)
    {
      this.__updateTableEditorsSetupDone = true;

      if(document.fonts && "onloadingdone" in document.fonts) //FF41+ and Chrome 35+ implement this
      {
        //whenever a font is loaded, resize table editors
        this.fontslistener = this.updateTableEditors.bind(this);
        document.fonts.addEventListener("loadingdone", this.fontslistener);
      }
      else // IE, Edge and Safari
      {
        // Keep updating the tableeditors for 5 seconds to give the rte time to load external css and fonts
        this.repeatupdatetableuntil = Date.now() + 5000;
      }
    }

    if(this.repeatupdatetableuntil && Date.now() < this.repeatupdatetableuntil && !this.scheduledupdatetableeditors)
    {
      //reschedule us on the next available frame after 200ms has passed
      this.scheduledupdatetableeditors = true;
      this.repeatupdatetabletimeout = setTimeout( (function() { this.repeatupdatetableanimframe = requestAnimationFrame(this.rescheduledUpdateTableEditors.bind(this)); }).bind(this), 200);
    }
  }



  rescheduledUpdateTableEditors()
  {
    this.scheduledupdatetableeditors = false;
    this.updateTableEditors();
  }

  _executeDeleteByKey(forward)
  {
    return false; // let the browser handle it
  }

  /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  //
  //  Event handling
  //

  _handleKeyCommand(event, names)
  {
    for (let keyname of names)
    {
      switch (keyname)
      {
        case "Accel+A":      {
                              event.preventDefault();
                              event.stopPropagation();
                              this.SelectAll();
                            } return;
        case "Accel+B":      { // apply bold
                              event.preventDefault();
                              event.stopPropagation();
                              this.executeAction("b");
                            } return;
        case "Accel+I":      { // I: Apply italic
                              event.preventDefault();
                              event.stopPropagation();
                              this.executeAction('i');
                            } return;
        case "Accel+U":      { // U: Apply underline
                              event.preventDefault();
                              event.stopPropagation();
                              this.executeAction('u');
                            } return;
        case "Shift+Enter": {
                              event.preventDefault();
                              event.stopPropagation();
                              this.executeSoftEnter();
                            } return;
        case "Enter":       {
                              if (!this.executeHardEnter())
                              {
                                event.preventDefault();
                                event.stopPropagation();
                                return;
                              }
                            } break;
        case "Tab":
        case "Shift+Tab":   { //these can affect apps, just prevent them from bubbling up, they have meaning to us..
                              event.stopPropagation();
                            } break;
        case "Delete":      {
                              if (this._executeDeleteByKey(true))
                              {
                                event.preventDefault();
                                event.stopPropagation();
                                return;
                              }
                            } break;
        case "Backspace":   {
                              if (this._executeDeleteByKey(false))
                              {
                                event.preventDefault();
                                event.stopPropagation();
                                return;
                              }
                            } break;
        case "F2":          { this._inspectCursorPosition(); event.preventDefault(); event.stopPropagation(); return; }
      }
    }
  }

  _inspectCursorPosition()
  {
    const range = this.getSelectionRange();
    let b = range.start, e = range.end;

    const bres = b.scanForward(this.getContentBodyNode(), {});
    const eres = e.scanBackward(this.getContentBodyNode(), {});

    const br = range.start.clone(); br.moveRight(this.getContentBodyNode());
    const el = range.end.clone(); el.moveLeft(this.getContentBodyNode());

    console.log('inspectres', richdebug.getStructuredOuterHTML(this.getContentBodyNode(), { range, b, e, br, el }, { indent: 1 }), bres, eres);
    console.log({ b, e, br, el });
  }

  _gotKeyDown(event)
  {
    if(!this.hasFocus())
    {
      event.preventDefault();
      console.log("Received keydown without having focus");
      return; //this keydown shouldn't have gotten here!
    }

    // Firefox doesn't have anything like selectionchange, so we need to do that before keys arrive
    if (browser.getName() === "firefox")
      this.OnSelectionChange(null);

    // User input is being handled, handle input events now!
    this._detectedInputEvent(event);

    this._handleKeyCommand(event, KeyboardHandler.getEventKeyNames(event));

    // Something might be done with this press, schedule a state update
    setTimeout(() =>
    {
      this.OnSelectionChange(event);
      this.stateHasChanged();
    },1);

    return true;
  }

  _gotKeyPress(event) //ADDME generalize/configurable key mappings. should this really be part of the whrte core anyway?
  {
    let eventdata = dompack.normalizeKeyboardEventData(event);
    if (eventdata.ctrlKey)
      return;

    this.OnSelectionChange(event);

    // enters keep delayed surrounds intact
    if (eventdata.key === "Enter")
      return;

    // Check the dom structure before applying the change. The cursor might be in an illegal place.
    this.checkDomStructure();

    var range = this.getSelectionRange();

    //console.log('keypressed', richdebug.getStructuredOuterHTML(this.getContentBodyNode(), range));
    //console.log(range.isCollapsed(), this.delayedsurrounds.length);
    if (this.delayedsurrounds.length)
    {
      if (!range.isCollapsed() || eventdata.key.length !== 1)
        this.ClearDelayedSurrounds();
      else
      {
        // Insert the pressed character at the current cursor position
        //console.log('pre sst "' + String.fromCharCode(charCode) + '"', richdebug.getStructuredOuterHTML(this.getContentBodyNode(), this.getSelectionRange()));
        this.insertTextAtCursor(eventdata.key);
        //console.log('post sst', richdebug.getStructuredOuterHTML(this.getContentBodyNode(), this.getSelectionRange()));

        //console.log('onKeyPressed, delay, pre: ', this.getContentsHTML());

        // Execute delayed surrounds
        for (var i=0; i<this.delayedsurrounds.length; ++i)
          this._surroundSelection(this.delayedsurrounds[i]);
        this.ClearDelayedSurrounds();

        //console.log('onKeyPressed, delay, post: ', this.getContentsHTML());

        // Set cursor directly after inserted text
        this.collapseSelection();
        //this.GetSelectionObject().Collapse();

        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }

    return true;
  }

  _gotKeyUp(event)
  {
    let eventdata = dompack.normalizeKeyboardEventData(event);

    // Don't clear delayed surrounds on enter, so they'll be transferred to the next line
    if (eventdata.key !== "Enter")
      this.ClearDelayedSurrounds();

    this.OnSelectionChange(event);
    this.stateHasChanged();
    return true;
  }

  _gotMouseDown(event)
  {
    this.ClearDelayedSurrounds();

    // When clicking on an image, select it
    if (event.target.nodeName.toUpperCase() == "IMG")
      this.selectNodeOuter(event.target);

    this.OnSelectionChange(event);
    this.stateHasChanged();

    // Delay 1 ms to pick up text selection changes for context menus. Also delay the context menu by 1ms and everything will be ok
    window.setTimeout( () =>
    {
      this.OnSelectionChange(event);
      this.stateHasChanged();
    },1);
    return true;
  }

  _gotMouseUp(event)
  {
    this.ClearDelayedSurrounds();
    window.setTimeout( () =>
    {
      this.OnSelectionChange(event);
      this.stateHasChanged();
    },1);
  }

  _gotMouseClick(event)
  {
  }
  _gotDoubleClick(event)
  {
    if (!event.target || !this.rte._isActive())
      return;
    //ADDME should there be more doubleclickable?
    if(event.target && event.target.nodeName.toUpperCase() == "IMG")
    { //double click on an image should open the action props
      this.selectNodeOuter(event.target);
      this.executeAction('action-properties');
    }
    event.stopPropagation();
    event.preventDefault();
  }

  setInputEventAttach(attach)
  {
    if (this.attachedinputevents == attach)
      return;

    if (!this.inputeventfunction)
      this.inputeventfunction = this._detectedInputEvent.bind(this);

    if (attach)
    {
      document.addEventListener('selectionchange', this.inputeventfunction);
      this.getContentBodyNode().addEventListener('input', this.inputeventfunction);
    }
    else
    {
      document.removeEventListener('selectionchange', this.inputeventfunction);
      this.getContentBodyNode().removeEventListener('input', this.inputeventfunction);
    }

    this.attachedinputevents = attach;
  }

  scheduleCallbackOnInputOrDelay(callback, name)
  {
    if (this.activeinputhandler == name)
      return;

    for (var i = 0; i < this.oninputhandlers.length; ++i)
      if (this.oninputhandlers[i].name == name)
        return;

    if (!this.oninputhandlers.length)
    {
      this.setInputEventAttach(true);
      this._delayedDetectedInputEvent(null);
    }

    this.oninputhandlers.push({ name: name, callback: callback });
  }

  _delayedDetectedInputEvent(event)
  {
    if (event)
      Promise.resolve(true).then(() => this._detectedInputEvent(event));
    else
      setTimeout(() => this._detectedInputEvent(null), 1);
  }

  _detectedInputEvent(event)
  {
    // Currently inside range code, just ignore
    if (this.selectingrange)
      return;

    if (this.oninputhandlers.length)
    {
      //console.log('inputdelay activated by ' + (event ? 'event ' + event.type : 'timeout'));
      var copy = this.oninputhandlers.slice();
      this.oninputhandlers = [];
      this.setInputEventAttach(false);

      for (var i = 0; i < copy.length; ++i)
      {
        this.activeinputhandler = copy[i].name;
        copy[i].callback();
      }

      this.activeinputhandler = '';
    }
  }

  setShowFormatting(show)
  {
    this.getContentBodyNode().classList.toggle('wh-rtd-formatting', Boolean(show));
    this.stateHasChanged();
  }

  getShowFormatting()
  {
    return this.getContentBodyNode().classList.contains("wh-rtd-formatting");
  }
  executeDefaultPropertiesAction(event)
  {
    if(event.target.nodeName == 'A')
    {
      let url = prompt(this.GetLanguageText('prompt_hyperlink'), event.target.href);
      if(url)
        event.target.href = url;
      return;
    }
  }

  /// Get an id for an action target (which can be used through RPC's and then used later using getActionTarget)
  _registerActionTarget(targetnode)
  {
    // FIXME: allow only one target in flight, mix in local id (unique per rtebase in rte) / edittoken?
    this.actiontargets.push(targetnode);
    return this.actiontargets.length;
  }

  getActionTarget(targetid)
  {
    var target = targetid > 0 && targetid <= this.actiontargets.length ? this.actiontargets[targetid-1] : null;
    if(target)
    {
      var findbody = this.getContentBodyNode();
      for(var trynode = target; trynode; trynode = trynode.parentNode)
        if(trynode == findbody)
          return target; //good news, the target is still in the DOM. Enjoy!
    }
    return null;
  }

  async newUploadInsertImage()
  {
    let lock = dompack.flagUIBusy();
    let files = await compatupload.selectFiles({ mimetypes: [ "image/*" ] });
    if(!files.length)
    {
      lock.release();
      return;
    }

    try
    {
      let imgnode = this._createImageDownloadNode();
      this.replaceSelectionWithNode(imgnode, true);
      await this.uploadImageToServer(files[0], imgnode);
    }
    finally
    {
      lock.release();
    }
  }

  //Upload an image to the server, and then replace the src in the specified image node
  async uploadImageToServer(filetoupload, imgnode)
  {
    let uploader = new compatupload.UploadSession([filetoupload]);//ADDME - should identify us as permitted to upload eg , { params: { edittoken: ...} });
    let res = await uploader.upload();
    let properurl = await formservice.getUploadedFileFinalURL(res[0].url);
    imgnode.src = properurl;
    this.rte.knownimages.push(imgnode.src);
    imgnode.classList.add("wh-rtd__img");

    await preload.promiseImage(imgnode.src); //don't return until the upload is done!
  }
  //FIXME if we can select embeddedobjects, we can merge this into executeAction
  launchActionPropertiesForNode(node, subaction)
  {
    let action = { action: 'action-properties'
                 , targetid: this._registerActionTarget(node)
                 , subaction: subaction
                 , rte: this.rte
                 };

    if(!dompack.dispatchCustomEvent(node, "wh:richeditor-action",
                         { bubbles: true
                         , cancelable: true
                         , detail: action
                         }))
      return;

    this.executeDefaultPropertiesAction({target:node, detail:action});
  }

  executeAction(action)
  {
    // Fallback for single string argument call without extra parameters - apparently everyone but the 'table' action doe sthis
    if (typeof action == "string")
      action = { action: action };

    if (!this._isActionAllowed(action.action))
      return;

    let actionnode = this.options.eventnode; //FIXME legacy! should just fire to the closest event possible for all actions
    if (action)
    {
      if(!action.action)
        throw new Error("Expected an 'action' value");

      action.rte = this.rte; //this is the RTE object

      if(action.action == 'a-href')
      {
        let selstate = this.getSelectionState();
        if(selstate.hyperlink) //inside a hyperlink
          action.action = 'action-properties'; //rewrite to a properties action
      }

      if(action.action == 'action-properties')
      {
        var selstate = this.getSelectionState();
        if(selstate.actionelements.length == 0)
          return;

        actionnode = selstate.actiontargets[0];
        action.targetid = this._registerActionTarget(actionnode);

        action.actiontarget = { __node: actionnode };
        //action.subaction = not needed yet on this route
      }
    }

    if(!dompack.dispatchCustomEvent(actionnode, "wh:richeditor-action",
                         { bubbles: true
                         , cancelable: true
                         , detail: action
                         }))
      return;


// FIXME for custom butons
    switch (action.action)
    {
      case "img":
        this.newUploadInsertImage();
        break;
      case 'a-href':
        {
          let url = prompt(this.GetLanguageText('prompt_hyperlink'), "http://");
          this.takeFocus();
          if (url)
            this.insertHyperlink(url);
        } break;
      case 'remove_hyperlink':
        this.RemoveHyperlink();
        break;
      case 'table':
        if (!action.size)
          throw "Expected size param for table action";
        this.insertTable(action.size.x, action.size.y);
        break;
      case 'ul':
        this._toggleBulletedList();
        break;
      case 'ol':
        this._toggleNumberedList();
        break;
      case 'li-increase-level':
        this.addListLevel();
        break;
      case 'li-decrease-level':
        this.removeListLevel();
        break;
      case 'align_left':
      case 'align_center':
      case 'align_right':
      case 'align_justified':
        this._setAlignment(action.action.substr(6));
        break;
      case 'undo':
        this._undo();
        break;
      case 'redo':
        this._redo();
        break;
      case 'action-clearformatting':
        if (confirm(this.GetLanguageText("messages_confirmclearformatting")))
          this._clearFormatting();
        break;
      case 'action-showformatting':
        this.setShowFormatting(!this.getShowFormatting());
        break;
      case 'action-properties':
        this.executeDefaultPropertiesAction({target:actionnode, detail:action});
        break;

      case 'b':
      case 'u':
      case 'i':
      case 'strike':
        this.applyTextStyle(action.action, !this.getSelectionState().hasTextStyle(action.action));
        break;
      case 'sub': // sub & sup are mutually recursive
      case 'sup':
        if (!this.getSelectionState().hasTextStyle(action.action))
          this.applyTextStyle((action.action == 'sub' ? 'sup' : 'sub'), false);
        this.applyTextStyle(action.action, !this.getSelectionState().hasTextStyle(action.action));
        break;

      case "table-addpara-before":
      case "table-addpara-after":
      {
        let node = this.getSelectionState().actionparent;
        let tablenode = node.closest("table");
        this.insertEmptyParagraph(tablenode, action.action === "table-addpara-after");
      } break;
      case "table-addrow-before":
      case "table-addrow-after":
      case "table-addcolumn-before":
      case "table-addcolumn-after":
      case "table-deletecolumn":
      case "table-deleterow":
      case "table-mergeright":
      case "table-mergedown":
      case "table-splitcols":
      case "table-splitrows":
      {
        var node = this.getSelectionState().actionparent;
        var tablenode = node.closest("table");
        var editor = tablesupport.getEditorForNode(tablenode);
        switch (action.action)
        {
          case "table-addrow-before":
          case "table-addrow-after":      editor.insertRows(node, action.action === "table-addrow-before", 1, node.offsetHeight, { newcell_callback: this._initNewTableCell.bind(this) }); break;
          case "table-addcolumn-before":
          case "table-addcolumn-after":   editor.insertColumns(node, action.action === "table-addcolumn-before", 1, 32, { newcell_callback: this._initNewTableCell.bind(this) }); break;
          case "table-deleterow":         editor.deleteRows(node, 1); break;
          case "table-deletecolumn":      editor.deleteColumns(node, 1); break;
          case "table-mergeright":        editor.mergeRight(node); break;
          case "table-mergedown":         editor.mergeDown(node); break;
          case "table-splitcols":         editor.splitCols(node); break;
          case "table-splitrows":         editor.splitRows(node); break;
        }
        break;
      }
    }
  }

  /** Initialize a new table cell created by table-addrow/table-addcolumn
      @param cellnode Table cell node (td or th)
  */
  _initNewTableCell(cellnode)
  {
  }

  /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  //
  //  Language texts
  //

  _getLangTexts()
  {
    if (!this._langtexts)
    {
      this._langtexts =
               { en: { buttonbar_bold: "Bold"
                     , buttonbar_italic: "Italic"
                     , buttonbar_underline: "Underline"
                     , buttonbar_insert_image: "Insert Image"
                     , buttonbar_insert_hyperlink: "Insert Hyperlink"
                     , buttonbar_remove_hyperlink: "Remove Hyperlink"
                     , buttonbar_anchor: "Bookmark"
                     , buttonbar_insert_table: "Insert Table"
                     , buttonbar_bulleted_list: "Bulleted List"
                     , buttonbar_numbered_list: "Numbered List"
                     , buttonbar_align_left: "Align left"
                     , buttonbar_align_center: "Center"
                     , buttonbar_align_right: "Align right"
                     , buttonbar_align_justified: "Justify"
                     , buttonbar_undo: "Undo"
                     , buttonbar_redo: "Redo"
                     , buttonbar_clear_formatting: "Clear Formatting"
                     , prompt_hyperlink: "Hyperlink URL"
                     , messages_openlink: "%1<br/><b>Shift + click to open in a new window</b>"
                     , messages_anchor: "Bookmark #%1"
                     , messages_confirmclearformatting: "Are you sure you want to discard all style?\n\nThis operation cannot be undone."
                     , messages_confirmclearcontents: "Are you sure you want to delete all contents?\n\nThis operation cannot be undone."
                     }
               , nl: { buttonbar_bold: "Vet"
                     , buttonbar_italic: "Cursief"
                     , buttonbar_underline: "Onderstrepen"
                     , buttonbar_insert_image: "Afbeelding invoegen"
                     , buttonbar_insert_hyperlink: "Hyperlink invoegen"
                     , buttonbar_remove_hyperlink: "Hyperlink verwijderen"
                     , buttonbar_anchor: "Bladwijzer"
                     , buttonbar_insert_table: "Tabel invoegen"
                     , buttonbar_bulleted_list: "Lijst met opsommingstekens"
                     , buttonbar_numbered_list: "Genummerde lijst"
                     , buttonbar_align_left: "Links uitlijnen"
                     , buttonbar_align_center: "Centreren"
                     , buttonbar_align_right: "Rechts uitlijnen"
                     , buttonbar_align_justified: "Uitvullen"
                     , buttonbar_undo: "Ongedaan maken"
                     , buttonbar_redo: "Opnieuw"
                     , buttonbar_clear_formatting: "Opmaak verwijderen"
                     , prompt_hyperlink: "URL voor de hyperlink"
                     , messages_openlink: "%1<br/><b>Shift + klik om in een nieuw venster te openen</b>"
                     , messages_anchor: "Bladwijzer #%1"
                     , messages_confirmclearformatting: "Weet u zeker dat u alle opmaak wilt verwijderen?\n\nDeze operatie kan niet ongedaan gemaakt worden."
                     , messages_confirmclearcontents: "Weet u zeker dat u alle inhoud wilt verwijderen?\n\nDeze operatie kan niet ongedaan gemaakt worden."
                     }
               };
    }
    return this._langtexts;
  }

  GetLanguageText(name, param1, param2)
  {
    let langtexts = this._getLangTexts();
    if (langtexts[this.language] && langtexts[this.language][name])
      return (langtexts[this.language][name]).split('%1').join(param1).split('%2').join(param2);
    return "";
  }

  requireBottomParagraph()
  {
    // overridden by structured editor
  }
}

class TextFormattingState
{
  constructor()
  {
    this.hyperlink = false;
    this.bulletedlist = false;
    this.numberedlist = false;
    this.alignleft = false;
    this.aligncenter = false;
    this.alignright = false;
    this.alignjustified = false;
    this.haveselection = false;

    this.textstyles = [];
    this.actionelements = [];
    this.actiontargets = [];

    this.actionstate = {};
    this.actionparent = null; // nearest ol/ul/td/th

    this.tables = [];
    this.blockstyle = null;
  }

  hasTextStyle(nodeName)
  {
    return this.getTextStyleByNodeName(nodeName) != null;
  }

  getTextStyleByNodeName(nodeName)
  {
    for (var i = 0; i < this.textstyles.length; ++i)
      if (this.textstyles[i].nodeName == nodeName)
        return this.textstyles[i];
    return null;
  }

}

EditorBase.TextFormattingState = TextFormattingState;
module.exports = EditorBase;
