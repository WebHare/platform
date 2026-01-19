import * as dompack from 'dompack';
import * as browser from "dompack/extra/browser";
import * as $todd from "@mod-tollium/web/ui/js/support";
import { ToddCompBase, type ComponentStandardAttributes } from '@mod-tollium/web/ui/js/componentbase';
import type { MagicMenuEvent } from '@mod-tollium/web/ui/js/debugging/magicmenu';
import type { SelectionMatch } from '@mod-tollium/web/ui/js/types';

interface PulldownOption {
  indent: number;
  title: string;
  value: string;
  selected: boolean;
  enabled: boolean;
  isdivider: boolean;
  flags: Record<string, boolean>;
  enablecomponents: string[];
}

interface PulldownAttributes extends ComponentStandardAttributes {
  options: PulldownOption[];
  required: boolean;
}

export default class ObjPulldown extends ToddCompBase {
  /****************************************************************************************************************************
   * Initialization
   */
  componenttype = "pulldown2";
  lastvalue: null | string = null;
  options: PulldownOption[];

  declare node: HTMLSelectElement;

  constructor(parentcomp: ToddCompBase | null, data: PulldownAttributes) {
    super(parentcomp, data);

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
    this.setEnabled(data.enabled ?? true);
  }

  getValue() {
    return this.node.value || '';
  }

  setValue(value: string) {
    dompack.changeValue(this.node, value);
    //shouldn't be needed: this.onSelect(); - changeValue will fire the event itself
  }

  setRequired(value: boolean) {
    if (Boolean(value) !== Boolean(this.node.required)) {
      this.node.required = Boolean(value);
    }
  }

  setEnabled(value: boolean) {
    this.node.disabled = !value;
  }

  getSubmitValue() {
    return this.getValue();
  }

  buildNode() {
    this.node = <select onChange={(ev: Event) => this.gotControlChange(ev)} />;
    this.node.ariaLabel = this.title;

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
          this.node.append(<option disabled="disabled" class="divider">──────────</option>);
        else
          this.node.append(<hr />);
        insertdivider = false;
      }

      this.node.append(<option value={opt.value} selected={opt.selected} disabled={!opt.enabled}>{opt.title}</option>);
    }

    if (this.hint)
      this.node.title = this.hint;
    this.node.dataset.name = this.name;
    this.node.addEventListener("change", () => this.onSelect());
    this.node.propTodd = this;
  }

  onSelect() {
    const newvalue = this.getValue();
    if (newvalue !== this.lastvalue) {
      const shouldsetdirty = this.lastvalue !== null;
      this.lastvalue = newvalue;
      if (shouldsetdirty)
        this.setDirty();
    }
    if (this.isEventUnmasked("select") || this.enablecomponents.length)
      this.transferState();
    // always call actionEnabled or enableon's and clientside visibleon's won't work correctly
    this.owner.actionEnabler();
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
    this.node.style.width = this.width.set + 'px';
  }

  /****************************************************************************************************************************
   * Events
   */

  gotControlChange(ev: Event) {
    this.setDirty();
  }

  onMagicMenu(event: MagicMenuEvent) {
    event.stopPropagation();
    event.detail.submenu.prepend(<li onClick={() => this.queueMessage("inspectoptions", {}, true)}>Inspect options</li>);
  }

  isEnabledOn(checkflags: string[], min: number, max: number, selectionmatch: SelectionMatch) {
    const flags = this.options[this.node.selectedIndex].flags;
    return $todd.checkEnabledFlags([flags], checkflags, min, max, selectionmatch);
  }
}
