import * as dompack from 'dompack';
import ActionableBase from '@mod-tollium/webdesigns/webinterface/components/base/actionable';
import OverlayManager from "@webhare/dompack-overlays";
import './image.scss';

var toddImages = require("@mod-tollium/js/icons");
var $todd = require('@mod-tollium/web/ui/js/support');

// FIXME: relayout is needlessly triggered after communicating things like selection to the server

function getCoverCoordinates(inwidth, inheight, outwidth, outheight, fit)
{
  var infx = !(outwidth > 0);
  var infy = !(outheight > 0);
  var dx = infx ? 0 : inwidth / outwidth;
  var dy = infy ? 0 : inheight / outheight;
  var scale;
  if(infx)
    scale=dy;
  else if(infy)
    scale=dx;
  else if(fit)
    scale = Math.max(dx,dy);
  else
    scale = Math.min(dx,dy);

  return { width: inwidth/scale
         , height: inheight/scale
         , top: (outheight - (inheight/scale))/2
         , left: (outwidth - (inwidth/scale))/2
         };
}


export default class ObjImage extends ActionableBase
{ // ---------------------------------------------------------------------------
  //
  // Initialization
  //
  constructor(parentcomp, data, replacingcomp)
  {
    super(parentcomp, data, replacingcomp);

    this.componenttype = "image";
    this.focusedoverlay = null;

    this.clickable = false;

    this.imgsrc = '';
    this.imgwidth = 0;
    this.imgheight = 0;
    this.objectfit = data.objectfit;


    // Overlays support ////////////////////////////////////////////
    this.flags = data.flags || [];

    this.overlays_allowcreate = data.overlays_allowcreate;

    this.overlays = []; // storage of overlays (componentbase will send our overlays through an update)
    this.newoverlaycounter = 0;

    this.overlaymanager = null;
    this.overlaytranslation = null;
    this.delayed_selectionrowkeys = null; // if we get a selection before an overlaymanager has been initialized, we store the rowkeys of the selection here
    this.overlaystorage = "overlay-data"; // Symbol("overlay-data");
    ////////////////////////////////////////////////////////////////


    this.buildNode();
    this.updateNode(data);

    //this.action = data.action;
    this.unmasked_events = data.unmasked_events || [];
    this._updateClickable();
  }

  // ---------------------------------------------------------------------------
  //
  // Overrides
  //

  enabledOn(checkflags, min, max, selectionmatch)
  {
    if(!this.overlaymanager)//too soon
      return false;

    var selectedoverlays = this.overlaymanager.getSelection();

    let itemstocheck = [];
    for(let overlay of selectedoverlays)
      itemstocheck.push(overlay[this.overlaystorage].overlay.flags);

    return $todd.checkEnabledFlags(itemstocheck, checkflags, min, max, selectionmatch);
  }


  // ---------------------------------------------------------------------------
  //
  // Helper functions
  //

  _updateClickable()
  {
    this.clickable = this.unmasked_events.includes('click') || this.action;
    this.node.classList.toggle("t-image--clickable", this.clickable);
  }

  // ---------------------------------------------------------------------------
  //
  // Callbacks
  //

  onActionUpdated()
  {
    super.onActionUpdated();
    this._updateClickable();
  }

  onCaptureFocus(e)
  {
    if(e.target.classList.contains('t-image__overlay'))
      this.focusedoverlay = e.target;
    else
      this.focusedoverlay = null;
    console.log("last focused overlay:",this.focusedoverlay);
  }

  // ---------------------------------------------------------------------------
  //
  // DOM
  //

  // Build the DOM node(s) for this component
  buildNode()
  {
    this.node = dompack.create("div", { className: "t-image"
                                      , on: { click: evt => this.onClick(evt)
                                            , mousedown: evt => this._gotMouseDown(evt)
                                            }
                                      });
    this.node.dataset.name = this.name;

    if(this.hint)
      this.node.title = this.hint;
    this.node.propTodd = this;

    // wrap the image and overlays so the overlays correctly overlap the image
    // (instead of the <image> component's .t-image panel)
    this.imgwrapper = dompack.create('div', { className: "t-image__wrapper" });
    this.node.appendChild(this.imgwrapper);

    this.node.addEventListener("dompack:overlay-selectionchange", (e) => this.onOverlaySelectionChange(e));
    this.node.addEventListener("dompack:overlay-areachange", (e) => this._syncOverlaysAfterUserChange(e));
    this.node.addEventListener("dompack:overlay-created", (e) => this._gotNewDrawnOverlay(e));
    this.node.addEventListener("dompack:overlay-deleted", (e) => this._gotOverlayDeleted(e));
    this.node.addEventListener("focus", (e) => this.onCaptureFocus(e), true);
  }

