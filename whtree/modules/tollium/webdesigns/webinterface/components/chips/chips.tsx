import * as dompack from '@webhare/dompack';
import * as icons from '@mod-tollium/js/icons';
import * as $todd from "@mod-tollium/web/ui/js/support";
import { ToddCompBase, type ComponentStandardAttributes } from '@mod-tollium/web/ui/js/componentbase';
import type { MagicMenuEvent } from '@mod-tollium/web/ui/js/debugging/magicmenu';
import type { SelectionMatch } from '@mod-tollium/web/ui/js/types';
import './chips.scss';
import Keyboard from 'dompack/extra/keyboard';
import type ObjMenuItem from '../menuitem/menuitem';

const rowGap = 2;
const gap = 5;
const topMargin = 2;
const bottomMargin = 3;

interface ChipsOption {
  icon?: number;
  value: string;
  title: string;
  text: string;
  hint?: string;
  selected: boolean;
  flags: Record<string, boolean>;
  enablecomponents: string[];
  backgroundcolor: string;
  invertcolor: boolean;
}

interface ChipsAttributes extends ComponentStandardAttributes {
  options: ChipsOption[];
  deletableflags: string[];
  openaction: string;
  selectcontextmenu: string;
  newcontextmenu: string;
  icons: string[];
}

type ChipsSavedState = {
  activeValue: string | number | null;
  cursorOrigin: { value: string | number; x: number; y: number } | null;
};

export default class ObjChips extends ToddCompBase<ChipsAttributes, ChipsSavedState> {
  /****************************************************************************************************************************
   * Initialization
   */
  componenttype = "chips";
  lastvalue: unknown = null;
  options: ChipsOption[];
  optionsMeta = new WeakMap<ChipsOption, { node: HTMLDivElement; size: $todd.Size; deleteIcon: HTMLImageElement | null }>();
  activeValue: string | number | null = null;
  deletableflags: string[];
  /** Node where cursor up/down navigation originated */
  cursorOrigin: { value: string | number; x: number; y: number } | null = null;
  openaction: string;
  selectcontextmenu: string;
  newcontextmenu: string;
  iconnames: string[];

  declare node: HTMLDivElement;

  constructor(parentcomp: ToddCompBase | null, data: ChipsAttributes) {
    super(parentcomp, data);

    this.setEnabled(data.enabled ?? true);

    this.options = data.options;
    this.options.forEach(opt => {
      if (opt.enablecomponents)
        for (const comp of opt.enablecomponents)
          if (!this.enablecomponents.includes(comp))
            this.enablecomponents.push(comp);
    });
    this.activeValue = this.options.find(opt => opt.selected)?.value ?? this.options[0]?.value ?? null;
    this.deletableflags = data.deletableflags;
    this.iconnames = data.icons;

    this.buildNode();
    this.node.addEventListener("tollium:magicmenu", e => this.onMagicMenu(e));
    this.setRequired(false);

    this.openaction = data.openaction;
    this.selectcontextmenu = data.selectcontextmenu;
    this.newcontextmenu = data.newcontextmenu;
    if (this.selectcontextmenu)
      this.owner.addComponent(this.owner, data.selectcontextmenu);
    if (this.newcontextmenu)
      this.owner.addComponent(this.owner, data.newcontextmenu);
  }

  getStateForReadd(): ChipsSavedState | null {
    return { activeValue: this.activeValue, cursorOrigin: this.cursorOrigin };
  }

  applyStateAfterReadd(state: ChipsSavedState): void {
    if (this.options.find(opt => opt.value === state.activeValue)) {
      const focus = this.node.contains(document.activeElement);
      this.setActiveValue(state.activeValue, { focus, updateOrigin: false });
    }
    if (state.cursorOrigin && this.options.find(opt => opt.value === state.cursorOrigin!.value))
      this.cursorOrigin = state.cursorOrigin;
  }

  getValue() {
    return this.options.find(opt => opt.selected)?.value ?? "";
  }

  setValue(value: string | number | null) {
    for (const opt of this.options) {
      opt.selected = opt.value === value;
      const meta = this.optionsMeta.get(opt)!;
      meta.node.classList.toggle("t-chips__chip--selected", opt.value === value);
      meta.node.ariaSelected = opt.selected ? "true" : "false";
    }
  }

  setRequired(value: boolean) {
  }

  setEnabled(value: boolean) {
    super.setEnabled(value);
    this.node?.classList.toggle("t-chips--disabled", !value);
  }

  getSubmitValue() {
    return this.getValue();
  }

