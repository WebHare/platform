// ---------------------------------------------------------------------------
//
// toddGoogleMap is a todd wrapper around the toddGM_Map object
//

// Initialize the map
function toddGoogleMap(options)
{
  // The todd iframe object to communicate with todd
  this.iframetodd = new $toddiframe({ onprint: toddGM_BindFunction(this.PrintMap, this)
                                    , onresize: toddGM_BindFunction(this.IFrameResized, this)
                                    });

  if (!this.iframetodd)
  {
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

  // Add callbacks to options
  options.CreateButtonImage =   toddGM_BindFunction(this.CreateButtonImage, this);
  options.OnInitialized =       toddGM_BindFunction(this.OnInitialized, this);
  options.OnClick =             toddGM_BindFunction(this.OnClick, this);
  options.OnDblClick =          toddGM_BindFunction(this.OnDblClick, this);
  options.OnRightClick =        toddGM_BindFunction(this.OnRightClick, this);
  options.OnMoveEnd =           toddGM_BindFunction(this.OnMoveEnd, this);
  options.OnZoomEnd =           toddGM_BindFunction(this.OnZoomEnd, this);
  options.OnOverlayClick =      toddGM_BindFunction(this.OnOverlayClick, this);
  options.OnOverlayDblClick =   toddGM_BindFunction(this.OnOverlayDblClick, this);
  options.OnOverlayRightClick = toddGM_BindFunction(this.OnOverlayRightClick, this);
  options.OnOverlayDragEnd =    toddGM_BindFunction(this.OnOverlayDragEnd, this);
  options.OnDirections =        toddGM_BindFunction(this.OnDirections, this);
  options.OpenInfoWindow =      toddGM_BindFunction(this.OpenInfoWindow, this);
  options.CloseInfoWindow =     toddGM_BindFunction(this.CloseInfoWindow, this);

  // Our todd map controller object
  this.map = toddGM_Initialize(options.mapdiv, options);

  // Previous center (used to prevent generating move events when the map did not actually move)
  this.prevmapcenter = null;
}
toddGoogleMap.prototype = {};

// Deinitialize the map
toddGoogleMap.prototype.DeInit = function toddGoogleMap_DeInit()
{
  toddGM_DeInit(this.map);
}

toddGoogleMap.prototype.CallMapFunction = function toddGoogleMap_CallMapFunction(name, args)
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

toddGoogleMap.prototype.PrintMap = function()
{
  var canvas = document.getElementById("map_canvas");
  if (!canvas)
    return; // Should not happen, just in case...

  // Store the current width and height
  var oldwidth = canvas.style.width;
  var oldheight = canvas.style.height;

  // Set explicit width and height
  canvas.style.width = canvas.clientWidth + "px";
  canvas.style.height = canvas.clientHeight + "px";

  // Print the iframe contents
  print();

  // Restore the old width and height
  window.setTimeout(function()
  {
    canvas.style.width = oldwidth;
    canvas.style.height = oldheight;
  }, 1);
}

toddGoogleMap.prototype.IFrameResized = function()
{
  if (this.map.map)
    google.maps.event.trigger(this.map.map, "resize");
}

toddGoogleMap.prototype.SelectionUpdate = function toddGoogleMap_SelectionUpdate(overlay, latlng)
{
  this.selection = overlay;
  if (this.iframetodd)
  {
    var data = { rowkeys: this.selection ? this.selection.rowkeys : ""
               , latlng: latlng
               }
    this.iframetodd.setData(data);

    // Read flags for the action source selection
    var flags = [];
    if (this.selection)
      flags.push(this.selection.flags);
    this.iframetodd.actionEnabler(flags);
  }
}

toddGoogleMap.prototype.CreateButtonImage = function toddGoogleMap_CreateButtonImage(filename, width, height)
{
  var img = document.createElement("img");
  img.src = this.imgbase + filename;
  img.width = width;
  img.height = height;
  return img;
}

toddGoogleMap.prototype.OnInitialized = function toddGoogleMap_OnInitialized()
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
    var cached_call = this.cached_calls.splice(0, 1);
    if (this.map[cached_call.name])
      this.map[cached_call.name].apply(this.map, cached_call.args);
  }
}

