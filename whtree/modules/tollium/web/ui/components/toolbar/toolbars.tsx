import * as dompack from "dompack";

import "./toolbars.css";

export type ToolbarButtonOptions = {
  label?: string;
  classNames?: string[];
  hint?: string;
  icon?: HTMLImageElement;
  enabled?: boolean;
  pressed?: boolean;
  onExecute?: EventListenerOrEventListenerObject;
};

export class ToolbarButton {
  node: HTMLElement;
  options: ToolbarButtonOptions;

  constructor(options?: ToolbarButtonOptions) {
    this.options = {
      enabled: true,
      pressed: false,
      ...options
    };

    this.node = <div class={["wh-toolbar-button", ...(this.options.classNames || [])].join(" ")} title={this.options.hint}></div>;
    this.node.addEventListener("click", () => this.executeAction());
    if (this.options.icon) {
      this.options.icon.classList.add("wh-toolbar-button-img");
      this.node.appendChild(this.options.icon);
    }
    if (this.options.label)
      this.node.appendChild(<span>{this.options.label}</span>);
    if (!this.options.enabled)
      this.node.classList.add("disabled");
    if (this.options.pressed)
      this.node.classList.add("pressed");
    if (this.options.onExecute)
      this.node.addEventListener("execute", this.options.onExecute);
  }

  executeAction() {
    if (this.options.enabled)
      dompack.dispatchCustomEvent(this.node, "execute", { bubbles: false, cancelable: false });
  }

  setEnabled(enabled: boolean) {
    enabled = Boolean(enabled);
    if (enabled !== this.options.enabled) {
      this.options.enabled = enabled;
      this.node.classList.toggle("disabled", !this.options.enabled);
    }
  }

  setPressed(pressed: boolean) {
    pressed = Boolean(pressed);
    if (pressed !== this.options.pressed) {
      this.options.pressed = pressed;
      this.node.classList.toggle("pressed", this.options.pressed);
    }
  }
}

export class ToolbarSeparator extends ToolbarButton {
  constructor(options?: ToolbarButtonOptions) {
    super(options);
    this.node = dompack.create("div", { "className": ["wh-toolbar-separator"].concat(this.options.classNames || []).join(" ") });
  }
}

class ToolbarContainer {
  addButton(_button: ToolbarButton) {
    throw new Error("addButton not implemented");
  }

  addComponent(_comp: ToolbarButton) {
    throw new Error("addComponent not implemented");
  }
}

export type { ToolbarContainer };

export type ToolbarPanelOptions = {
  onClose?: EventListenerOrEventListenerObject;
  onApply?: EventListenerOrEventListenerObject;
};

export class ToolbarPanel extends ToolbarContainer {
  node: HTMLElement;
  options?: ToolbarPanelOptions;

  constructor(options?: ToolbarPanelOptions) {
    super();

    this.options = options;
    this.node = <div class="wh-toolbar-panel open"></div>;

    if (this.options?.onClose)
      this.node.addEventListener("close", this.options.onClose);
    if (this.options?.onApply)
      this.node.addEventListener("apply", this.options.onApply);
  }

  addButton(button: ToolbarButton) {
    this.addComponent(button);
  }

  addComponent(comp: ToolbarButton) {
    this.node.appendChild(comp.node);
  }
}

type ToolbarOptions = {
  applyIcon?: HTMLImageElement;
  applyLabel?: string;
  closeIcon?: HTMLImageElement;
  closeLabel?: string;
  classNames?: string[];
};

export class Toolbar extends ToolbarContainer {
  options: ToolbarOptions;
  node: HTMLElement;
  mainPanel: ToolbarPanel;
  modalPanel: ToolbarPanel | null;
  modalHolder: HTMLElement;

  constructor(options: ToolbarOptions) {
    super();

    this.options = {
      applyLabel: "Apply",
      closeLabel: "Close",
      ...options
    };

    this.node = <div class={["wh-toolbar", ...(this.options.classNames || [])].join(" ")}></div>;

    this.mainPanel = new ToolbarPanel();
    this.node.appendChild(this.mainPanel.node);

    this.modalPanel = null;
    this.modalHolder = <div class="wh-toolbar-modalholder"></div>;
    this.node.appendChild(this.modalHolder);

    const modalbuttons = <div class="wh-toolbar-modalbuttons"></div>;
    this.modalHolder.append(modalbuttons);

    let button = <div class="wh-toolbar-button wh-toolbar-button-applymodal"></div>;
    button.addEventListener("click", () => this.onModalApply());
    modalbuttons.append(button);
    if (this.options.applyIcon) {
      this.options.applyIcon.classList.add("wh-toolbar-button-img");
      button.appendChild(this.options.applyIcon);
    }
    if (this.options.applyLabel)
      button.appendChild(<span>{this.options.applyLabel}</span>);

    button = <div class="wh-toolbar-button wh-toolbar-button-revertmodal"></div>;
    button.addEventListener("click", () => this.onModalCancel());
    modalbuttons.append(button);
    if (this.options.closeIcon) {
      this.options.closeIcon.classList.add("wh-toolbar-button-img");
      button.appendChild(this.options.closeIcon);
    }
    if (this.options.closeLabel)
      button.appendChild(<span>{this.options.closeLabel}</span>);
  }

  setSize(width: number, height: number) {
    this.node.style.width = width + "px";
    this.node.style.height = height + "px";
  }

  addButton(button: ToolbarButton) {
    this.mainPanel.addButton(button);
  }

  addComponent(comp: ToolbarButton) {
    this.mainPanel.addComponent(comp);
  }

  activateModalPanel(subPanel: ToolbarPanel) {
    if (this.modalPanel)
      this.closeModalPanel();

    this.mainPanel.node.classList.remove("open");
    this.modalPanel = subPanel;
    this.modalHolder.appendChild(this.modalPanel.node);
    this.modalHolder.classList.add("open");
    dompack.dispatchCustomEvent(
      this.node,
      "modal-opened",
      {
        bubbles: false,
        cancelable: false,
        detail:
        {
          apply: () => this.onModalApply(),
          cancel: () => this.onModalCancel(),
          panel: subPanel
        }
      });
  }

  closeModalPanel() {
    if (!this.modalPanel)
      return;

    dompack.dispatchCustomEvent(this.modalPanel.node, "close", { bubbles: false, cancelable: false });
    this.mainPanel.node.classList.add("open");
    this.modalHolder.classList.remove("open");
    this.modalHolder.removeChild(this.modalPanel.node);
    this.modalPanel = null;
    dompack.dispatchCustomEvent(this.node, "modal-closed", { bubbles: false, cancelable: false });
  }

  onModalApply() {
    if (this.modalPanel)
      dompack.dispatchCustomEvent(this.modalPanel.node, "apply", { bubbles: false, cancelable: false });
    this.closeModalPanel();
  }

  onModalCancel() {
    if (this.modalPanel)
      dompack.dispatchCustomEvent(this.modalPanel.node, "cancel", { bubbles: false, cancelable: false });
    this.closeModalPanel();
  }
}