  setActiveValue(value: string | number | null, options: { focus?: boolean; select?: boolean; updateOrigin?: boolean } = {}) {
    this.activeValue = value;
    if (options.updateOrigin !== false)
      this.cursorOrigin = null;
    for (const opt of this.options) {
      const meta = this.optionsMeta.get(opt)!;
      const isActive = opt.value === value;
      if (isActive)
        this.activeValue = opt.value;
      meta.node.tabIndex = isActive && this.enabled ? 0 : -1;
      if (isActive) {
        if (options.focus && !meta.node.contains(document.activeElement))
          meta.node.focus();
        if (options.updateOrigin !== false) {
          const box = this.getOptionBox(meta.node);
          this.cursorOrigin = { value: opt.value, x: box.x, y: box.y };
        }
      }
    }
    if (options.select) {
      this.setValue(value);
      this.onSelect();
    }
    if (this.activeValue !== value)
      this.activeValue = null;
  }

  getBoxOfValue(value: string | number | null): DOMRect | null {
    const opt = this.options.find(_ => _.value === value);
    if (!opt)
      return null;
    const meta = this.optionsMeta.get(opt);
    if (!meta)
      return null;
    return this.getOptionBox(meta.node);
  }

  getOptionBox(optionNode: HTMLElement): DOMRect {
    const rect = optionNode.getBoundingClientRect();
    const refRect = this.node.getBoundingClientRect();
    rect.x -= refRect.x;
    rect.y -= refRect.y;
    return rect;
  }

  /** Check if the location of the stored cursor origin is still valid, build a
   * new one based on the active value if not
   */
  checkCursorOrigin(): { value: string | number; x: number; y: number } | null {
    if (this.cursorOrigin) {
      const option = this.options.find(_ => _.value === this.cursorOrigin?.value);
      if (option) {
        const meta = this.optionsMeta.get(option)!;
        const box = this.getOptionBox(meta.node);
        if (box.x === this.cursorOrigin.x)
          return this.cursorOrigin;
      }
    }
    this.cursorOrigin = null;
    for (const option of this.options) {
      const meta = this.optionsMeta.get(option)!;
      if (meta.node.classList.contains("t-chips__chip--active")) {
        const box = this.getOptionBox(meta.node);
        this.cursorOrigin = { value: option.value, x: box.x, y: box.y };
      }
    }
    return this.cursorOrigin;
  }