  updateNode(data)
  {
    if(data.src && data.src == this.imgsrc)
      return;

    //We'll be loading a new promise
    if(this.imgdefer)
    {
      this.imgdefer.reject(new Error("Image cancelled"));
      this.imgdefer=null;
    }

    if (this.imgnode)
      this.imgnode.remove();

    if (data.settings)
    {
      this.imgsrc = null;
      this.imgwidth = data.settings.width;
      this.imgheight = data.settings.height;
      //createImage will take care of UI busy flagging
      this.imgnode = toddImages.createImage(data.settings.imgname, data.settings.width, data.settings.height, data.settings.color);
      this.imgwrapper.appendChild(this.imgnode);
      return;
    }

    let imgdefer = dompack.createDeferred();
    let interfacelock = dompack.flagUIBusy();

    this.imgnode = dompack.create('img', { style: { opacity: 0, objectFit: this.objectfit } //hide the image while loading
                                         , on: { load:  event => imgdefer.resolve(this)
                                               , error: error => imgdefer.reject(error)
                                               }
                                         });
    imgdefer.promise.then(() => this.relayout());
    imgdefer.promise.finally( () => interfacelock.release());

    this.imgwidth = data.imgwidth;
    this.imgheight = data.imgheight;
    this.imgwrapper.appendChild(this.imgnode);
    this.imgnode.src = data.src;

    this.imgsrc = data.src;
  }

  // ---------------------------------------------------------------------------
  //
  // Overlays
  //

  _requireAnOverlaymanager()
  {
    return (this.overlays.length > 0 || this.overlays_allowcreate);
  }

  _imageDimensionsKnown()
  {
    if (!this.imgnode || !this.imgnode.offsetWidth || !this.imgnode.offsetHeight)
      return false;
    return true;
  }

  _testTranslatedAreaChanged(translated, origtranslated)
  {
    if (translated.type != origtranslated.type)
      return true;

    switch (translated.type)
    {
      case "rectangle":
      {
        return (translated.top !== origtranslated.top
                || translated.left !== origtranslated.left
                || translated.height !== origtranslated.height
                || translated.width !== origtranslated.width);
      }
    }
  }

  _translateOverlayArea(area, toimage)
  {
    switch (area.type)
    {
      case "rectangle":
      {
        if (toimage)
        {
          return { type:   "rectangle"
                 , top:    area.top / this.overlaytranslation.heightratio
                 , left:   area.left / this.overlaytranslation.widthratio
                 , height: area.height / this.overlaytranslation.heightratio
                 , width:  area.width / this.overlaytranslation.widthratio
                 };
        }
        else
        {
          return (
            { type:   "rectangle"
            , top:    Math.round(area.top * this.overlaytranslation.heightratio)
            , left:   Math.round(area.left * this.overlaytranslation.widthratio)
            , height: Math.round(area.height * this.overlaytranslation.heightratio)
            , width:  Math.round(area.width * this.overlaytranslation.widthratio)
            });
        }
      }
      default:
      {
        throw new Error(`Illegal area type ${area.type}`);
      }
    }
  }

  _createOverlay(translatedarea)
  {
    switch (translatedarea.type)
    {
      case "rectangle":
      {
        return this.overlaymanager.addRectangle(translatedarea);
      }
      default:
      {
        throw new Error(`Illegal area type ${translatedarea.type}`);
      }
    }
  }

  _updateOverlayManager()
  {
    let overlaybounds =
        { top:    this.imgnode.offsetTop
        , left:   this.imgnode.offsetLeft
        , bottom: this.imgnode.offsetTop + this.imgnode.offsetHeight
        , right:  this.imgnode.offsetLeft + this.imgnode.offsetWidth
        };

    let opts =
        { allowcreate: this.overlays_allowcreate
        , bounds: overlaybounds
        , autoselectdrawnoverlays: false
        };

    if (!this.overlaymanager)
      this.overlaymanager = new OverlayManager(this.imgwrapper, "t-image__overlay", opts);
    else
      this.overlaymanager.updateOptions(opts);
  }

  // if a layoutmanager is active, we only need to update positions/sizes of overlays
  // (if our image dimension has changed)
  _relayoutOverlays()
  {
    this._syncOverlays(); // lazy but functional
  }

