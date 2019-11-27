import * as dompack from 'dompack';

var Toolbar = require('../../toolbar/toolbars');
var menu = require('@mod-tollium/web/ui/components/basecontrols/menu');

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
//  Standard RTE ButtonBar
//

class ToolbarButtonBase extends Toolbar.Button
{
  constructor(toolbar, options)
  {
    super(toolbar, options);

    this.active = false;   //ADDME perhaps move this to only ToggableToolbarButton, if such things will ever be created?
    this.available = true; //is this button currently available for use (context or blockstyle isn't blocking it)
    this.node = null;
    this.buttondebugid = '';
  }

  isAllowed(allowtagset)
  {
    return true;
  }

  updateState(selstate)
  {
    var actionstate = (selstate && selstate.actionstate[this.type]);
    if (actionstate)
    {
      this.available = actionstate.available || false;
      this.active = actionstate.active || false;
    }

    this.updateButtonRendering();
  }

  updateButtonRendering()
  {
  }

}

class ToolbarSimpleButtonBase extends ToolbarButtonBase
{
  constructor(toolbar, buttonname)
  {
    super(toolbar);

    this.node = dompack.create('span',
                            { className: "wh-rtd-button"
                            , on: { "mousedown": this.mousedown.bind(this)
                                  , "click": this.click.bind(this)
                                  , "mouseover": this.mouseover.bind(this)
                                  }
                            , dataset: { button: buttonname }
                            });
  }

  mousedown(event) //we block mousedown to prevent loss of focus when clicking the button
  {
    event.stopPropagation();
    event.preventDefault();
    return;
  }

  click(event)
  {
    event.stopPropagation();
    event.preventDefault();

    // Check for a custom handler
    if (!this.available || !this.toolbar.rte.isEditable())
      return;

    this.executeAction();
  }

  mouseover(button, event)
  {
    /* FIXME: want a centralized tooltip system
    this.OnButtonHover(button.WHRTE_action, event);
    event.stop();
    */
  }

  updateButtonRendering()
  {
    dompack.toggleClasses(this.node,
        { disabled:   !(this.available && this.toolbar.rte.isEditable())
        , active:     this.active
        });
  }
}

class ToolbarButton extends ToolbarSimpleButtonBase
{
  constructor(toolbar, type)
  {
    super(toolbar, type);
    this.buttondebugid = 'toolbarbutton:' + type;
    this.type = type;

    this.updateState(null);
  }

  isAllowed(allowtagset)
  {
    if(this.type == "li-increase-level" || this.type == "li-decrease-level")
      return allowtagset.includes("ul") || allowtagset.includes("ol");
    if(this.type == "action-properties")
      return allowtagset.includes("a-href") || allowtagset.includes("img") || allowtagset.includes("object-video");
    if(this.type == "action-clearformatting")
      return true; //ADDME or remove when allowtagset is empty, but do we really filter then? allowtagset.length>0;
    if(this.type == "object-insert")
      return true;
    return allowtagset.includes(this.type);
  }

  executeAction()
  {
    this.toolbar.rte.executeAction(this.type);
    return false;
  }
}

class SimpleToggleButton extends ToolbarSimpleButtonBase
{
  constructor(toolbar, type)
  {
    super(toolbar, type);
    this.type=type;

    this.updateState(null);
  }

  isAllowed(allowtagset)
  {
    return allowtagset.includes(this.type);
  }
  executeAction()
  {
    this.toolbar.rte.executeAction(this.type);
    return false;
  }
}

class MenuButton extends SimpleToggleButton
{
  constructor(toolbar, type)
  {
    super(toolbar, type);

    this.listnode = dompack.create('ul');
    this.node.appendChild(dompack.create("div", { style: { display: "none" }
                                                , childNodes: [ this.listnode ]
                                                }));
    this.node.addEventListener("wh:menu-activateitem", evt => this.activateItem(evt));
  }

  updateState(selstate)
  {
    //FIXME: this.active = (menu is currently showing)
    this.updateButtonRendering();
  }

