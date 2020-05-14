import * as dompack from 'dompack';
import HTMLComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/html';
var $todd = require('@mod-tollium/web/ui/js/support');

export default class ObjPulldown extends HTMLComponentBase
{
/****************************************************************************************************************************
 * Initialization
 */

  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);
    this.componenttype = "pulldown2";
    this.components = [];

    this.options = data.options;
    this.options.forEach(opt =>
    {
      //ADDME: Should the menu code handle this?
      for (var i = 0; i < opt.indent; ++i)
        opt.title = "\xA0\xA0" + opt.title;

      if(opt.enablecomponents)
        for(var comp of opt.enablecomponents)
          if(!this.enablecomponents.includes(comp))
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

  buildHTMLNode()
  {
    var node =
        <select onChange={ev => this.gotControlChange(ev)} >
          {
            this.options.map(opt =>
              opt.isdivider
                ? <option disabled="disabled" class="divider">──────────</option>
                : <option
                    value={opt.value}
                    selected={opt.selected ? "selected" : ""}
                    disabled={opt.enabled ? "" : "disabled" }>{opt.title}</option>
            )
          }
        </select>;

    return node;
  }

/****************************************************************************************************************************
 * Dimensions
 */

  getSkinSettings()
  {
    return { compheight: Math.ceil(this.node.getBoundingClientRect().height) };
  }

  calculateDimWidth()
  {
    this.width.min = 32; //FIXME determine a value, or don't we want us to ever shrink ?
    this.width.calc = this.node.getBoundingClientRect().width;
    this.debugLog("dimensions", "calc=" + this.width.calc + ", min=" + this.width.min);
  }

  calculateDimHeight()
  {
    this.height.min = Math.max(this.skinsettings.compheight, $todd.settings.grid_vsize);
  }

  relayout()
  {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height="+ this.height.set);

    var collapsed = this.width.set == this.myminheight;

    this.node.style.width = this.width.set + 'px';
    this.node.classList.toggle("collapsed", collapsed);
  }


/****************************************************************************************************************************
 * Events
 */

  gotControlChange(ev)
  {
    this.setDirty();
  }

  onMagicMenu(event)
  {
    event.stopPropagation();
    event.detail.submenu.prepend(<li onClick={ () => this.queueMessage("inspectoptions", {}, true) }>Inspect options</li>);
  }

  enabledOn(checkflags, min, max, selectionmatch)
  {
//    console.log(this.obj.getSelectedIndex());
    var flags = this.options[this.node.selectedIndex].flags;
    return $todd.Screen.checkEnabledFlags([flags], checkflags, min, max, selectionmatch);
  }
}