  // sync server modified overlays with the overlay manager
  _syncOverlays()
  {
    // if we don't have an overlay manager and don't need it we have nothing to do
    if (!this.overlaymanager && !this._requireAnOverlaymanager())
      return;

    // we want an overlaymanager but we want to delay it until we can initialize at the correct size
    // After the image has loaded, relayout will be called, which in turn will call _relayoutOverlays -> _syncOverlays()
    // and then whe'll pass this test.
    if (!this._imageDimensionsKnown())
      return;


    // calc new translation ratios
    this.overlaytranslation =
        { widthratio: this.imgnode.naturalWidth / this.imgnode.offsetWidth
        , heightratio: this.imgnode.naturalHeight / this.imgnode.offsetHeight
        };

    // Make sure we update (either create or make sure to apply updated settings such as 'allowcreate')
    this._updateOverlayManager();


    if (this.overlays.length == 0)
    {
      // ! we must use a shallow copy (using slice() of the array because
      //   the array will be modified during running
      for (let o of this.overlaymanager.overlays.slice())
        this.overlaymanager.delete(o);

      return;
    }

    let showoverlays = this.overlays;

    let displayed_overlays = this.overlaymanager.overlays;
    displayed_overlays.forEach(o => o[this.overlaystorage].used = false);

    for (let overlay of showoverlays)
    {
      /*
      overlay.area
      overlay.flags
      overlay.hint
      overlay.rowkey
      overlay.title
      */
      let translatedarea = this._translateOverlayArea(overlay.area, true);

      // do we have a shown overlay for this overlay?
      let overlayobj = displayed_overlays.find(o =>
          o[this.overlaystorage] &&
              (o[this.overlaystorage].rowkey === overlay.rowkey
              || (overlay.tollium_newid && o[this.overlaystorage].newid === overlay.tollium_newid)));

      if (overlayobj)
      {
        overlayobj.update(translatedarea);
      }
      else
      {
        overlayobj = this._createOverlay(translatedarea);
        overlayobj[this.overlaystorage] = {};
      }

      let ostorage = overlayobj[this.overlaystorage];

      if (overlay.title != "")
      {
        if (!ostorage.titlenode)
        {
          ostorage.titlenode = dompack.create("div", { className: "t-image__overlay__title" });
          overlayobj.nodes.container.appendChild( ostorage.titlenode );
        }

        ostorage.titlenode.innerText = overlay.title;
      }
      else if (ostorage.titlenode)
      {
        // no title, but there's a titlenode we don't need anymore, so remove it
        ostorage.titlenode.parentNode.removeChild(ostorage.titlenode);
        ostorage.titlenode = null;
      }

      if (overlay.hint != "")
        overlayobj.nodes.container.setAttribute("title", overlay.hint);
      else
        overlayobj.nodes.container.removeAttribute("title");

      Object.assign(overlayobj[this.overlaystorage],
          { used:           true
          , rowkey:         overlay.rowkey
          , newid:          0
          , translatedarea: translatedarea
          , overlay:        overlay
          });
    }

    // work on a copy of displayed_overlays, it will be modified during running
    for (let o of displayed_overlays.slice()) // NOTE: .slice() used as shallow copy
    {
      if (!o[this.overlaystorage].used)
        this.overlaymanager.delete(o);
    }

    if (this.delayed_selectionrowkeys !== null)
      this.setOverlayManagerSelectionByRowkeys(this.delayed_selectionrowkeys);
  }

  _gotNewDrawnOverlay(e)
  {
    let { area, overlay } = e.detail;

    // translate to image coordinates
    area = this._translateOverlayArea(area, false);

    // newly created by user!
    let newid = ++this.newoverlaycounter;
    overlay[this.overlaystorage] =
        { rowkey:         ""
        , newid:          newid
        , translatedarea: null
        , overlay:        overlay
        };

    this.queueMessage("newoverlay", { area: area, newid: newid }, true);
  }

  _gotOverlayDeleted(evt)
  {
    // also delete from our administration so refreshing doesn't recreate the overlay
    for (let idx = 0; idx < this.overlays.length; idx++)
    {
      if (this.overlays[idx].rowkey == evt.detail.overlay[this.overlaystorage].rowkey)
      {
        this.overlays.splice(idx, 1);
      }
    }
  }

  setOverlayManagerSelectionByRowkeys(rowkeys)
  {
    let selectedoverlays = [];
    for(let overlay of this.overlaymanager.overlays)
    {
      if (rowkeys.indexOf(overlay[this.overlaystorage].rowkey) > -1)
        selectedoverlays.push(overlay);
    }

    this.overlaymanager.setSelection(selectedoverlays);
  }

