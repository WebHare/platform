import * as dompack from 'dompack';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';
import $todd from "@mod-tollium/web/ui/js/support";

/****************************************************************************************************************************
 *                                                                                                                          *
 *  CUSTOM HTML                                                                                                             *
 *                                                                                                                          *
 ****************************************************************************************************************************/

export default class ObjCustomHTML extends ComponentBase
{
  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);
    this.componenttype = "custom";
    this.selectionflags = [];

    this.node = dompack.create("t-custom", { dataset: {name: this.name }
                                        , "style": { "position": "relative"
                                                    , "overflow": "hidden"
                                                    }
                                        });
    this.contentdiv = dompack.create("div", { "style": { "width": "100%"
                                                     , "height": "100%"
                                                     }});
    this.node.appendChild(this.contentdiv);
    this.node.propTodd = this;
  }

/****************************************************************************************************************************
 * Property getters & setters
 */

  getContainer()
  {
    return this.contentdiv;
  }

  setSelectionFlag(flag)
  {
    if(!this.selectionflags.includes(flag))
      this.selectionflags.push(flag);
    this.owner.actionEnabler();
  }

  clearSelectionFlag(flag)
  {
    this.selectionflags = this.selectionflags.filter(item => item != flag); //erase
    this.owner.actionEnabler();
  }

/****************************************************************************************************************************
 * Dimensions
 */

  calculateDimWidth()
  {
  }

  calculateDimHeight()
  {
  }

  relayout()
  {
    dompack.setStyles(this.node, { "width": this.width.set
                                 , "height": this.height.set
                                 });
    if (this.width.set != this.prevwidth || this.height.set != this.prevheight)
    {
      this.prevwidth = this.width.set;
      this.prevheight = this.height.set;

      dompack.dispatchCustomEvent(this.contentdiv, 'tollium:resized', { bubbles:true, cancelable:false, detail: { x: this.width.set, y: this.height.set } }); //new style
    }
  }

  enabledOn(checkflags, min, max, selectionmatch)
  {
    return $todd.checkEnabledFlags(this.selectionflags, checkflags, min, max, selectionmatch);
  }
}
