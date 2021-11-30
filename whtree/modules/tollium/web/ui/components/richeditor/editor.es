import * as dompack from 'dompack';
import { qS, qSA } from 'dompack';
import ScrollMonitor from '@mod-tollium/js/internal/scrollmonitor';
import KeyboardHandler from "dompack/extra/keyboard";
import * as browser from "dompack/extra/browser";

import StructuredEditor from './internal/structurededitor';
import * as domlevel from './internal/domlevel';
import FreeEditor from './internal/free-editor';
var TableEditor = require('./internal/tableeditor');
import RTEToolbar from './internal/toolbar';
import * as menu from '@mod-tollium/web/ui/components/basecontrols/menu';
import getTid from "@mod-tollium/js/gettid";
import "@mod-tollium/web/ui/components/richeditor/richeditor.lang.json";

import { convertHtmlToPlainText } from "@mod-system/js/internal/converthtmltoplaintext";

export function getDefaultToolbarLayout()
{
  return [ [ "p-class", ["ul","ol","li-decrease-level","li-increase-level"], ["p-align-left","p-align-right","p-align-center","p-align-justify"], ["action-spellcheck","action-search","action-showformatting","action-properties"]
           , ["b","i","u","strike"], ["sub","sup"], ["a-href"], ["img","object-video","object-insert","table","action-symbol"], ["action-clearformatting"]
           ]
         ];
}

export class RTE
{
  constructor(container, options)
  {
    this.container = container;
    this.toolbar = null;
    this.editable = false;
    this.editnode = null;
    this.editrte = null;
    //this.iframe:null

    this.htmldiv = null;
    this.bodydiv = null;

    this.showformatting = false;

    this.cachededitors = [];

    this.editoridcounter = 0;
    this.editors = {};
    this.addcss = [];

    this.pageframe = null;

      /// Whether document is dirty. Initial set to true to avoid firing events during init
    this.dirty = true;
    this.original_value = "<neverset>";
      //URLs of images we have already seen and stored on the server
    this.knownimages = [];

    this.options = { structure: null
                   , allowtags: null
                   , hidebuttons: []
                   , content: ''
                   , enabled: true
                   , readonly: false
                   , log: false
                   , selfedit: false
                   , pageedit: false
                   //, actionhandler: null
                   , cssinstance: null
                   , csslinks:null
                   , csscode:''
                   , breakupnodes: []
                   , htmlclass: ''
                   , bodyclass: ''

                   , contentarea: true //display a content area if possible
                   , editembeddedobjects: true
                   , allowundo: true
                   , margins: 'compact'
                   , propertiesaction: false //add properties button to toolbar/menus (only set if you're going to intercept action-properties)
                   , toolbarlayout: null
                   , ...options
                   };

    if(options && options.toolbarnode)
      this.toolbarnode = options.toolbarnode;

    if(this.container.whRTD)
      throw new Error("Duplicate RTD initialization");

    this.container.whRTD = this;

    if(dompack.debugflags.rte)
      console.log("[rte] initializing rtd",this.container, this.options);

    if (!this.options.selfedit)
    {
      this.toolbarnode = dompack.create("div");
      //the 'style scope' node is the point from which we apply the rewritten css. it needs to be the immediate parent of the wh-rtd__html node
      this.stylescopenode = dompack.create("div", { className: "wh-rtd__stylescope " + (this.options.cssinstance || '') });

      //ADDME globally manage css loaded by instances
      if(this.options.csslinks)
        this.options.csslinks.forEach(href => this.addcss.push({type:"link", src: href}));

      if(this.options.csscode)
        this.addcss.push({type:"style",src:this.options.csscode});

      //Create two divs inside the container, which will play the role of HTML and BODY
      this.bodydiv = dompack.create("div", { className: "wh-rtd-editor wh-rtd__body wh-rtd-editor-bodynode " + this.options.bodyclass
                                           , innerHTML : this.container.innerHTML
                                           , on: { "dompack:takefocus": evt => this._takeSafeFocus(evt) }
                                           });
      this.htmldiv = dompack.create("div", { className: "wh-rtd-editor wh-rtd__html wh-rtd-editor-htmlnode " + this.options.htmlclass
                                           , childNodes: [ this.bodydiv]
                                           });
      if(this.options.structure)
        this.container.classList.add("wh-rtd--structured");

      if (browser.getName() === "safari" && browser.getVersion() < 13)
        this.bodydiv.classList.add("wh-rtd__body--safariscrollfix");

      dompack.empty(this.container);
      this.container.classList.add("wh-rtd__editor");
      this.container.appendChild(this.toolbarnode);

      this.stylescopenode.appendChild(this.htmldiv);
      this.container.appendChild(this.stylescopenode);

      this.scrollmonitor = new ScrollMonitor(this.container);
      ScrollMonitor.saveScrollPosition(this.container);
    }
    else
    {
      this.htmldiv = container.ownerDocument.documentElement;
      this.bodydiv = container.ownerDocument.body;
    }

    this.htmldiv.addEventListener("mousedown", evt => this._gotPageClick(evt));
    this.htmldiv.addEventListener("click", evt => this._gotClick(evt));
    this.htmldiv.addEventListener("contextmenu", evt => this._gotContextMenu(evt));

    if(this.toolbarnode)
    {
      var toolbaropts = { hidebuttons: this.options.hidebuttons
                        , allowtags: this.options.allowtags
                        , layout: this.options.toolbarlayout || getDefaultToolbarLayout()
                        };

      if(this.options.structure)
      {
        toolbaropts.hidebuttons.push('action-clearformatting');
      }
      else
      {
        toolbaropts.hidebuttons.push('p-class','action-showformatting','object-insert','object-video','table');
        toolbaropts.compact = true;
      }
      if(!this.options.propertiesaction)
        toolbaropts.hidebuttons.push('action-properties');

      this.toolbarnode.classList.add("wh-rtd-toolbar");
      this.toolbar = new RTEToolbar(this, this.toolbarnode, toolbaropts);

      if (this.options.readonly)
        this.toolbarnode.style.display = "none";
    }

    this.gotPageFrameLoad();

    RTE.register(this);
    this.clearDirty();
  }

