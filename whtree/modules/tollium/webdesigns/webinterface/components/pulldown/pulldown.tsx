/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from 'dompack';
import * as browser from "dompack/extra/browser";
import HTMLComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/html';
import * as $todd from "@mod-tollium/web/ui/js/support";

export default class ObjPulldown extends HTMLComponentBase {
  /****************************************************************************************************************************
   * Initialization
   */

  constructor(parentcomp, data) {
    super(parentcomp, data);
    this.componenttype = "pulldown2";
    this.components = [];

    this.options = data.options;
    this.options.forEach(opt => {
      //ADDME: Should the menu code handle this?
      for (let i = 0; i < opt.indent; ++i)
        opt.title = "\xA0\xA0" + opt.title;

      if (opt.enablecomponents)
        for (const comp of opt.enablecomponents)
          if (!this.enablecomponents.includes(comp))
            this.enablecomponents.push(comp);
    });

    this.buildNode();
    this.node.addEventListener("tollium:magicmenu", e => this.onMagicMenu(e));
    this.setRequired(data.required);
    this.setEnabled(data.enabled);
  }

  /****************************************************************************************************************************
   * DOM
   */

  buildHTMLNode() {
    const node = <select onChange={ev => this.gotControlChange(ev)} />;
    let insertdivider = false;
    for (const opt of this.options) {
      if (opt.isdivider) {
        insertdivider = true;
        continue;
      }

      //real item, flush any divider
      if (insertdivider) {
        // Firefox supports using <hr> as menu divider from version 122
        if (browser.getName() === "firefox" && browser.getVersion() < 122)
          node.append(<option disabled="disabled" class="divider">──────────</option>);
        else
          node.append(<hr />);
        insertdivider = false;
      }

      node.append(<option value={opt.value} selected={opt.selected} disabled={!opt.enabled}>{opt.title}</option>);
    }
    return node;
  }

  /****************************************************************************************************************************
   * Dimensions
   */

  calculateDimWidth() {
    this.width.min = 32; //FIXME determine a value, or don't we want us to ever shrink ?
    this.width.calc = this.node.getBoundingClientRect().width;
    this.debugLog("dimensions", "calc=" + this.width.calc + ", min=" + this.width.min);
  }

  calculateDimHeight() {
    this.height.min = $todd.settings.grid_vsize - $todd.settings.gridline_bottommargin - $todd.settings.gridline_topmargin;
  }

  relayout() {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height=" + this.height.set);

    const collapsed = this.width.set === this.myminheight;

    this.node.style.width = this.width.set + 'px';
    this.node.classList.toggle("collapsed", collapsed);
  }


  /****************************************************************************************************************************
   * Events
   */

  gotControlChange(ev) {
    this.setDirty();
  }

  onMagicMenu(event) {
    event.stopPropagation();
    event.detail.submenu.prepend(<li onClick={() => this.queueMessage("inspectoptions", {}, true)}>Inspect options</li>);
  }

  isEnabledOn(checkflags: string[], min: number, max: number, selectionmatch: SelectionMatch) {
    //    console.log(this.obj.getSelectedIndex());
    const flags = this.options[this.node.selectedIndex].flags;
    return $todd.checkEnabledFlags([flags], checkflags, min, max, selectionmatch);
  }
}
