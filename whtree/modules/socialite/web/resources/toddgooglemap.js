// ---------------------------------------------------------------------------
//
// toddGoogleMap is a todd wrapper around the toddGM_Map object
//

class toddGoogleMap {

  // Initialize the map
  constructor(options) {
    // The todd iframe object to communicate with todd
    this.iframetodd = new $toddiframe({
      onresize: () => this.iFrameResized()
    });

    if (!this.iframetodd) {
      document.getElementById(options.mapdiv).innerHTML = '<div style="padding: 8px;">The Google Map could not be loaded, because the iframe could not connect to the main window.</div>';
      return;
    }

    // Context menus
    this.newcontextmenuname = options.newcontextmenu;
    this.selectcontextmenuname = options.selectcontextmenu;

    // Current selection
    this.selection = null;

    // Our info window
    this.infowindow;

    // Cached function calls (called by HareScript before map was fully loaded)
    this.cached_calls = [];

    // Image base URL
    this.imgbase = options.imgbase;

    // Image load queue
    this.imgqueue = new Map();
    this.imgqueueid = 0;
    window.addEventListener("message", (event) => this.onWindowMessage(event));

    // Add callbacks to options
    options.CreateButtonImage =   (...args) => this.createButtonImage(...args);
    options.OnInitialized =       (...args) => this.onInitialized(...args);
    options.OnClick =             (...args) => this.onClick(...args);
    options.OnDblClick =          (...args) => this.onDblClick(...args);
    options.OnRightClick =        (...args) => this.onRightClick(...args);
    options.OnMoveEnd =           (...args) => this.onMoveEnd(...args);
    options.OnZoomEnd =           (...args) => this.onZoomEnd(...args);
    options.OnOverlayClick =      (...args) => this.onOverlayClick(...args);
    options.OnOverlayDblClick =   (...args) => this.onOverlayDblClick(...args);
    options.OnOverlayRightClick = (...args) => this.onOverlayRightClick(...args);
    options.OnOverlayDragEnd =    (...args) => this.onOverlayDragEnd(...args);
    options.OnDirections =        (...args) => this.onDirections(...args);
    options.OpenInfoWindow =      (...args) => this.openInfoWindow(...args);
    options.CloseInfoWindow =     (...args) => this.closeInfoWindow(...args);

    // Our todd map controller object
    this.map = toddGM_Initialize(options.mapdiv, options);

    // Previous center (used to prevent generating move events when the map did not actually move)
    this.prevmapcenter = null;
  }

  // Deinitialize the map
  deInit()
  {
    toddGM_DeInit(this.map);
  }

  callMapFunction(name, ...args)
  {
    // If the Google map is loaded, call requested function on our Google Map object, otherwise delay the call until the map
    // is initialized
    if (this.map.map)
    {
      if (this.map[name])
        this.map[name].apply(this.map, args);
    }
    else
      this.cached_calls.push({ name: name, args: args });
  }

  iFrameResized()
  {
    if (this.map.map)
      google.maps.event.trigger(this.map.map, "resize");
  }

  selectionUpdate(overlay, latlng)
  {
    this.selection = overlay;
    if (this.iframetodd)
    {
      var data = {
        rowkeys: this.selection ? this.selection.rowkeys : "",
        latlng: latlng
      };
      this.iframetodd.setData(data);

      // Read flags for the action source selection
      var flags = [];
      if (this.selection)
        flags.push(this.selection.flags);
      this.iframetodd.actionEnabler(flags);
    }
  }

  async createButtonImage(filename, width, height)
  {
    return new Promise(resolve => {
      const id = ++this.imgqueueid;
      this.imgqueue.set(id, { id, resolve });
      // filename is 'map_[button].png', change to 'tollium:maps/[button]'
      this.iframetodd.postMessage({
        id,
        type: "createimage",
        imgname: "tollium:maps/" + filename.substring(4, filename.length - 4),
        width: 24,
        height: 24,
        color: "b"
      });
    });
  }

  onWindowMessage(event) {
    switch (event.data.type) {
      case "createdimage": {
        const queued = this.imgqueue.get(event.data.id);
        if (queued) {
          this.imgqueue.delete(queued.id);

          const img = document.createElement("img");
          img.src = event.data.src;
          img.width = event.data.width;
          img.height = event.data.height;
          queued.resolve(img);
        }
        break;
      }
    }
  }

