import * as dompack from "dompack";
import * as $todd from "@mod-tollium/web/ui/js/support";
import { ActionableComponent, type ActionableAttributes, type ComponentBaseUpdate, type ToddCompBase } from "@mod-tollium/web/ui/js/componentbase";
import "./svg.scss";

declare global {
  interface HTMLElementTagNameMap {
    "t-svg": HTMLElement;
  }
}

interface SVGAttributes extends ActionableAttributes {
  src: string;
  vars?: Record<string, string>;
  opacity?: number;
}

type SVGUpdate = {
  type: "source";
  src: string;
} | {
  type: "opacity";
  opacity: number;
} | {
  type: "vars";
  vars?: Record<string, string>;
} | {
  type: "action";
  action: string;
} | {
  type: "eventmask";
  unmasked_events: string[];
} | ComponentBaseUpdate;

export class ObjSVGImage extends ActionableComponent<SVGAttributes> {
  componenttype = "svg";
  private clickable = false;
  private svgSrc = "";
  private opacity = 1;
  private wrapperNode!: HTMLDivElement;


  // ------------------------------------------------------------------------------------------------------------------------
  //
  // Initialization
  //

  constructor(parentcomp: ToddCompBase, data: SVGAttributes) {
    super(parentcomp, data);

    this.buildNode();
    this.updateCSSVars(data.vars);
    this.updateNode(data);

    this.action = data.action;
    this.unmasked_events = data.unmasked_events || [];
    this.updateClickable();
  }


  // ------------------------------------------------------------------------------------------------------------------------
  //
  // Helper functions
  //

  private updateClickable() {
    this.clickable = this.unmasked_events?.includes("click") || Boolean(this.action);
    this.node.classList.toggle("clickable", this.clickable);
  }


  // ------------------------------------------------------------------------------------------------------------------------
  //
  // Callbacks
  //

  onActionUpdated() {
    super.onActionUpdated();
    this.updateClickable();
  }


  // ------------------------------------------------------------------------------------------------------------------------
  //
  // DOM
  //

  canBeFocusable() {
    return this.clickable; //prevent componentbase from setting a tabindex
  }

  // Build the DOM node(s) for this component
  buildNode() {
    this.node = dompack.create("t-svg");
    this.node.dataset.name = this.name;

    if (this.hint)
      this.node.title = this.hint;
    this.node.propTodd = this;

    this.wrapperNode = dompack.create("div", {
      className: "wrapper",
      on: {
        click: evt => this.gotMouseClick(evt),
        mousedown: evt => this.gotMouseDown(evt),
      },
    });
    this.node.append(this.wrapperNode);
  }

  private updateNode(data: { src?: string; opacity?: number }) {
    if (data.src !== undefined && data.src !== this.svgSrc) {
      this.svgSrc = data.src;
      const svgDoc = new DOMParser().parseFromString(this.svgSrc, "text/xml");
      try {
        const svgNode = document.importNode(svgDoc.documentElement, true);
        this.wrapperNode.replaceChildren(svgNode);
      } catch (_) { }
    }
    if (data.opacity !== undefined && data.opacity !== this.opacity) {
      this.opacity = data.opacity;
      this.wrapperNode.style.opacity = String(this.opacity);
    }
  }

  private updateCSSVars(cssVars?: Record<string, string>) {
    // Remove existing variables (i.e. all explicitly set custom properties on the wrapper node) that don't have a new value
    // Iterating a CSSStyleDeclaration yields its set property names (incl. custom properties); copy as we're modifying it
    for (const name of Array.from(this.wrapperNode.style))
      if (name.startsWith("--") && !(cssVars && Object.hasOwn(cssVars, name)))
        this.wrapperNode.style.removeProperty(name);
    // Set the new variables
    if (cssVars)
      for (const [name, value] of Object.entries(cssVars))
        this.wrapperNode.style.setProperty(name, value);
  }


  // ------------------------------------------------------------------------------------------------------------------------
  //
  // Dimensions
  //

  calculateDimWidth() {
    this.width.calc = $todd.CalcAbsSize(this.width.xml_set, true);
    this.width.min = this.width.calc;
    this.debugLog("dimensions", "calc=" + this.width.calc + ", min=" + this.width.min);
  }

  calculateDimHeight() {
    this.height.calc = $todd.CalcAbsSize(this.height.xml_set, false);
    this.height.min = Math.max(this.height.calc, $todd.gridlineInnerHeight);
    this.debugLog("dimensions", "min=" + this.height.min + ", calc=" + this.height.calc + ", min=" + this.height.min);
  }

  relayout() {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height=" + this.height.set);

    if (this.node) {
      let width = this.width.set;
      let height = this.height.set;
      dompack.setStyles(this.node, {
        width,
        height,
      });
      // Resize the wrapper to the specified dimensions if they're smaller than the calculated dimensions
      if (this.width.xml_set_parsed?.type === 2 && width > this.width.xml_set_parsed.size)
        width = this.width.xml_set_parsed.size;
      if (this.height.xml_set_parsed?.type === 2 && height > this.height.xml_set_parsed.size)
        height = this.height.xml_set_parsed.size;
      dompack.setStyles(this.wrapperNode, {
        width,
        height,
      });
    }
  }


  // ------------------------------------------------------------------------------------------------------------------------
  //
  // Events & callbacks
  //

  private gotMouseDown(event: MouseEvent) {
    if (this.action)
      event.preventDefault();
  }

  private gotMouseClick(event: MouseEvent) {
    if (!this.clickable || !this.getEnabled())
      return;

    event.preventDefault();
    this.owner.executeAction(this.action);
    if (!this.isEventUnmasked("click"))
      return;

    const idNode = (event.target as Element | null)?.closest("[id]");
    let id = "";
    if (idNode && this.wrapperNode.contains(idNode))
      id = idNode.id;
    void this.asyncMessage("click", {
      absolutex: event.offsetX,
      absolutey: event.offsetY,
      id,
    });
  }

  applyUpdate(data: SVGUpdate) {
    switch (data.type) {
      case "source":
      case "opacity":
        this.updateNode(data);
        return;
      case "vars":
        this.updateCSSVars(data.vars);
        return;
      case "action":
        this.setAction(data.action);
        return;
      case "eventmask":
        this.unmasked_events = data.unmasked_events;
        this.onActionUpdated();
        return;
    }

    super.applyUpdate(data);
  }
}