  // ---------------------------------------------------------------------------
  //
  // Helper functions
  //

  _takeSafeFocus (evt)
  {
    //TODO? An alternative approach might be to have the ScrollMonitor watch focus events ?
    //take focus but save scroll position  (ADDME for non-body nodes too!)
    evt.preventDefault();

    let scrollleft = evt.target.parentNode.scrollLeft;
    let scrolltop = evt.target.parentNode.scrollTop;

    evt.target.focus(); //on chrome, focus resets scroll position. https://bugs.chromium.org/p/chromium/issues/detail?id=75072

    evt.target.parentNode.scrollLeft = scrollleft;
    evt.target.parentNode.scrollTop = scrolltop;
  }

  _gotContextMenu(event)
  {
    // with ctrl-shift, don't react on the event, fallback to browser menu
    if (event.ctrlKey && event.shiftKey)
      return;

    event.stopPropagation();
    event.preventDefault();

    // Contextmenu event changes selection, but the select event will fire later, so force update when getting the state.
    if(this.editrte)
      this.editrte._gotSelectionChange(null); //Fixes Chrome's weird cross-td-boundary selection right click

    let selectionstate = this.getSelectionState(true);
    if(!selectionstate)
      return;

    let actiontarget = selectionstate.actiontargets.length ? this.getTargetInfo({__node: selectionstate.actiontargets[0] }) : null;

    let menuitems = [];
    for(let menuitem of
                    [ { action: "table-addrow-before", title: getTid("tollium:components.rte.table_addrow_before") }
                    , { action: "table-addrow-after", title: getTid("tollium:components.rte.table_addrow_after") }
                    , null
                    , { action: "table-addcolumn-before", title: getTid("tollium:components.rte.table_addcolumn_before") }
                    , { action: "table-addcolumn-after", title: getTid("tollium:components.rte.table_addcolumn_after") }
                    , null
                    , { action: "table-deleterow", title: getTid("tollium:components.rte.table_deleterow")  }
                    , { action: "table-deletecolumn", title: getTid("tollium:components.rte.table_deletecolumn")  }
                    , null
                    , { action: "table-addpara-before", title: getTid("tollium:components.rte.table_addpara_before")  }
                    , { action: "table-addpara-after", title: getTid("tollium:components.rte.table_addpara_after")  }
                    , null
                    , { action: "table-mergeright", title: getTid("tollium:components.rte.table_mergeright")  }
                    , { action: "table-mergedown", title: getTid("tollium:components.rte.table_mergedown")  }
                    , { action: "table-splitcols", title: getTid("tollium:components.rte.table_splitcols")  }
                    , { action: "table-splitrows", title: getTid("tollium:components.rte.table_splitrows")  }
                    , null
                    , ...(this.options.propertiesaction ? [{ action: "action-properties", title: getTid("tollium:components.rte.properties") }] : [])
                    ])
    {
      if(!menuitem || selectionstate.actionstate[menuitem.action].available)
        menuitems.push(menuitem);
    }

    if(!dompack.dispatchCustomEvent(this.bodydiv, "wh:richeditor-contextmenu", { bubbles: true
                                                                               , cancelable: true
                                                                               , detail: { actiontarget, menuitems }
                                                                               }))
    {
      return;
    }

    let contextmenu = <ul onClick={evt => this._activateRTDMenuItem(evt, actiontarget)}>
                        { menuitems.map( item => item ? <li data-action={item.action}>{item.title}</li> : <li class="divider" />) }
                      </ul>;

    menu.openAt(contextmenu, event, { eventnode: this.node });
  }