  click(event)
  {
    event.stopPropagation();
    event.preventDefault();

    this.ensureSubMenu();
    if (!this.available || !this.toolbar.rte.isEditable() || !this.listnode.childNodes.length)
      return;

    menu.openAt(this.listnode, this.node, { direction: "down" }, false);
    this.updateState(this.toolbar.rte.getSelectionState());
  }

  // Override to fill this.listnode with <li> menuitems
  ensureSubMenu()
  {
  }

  // Override to respond to selected menuitem (event.detail.menuitem is selected <li>)
  activateItem(event)
  {
    event.stopPropagation();
    this.updateState(this.toolbar.rte.getSelectionState());
  }
}

class StyleButtonBase extends ToolbarButtonBase
{
  constructor(toolbar, button)
  {
    super(toolbar);
    this.owngroup = true;
    this.optionlist = [];

    this.node = <span>
                  { this.select = <select class="wh-rtd__toolbarstyle" data-button={button} on={{change: e => this.selectStyle() }} /> }
                </span>;
    this.updateStructure();
  }

  updateStructure(selstate)
  {
    dompack.empty(this.select);
    this.optionlist = [];

    let styles = this.getAvailableStyles(selstate);

    for (var i=0;i<styles.length;++i)
    {
      var bs = styles[i];
      var title = bs.def.title ? bs.def.title : bs.tag;
      var opt = <option class="wh-rtd__toolbaroption" value={bs.tag}>{title}</option>;
      //ADDME toolbarcss? but 'style: { cssText: bs.def.toolbarcss' is CSP risky

      opt.blockstyle = bs;
      this.optionlist.push(opt);
      this.select.appendChild(opt);
    }

  }

  updateState(selstate)
  {
    this.updateStructure(selstate);

    //FIXME what to do if we have no blockstyle?
    if(selstate)
    {
      // this.optionlist[0].classList.toggle('wh-rtd__toolbaroption--unavailable', true);

//      for (var i = 0; i < this.optionlist.length; ++i)
//      {
//        var style = this.optionlist[i].blockstyle;
//        this.optionlist[i].classList.toggle('-wh-rtd-unavailable', selstate.blockstyle.listtype != style.listtype)
//      }

      this.select.value = this.getCurrentStyle(selstate);
    }
    this.select.disabled = !(this.available && this.toolbar.rte.isEditable() && this.optionlist.length);
  }

  selectStyle()
  {
    let editor = this.toolbar.rte.getEditor();
    if(editor && this.select.value)
    {
      this.setStyle(this.select.value)
      editor.takeFocus();
    }
  }
}

class TableCellStyleButton extends StyleButtonBase
{
  constructor(toolbar)
  {
    super(toolbar, "td-class");
  }
  getAvailableStyles(selstate)
  {
    let editor = this.toolbar.rte.getEditor();
    if(editor && selstate && selstate.cellparent)
      return editor.getAvailableTableCellStyles(selstate);
    return [];
  }
  getCurrentStyle(selstate)
  {
    if(selstate && selstate.cellparent)
      return '';
    return null;
  }
  setStyle(value)
  {
  }
}

class BlockStyleButton extends StyleButtonBase
{
  constructor(toolbar)
  {
    super(toolbar, "p-class");
  }
  getAvailableStyles(selstate)
  {
    let editor = this.toolbar.rte.getEditor();
    if(!editor)
      return [];

    return editor.getAvailableBlockStyles(selstate);
  }

  getCurrentStyle(selstate)
  {
    return selstate && selstate.blockstyle ? selstate.blockstyle.tag : null;
  }
  setStyle(value)
  {
    let editor = this.toolbar.rte.getEditor();
    if(editor)
      editor.setSelectionBlockStyle(value);
  }
}

class ShowFormattingButton extends SimpleToggleButton
{
  updateState()
  {
    let editor = this.toolbar.rte.getEditor();
    this.active = editor && editor.getShowFormatting();
    this.updateButtonRendering();
  }

  isAllowed(allowtags)
  {
    return true;
  }

  //FIXME: This custom click event isn't necessary if executeAction would be handled by RTE instead of EditorBase
  click(event)
  {
    event.stopPropagation();
    event.preventDefault();

    let editor = this.toolbar.rte.getEditor();
    if (!this.available || !this.toolbar.rte.isEditable())
      return;

    editor.setShowFormatting(!this.active);
  }
}