toddGoogleMap.prototype.OnClick = function toddGoogleMap_OnClick(latlng)
{
  this.SelectionUpdate(null, toddGM_LatLngToString(latlng));
  if (this.iframetodd)
  {
//ADDME:
//    toddClearPopupStack();
    this.iframetodd.doCallback({ type: "map_click"
                               , pos: toddGM_LatLngToString(latlng)
                               });
  }
}

toddGoogleMap.prototype.OnDblClick = function toddGoogleMap_OnDblClick(latlng)
{
  this.SelectionUpdate(null, toddGM_LatLngToString(latlng));
  if (this.iframetodd)
  {
//ADDME:
//    toddClearPopupStack();
    this.iframetodd.doCallback({ type: "map_dblclick"
                               , pos: toddGM_LatLngToString(latlng)
                               });
  }
}

toddGoogleMap.prototype.OnRightClick = function toddGoogleMap_OnRightClick(latlng, point)
{
  this.SelectionUpdate(null, toddGM_LatLngToString(latlng));
  if (this.iframetodd)
  {
//ADDME:
//    toddClearPopupStack();
    this.iframetodd.showContextMenu(this.newcontextmenuname, point.x, point.y);
  }
}

toddGoogleMap.prototype.OnMoveEnd = function toddGoogleMap_OnMoveEnd()
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

toddGoogleMap.prototype.OnZoomEnd = function toddGoogleMap_OnZoomEnd()
{
  if (this.iframetodd)
  {
//ADDME:
//    toddClearPopupStack();
    this.iframetodd.doCallback({ type: "map_zoomend"
                               , zoom: this.map.map.getZoom()
                               , bounds: toddGM_BoundsToString(this.map.map.getBounds())
                               });
  }
}

toddGoogleMap.prototype.OnOverlayClick = function toddGoogleMap_OnOverlayClick(overlay, latlng)
{
  this.SelectionUpdate(overlay, toddGM_LatLngToString(latlng));
  if (this.iframetodd)
  {
//ADDME:
//    toddClearPopupStack();
    this.iframetodd.doCallback({ type: "overlay_click"
                               , rowkeys: overlay.rowkeys
                               });
  }
}

toddGoogleMap.prototype.OnOverlayDblClick = function toddGoogleMap_OnOverlayDblClick(overlay, latlng)
{
  this.SelectionUpdate(overlay, toddGM_LatLngToString(latlng));
  if (this.iframetodd)
  {
//ADDME:
//    toddClearPopupStack();
    this.iframetodd.doCallback({ type: "overlay_dblclick"
                               , rowkeys: overlay.rowkeys
                               });
  }
}

toddGoogleMap.prototype.OnOverlayRightClick = function toddGoogleMap_OnOverlayRightClick(overlay, latlng, point)
{
  this.SelectionUpdate(overlay, toddGM_LatLngToString(latlng));
  if (this.iframetodd)
  {
//ADDME:
//    toddClearPopupStack();
    this.iframetodd.showContextMenu(this.selectcontextmenuname, parseInt(point.x), parseInt(point.y));
  }
}

toddGoogleMap.prototype.OnOverlayDragEnd = function toddGoogleMap_OnOverlayDragEnd(overlay, latlng)
{
  this.SelectionUpdate(overlay, toddGM_LatLngToString(latlng));
  if (this.iframetodd)
  {
//ADDME:
//    toddClearPopupStack();
    this.iframetodd.doCallback({ type: "overlay_dragend"
                               , rowkeys: overlay.rowkeys
                               , pos: toddGM_LatLngToString(latlng)
                               });
  }
}

toddGoogleMap.prototype.OnDirections = function toddGoogleMap_OnDirections(status, directions)
{
  this.iframetodd.doCallback({ type: "directions"
                             , status: status
                             , directions: directions
                             });
}

toddGoogleMap.prototype.OpenInfoWindow = function toddGoogleMap_OpenInfoWindow(overlay)
{
  this.infowindow.Open(overlay);
}

toddGoogleMap.prototype.CloseInfoWindow = function toddGoogleMap_CloseInfoWindow()
{
  this.infowindow.Close();
}