  _activateRTDMenuItem(evt, actiontarget)
  {
    dompack.stop(evt);
    let item = evt.target.closest('li');
    this.executeAction(item.dataset.action, actiontarget);
  }

  //get the current dirty flag
  isDirty()
  {
    return this.dirty;
  }

  //clear dirty state
  clearDirty()
  {
    this.original_value = this.getValue();
    this.dirty = false;
  }

  _checkDirty()
  {
    if (this.dirty)
      return;

    this.dirty = this.original_value != this.getValue();
    if (this.dirty)
    {
      if (dompack.debugflags.rte)
        console.log("[rte] Document got dirty, firing event");

      dompack.dispatchCustomEvent(this.container, "wh:richeditor-dirty", { bubbles: true, cancelable: false });
    }
  }

  getEditNode (node)
  {
    if(!this.options.pageedit && !this.options.selfedit)
      return this.basenode;

    for(;node &&node != this.basenode; node = node.parentNode)
    {
      if (!node.getAttribute)
        continue;

      if (node.hasAttribute('data-wh-rtd-editable'))
        return node;

      // Also pick up tableeditor resize handlers, redirect them to table node
      if (node.classList.contains('wh-tableeditor-resize-holder'))
        node = node.propWhTableeditor.node;
    }
    return null;
  }

  createEditor (edittarget)
  {
    var editoropts = { log: this.options.log
                     , designmode: false
                     , eventnode: this.container
                     , breakupnodes: this.options.breakupnodes
                     , editembeddedobjects: this.options.editembeddedobjects
                     , allowundo: this.options.structure && (!!this.options.undoholder || this.options.allowundo)
                     };

    var editor;
    if(this.options.structure)
    {
      /*
      NOTE: contenteditable makes the node focusable, however the wh-rtd__undoholder is a hidden node we don't want to be focused.
            We prevent it from appearing in (and messing up) tabnavigation we also add tabindex="-1" in addition to the contenteditable="true".
      */

      let undonode = null;
      if (this.options.undoholder) //FIXME not sure if we need this, might be needed for page editor
      {
        editoropts.allowundo = true;
        undonode = <div contenteditable="true" class="wh-rtd__undoholder" tabindex="-1" />;
        //dompack.create('div', { contentEditable: true, style: {opacity:1}});
        this.options.undoholder.appendChild(undonode);
      }
      else if (this.options.allowundo)
      {
        undonode = <div contenteditable="true" class="wh-rtd__undoholder" tabindex="-1" />;
        this.container.appendChild(undonode);
      }

      editoropts.structure = this.options.structure; //FIXME limit structure to what is needed here
      editor = new StructuredEditor(edittarget, this, editoropts, undonode);
    }
    else
    {
      editoropts.allowtags = this.options.allowtags;
      editoropts.allowundo = false;
      editor = new FreeEditor(edittarget, this, editoropts);
    }

    editor.setShowFormatting(this.showformatting);
    return editor;
  }