class InsertTableButton extends MenuButton
{
  constructor(toolbar, type)
  {
    super(toolbar, type);
    this.initialrows = 6;
    this.initialcolumns = 8;
  }

  ensureSubMenu()
  {
    if (this.listnode.childNodes.length)
      return;

    this.listnode.classList.add("wh-rtd-tablemenu");
    this.listnode.addEventListener("mouseleave", this.hoverItem.bind(this));
    this.listnode.addEventListener("mousemove", this.hoverItem.bind(this));
    for (var row = 0; row < this.initialrows; ++row)
      for (var col = 0; col < this.initialcolumns; ++col)
      {
        var classNames = [ "wh-rtd-tablemenuitem" ];
        if (col == 0)
          classNames.push("wh-rtd-tablemenuitem-newrow");
        if (row == 0)
          classNames.push("wh-rtd-tablemenuitem-newcol");
        this.listnode.appendChild(new dompack.create("li",
                                             { innerHTML: "&nbsp;"
                                             , className: classNames.join(" ")
                                             , dataset:   { col: col + 1, row: row + 1 }
                                             }));
      }

    this.statusnode = dompack.create("li", { "textContent": ""
                                           , "className": "wh-rtd-tablemenustatus disabled"
                                           });
    this.listnode.appendChild(this.statusnode);
  }

  updateState(selstate)
  {
    // Cannot insert table into a table
    this.available = selstate && selstate.tables.length == 0;
    super.updateState(selstate);
  }

  isAllowed(allowtags)
  {
    // Called in free editor
    return allowtags.includes("table");
  }

  hoverItem(event, target)
  {
    event.stopPropagation();
    event.preventDefault();

    if (event.name == "mousemove" && event.target.nodeName.toUpperCase() != "LI")
      return;

    var selsize = this.getItemSize(event.target);

    dompack.qSA(this.listnode, "li").forEach((menuitem, i) =>
    {
      var size = this.getItemSize(menuitem);
      menuitem.classList.toggle("selected", !!selsize && !!size && size.x <= selsize.x && size.y <= selsize.y);
    });
    this.statusnode.textContent = selsize ? (selsize.x + "x" + selsize.y) : "";
  }

  activateItem(event)
  {
    let editor = this.toolbar.rte.getEditor();
    if(!editor)
      return;

    var size = this.getItemSize(event.detail.menuitem);
    if (size)
      editor.executeAction({ action: 'table'
                                        , size: size
                                        });
    super.activateItem(event);
  }

  // Return the col and row for a menu item
  getItemSize(menuitem)
  {
    if (menuitem && menuitem.getAttribute)
    {
      var x = parseInt(menuitem.getAttribute("data-col"), 10);
      var y = parseInt(menuitem.getAttribute("data-row"), 10);
      if (x > 0 && y > 0)
        return { x: x, y: y };
    }
  }
}

var supportedbuttons =
  { "a-href": ToolbarButton
  , "b": SimpleToggleButton
  , "i": SimpleToggleButton
  , "u": SimpleToggleButton
  , "strike": SimpleToggleButton
  , "sup": SimpleToggleButton
  , "sub": SimpleToggleButton
  , "img": ToolbarButton
  , "action-properties": ToolbarButton
  , "action-clearformatting": ToolbarButton
  , "action-showformatting": ShowFormattingButton
  , "td-class": TableCellStyleButton
  , "p-class": BlockStyleButton

  , "ol": SimpleToggleButton
  , "ul": SimpleToggleButton
  , "li-decrease-level": ToolbarButton
  , "li-increase-level": ToolbarButton
  , "object-insert": ToolbarButton
  , "object-video": ToolbarButton
  , "table": InsertTableButton
  };

export default class RTEToolbar
{
  constructor(rte, element, options)
  {
    this.rte = rte;
    this.options =
        { hidebuttons: []
        //button layout. top level array is rows, consists of groups, and a group is either a single button (p-class) or an array of buttons
        //ADDME: Note, if new buttons are added, we probably need to update tollium (field-)rte.js to hide these in nonstructured mode
        , layout: []
        , compact: false
        , allowtags: null
        , ...options
        };

    this.buttons = [];

    this.el=element;

    this.buildButtonBar();
    this.rte.getContainer().addEventListener("wh:rtd-statechange", evt => this.onStateChange());
  }

