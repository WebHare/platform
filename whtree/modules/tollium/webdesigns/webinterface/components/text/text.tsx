import * as dompack from '@webhare/dompack';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';

import * as $todd from "@mod-tollium/web/ui/js/support";
import "./text.scss";
import type { ComponentBaseUpdate, ComponentStandardAttributes, ToddCompBase } from '@mod-tollium/web/ui/js/componentbase';

const linetextTopMargin = 5; //keep in sync with t-text.scss

interface TextAttributes extends ComponentStandardAttributes, TextStyles {
  labelfor: string;
  transparenttoclicks?: boolean;
  selectable?: boolean;
  action?: string;
  linkactions?: Array<{ url: string; action: string }>;
  isheading?: boolean;
  value: string;
  ishtml?: boolean;
  destroywithparent?: boolean;
}

interface TextStyles {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  wordwrap?: boolean;
  ellipsis?: boolean;
}

/****************************************************************************************************************************
 *                                                                                                                          *
 *  TEXT                                                                                                                    *
 *                                                                                                                          *
****************************************************************************************************************************/

export class ObjText extends ComponentBase {
  componenttype = "text";
  labelfor = "";

  styles: TextStyles = {
    bold: false,
    italic: false,
    underline: false,
    wordwrap: false,
    ellipsis: false
  };
  transparenttoclicks = false;
  sethtml = false;
  recreatenode = false;
  isheading = false;
  ismouseselectable = false;
  linkactions: TextAttributes["linkactions"] = [];
  value = '';
  nodesize!: $todd.Size;
  declare node: HTMLElement;

  constructor(parentcomp: ToddCompBase, data: TextAttributes) {
    super(parentcomp, data);

    this.transparenttoclicks = data.transparenttoclicks ?? false;

    this.setLabelFor(data.labelfor);

    this.setStyles(data);
    this.isheading = Boolean(data.isheading);

    this.ismouseselectable = data.selectable ?? false;
    this.linkactions = data.linkactions || [];

    this.setInterestingActions([this.action]);
    this.setValue(data.value, data.ishtml);
  }

  setStyles(settings: TextStyles) {
    (Object.keys(this.styles) as Array<keyof TextStyles>).forEach(key => {
      if (typeof (settings[key]) === typeof (this.styles![key]))
        this.styles![key] = settings[key];
    });
  }

  /****************************************************************************************************************************
  * Property getters & setters
  */

  getLabelFor() {
    return this.labelfor;
  }

  setLabelFor(value: string) {
    if (this.node)
      this.node.dataset.labelfor = value;
    this.labelfor = value;
  }

  setValue(value: string, ishtml?: boolean) {
    this.value = value;
    this.sethtml = Boolean(ishtml);
    this.buildNode();
    if (!this.styles?.ellipsis)
      this.width.dirty = true;
  }


  /****************************************************************************************************************************
  * DOM
  */

  buildNode() {
    const txtnode = <t-text class="t-text__linetext" data-name={this.name} propTodd={this} />;

    if (this.isheading)
      txtnode.classList.add("heading");
    if (this.sethtml)
      txtnode.innerHTML = this.value;
    else this.value.split('\n').forEach((textrow, idx) => {
      if (idx > 0)
        txtnode.appendChild(<br />);
      txtnode.append(textrow);
    });

    if (this.hint)
      txtnode.title = this.hint;

    if (this.ismouseselectable)
      txtnode.classList.add("selectable");

    if (this.styles.bold)
      txtnode.style.fontWeight = "bold";
    if (this.styles.italic)
      txtnode.style.fontStyle = "italic";
    if (this.styles.underline)
      txtnode.style.textDecoration = "underline";
    if (this.labelfor || this.action) {
      txtnode.classList.add("label");
      if (this.labelfor)
        txtnode.dataset.labelfor = this.labelfor;
    } else {
      if (this.styles.wordwrap)
        txtnode.classList.add("wrapped");
      if (this.styles.ellipsis)
        txtnode.classList.add("ellipsis");
    }

    if (!this.transparenttoclicks)
      dompack.addDocEventListener(txtnode, "click", this.onClick.bind(this));

    txtnode.propTodd = this;

    this.nodesize = $todd.CalculateSize(txtnode);

    if (this.styles.ellipsis) //don't set width if ellipsis is applied
      this.nodesize.x = 0;

    if (this.node && this.node.parentNode) {
      this.node.parentNode.replaceChild(txtnode, this.node);
      this.node = txtnode;
    } else
      this.node = txtnode;
    return txtnode;
  }


  /****************************************************************************************************************************
  * Dimensions
  */

  calculateDimWidth() {
    this.width.calc = this.nodesize.x;
    this.width.min = this.width.calc;
  }

  applySetWidth() {
    this.debugLog("dimensions", "width min=" + this.width.min + ", calc=" + this.width.calc + ", set=" + this.width.set);
    this.node.style.width = this.width.set + 'px';
  }

  calculateDimHeight() {
    this.height.min = Math.max(this.node.getBoundingClientRect().height + linetextTopMargin, $todd.gridlineInnerHeight);
  }

  relayout() {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height=" + this.height.set);
    this.node.style.width = this.width.set + 'px';
    this.node.style.height = (this.height.set - linetextTopMargin) + 'px';

    if (this.styles.ellipsis)
      this.node.classList.toggle('overflow', this.width.set < this.width.min || this.height.set < this.height.min);
  }


  /****************************************************************************************************************************
  * Events
  */

  applyUpdate(data: ComponentBaseUpdate | { type: "value"; value: string; ishtml: boolean }) {
    switch (data.type) {
      case "value":
        this.setValue(data.value, data.ishtml);
        return;
    }
    super.applyUpdate(data);
  }

  onClick(event: dompack.DocEvent<MouseEvent>) {
    const anchor = event.target.closest('a');
    if (anchor) {
      const rec = this.linkactions?.find(action => action.url === anchor.href);
      if (rec)
        this.owner.executeAction(rec.action);
      else if (this.isEventUnmasked("clicklink"))
        this.queueEvent(this.owner.screenname + "." + this.name, 'clicklink ' + anchor.href, true);
      else if (anchor.href.substr(0, 7) === 'mailto:')
        return; //let it be, follow the link. the only exit which does _not_ event.stop...
      else if (anchor.href.substr(0, 11) !== 'javascript:')
        window.open(anchor.href, '_blank');

      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    if (this.action)
      this.owner.executeAction(this.action);

    const comp = this.owner.getComponent(this.labelfor);
    if (comp) {
      //ADDME might as well send a signal through JS to the tollium component instead of trying to click, because checkbox is now doing hacks to forward the click event
      comp.node!.focus();
      comp.node!.click();
    }
  }
}