  connectEditor(editnode)
  {
    if(dompack.debugflags.rte)
      console.log("[rte] connecting editor",editnode, editnode.wh_editor_id);
    if (!editnode.wh_editor_id)
    {
      editnode.wh_editor_id = ++this.editoridcounter;
      this.editors[editnode.wh_editor_id] = this.createEditor(editnode);
    }

    this.disconnectCurrentEditor();

    this.editnode = editnode;
    this.editrte = this.editors[editnode.wh_editor_id];

    this.editrte.editareaconnect();
    this.basenode.classList.add("wh-rtd-editing");
    this.editrte.onstatechange = this._gotStateChange.bind(this);

    this.editable = true;
  }

  disconnectCurrentEditor()
  {
    if (this.editrte)
    {
      this.editrte.onstatechange = null;

      this.editrte.editareadisconnect();
      this.basenode.classList.remove("wh-rtd-editing");

      this.editrte.destroy();
    }

    this.editnode = null;
    this.editrte = null;

    this.editable = false;
  }

  _isActive()
  {
    return this.options.enabled && !this.options.readonly;
  }

  // ---------------------------------------------------------------------------
  //
  // Callbacks
  //
  _gotClick(event)
  {
    dompack.stop(event); //no click should ever escape an RTE area

    let linkel = event.target.closest('a[href]');
    if(linkel
        && linkel.href.match(/^https?:/)
        && (!this._isActive() || KeyboardHandler.hasNativeEventMultiSelectKey(event)))
    {
        window.open(linkel.href, '_blank');
    }
  }

  _gotPageClick(event)
  {
    if (!this._isActive())
      return;

    let editnode = this.getEditNode(event.target);
    if (this.editnode != editnode)
    {
      if (this.editnode)
        this.disconnectCurrentEditor();
      if (editnode)
        this.connectEditor(editnode);
      this._fireStateChange();
    }
    else if (editnode)
    {
      let lastelt = editnode.lastElementChild;
      if (!lastelt || event.clientY > lastelt.getBoundingClientRect().bottom)
        this.editrte.requireBottomParagraph();
    }

    // clicked on the html-div?
    if (this.editnode && this.editnode.parentNode === event.target)
    {
      // focus body node instead
      this.editnode.focus();
      event.preventDefault();
    }
  }

  _updateEnablingAttributes()
  {
    let rtdstatenode = this.stylescopenode || this.htmldiv;
    rtdstatenode.classList.toggle('wh-rtd--enabled', this._isActive());
    rtdstatenode.classList.toggle('wh-rtd--disabled', !this.options.enabled);
    rtdstatenode.classList.toggle('wh-rtd--readonly', this.options.readonly);
  }

  gotPageFrameLoad()
  {
    this.basenode = this.getBody();
    this.basenode.classList.add("wh-rtd");
    this.basenode.classList.add("wh-rtd-editor");
    this.basenode.classList.add("wh-rtd-theme-default");
    this._updateEnablingAttributes();

    let margins = 'none';
    if(this.options.structure && this.options.structure.contentareawidth)
    {
      if(this.options.contentarea)
      {
        this.basenode.parentNode.classList.add('wh-rtd-withcontentarea');
        this.basenode.classList.add('wh-rtd__body--contentarea');
      }
      this.basenode.style.width = this.options.structure.contentareawidth; //NOTE: already contains 'px'
      margins = this.options.margins;
    }

    if (!this.options.selfedit)
    {
      this.htmldiv.classList.add("wh-rtd--margins-" + margins);
      if(margins != 'none') //include -active if -any- margin is present. should replace wh-rtd-withcontentarea and wh-rtd__body--contentarea eventually
        this.htmldiv.classList.add("wh-rtd--margins-active");
    }

    if (!this.options.selfedit && !this.options.pageedit)
      this.connectEditor(this.bodydiv);

    if (!this._isActive())
      this.disconnectCurrentEditor();

    this._fireStateChange();
  }

  _gotStateChange(event)
  {
    this._fireStateChange();
    this._checkDirty();
  }

  _fireStateChange()
  {
    dompack.dispatchCustomEvent(this.bodydiv, 'wh:richeditor-statechange', { bubbles: true, cancelable: false});
  }