  onOverlaySelectionChange(evt)
  {
    if (!evt.detail.useraction)
      return;

    this._syncOverlaysSelectionToServer();
  }

  // needed for selecting or creating a new overlay??
  _syncOverlaysSelectionToServer() // from overlaymanager to ourself
  {
    let selectionrowkeys = this.overlaymanager.getSelection().filter(o => !o[this.overlaystorage].newid).map(o => o[this.overlaystorage].rowkey);

    if (this.selectionrowkeys == selectionrowkeys)
      return;

    // Apply the selection states from the overlaymanager to our own list
    //for(let overlay of this.overlays)
    //  overlay.tolliumselected = selectionrowkeys.indexOf(overlay.rowkey) > -1;
    this.selectionrowkeys = selectionrowkeys;

    //let selectedrowkeys = this.overlaymanager.getSelectionRowkeys();
    this.queueMessage('selection', { rowkeys: selectionrowkeys }, true);
  }

  _syncOverlaysAfterUserChange()
  {
    // if there's no overlay manager there should have been no overlays firing the dompack:overlay-areachange event
    if (!this.overlaymanager)
    {
      console.error("Received overlay areachange event, but got no overlaymanager");
      return;
    }

    let result = [];
    for (let overlayobj of this.overlaymanager.overlays)
    {
      if (!overlayobj[this.overlaystorage])
      {
        // newly created by user!
        overlayobj[this.overlaystorage] =
          { rowkey:         ""
          , newid:          ++this.newoverlaycounter
          , translatedarea: null
          , overlay:        null
          };
      }
      else if (!overlayobj[this.overlaystorage].newid)
      {
        let newarea = overlayobj.getArea();
        let overlay = overlayobj[this.overlaystorage].overlay;
        if (this._testTranslatedAreaChanged(newarea, overlayobj[this.overlaystorage].translatedarea))
          overlay.area = this._translateOverlayArea(newarea, false);
        result.push({ rowkey: overlay.rowkey, area: overlay.area });
      }
      else
      {
        // FIXME: handle new overlays that have been modified while tollium was processing them
      }
    }

    /* new overlays have ++newid set

       send the new ones to tollium, let tollium add them

       send them back with [ rowkey = xxx, tollium_newid = original_newid ], sync code will connect the right rowkey (not tested though)
    */

    this.queueMessage('overlays', { overlays: result }, true);

    this._syncOverlaysSelectionToServer();
  }

  // ---------------------------------------------------------------------------
  //
  // Dimensions
  //

  calculateDimWidth()
  {
    this.width.calc = $todd.CalcAbsSize(this.width.xml_set);
    this.width.min = this.width.calc;
    this.debugLog("dimensions", "calc=" + this.width.calc + ", min=" + this.width.min);
  }

  calculateDimHeight()
  {
    this.height.calc = $todd.CalcAbsSize(this.height.xml_set);
    this.height.min = Math.max(this.height.calc, $todd.gridlineInnerHeight);
    this.debugLog("dimensions", "min=" + this.height.min + ", calc=" + this.height.calc + ", min=" + this.height.min);
  }

  relayout()
  {
    this.debugLog("dimensions", "relayouting set width=" + this.width.set + ", set height="+ this.height.set);
    var coords = getCoverCoordinates(this.imgwidth, this.imgheight, this.width.set, this.height.set, true);

    if (this.imgnode)
    {
      dompack.setStyles(this.imgnode, { "width": coords.width
                                      , "height": coords.height
                                      , "opacity":"1"
                                      });
    }

    // FIXME: should we do this through CSS now (use a flexbox and let it hor/ver align?)
    // NOTE: use margin because top/left wouldn't stretch the container, causing the image to move out / overflow the container
    dompack.setStyles(this.imgwrapper, { "margin-top": coords.top
                                       , "margin-left": coords.left
                                       , "position":"relative"
                                       });

    // Overlays may have to be repositioned.
    // In case an image load triggered the relayout,
    // the overlays may all still need to be generated and selection applied.
    this._relayoutOverlays();
  }

  // ---------------------------------------------------------------------------
  //
  // Interactions
  //

  addOverlay(overlay)
  {
    // overlay: { top: 0, left: 0, right: 0, bottom: 0, type: "rectangle" }
    this.overlays.push(overlay);
    this.queueMessage('overlays', this.overlays, true);
  }