  onInitialized()
  {
  //ADDME:
  //  if (this.iframetodd)
  //    this.iframetodd.RemoveIFrameEvents();

    // We have a map, attach our info window
    this.infowindow = new toddGM_InfoWindow(this.map.map);

    // Set initial directions, if any
    var data = this.iframetodd.getData();
    if (data && data.directions)
      this.map.LoadDirections(data.directions.waypoints, data.directionsoptions);

    // We're fully initialized, call any delayed HareScript functions
    while (this.cached_calls.length > 0)
    {
      var cached_call = this.cached_calls.shift();
      if (this.map[cached_call.name])
        this.map[cached_call.name].apply(this.map, cached_call.args);
    }
  }

  onClick(latlng)
  {
    this.selectionUpdate(null, toddGM_LatLngToString(latlng));
    if (this.iframetodd)
    {
  //ADDME:
  //    toddClearPopupStack();
      this.iframetodd.doCallback({
        type: "map_click",
        pos: toddGM_LatLngToString(latlng)
      });
    }
  }

  onDblClick(latlng)
  {
    this.selectionUpdate(null, toddGM_LatLngToString(latlng));
    if (this.iframetodd)
    {
  //ADDME:
  //    toddClearPopupStack();
      this.iframetodd.doCallback({
        type: "map_dblclick",
        pos: toddGM_LatLngToString(latlng)
      });
    }
  }

  onRightClick(latlng, point)
  {
    this.selectionUpdate(null, toddGM_LatLngToString(latlng));
    if (this.iframetodd)
    {
  //ADDME:
  //    toddClearPopupStack();
      this.iframetodd.showContextMenu(this.newcontextmenuname, point.x, point.y);
    }
  }

  onMoveEnd()
  {
    var mapcenter = this.map.map.getCenter();
    if (mapcenter.equals(this.prevmapcenter))
      return;
    this.prevmapcenter = mapcenter;

    if (this.iframetodd)
    {
  //ADDME:
  //    toddClearPopupStack();
      this.iframetodd.doCallback({ type: "map_moveend"
                                 , center: toddGM_LatLngToString(mapcenter)
                                 , bounds: toddGM_BoundsToString(this.map.map.getBounds())
                                 });
    }
  }

  onZoomEnd()
  {
    if (this.iframetodd)
    {
  //ADDME:
  //    toddClearPopupStack();
      this.iframetodd.doCallback({
        type: "map_zoomend",
        zoom: this.map.map.getZoom(),
        bounds: toddGM_BoundsToString(this.map.map.getBounds())
      });
    }
  }

  onOverlayClick(overlay, latlng)
  {
    this.selectionUpdate(overlay, toddGM_LatLngToString(latlng));
    if (this.iframetodd)
    {
  //ADDME:
  //    toddClearPopupStack();
      this.iframetodd.doCallback({
        type: "overlay_click",
        rowkeys: overlay.rowkeys
      });
    }
  }

  onOverlayDblClick(overlay, latlng)
  {
    this.selectionUpdate(overlay, toddGM_LatLngToString(latlng));
    if (this.iframetodd)
    {
  //ADDME:
  //    toddClearPopupStack();
      this.iframetodd.doCallback({
        type: "overlay_dblclick",
        rowkeys: overlay.rowkeys
      });
    }
  }

  onOverlayRightClick(overlay, latlng, point)
  {
    this.selectionUpdate(overlay, toddGM_LatLngToString(latlng));
    if (this.iframetodd)
    {
  //ADDME:
  //    toddClearPopupStack();
      this.iframetodd.showContextMenu(this.selectcontextmenuname, parseInt(point.x), parseInt(point.y));
    }
  }

  onOverlayDragEnd(overlay, latlng)
  {
    this.selectionUpdate(overlay, toddGM_LatLngToString(latlng));
    if (this.iframetodd)
    {
  //ADDME:
  //    toddClearPopupStack();
      this.iframetodd.doCallback({
        type: "overlay_dragend",
        rowkeys: overlay.rowkeys,
        pos: toddGM_LatLngToString(latlng)
      });
    }
  }

  onDirections(status, directions)
  {
    this.iframetodd.doCallback({
      type: "directions",
      status: status,
      directions: directions
    });
  }

  openInfoWindow(overlay)
  {
    this.infowindow.Open(overlay);
  }

  closeInfoWindow()
  {
    this.infowindow.Close();
  }
}
