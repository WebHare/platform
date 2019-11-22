import * as dompack from 'dompack';
import ComponentBase from '@mod-tollium/webdesigns/webinterface/components/base/compbase';

import { Counter } from "@mod-tollium/web/ui/components/basecontrols/counter";
import { getUTF8Length } from "@mod-system/js/internal/utf8";

var $todd = require("@mod-tollium/web/ui/js/support");
var getTid = require("@mod-tollium/js/gettid").getTid;
var RTE = require('@mod-tollium/web/ui/components/richeditor');
var TableEditor = require('@mod-tollium/web/ui/components/richeditor/internal/tableeditor');
var menu = require('@mod-tollium/web/ui/components/basecontrols/menu');


/* our new dirty/change protocol:
  - When the server initializes us, we get a value and a generation count (0).
    We store this generation and reset our dirtycount.
  - When the server updates the value, it sends a higher sendcount with that
    value. We again store this value and reset our dirtycount
  - When the RTD receives input, it sends a Dirty signal. We receive that signal,
    increment our dirtycount, and send the generation and dirtycount to the server
  - When the server receives our dirty signal and the generation matches,
    it'll flag the RTD as dirty. If the server's generation is higher, it ignores
    the dirty signal
  - When the server wants to mark us as clean (and receive future dirties) without
    having to reset the value, it'll send us a clean request and inform us of
    the dirtycount. We'll only rearm if the dirtycount matches what we had - if
    we were already higher, it's a race and the server will rearm our higher
    dirtycount soon.
*/

export default class ObjRTE extends ComponentBase
{
  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);
    this.componenttype= "rte";
    this.rte= null;
    this.rteoptions= null;
    this.actions= [];
    this.borders= null;
    this.hint= '';
    this.required= false;
    this.interceptbuttons= [];
    this.valueid= '';

    /// Selection for enabled actions ()
    this._selectionflags= [ {} ];
    /// The untouched content as sent by the server
    this.untouchedcontent= null;
    /// Original restructured HTML content
    this.restructuredcontent= null;

    this._showcounter= false;
    this._countmethod= "";
    this._toplaintextmethod= "";
    this._textwarnlength= 0;

    this._counter= 0;

    this._pendingactiontargetseq=0;
    this._pendingactiontargets= [];

    this.hint = data.hint;
    this.required = data.required;
    this.interceptbuttons = data.interceptbuttons;
    this.isemaileditor = data.areatype == 'email'; //FIXME gaat dit nbu wel via 'type' of 'areatype' ?
    this.borders = data.borders;
    this._showcounter = data.showcounter;
    this._countmethod = data.countmethod;
    this._toplaintextmethod = data.toplaintextmethod;
    this._warnlength = data.warnlength;

    var hidebuttons = [];
    if(!data.allownewembeddedobjects)
      hidebuttons.push('object-insert');
    if(!data.allowvideo)
      hidebuttons.push('object-video');
    if(!data.structure || !data.structure.blockstyles.some(function(style) { return style.type == "table"; }))
      hidebuttons.push('table');

    this.rteoptions =
      { enabled: data.enabled
      , readonly: data.readonly
      , backgroundcolor: 'transparent'

      , actionelements:
            [ { element:"table", hasclasses: ["wh-rtd__table"] }
            ]

      //FIXME
      , language: 'en'//parent.app.lang      // FIXME
      //, log:true
      , allowtags: data.allowtags.length ? data.allowtags : null
      , structure: data.structure
      , margins: data.margins
      , csslinks: [data.cssurl]
      , cssinstance: data.cssinstance
      , breakupnodes: this.isemaileditor ? [ 'blockquote' ] : []
      , hidebuttons: hidebuttons
      , htmlclass: data.htmlclass
      , bodyclass: data.bodyclass
      , csscode: data.csscode
      , propertiesaction: true
      };

    if(!this.rteoptions.structure)
    {
      //ADDME standard styling should be class-selectable and implemented by designfiels rte css itself or a theme
      this.rteoptions.csscode = '.' + data.cssinstance + '.wh-rtd-editor-htmlnode { font: 0.7em Tahoma,"Lucida Grande","DejaVu Sans",freesans,arial,helvetica,sans-serif; }\n'
                                +'.' + data.cssinstance + ' blockquote { border: #666666 solid 0; border-left-width: 2px; margin: 5px 0; padding: 0 5px; color: #555555; }\n'
                                +'.' + data.cssinstance + ' blockquote blockquote { color: #666666; }\n'
                                +'.' + data.cssinstance + ' blockquote blockquote blockquote { color: #777777; }\n'
                                +'.' + data.cssinstance + ' p { padding:0; margin: 0}\n';
    }

    // Build our DOM
    this.buildNode();
    this.setValue(data);
  }

  destroy()
  {
    this.rte.destroy();
    super.destroy();
  }

