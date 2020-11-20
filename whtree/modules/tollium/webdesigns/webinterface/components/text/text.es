import * as dompack from 'dompack';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';

var $todd = require('@mod-tollium/web/ui/js/support');
import "./text.scss";

const linetextTopMargin = 7; //kee in sync with css linetext-top-margin

//import Keyboard from 'dompack/extra/keyboard';


/****************************************************************************************************************************
 *                                                                                                                          *
 *  TEXT                                                                                                                    *
 *                                                                                                                          *
 ****************************************************************************************************************************/

export default class ObjText extends ComponentBase
{
/****************************************************************************************************************************
* Initialization
*/
  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);

    this.componenttype = "text";
    this.labelfor = null;

    this.styles = null;
    this.transparenttoclicks = false;
    this.sethtml = false;
    this.recreatenode = false;
    this.isheading = false;
    this.ismouseselectable = false;
    this.linkactions = [];


    this.transparenttoclicks = data.transparenttoclicks;

    this.setLabelFor(data.labelfor);

    this.setStyles(data);
    this.isheading = !!data.isheading;
    this.action = data.action;

    this.ismouseselectable = data.selectable;
    this.linkactions = data.linkactions || [];

    this.setInterestingActions([this.action]);
    this.setValue(data.value, data.ishtml);
  }

  setStyles(settings)
  {
    if (!this.styles)
    {
      this.styles = { bold:      false
                    , italic:    false
                    , underline: false
                    , wordwrap:  false
                    , ellipsis:  false
                    };
    }

    Object.keys(this.styles).forEach(key =>
    {
      if (typeof(settings[key]) == typeof(this.styles[key]))
        this.styles[key] = settings[key];
    });
  }

/****************************************************************************************************************************
* Property getters & setters
*/

  getLabelFor()
  {
    return this.labelfor;
  }

  setLabelFor(value)
  {
    if (this.node)
      this.node.dataset.labelfor = value;
    this.labelfor = value;
  }

  setValue(value, ishtml)
  {
    this.value = value;
    this.sethtml = !!ishtml;
    this.buildNode();
    if(!this.styles.ellipsis)
      this.width.dirty=true;
  }


/****************************************************************************************************************************
* DOM
*/

  buildNode()
  {
    var txtnode = <t-text class="t-text__linetext" data-name={this.name} propTodd={this} />;

    if (this.isheading)
      txtnode.classList.add("heading");
    if(this.sethtml)
      txtnode.innerHTML = this.value;
    else this.value.split('\n').forEach( (textrow, idx) =>
      {
        if(idx>0)
          txtnode.appendChild(<br />);
        txtnode.append(textrow);
      });

    if(this.hint)
      txtnode.title = this.hint;

    if(this.ismouseselectable)
      txtnode.classList.add("selectable");

    if(this.styles.bold)
      txtnode.style.fontWeight = "bold";
    if(this.styles.italic)
      txtnode.style.fontStyle = "italic";
    if(this.styles.underline)
      txtnode.style.textDecoration = "underline";
    if (this.labelfor || this.action)
    {
      txtnode.classList.add("label");
      if (this.labelfor)
        txtnode.dataset.labelfor = this.labelfor;
    }
    else
    {
      if (this.styles.wordwrap)
        txtnode.classList.add("wrapped");
      if (this.styles.ellipsis)
        txtnode.classList.add("ellipsis");
    }

    if(!this.transparenttoclicks)
      txtnode.addEventListener("click", this.onClick.bind(this));

    txtnode.propTodd = this;

    this.nodesize = $todd.CalculateSize(txtnode);

    if(this.styles.ellipsis) //don't set width if ellipsis is applied
      this.nodesize.x = 0;

    if(this.node && this.node.parentNode)
    {
      this.node.parentNode.replaceChild(txtnode, this.node);
      this.node = txtnode;
    }
    else
      this.node = txtnode;
    return txtnode;
  }


/****************************************************************************************************************************
* Dimensions
*/

  calculateDimWidth()
  {
    this.width.calc = this.nodesize.x;
    this.width.min = this.width.calc;
  }

  applySetWidth()
  {
    this.debugLog("dimensions", "width min=" + this.width.min + ", calc=" + this.width.calc + ", set=" + this.width.set);
    this.node.style.width = this.width.set + 'px';
    this.updateNodeSizeData();
  }

  calculateDimHeight()
  {
    this.height.min = Math.max(this.node.getBoundingClientRect().height + linetextTopMargin, $todd.settings.grid_vsize);
  }

  relayout()
  {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height="+ this.height.set);
    dompack.setStyles(this.node, { width: this.width.set, height: this.height.set - linetextTopMargin });

    if (this.styles.ellipsis)
      this.node.classList.toggle('overflow', this.width.set < this.width.min || this.height.set < this.height.min);
  }


/****************************************************************************************************************************
* Events
*/

  applyUpdate(data)
  {
    switch(data.type)
    {
      case "value":
        this.setValue(data.value, data.ishtml);
        return;
    }
    super.applyUpdate(data);
  }

  onClick(event)
  {
    var anchor = event.target.closest( 'a');
    if(anchor)
    {
      var rec = this.linkactions.find(action => action.url == anchor.href);
      if (rec)
        this.owner.executeAction(rec.action);
      else if(this.isEventUnmasked("clicklink"))
        this.queueEvent(this.owner.screenname + "." + this.name, 'clicklink ' + anchor.href, true);
      else if(anchor.href.substr(0,7) == 'mailto:')
        return; //let it be, follow the link. the only exit which does _not_ event.stop...
      else if(anchor.href.substr(0,11) != 'javascript:')
        window.open(anchor.href,'_blank');

      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    if(this.action)
      this.owner.executeAction(this.action);

    var comp = this.owner.getComponent(this.labelfor);
    if (comp)
    {
      //ADDME might as well send a signal through JS to the tollium component instead of trying to click, because checkbox is now doing hacks to forward the click event
      comp.node.focus();
      comp.node.click();
    }
  }

  onTooltip(node)
  {
    if (!this.styles.wordwrap && !this.styles.ellipsis && this.width.set < this.width.calc)
      return this.node.textContent;
  }

};

exports.components = { text: $todd.ObjText
                     };