  // ---------------------------------------------------------------------------
  //
  // Action and content API
  //
  insertHyperlink(link, options)
  {
    this.editrte.insertHyperlink(link,options);
    this._checkDirty();
  }

  getTargetInfo(actiontarget) //provide JSON-safe information about the action target
  {
    let node = actiontarget.__node;
    if(node.matches('a'))
    {
      return { type: 'hyperlink'
             , link: node.getAttribute("href") //note that getAttribute gives the 'true' link but 'href' may give a resolved link
             , target: node.target || ''
             , __node: node
             };
    }
    else if(node.matches('td,th'))
    {
      let tablenode = node.closest('table');
      let editor = TableEditor.getEditorForNode(tablenode);
      return { type: 'cell'
             , tablestyletag: tablenode.classList[0]
             , cellstyletag: node.classList[1] || ''
             , datacell: editor.locateFirstDataCell()
             , numrows: editor.numrows
             , numcolumns: editor.numcolumns
             , __node: node
             };
    }
    else if(node.matches('.wh-rtd-embeddedobject'))
    {
      return { type: 'embeddedobject'
             , instanceref:  node.dataset.instanceref
             , __node: node
             };
    }
    else if(node.matches('img'))
    {
      let align = node.classList.contains("wh-rtd__img--floatleft") ? 'left' : node.classList.contains("wh-rtd__img--floatright") ? 'right' : '';
      let linkinfo = null;
      let link = node.closest('a');
      if(link)
        linkinfo = { link: link.href
                   , target: link.target || ''
                   };

      return { type: 'img'
             , align: align
             , width:  parseInt(node.getAttribute("width")) || node.width
             , height: parseInt(node.getAttribute("height")) || node.height
             , alttext: node.alt
             , link: linkinfo
             , src: node.src
             , __node: node
             };
    }
    return null;
  }
  updateTarget(actiontarget, settings)
  {
    const undolock = this.getEditor().getUndoLock();

    let node = actiontarget.__node;
    if(node.matches('a'))
      this._updateHyperlink(actiontarget.__node, settings);
    else if(node.matches('td,th'))
      this._updateCell(actiontarget.__node, settings);
    else if(node.matches('.wh-rtd-embeddedobject'))
    {
      if(node.classList.contains("wh-rtd-embeddedobject"))
      {
        //we'll simply reinsert
        if (settings)
        {
          if (settings.type == 'replace')
          {
            this.getEditor().updateEmbeddedObject(node, settings.data);
          }
          else if (settings.type == 'remove')
          {
            this.getEditor().removeEmbeddedObject(node);
          }
        }
      }
    }
    else if(node.matches('img'))
    {
      node.width = settings.width;
      node.height = settings.height;
      node.align = '';
      node.alt = settings.alttext;
      node.className = "wh-rtd__img" + (settings.align=='left' ? " wh-rtd__img--floatleft" : settings.align=="right" ? " wh-rtd__img--floatright" : "");

      var link = node.closest('A');
      if(link && !settings.link) //remove the hyperlink
      {
        link.replaceWith(node);
        this.editrte.selectNodeOuter(node);
      }
      else if (settings.link) //add or update a hyperlink
      {
        if(!link)
        {
          //replace the image with the link
          link = document.createElement('a');
          node.replaceWith(link);
          link.appendChild(node);
          this.editrte.selectNodeOuter(link);
        }

        link.href = settings.link.link;
        link.target = settings.link.target || '';
      }
    }
    else
    {
      console.error(node,settings);
      throw new Error("Did not understand action target");
    }
    undolock.close();
  }

  _updateHyperlink(node, settings)
  {
    const undolock = this.editrte.getUndoLock();

    if(settings.destroy) //get rid of the hyperlink
    {
      this.editrte.selectNodeOuter(node);
      this.editrte.removeHyperlink();
    }
    else
    {
      if('link' in settings)
        node.setAttribute("href",settings.link);
      if('target' in settings)
        if(settings.target)
          node.target = settings.target;
        else
          node.removeAttribute('target');
    }

    this._checkDirty();
    undolock.close();
  }