/****************************************************************************************************************************
* Property getters & setters
*/

  setValue(newvalue) //set from server
  {
    if(this.untouchedcontent == newvalue.value && !this.rte.isDirty())
      return console.log("RTE: server sent an unneeded update");

    this.untouchedcontent = newvalue.value;
    this.valuegeneration = newvalue.valuegeneration;
    this.valuedirtycount = newvalue.valuedirtycount;
    this.rte.setValue(this.untouchedcontent);
    this.restructuredcontent = this.rte.getValue();
    if (newvalue.valuedirtycount == 0)
      this.rte.clearDirty();
  }

  getSubmitValue()
  {
    let suggestedreturnvalue = this.rte.getValue();
    if (suggestedreturnvalue == this.restructuredcontent) //no material change ( FIXME Let the RTD implement this)
    {
      console.log("Returning untouched value");
      return this.untouchedcontent;
    }
    else
    {
      console.log("Returning updated value");
      return suggestedreturnvalue;
    }
  }


/****************************************************************************************************************************
* DOM
*/

  // Build the DOM node(s) for this component
  buildNode()
  {
    this.node = <div data-name={this.name} propTodd={this} />;
    this.rte = new RTE(this.node, this.rteoptions);
    if(this.rteoptions.structure)
      this.node.classList.add("structured");

    this.rte.getBody().addEventListener("wh:rtd-statechange", () => this._onRTEStateChange());

    if (this._showcounter)
    {
      this._counter = new Counter({ count: 0, limit: this._warnlength, focusnode: this.node });
      this.node.appendChild(this._counter.node);
    }

    ["Top","Right","Bottom","Left"].forEach(bordername =>
    {
      // 1px is the default from designfiles css
      if (this.borders && !this.borders[bordername.toLowerCase()])
        this.node.style[`border${bordername}Width`] = "0px";
    });

    this.node.propTodd = this;
    this.node.addEventListener("wh:richeditor-action", evt => this._doExecuteAction(evt));
    this.node.addEventListener("wh:rtd-dirty", evt => this._gotDirty());
  }

/****************************************************************************************************************************
* Dimensions
*/

  calculateDimWidth()
  {
    this.width.min = 200;
  }

  calculateDimHeight()
  {
    this.height.min = 120;
  }

  relayout()
  {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height="+ this.height.set);
    this.node.style.width = this.width.set + 'px';
    this.node.style.height = this.height.set + 'px';
  }


/****************************************************************************************************************************
* Component state
*/

  enabledOn(checkflags, min, max, selectionmatch)
  {
    return $todd.Screen.checkEnabledFlags(this._selectionflags, checkflags, min, max, selectionmatch);
  }


