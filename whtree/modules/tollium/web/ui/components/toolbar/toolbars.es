require('./toolbars.css');
import * as dompack from 'dompack';

class ToolbarButton
{
  constructor(toolbar, options)
  {
    this.toolbar = toolbar;
    this.options =
        { label: null
        , classnames: null
        , hint: null
        , icon: null
        , enabled: true
        , pressed: false
        , ...options
        };

    this.node = dompack.create("div",{ className: ["wh-toolbar-button"].concat(this.options.classnames || []).join(" ")
                                     , on: { "click": this.executeAction.bind(this) }
                                     , title: this.options.hint || ""
                                     });
    if (this.options.icon)
    {
      this.options.icon.classList.add("wh-toolbar-button-img");
      this.node.appendChild(this.options.icon);
    }
    if (this.options.label)
      this.node.appendChild(dompack.create("span", { "textContent": this.options.label }));
    if (!this.options.enabled)
      this.node.classList.add("disabled");
    if (this.options.pressed)
      this.node.classList.add("pressed");

    if (this.options.onExecute)
      this.toElement().addEventListener("execute", this.options.onExecute);
  }

  toElement()
  {
    return this.node;
  }

  executeAction()
  {
    if (this.options.enabled)
      dompack.dispatchCustomEvent(this.toElement(), "execute", { bubbles: false, cancelable: false });
  }

  setEnabled(enabled)
  {
    enabled = !!enabled;
    if (enabled != this.options.enabled)
    {
      this.options.enabled = enabled;
      dompack.toggleClasses(this.node, { disabled: !this.options.enabled });
    }
  }

  setPressed(pressed)
  {
    pressed = !!pressed;
    if (pressed != this.options.pressed)
    {
      this.options.pressed = pressed;
      dompack.toggleClasses(this.node, { pressed: this.options.pressed });
    }
  }
}

class ToolbarSeparator extends ToolbarButton
{
  constructor(toolbar, options)
  {
    super(toolbar, options);
    this.node = dompack.create("div",{"className":["wh-toolbar-separator"].concat(this.options.classnames || []).join(" ")});
  }
}

class ToolbarPanel
{
  constructor(options)
  {
    this.options = { ...options };
    this.panel = dompack.create("div",{"className":"wh-toolbar-panel open"});

    if (this.options.onClose)
      this.toElement().addEventListener("close", this.options.onClose);
    if (this.options.onApply)
      this.toElement().addEventListener("apply", this.options.onApply);
  }

  toElement()
  {
    return this.panel;
  }

  addButton(button)
  {
    if(typeof button != 'object')
      throw new Error("Specify explicit element to addButton"); //might have sneaked through when we did $(button)
    this.addComponent(button);
  }

  addComponent(comp)
  {
    this.panel.appendChild(comp.toElement());
  }
}

class Toolbar
{
  constructor(options)
  {
    this.modalpanel = null;
    this.options =
         { applyicon: null
         , applylabel: "Apply"
         , closeicon: null
         , closelabel: "Revert"
         , classnames: null
         , ...options
         };

    this.buttonbar = dompack.create("div",{ className: ["wh-toolbar"].concat(this.options.classnames || []).join(" ")
                                          });

    this.mainpanel = new ToolbarPanel();
    this.buttonbar.appendChild(this.mainpanel.toElement());

    this.modalholder = dompack.create("div", { className: "wh-toolbar-modalholder" });
    this.buttonbar.appendChild(this.modalholder);

    var modalbuttons = dompack.create("div", { className: "wh-toolbar-modalbuttons" });
    this.modalholder.append(modalbuttons);

    var button = dompack.create("div", { className: "wh-toolbar-button wh-toolbar-button-applymodal"
                                       , on: { "click": this.onModalApply.bind(this) }
                                       });
    modalbuttons.append(button);
    if (this.options.applyicon)
    {
      this.options.applyicon.classList.add("wh-toolbar-button-img");
      button.appendChild(this.options.applyicon);
    }
    if (this.options.applylabel)
      button.appendChild(dompack.create("span", { textContent: this.options.applylabel }));

    button = dompack.create("div", { className: "wh-toolbar-button wh-toolbar-button-revertmodal"
                                   , on: { "click": this.onModalCancel.bind(this) }
                                   });
    modalbuttons.append(button);
    if (this.options.closeicon)
    {
      this.options.closeicon.classList.add("wh-toolbar-button-img");
      button.appendChild(this.options.closeicon);
    }
    if (this.options.closelabel)
      button.appendChild(dompack.create("span", { textContent: this.options.closelabel }));
  }

  toElement()
  {
    return this.buttonbar;
  }

  setSize(width, height)
  {
    Object.assign(this.buttonbar.style,
        { width:  width + "px"
        , height: height + "px"
        });
  }

  addButton(button)
  {
    this.mainpanel.addButton(button);
  }

  addComponent(comp)
  {
    this.mainpanel.addComponent(comp);
  }

  activateModalPanel(subpanel)
  {
    if(this.modalpanel)
      this.closeModalPanel();

    this.mainpanel.toElement().classList.remove('open');
    this.modalpanel = subpanel;
    this.modalholder.appendChild(this.modalpanel.panel);
    this.modalholder.classList.add('open');
    dompack.dispatchCustomEvent(
        this.toElement(),
        "modal-opened",
        { bubbles: false
        , cancelable: false
        , detail:
            { apply: this.onModalApply.bind(this)
            , cancel: this.onModalCancel.bind(this)
            , panel: subpanel
            }
        });
  }

  closeModalPanel()
  {
    if(!this.modalpanel)
      return;

    dompack.dispatchCustomEvent(this.modalpanel.toElement(), "close", { bubbles: false, cancelable: false });
    this.mainpanel.toElement().classList.add('open');
    this.modalholder.classList.remove('open');
    this.modalholder.removeChild(this.modalpanel.panel);
    this.modalpanel = null;
    dompack.dispatchCustomEvent(this.toElement(), "modal-closed", { bubbles: false, cancelable: false });
  }

  onModalApply()
  {
    dompack.dispatchCustomEvent(this.modalpanel.toElement(), "apply", { bubbles: false, cancelable: false });
    this.closeModalPanel();
  }

  onModalCancel()
  {
    dompack.dispatchCustomEvent(this.modalpanel.toElement(), "cancel", { bubbles: false, cancelable: false });
    this.closeModalPanel();
  }
}

Toolbar.Button = ToolbarButton;
Toolbar.Panel = ToolbarPanel;
Toolbar.Separator = ToolbarSeparator;

module.exports = Toolbar;