  _updateCell(node, settings)
  {
    let table = node.closest('table');
    if(settings.removetable)
    {
      this.getEditor().removeTable(table);
      return;
    }

    //apply cell update before table updates... the table might destroy our node! (eg if it gets replaced by a TH)
    this.getEditor().setCellStyle(node, settings.cellstyletag);

    let editor = TableEditor.getEditorForNode(table);
    if (editor)
    {
      editor.setFirstDataCell(settings.datacell.row, settings.datacell.col);
      editor.setStyleTag(settings.tablestyletag);
    }
  }

  // ---------------------------------------------------------------------------
  //
  // Public API
  //

  destroy()
  {
    this.disconnectCurrentEditor();
    this.cachededitors.forEach(editor => editor.destroy());
    this.toolbarnode.remove();
    RTE.unregister(this);
  }

  getContainer()
  {
    return this.container;
  }

  getBody()
  {
    return this.bodydiv || this.container;
  }

  qS(selector)
  {
    return this.getBody().querySelector(selector);
  }

  qSA(selector)
  {
    return Array.from(this.getBody().querySelectorAll(selector));
  }

  getButtonNode(actionname)
  {
    return this.toolbarnode.querySelector('span.wh-rtd-button[data-button=' + actionname + ']');
  }

  isEditable()
  {
    return this.editable;
  }

  getEditor()
  {
    if(this.editrte)
      return this.editrte;
    return null;
  }

  getValue()
  {
    var returntree = this.getBody().cloneNode(true);

    //clean embedded objects
    domlevel.queryEmbeddedObjects(returntree).forEach(node =>
    {
      node.contentEditable="inherit";
      dompack.empty(node);
    });

    //clean table editors
    TableEditor.cleanupTree(returntree);

    qSA(returntree, "*[tabindex], *[todd-savedtabindex]").forEach(item =>
    {
      item.removeAttribute("tabindex");
      item.removeAttribute("todd-savedtabindex");
    });

    return returntree.innerHTML;
  }

  setValue(val)
  {
    this.dirty = true;

    this.bodydiv.innerHTML = val;
    if (this.getEditor())
      this.getEditor().resetUndoStack();
    this.knownimages = qSA(this.bodydiv, 'img').map(node => node.src);

    if(this.getEditor())
      this.getEditor().reprocessAfterExternalSet();
    else
    {
      //connect and disconnect to ensure the content is rewritten and previews become available
      if (!this.options.selfedit && !this.options.pageedit)
      {
        this.connectEditor(this.bodydiv);
        this.getEditor().reprocessAfterExternalSet();
        this.disconnectCurrentEditor();
      }
    }

    this.original_value = this.getValue();
    this.dirty = false;

    this._checkDirty();
  }

  focus()
  {
    if(this.editrte)
      this.editrte.bodydiv.focus();
  }

  takeFocus()
  {
    if (this.editrte)
      this.editrte.takeFocus();
  }

  getSelectionState(forceupdate)
  {
    return this.editrte && this.editrte.getSelectionState(forceupdate);
  }

  getShowFormatting()
  {
    return this.showformatting;
  }

  setShowFormatting(newshowformatting)
  {
    this.showformatting = newshowformatting;
    Object.keys(this.editors, key => this.editors[key].setShowFormatting(newshowformatting));
  }

  getAvailableBlockStyles(selstate)
  {
    return this.editrte ? this.editrte.getAvailableBlockStyles(selstate) : [];
  }

  executeAction(action, actiontarget)
  {
    //FIXME: RTE should handle the action and dispatch to the active editor, so it can handle global rte actions (like show
    //       formatting)
    this.editrte && this.editrte.executeAction(action, actiontarget);
  }

  setSelectionBlockStyle(newblockstyle, forced)
  {
    this.editrte && this.editrte.setSelectionBlockStyle(newblockstyle, forced);
  }

  setEnabled(enabled)
  {
    if (enabled == this.options.enabled)
      return;

    this.options.enabled = enabled;

    if (this.basenode)
      this._updateEnablingAttributes();

    if (this.options.readonly) // Readonly still active, no change
      return;

    if (enabled)
    {
      if (!this.options.selfedit && !this.options.pageedit)
        this.connectEditor(this.bodydiv);

      this._fireStateChange();
    }
    else
    {
      this.disconnectCurrentEditor();
      this._fireStateChange();
    }
  }

