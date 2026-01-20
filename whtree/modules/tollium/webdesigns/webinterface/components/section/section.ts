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
  componenttype = "section";
  panel: ToddCompBase;
  open = false;
  private detailsNode!: HTMLDetailsElement;
  overheadHeight = 28; //FIXME align with section.css

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
            dompack.create('summary', {
              on: { click: evt => this.onClick(evt) },
            }, [this.title]),
            this.panel.getNode()
          ],

        )
      ]);
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
    this.width.calc = this.panel.width.calc;
    this.width.min = this.panel.width.min;
  }

  applySetWidth(): void {
    this.panel.setWidth(this.width.set);
    this.panel.applyDimension(true);
  }

  calculateDimHeight() {
    this.height.min = this.overheadHeight + (this.detailsNode.open ? this.panel.height.min : 0);
    this.height.calc = this.overheadHeight + (this.detailsNode.open ? this.panel.height.calc : 0);
  }

  applySetHeight(): void {
    this.panel.setHeight(this.detailsNode.open ? this.height.set - this.overheadHeight : this.panel.height.calc);
    this.panel.applySetHeight();
  }
}
