import * as dompack from '@webhare/dompack';
import { html } from '@webhare/dompack/src/html';

import './section.css';
import { type ComponentStandardAttributes, ToddCompBase } from '@mod-tollium/web/ui/js/componentbase';

/****************************************************************************************************************************
 *                                                                                                                          *
 *  SPLIT                                                                                                                   *
 *                                                                                                                          *
 ****************************************************************************************************************************/

interface SectionAttributes extends ComponentStandardAttributes {
  panel: string;
  open: boolean;
}

export default class ObjSection extends ToddCompBase {
  static cachedDimensions?: {
    overheadHeight: number;
  };

  static getCachedDimensions(sample: ObjSection) {
    this.cachedDimensions = {
      overheadHeight: sample.summaryNode.offsetHeight + parseInt(getComputedStyle(sample.detailsNode).paddingTop) + parseInt(getComputedStyle(sample.detailsNode).paddingBottom)
    };
    return this.cachedDimensions;
  }

  componenttype = "section";
  panel: ToddCompBase;
  open = false;
  private detailsNode!: HTMLDetailsElement;
  private summaryNode!: HTMLElement;
  private panelNode!: HTMLElement;

  constructor(parentcomp: ToddCompBase, data: SectionAttributes) {
    super(parentcomp, data);
    console.log(data);

    this.panel = this.owner.addComponent(this, data.panel, { allowMissing: false });
    this.open = data.open;
    this.buildNode();
  }

  buildNode() {
    this.node = dompack.create('t-section', { dataset: { name: this.name } },
      [
        this.detailsNode = html('details', {
          open: this.open,
        },
          [
            this.summaryNode = dompack.create('summary', {
              on: {
                click: evt => this.onClick(evt),
                mouseenter: () => this.onMouseEnter()
              },
              title: this.title
            }, [this.title]),
            this.panelNode = this.panel.getNode()
          ],

        )
      ]);
  }

  onMouseEnter(): void {
    //apply title= if we're overflowing
    this.summaryNode.title = this.summaryNode.offsetWidth < this.summaryNode.scrollWidth ? this.summaryNode.textContent || '' : '';
  }

  getVisibleChildren(): ToddCompBase[] {
    return [this.panel];
  }

  onClick(evt: MouseEvent) {
    //We're intercepting onClick as onToggle runs *after* opening/closing and our relayout will cause flicker

    dompack.stop(evt);
    this.detailsNode.open = !this.detailsNode.open;
    this.height.dirty = true;
    this.owner.recalculateDimensions();
    this.owner.relayout();
  }

  relayout() {
    this.panel.relayout();
  }

  calculateDimWidth() {
    ObjSection.cachedDimensions ||= ObjSection.getCachedDimensions(this);

    this.width.calc = this.panel.width.calc;
    this.width.min = this.panel.width.min;
  }

  applySetWidth(): void {
    this.summaryNode.style.width = `${this.width.set}px`;
    this.panel.setWidth(this.width.set);
    this.panel.applyDimension(true);
  }

  calculateDimHeight() {
    this.height.min = ObjSection.cachedDimensions!.overheadHeight + (this.detailsNode.open ? this.panel.height.min : 0);
    this.height.calc = ObjSection.cachedDimensions!.overheadHeight + (this.detailsNode.open ? this.panel.height.calc : 0);
  }

  applySetHeight(): void {
    this.panel.setHeight(this.detailsNode.open ? this.height.set - ObjSection.cachedDimensions!.overheadHeight : this.panel.height.calc);
    this.panel.applySetHeight();
  }
}