/****************************************************************************************************************************
* Events
*/
  _doExecuteAction(event)
  {
    var action = event.detail.action;

    if(["a-href","object-insert","object-video"].includes(action))
    {
      event.stopPropagation();
      event.preventDefault();
      this.doButtonClick(action);
    }
    if(action == "action-properties")
    {
      this._gotPropertiesEvent(event);
    }
  }

  doButtonClick(buttonname, params)
  {
    var data = { button: buttonname };
    if (params)
      data.params = params;
    this.queueMessage('buttonclick', data, true);
  }

  _onRTEStateChange()
  {
    var selstate = this.rte ? this.rte.getSelectionState() : null;
    var actionstate = selstate ? selstate.actionstate : {};

    var have_change = false;

    var row = this._selectionflags[0];
    Object.keys(actionstate).forEach(key =>
    {
      var available = actionstate[key].available || false;
      if (row[key] !== available)
      {
        have_change = true;
        row[key] = available;
      }
    });

    if (have_change)
    {
      // Update enabled status for actions
      this.actions.forEach(action => action.checkEnabled());
    }

    if (this._showcounter)
      this._updateCounter();
  }

  _updateCounter()
  {
    if (!this.rte)
      return;

    let count = 0;

    let text = this.rte.getPlainText(this._toplaintextmethod);
    if (this._countmethod === "plaintext:characters")
      count = text.length;
    else if (this._countmethod === "plaintext:bytes")
      count = getUTF8Length(text.length);

    this._counter.update({ count: count });
  }

  getParentElement(element, gettag)
  {
    gettag=gettag.toUpperCase();
    for (var findparent=element;findparent;findparent=findparent.parentNode)
      if(findparent.nodeName.toUpperCase()==gettag)
        return findparent;
    return null;
  }

  _gotPropertiesEvent(event)
  {
    //FIXME we need to stop direct RTE manipulation and start using 'offiical' APIs offered by the richeditor/index.es
    if(event.detail.actiontarget)
    {
      let affectednodeinfo = event.detail.rte.getTargetInfo(event.detail.actiontarget);
      if(affectednodeinfo) //new properties API may not require any rework from us at all, except from not transmitting the node itself over JSON
      {
        //preserve the actiontarget - the RTE will need it when the response comes in
        let actionid = ++this._pendingactiontargetseq;
        this._pendingactiontargets.push( { id: actionid, target: event.detail.actiontarget });

        //the rest of the data is built to be JSON-safe
        this.queueMessage('properties2', { actionid, affectednodeinfo }, true);
        event.preventDefault();
        return;
      }
    }

    var targetid = event.detail.targetid;
    var target = event.target;
    var subaction = event.detail.subaction;

    //The image 'targetid' is being editted. gather its properties and inform our parent
    if(target.nodeName.toUpperCase()=='IMG')
    {
      var props = { targetid: targetid
                  , type: 'img'
                  , align: ''
                  , width:  parseInt(target.getAttribute("width")) || target.width
                  , height: parseInt(target.getAttribute("height")) || target.height
                  , alttext: target.alt
                  , link: null
                  , src: target.src
                  };

      if(target.classList.contains("wh-rtd__img--floatleft"))
        props.align='left';
      else if(target.classList.contains("wh-rtd__img--floatright"))
        props.align='right';
//      else if(target.align=='left' || target.align=='right')
  //      props.align=target.align; //backwards compatibility

      var link = this.getParentElement(target, 'A');
      if(link && link.href)
        props.link = { link: link.getAttribute("href")
                     , target: link.getAttribute("target") || ''
                     };

      this.queueMessage('properties', props, true);
      event.preventDefault();
    }
    else if(target.classList.contains("wh-rtd-embeddedobject"))
    {
      let props = { targetid: targetid
                  , type: 'embeddedobject'
                  , instanceref: target.getAttribute('data-instanceref')
                  , subaction: subaction
                  };
      this.queueMessage('properties', props, true);
      event.preventDefault();
    }
    else if(target.nodeName.toUpperCase()=='TABLE')
    {
      var editor = TableEditor.getEditorForNode(target);
      if (editor)
      {
        let props = { targetid: targetid
                    , type: 'table'
                    , datacell: editor.locateFirstDataCell()
                    , numrows: editor.numrows
                    , numcols: editor.numcols
                    , styletag: editor.node.classList[0]
                    };
        this.queueMessage('properties', props, true);
      }
      event.preventDefault();
    }
  }

  onMsgInsertAnchor(data)
  {
    this.rte.getEditor().setAnchor(data.name);
  }

  onMsgUpdateProps2(data)
  {
    console.error(data,this._pendingactiontargets,this._pendingactiontargets[0]);
    let actiontargetidx = this._pendingactiontargets.findIndex(pendingtarget => pendingtarget.id == data.actionid);
    if(actiontargetidx == -1)
    {
      console.log("Received update for unknown actiontarget #" + data.actionid, data);
      return;
    }

    let actiontarget = this._pendingactiontargets[actiontargetidx].target;
    this._pendingactiontargets.splice(actiontargetidx, 1);

    if(!data.settings) //it's just a cancellation
      return;

    this.rte.updateTarget(actiontarget, data.settings);
  }

  onMsgUpdateProps(data)
  {
    //FIXME we need to stop direct RTE manipulation and start using 'offiical' APIs offered by the richeditor/index.es
    var targetid = data.targetid;
    var newdata = data.newdata;


    var target = this.rte.getActionTarget(targetid);
    if(!target)
      return; //unable to match the target, too bad...

    const undolock = this.rte.getEditor().getUndoLock();

    switch (target.nodeName.toUpperCase())
    {
      case "IMG":
      {
        target.width = newdata.width;
        target.height = newdata.height;
        target.align = '';
        target.alt = newdata.alttext;
        target.className = "wh-rtd__img" + (newdata.align=='left' ? " wh-rtd__img--floatleft" : newdata.align=="right" ? " wh-rtd__img--floatright" : "");

        var link = this.getParentElement(target, 'A');
        if(link && !newdata.link) //remove the hyperlink
        {
          console.warn("ADDME: Calling low level APIs here, cleanup or approve - would prefer not to disturb selection");
          this.rte.getEditor().selectNodeOuter(target);
          this.rte.getEditor().removeHyperlink();
        }
        else if (newdata.link) //add a hyperlink
        {
          console.warn("ADDME: Calling low level APIs here, cleanup or approve - would prefer not to disturb selection");
          if(!link)
          {
            this.rte.getEditor().selectNodeOuter(target);
            this.rte.getEditor().insertHyperlink(newdata.link.link);
            link = this.getParentElement(target, 'A');
            if(!link)
            {
              undolock.close();
              return console.error("Somehow <A> construction failed");
            }
          }

          link.href = newdata.link.link;
          link.target = newdata.link.target || '';
        }
      } break;
      case "DIV":
      case "SPAN":
      {
        if(target.classList.contains("wh-rtd-embeddedobject"))
        {
          //we'll simply reinsert
          if (newdata)
          {
            if (newdata.type == 'replace')
            {
              this.rte.getEditor().updateEmbeddedObject(target, newdata.data);
            }
            else if (newdata.type == 'remove')
            {
              this.rte.getEditor().removeEmbeddedObject(target);
            }
          }
        }
      } break;
      case "TABLE":
      {
        switch (newdata.type)
        {
          case "edittable":
          {
            var editor = TableEditor.getEditorForNode(target);
            if (editor)
            {
              editor.setFirstDataCell(newdata.datacell.row, newdata.datacell.col);
              editor.setStyleTag(newdata.styletag);
            }
          } break;
          case "remove":
          {
            this.rte.getEditor().removeTable(target);
          } break;
        }
      } break;
      default:
      {
        console.log('classes', target.className.split(' '));
      }
    }

    undolock.close();
  }

  onMsgUpdateValue(data)
  {
    this.setValue(data);
  }

  onMsgClearDirty(data)
  {
    if(data.valuegeneration == this.valuegeneration && data.valuedirtycount == this.valuedirtycount)
    {
      this.rte.clearDirty();
    }
    else
    {
      console.log("Ignoring stale cleardirty request", data, this.valuegeneration, this.valuedirtycount);
    }
  }

  _gotDirty()
  {
    ++this.valuedirtycount;
    this.queueMessage("dirty", { valuedirtycount: this.valuedirtycount, valuegeneration: this.valuegeneration });
  }

  onMsgInsertHyperlink(data)
  {
    this.rte.getEditor().insertHyperlink(data.url, { target: data.target });
  }

  onMsgInsertEmbeddedObject(data)
  {
    this.rte.getEditor().insertEmbeddedObject(data);
  }

  onMsgInsertImage(data)
  {
    this.rte.getEditor().insertImage(data.link, data.width, data.height);
  }

  onMsgUpdateEnabled(data)
  {
    this.rte.setEnabled(data.value);
  }

  onMsgUpdateClasses(data)
  {
    this.rte.setHTMLClass(data.htmlclass);
    this.rte.setBodyClass(data.bodyclass);
  }

  onMsgAckDirty()
  {
    // Used to send an empty response on the 'dirty' async message, so the comm layer gets an ack
    // on the message, which the test framework needs to complete 'waits: ["tollium"]'
  }
}