  editOverlay(overlay)
  {
    // overlay: { rowkey: <rowkey>, top: 0, left: 0, right: 0, bottom: 0, type: "rectangle" }
    var changed = false;
    this.overlays.forEach(function(curoverlay)
    {
      if (curoverlay.rowkey == overlay.rowkey)
      {
        if (curoverlay.top != overlay.top)
        {
          curoverlay.top = overlay.top;
          changed = true;
        }
        if (curoverlay.left != overlay.left)
        {
          curoverlay.left = overlay.left;
          changed = true;
        }
        if (curoverlay.right != overlay.right)
        {
          curoverlay.right = overlay.right;
          changed = true;
        }
        if (curoverlay.bottom != overlay.bottom)
        {
          curoverlay.bottom = overlay.bottom;
          changed = true;
        }
      }
    });
    if (changed)
      this.queueMessage('overlays', this.overlays, true);
  }

/*
, deleteOverlay: function(overlay)
  {
    // overlay: { rowkey: <rowkey> }
    var changed = false;
    this.overlays = this.overlays.filter(function(curoverlay)
    {
      changed = changed || curoverlay.rowkey == overlay.rowkey;
      return curoverlay.rowkey != overlay.rowkey;
    });
    if (changed)
      this.queueMessage('overlays', this.overlays, true);
  }

, selectOverlay: function(overlay)
  {
    // overlay: null || { rowkey: <rowkey> }
    this.selection = overlay ? [ overlay.rowkey ] : [];
    this.queueMessage('selection', this.selection, true);
  }
*/

  // ---------------------------------------------------------------------------
  //
  // Events & callbacks
  //

  _gotMouseDown(event)
  {
    if(this.action)
      event.preventDefault();
  }

  onClick(event)
  {
    if(!this.clickable)
      return;

    this.owner.executeAction(this.action);
    if (!this.isEventUnmasked('click'))
      return;

    //console.log( { clientWidth: event.target.clientWidth, clientHeight: event.target.clientHeight, offsetX: event.offsetX, offsetY: event.offsetY, imgwidth: this.imgwidth, imgheight: this.imgheight } );
    var nodepos = { x: event.offsetX, y: event.offsetY };
    var imgpos = this.nodeToImage(nodepos);

    // 2nd argument is to check whether a message of this type is already in the queue?
    //this.queueEvent(this.owner.screenname + '.' + this.name, 'click '+ data, true/*sychronous*/);
    this.asyncMessage('click', { absolutex: nodepos.x
                               , absolutey: nodepos.y
                               , nativex:   imgpos.x  // click position scaled to original image size
                               , nativey:   imgpos.y
                               });

    event.preventDefault();
  }

  applyUpdate(data)
  {
    switch(data.type)
    {
      case 'image':
        this.updateNode(data);
        return;
      case 'action':
        this.setAction(data.action);
        return;
      case 'eventmask':
        this.unmasked_events = data.unmasked_events;
        this.onActionUpdated();
        return;
      case 'overlays_active':
        this.overlays_allowcreate = data.overlays_allowcreate;
        this._syncOverlays();
        return;

      // Overlays and selection aren't sent with initial data, only using updates
      case 'overlays':
        this.overlays = data.overlays || [];
        this._syncOverlays();
        return;

      case 'selection':
        //this.overlays.map((overlay) => overlay.tolliumselected = (data.selection || []).includes(overlay.rowkey));
        if (!this.overlaymanager)
          this.delayed_selectionrowkeys = data.selection;
        else
        {
          this.delayed_selectionrowkeys = null;
          this.setOverlayManagerSelectionByRowkeys(data.selection);
        }

        return;
    }

    super.applyUpdate(data);
  }

  // ---------------------------------------------------------------------------
  //
  // Helper functions
  //

  nodeToImage(pos)
  {
    /*
    scale coordinates up relative to the original size of the image

    NOTE:
    - don't use imgwidth/imgheight, but the natural size (original pixelsize of the image)
    - don't use setwidth and setheight to determine the ratio (only one is forced to a different size)
    */
    let pixelratio = window.devicePixelRatio || 1;

    //IE passes coordinates with decimals, even on 1:1 screens..
    let offsetx = Math.round(pos.x * pixelratio) / pixelratio;
    let offsety = Math.round(pos.y * pixelratio) / pixelratio;
    var wratio = this.imgwidth  / this.imgnode.clientWidth;
    var hratio = this.imgheight / this.imgnode.clientHeight;

    return { x: offsetx * wratio, y: offsety * hratio };
  }

  imageToNode(pos)
  {
    var wratio = this.imgwidth  / this.imgnode.clientWidth;
    var hratio = this.imgheight / this.imgnode.clientHeight;

    return { x: pos.x / wratio, y: pos.y / hratio };
  }
}