  createButtonObject(buttonname)
  {
    if(this.options.hidebuttons.includes(buttonname))
      return null;

    var buttontype = supportedbuttons[buttonname];
    if(!buttontype)
      return null;

    var newbutton = new buttontype(this, buttonname);
    if(this.options.allowtags && !newbutton.isAllowed(this.options.allowtags)) //filtering tags?
      return null;

    this.buttons.push(newbutton);
    return newbutton;
  }

  buildButtonBar()
  {
    dompack.empty(this.el);

    for(var rowidx=0;rowidx<this.options.layout.length;++rowidx)
    {
      var row = this.options.layout[rowidx];
      for(var groupidx=0;groupidx<row.length;++groupidx)
      {
        var group = row[groupidx];

        if(typeof group == "string") //button in own group
        {
          let buttonobj = this.createButtonObject(group);
          if(!buttonobj)
            continue;

          this.el.appendChild(buttonobj.node);
          continue;
        }

        var currentgroup = null;

        for (var buttonidx=0;buttonidx<group.length;++buttonidx)
        {
          var button = group[buttonidx];
          let buttonobj = this.createButtonObject(button);
          if(!buttonobj)
            continue;

          if(!currentgroup)
          {
            currentgroup = dompack.create("span", {"className":"wh-rtd-toolgroup"});
            this.el.appendChild(currentgroup);
          }
          currentgroup.appendChild(buttonobj.node);
        }
      }
      if(!this.options.compact)
        this.el.appendChild(dompack.create("br"));
    }

    this.onStateChange();
  }

  onStateChange()
  {
    var selstate = this.rte.getSelectionState();
    for (var i=0;i<this.buttons.length;++i) //ADDME Perhaps we shouldn't have separators inside the button array, but separate button-layout from list-of-buttons
      this.buttons[i].updateState(selstate);

/*  FIXME restore
    this.UpdateButtonState("bold", selstate.bold);
    this.UpdateButtonState("italic", selstate.italic);
    this.UpdateButtonState("underline", selstate.underline);

    this.SetButtonEnabled("insert_hyperlink", selstate.haveselection);
    this.SetButtonEnabled("remove_hyperlink", selstate.hyperlink);

    this.UpdateButtonState("bulleted_list", selstate.bulletedlist);
    this.UpdateButtonState("numbered_list", selstate.numberedlist);

    this.UpdateButtonState("align_left", selstate.alignleft);
    this.UpdateButtonState("align_center", selstate.aligncenter);
    this.UpdateButtonState("align_right", selstate.alignright);
    this.UpdateButtonState("align_justified", selstate.alignjustified);*/
  }

/*ADDME: Unused?
  getImageSrc(buttonname, disabled, width, height)
  {
    // If buttonpath was specified, link to the image in the buttonpath directory, otherwise link to the tollium image generator
    if (this.options.buttonpath)
      return this.options.buttonpath + buttonname + (disabled ? '_disabled' : '') + '.png';
    else
    {
      return '/tollium_todd/img.shtml?n=tollium:rte/' + buttonname + '&w=' + (width ? width : this.imgsize) + '&h=' + (height ? height : this.imgsize) + '&d=' + (disabled ? '1' : '');
    }
  }
*/

  getButton(buttonname)
  {
    for (var i=0; i<this.buttons.length; ++i)
      if (this.buttons[i].type == buttonname)
        return this.buttons[i];
  }

  OnButtonHover (action, event)
  {
    /*
    if (action == this.lastactionhover)
      return;
    this.lastactionhover = action;

    // Don't show button tooltips if the rte is not enabled
    if (!this.enabled)
      return;

    var button = this.getButton(action);
    if (button && button.title)
      this.editor.ShowTooltip(button.title, event);
    else
      this.editor.HideTooltip();
    */
  }

  UpdateButtonState (action, newstate)
  {
    var button = this.getButton(action);
    if (!button)
      return;
    button.active = newstate;
    this.UpdateButton(button);
  }
}