  setReadonly(readonly)
  {
    if (readonly == this.options.readonly)
      return;

    this.options.readonly = readonly;

    if (this.toolbarnode)
      this.toolbarnode.style.display = readonly ? "none" : "block";

    this._updateEnablingAttributes();

    if (!this.options.enabled) // Readonly still active, no change in editability
      return;

    if (!readonly)
    {
      this._fireStateChange();
      if (!this.options.selfedit && !this.options.pageedit)
        this.connectEditor(this.bodydiv);
    }
    else
    {
      this.disconnectCurrentEditor();
      this._fireStateChange();
    }
  }

  setHTMLClass(htmlclass)
  {
    this.__replaceClasses(this.htmldiv, this.options.htmlclass, htmlclass);
    this.options.htmlclass = htmlclass;
  }

  setBodyClass(bodyclass)
  {
    this.__replaceClasses(this.bodydiv, this.options.bodyclass, bodyclass);
    this.options.bodyclass = bodyclass;
  }

  __replaceClasses(node, removeclass, addclass)
  {
    removeclass = removeclass.trim();
    addclass = addclass.trim();

    if (removeclass != "")
    {
      // remove old classes (to keep extra classes set later intact)
      for (let cname of removeclass.split(" "))
      {
        if (cname != "")
          node.classList.remove(cname);
      }
    }

    if (addclass != "")
    {
      for (let cname of addclass.split(" "))
      {
        if (cname != "")
          node.classList.add(cname);
      }
    }
  }

  getPlainText(method, options = [])
  {
    switch (method)
    {
      case "converthtmltoplaintext":
      {
        const suppress_urls = options.includes("suppress_urls");
        const unix_newlines = options.includes("unix_newlines");
        return convertHtmlToPlainText(this.bodydiv, { suppress_urls, unix_newlines });
      }
    }
    throw new Error("Unsupported method for plaintext conversion: " + method);
  }
}

RTE.addedcss = [];

RTE.findCSSRule = function(addcss)
{
  for (var i = 0; i < RTE.addedcss.length; ++i)
    if(RTE.addedcss[i].type == addcss.type && RTE.addedcss[i].src == addcss.src)
      return { idx: i, rule: RTE.addedcss[i] };

  return null;
};

  /// Register this RTE in the list of active RTE's
RTE.register = function(rte)
{
  if (dompack.debugflags.rte)
    console.log('[wh.rich] Register new rte');

  //Add any missing stylesheets
  for (var i = 0; i < rte.addcss.length;++i)
  {
    let rulepos = this.findCSSRule(rte.addcss[i]);
    if(rulepos)
    {
      rulepos.rule.rtes.push(rte);
    }
    else
    {
      var node;
      if(rte.addcss[i].type == 'link')
      {
        node = dompack.create("link", { href: rte.addcss[i].src
                                      , rel: "stylesheet"
                                      , dataset: { whRtdTempstyle: "" }
                                      });
        qS('head,body').appendChild(node);
      }
      else
      {
        node = dompack.create("style", { type: "text/css"
                                       , dataset: { whRtdTempstyle: "" }
                                       });
        qS('head,body').appendChild(node);
        try
        {
          node.innerHTML = rte.addcss[i].src;
        }
        catch(e)//IE
        {
          node.styleSheet.cssText = rte.addcss[i].src;
        }

      }
      let rule = { type: rte.addcss[i].type
                 , src: rte.addcss[i].src
                 , node: node
                 , rtes: [rte]
                 };
      RTE.addedcss.push(rule);
    }
  }
};

  /// Unregister this RTE
RTE.unregister = function(rte)
{
  if (dompack.debugflags.rte)
    console.log('[wh.rich] Unregister new rte');

  for (var i = rte.addcss.length - 1; i>=0; --i)
  {
    var rulepos = this.findCSSRule(rte.addcss[i]);
    if(rulepos)
    {
      rulepos.rule.rtes = rulepos.rule.rtes.filter(el => el != rte); //erase us from the list
      if(!rulepos.rule.rtes.length)
      {
        rulepos.rule.node.remove();
        RTE.addedcss.splice(rulepos.idx, 1);
      }
    }
  }
};

RTE.getForNode = function(node)
{
  return node.whRTD || null;
};