  buildNode() {
    this.node = <t-chips
      class={{ "t-chips--disabled": !this.enabled }}
      onMousedown={(event: MouseEvent) => this.onMouseDown(event)}
      onClick={(event: MouseEvent) => this.onClick(event)}
      onContextmenu={(event: MouseEvent) => this.onContextMenu(event)}
    />;
    this.node.ariaLabel = this.title;

    for (const opt of this.options) {
      const div = <div class={{
        "t-chips__chip": 1,
        "t-chips__chip--selected": opt.selected,
        "t-chips__chip--active": opt.value === this.activeValue,
        "t-chips__chip--invertcolor": opt.invertcolor,
      }} tabIndex={this.enabled ? (opt.value === this.activeValue ? 0 : -1) : null}
        ariaSelected={opt.selected ? "true" : "false"}
        onFocus={(event: FocusEvent) => this.onFocus(event)}
        onMousedown={(event: MouseEvent) => this.onMouseDown(event)}
        onMouseop={(event: MouseEvent) => this.onMouseUp(event)}
        onMouseleave={(event: MouseEvent) => this.onMouseLeave(event)}
        onDblclick={(event: MouseEvent) => this.onDoubleClick(event)}
      >
        {opt.icon && this.iconnames[opt.icon - 1] ? icons.createImage(this.iconnames[opt.icon - 1], 16, 16, opt.invertcolor ? 'w' : 'b') : null}
        <span>{opt.title ? <b>{opt.title}{opt.text ? ": " : ""}</b> : ""}{opt.text}</span>
      </div > as HTMLDivElement;
      if (opt.hint)
        div.title = opt.hint;

      const deleteEnabled = this.enabled &&
        this.isEventUnmasked("delete") &&
        $todd.checkEnabledFlags([opt.flags], this.deletableflags, 1, 1, "all");

      const deleteIcon = deleteEnabled ? icons.createImage("tollium:actions/delete", 16, 16, opt.invertcolor ? 'w' : 'b', { className: "button__img" }) : null;
      if (deleteIcon)
        div.append(<div class="t-chips__buttons">{deleteIcon}</div>);

      div.style.setProperty("--t-chips__chip--background-color", opt.backgroundcolor || "#ccf");
      const size = $todd.CalculateSize(div, { noContentCollapse: true });
      div.style.width = `${size.x}px`;
      this.optionsMeta.set(opt, { node: div, size, deleteIcon });
      this.node.append(div);
    }

    if (this.hint)
      this.node.title = this.hint;
    this.node.dataset.name = this.name;
    this.node.propTodd = this;

    new Keyboard(this.node,
      {
        "ArrowRight": (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!this.enabled)
            return;
          let newOpt: ChipsOption | null = null;
          for (const opt of this.options.toReversed()) {
            if (opt.value === this.activeValue)
              break;
            newOpt = opt;
          }
          if (newOpt)
            this.setActiveValue(newOpt.value, { focus: true });
        },
        "ArrowLeft": (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!this.enabled)
            return;
          let newOpt: ChipsOption | null = null;
          for (const opt of this.options) {
            if (opt.value === this.activeValue)
              break;
            newOpt = opt;
          }
          if (newOpt)
            this.setActiveValue(newOpt.value, { focus: true });
        },
        "ArrowUp": (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!this.enabled)
            return;
          const origin = this.checkCursorOrigin();
          const activeBox = this.getBoxOfValue(this.activeValue);
          let newOpt: ChipsOption | null = null;
          for (const opt of this.options) {
            if (opt.value === this.activeValue)
              break;
            const box = this.getOptionBox(this.optionsMeta.get(opt)!.node);
            if ((!origin || box.x <= origin.x) && (!activeBox || box.y < activeBox.y))
              newOpt = opt;
          }
          if (newOpt)
            this.setActiveValue(newOpt.value, { focus: true, updateOrigin: false });
        },
        "ArrowDown": (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!this.enabled)
            return;
          const origin = this.checkCursorOrigin();
          const activeBox = this.getBoxOfValue(this.activeValue);
          let newOpt: [ChipsOption, number] | null = null;
          for (const opt of this.options.toReversed()) {
            if (opt.value === this.activeValue)
              break;
            const box = this.getOptionBox(this.optionsMeta.get(opt)!.node);
            if ((!origin || box.x <= origin.x) && (!activeBox || box.y > activeBox.y)) {
              if (!newOpt || box.y < newOpt[1])
                newOpt = [opt, box.y];
            }
          }
          if (newOpt)
            this.setActiveValue(newOpt[0].value, { focus: true, updateOrigin: false });
        },
        " ": (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!this.enabled)
            return;
          if (this.activeValue !== null) {
            this.setValue(this.activeValue);
            this.onSelect();
          }
        },
        "Delete": (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!this.enabled || !this.isEventUnmasked("delete"))
            return;
          const chip = this.options.find(opt => opt.value === this.activeValue);
          if (!chip || !$todd.checkEnabledFlags([chip.flags], this.deletableflags, 1, 1, "all"))
            return;
          this.queueMessage("delete", { value: this.activeValue }, true);
          // TODO: set active value to previous/first option after deletion
        },
        "Enter": (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!this.enabled)
            return;
          if (this.openaction) {
            const comp = this.owner.getComponent(this.openaction);
            if (comp)
              comp.onExecute();
          }
        }
      });
  }

  onSelect() {
    const newvalue = this.getValue();
    if (newvalue !== this.lastvalue) {
      this.lastvalue = newvalue;
      this.setDirty();

      if (this.isEventUnmasked("select") || this.enablecomponents.length)
        this.transferState(true);
      // always call actionEnabled or enableon's and clientside visibleon's won't work correctly
      this.owner.actionEnabler();
    }
  }

  /****************************************************************************************************************************
   * Dimensions
   */

  calculateDimWidth() {
    this.width.min = 64; //FIXME determine a value, or don't we want us to ever shrink ?
    this.width.calc = Math.max(this.node.getBoundingClientRect().width, this.width.min);

    const chipWidth = this.options.reduce((max, opt) => {
      const meta = this.optionsMeta.get(opt)!;
      return max + (max ? gap : 0) + meta.size.x;
    }, 0);

    this.width.calc = Math.max(this.width.min, chipWidth + 10);

    this.debugLog("dimensions", "calc=" + this.width.calc + ", min=" + this.width.min);
  }

  applySetWidth(): void {
    this.debugLog("dimensions", "applySetWidth set width=" + this.width.set);
    this.node.style.width = this.width.set + 'px';
    this.height.dirty = true;
  }

  calculateDimHeight() {
    let totalHeight = 0;
    let lineWidth = 0;
    let lineHeight = 0;

    for (const opt of this.options) {
      const size = this.optionsMeta.get(opt)!.size;

      if ((lineWidth ? lineWidth + gap : 0) + size.x > this.width.set) {
        totalHeight += (totalHeight ? rowGap : 0) + lineHeight;
        lineHeight = size.y;
        lineWidth = size.x;
      } else {
        lineHeight = Math.max(lineHeight, size.y);
        lineWidth += (lineWidth ? gap : 0) + size.x;
      }
    }
    if (lineHeight)
      totalHeight += (totalHeight ? rowGap : 0) + lineHeight;

    this.height.min = Math.max(totalHeight, $todd.settings.grid_vsize - topMargin - bottomMargin);
    this.height.calc = totalHeight;//Math.max(totalHeight, this.height.min);
    this.debugLog("dimensions", "calc=" + this.height.calc + ", min=" + this.height.min);
  }

  applySetHeight(): void {
    this.debugLog("dimensions", "applySetHeight set height=" + this.height.set);
    this.node.style.height = (this.height.set - topMargin - bottomMargin) + 'px';
  }

  relayout() {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height=" + this.height.set);
    this.node.style.width = this.width.set + 'px';
    this.node.style.height = (this.height.set - topMargin - bottomMargin) + 'px';
  }

  /****************************************************************************************************************************
   * Events
   */

  onMagicMenu(event: MagicMenuEvent) {
    let idx: number = -1;
    for (const [index, option] of this.options.entries()) {
      const meta = this.optionsMeta.get(option)!;
      if (meta.node.contains(event.target as Node))
        idx = index;
    }
    event.stopPropagation();
    event.detail.submenu.prepend(<li onClick={() => this.queueMessage("inspectoptions", { value: idx }, true)}>{idx === -1 ? "Inspect options" : `Inspect option #${idx}`}</li>);
  }

  isEnabledOn(checkflags: string[], min: number, max: number, selectionmatch: SelectionMatch) {
    const flags = this.options.filter(opt => opt.selected).map(opt => opt.flags);
    if (!flags.length)
      return false;
    return $todd.checkEnabledFlags(flags, checkflags, min, max, selectionmatch);
  }

  onClick(event: MouseEvent) {
    if (!this.enabled)
      return;
    //event.preventDefault();
    event.stopPropagation();
    for (const option of this.options) {
      const meta = this.optionsMeta.get(option)!;
      if (event.target === meta.deleteIcon) {
        this.queueMessage("delete", { value: option.value }, true);
        return;
      }
      //// check if within option
      if (event.target && meta.node.contains(event.target as Node)) {
        this.setActiveValue(option.value, { focus: true, select: true });
        return;
      }
    }
    // clicked outside of any option, deselect
    this.setValue(null);
    this.onSelect();
  }

  onDoubleClick(event: MouseEvent) {
    if (!this.enabled || !this.openaction)
      return;

    event.preventDefault();
    event.stopPropagation();
    for (const option of this.options) {
      const meta = this.optionsMeta.get(option)!;
      if (meta.node.contains(event.target as Node)) {
        this.setValue(option.value);
        this.onSelect();
        if (this.openaction) {
          const comp = this.owner.getComponent(this.openaction);
          if (comp)
            comp.onExecute();
        }
        return;
      }
    }
  }

  onFocus(event: FocusEvent) {
    if (!this.enabled)
      return;
    event.stopPropagation();
    for (const option of this.options) {
      const meta = this.optionsMeta.get(option)!;
      if (meta.node.contains(event.target as Node)) {
        this.setActiveValue(option.value, { updateOrigin: false });
        return;
      }
    }
    this.setActiveValue(null, { updateOrigin: false });
  }

  onMouseDown(event: MouseEvent) {
    if ((event.target as HTMLElement)?.nodeName === "IMG") {
      event.preventDefault();
      event.stopPropagation();

      if (event.button === 1)
        return;

      (event.target as HTMLImageElement).classList.toggle("button--active", true);
      return;
    }
    for (const option of this.options) {
      const meta = this.optionsMeta.get(option)!;
      if (meta.node.contains(event.target as Node)) {
        this.setActiveValue(option.value, { focus: true });
        return;
      }
    }
  }

  onMouseUp(event: MouseEvent) {
    if ((event.target as HTMLElement)?.nodeName === "IMG")
      (event.target as HTMLImageElement).classList.toggle("button--active", false);
  }

  onMouseLeave(event: MouseEvent) {
    if ((event.target as HTMLElement)?.nodeName === "IMG")
      (event.target as HTMLImageElement).classList.toggle("button--active", false);
  }

  onContextMenu(event: MouseEvent) {
    if (!this.enabled)
      return;
    event.preventDefault();
    event.stopPropagation();

    let haveValue = false;
    for (const option of this.options) {
      const meta = this.optionsMeta.get(option)!;
      if (meta.node.contains(event.target as Node)) {
        if (event.target && meta.node.contains(event.target as Node)) {
          this.setActiveValue(option.value, { focus: true, select: true });
          haveValue = true;
          break;
        }
      }
    }

    const menu = this.owner.getComponent(haveValue ? this.selectcontextmenu : this.newcontextmenu);
    if (!menu)
      return;
    (menu as ObjMenuItem).openMenuAt(event, { eventnode: this.node, ascontextmenu: true });
  }
}
