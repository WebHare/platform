///////////////////////////////////////////////////////////////////////////////
// Maps support functions (JavaScript counterparts of module::google/support.whlib)

function toddGM_StringToLatLng(coordinates)
{
  if (typeof coordinates == "string")
  {
    var parts = coordinates.split(",");
    if (parts.length == 2)
    {
      var lat = parseFloat(parts[0]);
      var lng = parseFloat(parts[1]);
      if (lat == lat && lng == lng)
        return new google.maps.LatLng(lat, lng);
    }
  }
}

function toddGM_LatLngToString(latlng)
{
  return latlng ? latlng.toUrlValue() : "";
}

function toddGM_StringToBounds(coordinates)
{
  if (typeof coordinates == "string")
  {
    var parts = coordinates.split(";");
    if (parts.length == 2)
    {
      var sw = toddGM_StringToLatLng(parts[0]);
      var ne = toddGM_StringToLatLng(parts[1]);
      if (sw && ne)
        return new google.maps.LatLngBounds(sw, ne);
    }
  }
}

function toddGM_BoundsToString(bounds)
{
  return bounds ? bounds.getSouthWest().toUrlValue() + ";" + bounds.getNorthEast().toUrlValue() : "";
}

function toddGM_BindFunction(func, obj, args)
{
  return func ? function() { return func.apply(obj, arguments.length ? arguments : args ? args : []); } : null;
}


///////////////////////////////////////////////////////////////////////////////
// General map functions (external interface)

/* options: { maptype:             "map"         // Initial map type (one of "map", "satellite", "hybrid", or "physical")
            , center:              "0,0"         // Initial map center coordinates
            , zoom:                0             // Initial zoom level
            , restrictto:          "0,0;0,0"     // Bounds to restrict the map to (if defined, restrict movement and zooming
                                                 // to only show the map within the given bounds)
            , moveable:            true          // If the map is moveable/zoomable by the user
            , showcontrols:        true          // If map navigation controls should be shown
            , backgroundcolor:     ""            // Tollium color, but "transparent" is not supported
            , shapecolor:          ""            // Default color for polygons/polylines
            , iconsize:            48            // Map marker icon width/height
            , icons:               iconlist      // List of icons
            , markermanager:       true          // If a markermanager should be used (defaults to true)
            , CreateButtonImage:   function(filename, width, height)
                                                 // Create a button <img> element, the filename does not contain path
            , OnInitialized:       function()
            , OnClick:             function(latlng)
            , OnDblClick:          function(latlng)
            , OnRightClick:        function(point)
            , OnMoveEnd:           function()
            , OnZoomEnd:           function()
            , OnOverlayClick:      function(overlay, latlng)
            , OnOverlayDblClick:   function(overlay, latlng)
            , OnOverlayRightClick: function(overlay, point)
            , OnOverlayDragEnd:    function(overlay, latlng)
            , OnProjectionChange:  function(map)
            , OnDirections:        function(status, directions)
            , OpenInfoWindow:      function(overlay)
            , CloseInfoWindow:     function()
            }

   iconlist: [ { name:           ""              // Map marker icon name
               , icon:           ""              // Icon image url
               , shadow:         ""              // Shadow image url
               , anchor_x:       0               // Left coordinate of icon's anchor
               , anchor_y:       0               // Top coordinate of icon's anchor
               , label_x:        0               // Horizontal center coordinate of icon's label
               , label_y:        0               // Top coordinate of icon's anchor
               , popup_x:        0               // Left coordinate of a merker's info window
               , popup_y:        0               // Top coordinate of merker's info window
               . width:          0               // Icon width in pixels (optional, defaults to iconsize)
               . height:         0               // Icon height in pixels (optional, defaults to iconsize)
               }
             ]

   overlaylist: [ { rowkey:         ""           // Unique overlay identifier (required)
                  , type:           ""           // Overlay type (one of "marker", "polygon" or "polyline")
                  , lat:            0.0          // marker: Marker latitude (required)
                  , lng:            0.0          // marker: Marker longitude (required)
                  , icon:           ""           // marker: Name of the icon to use (one of the icons in the iconlist; if no
                                                 // icon was specified or the icon could not be found, a standard Google
                                                 // marker icon is shown)
                  , hint:           ""           // marker: Marker tooltip text
                  , selectable:     false        // If the overlay is clickable by the user
                  , moveable:       false        // marker: If the marker is draggable by the user
                  , rowkeys:        []           // marker: The rowkeys this marker represents; usually this is an array
                                                 // containing only the rowkey of this marker, but for clustered markers
                                                 // this is the list of markers that are combined in this marker (if not
                                                 // present, the marker only represents itself)
                  , latlngs:        [ { lat: 0.0 // polygon, polyline: The shape vertices (required)
                                      , lng: 0.0
                                    ]
                  , outlinewidth:   0            // polygon, polyline: The width of the shape's outline
                  , outlinecolor:   ""           // polygon, polyline: The color of the shape's outline
                  , outlineopacity: 100          // polygon, polyline: The opacity (percentage) of the shape's outline
                  , reflat:         0.0          // polygon: Reference latitude for latlngs coordinates
                  , reflng:         0.0          // polygon: Reference longitude for latlngs coordinates
                  , fillcolor:      ""           // polygon: The polygon's fill color
                  , fillopacity:    100          // polygon: The polygon's fill opacity (percentage)
                  }
                ]
*/
function toddGM_Initialize(mapid, options)
{
  var mapdiv = document.getElementById(mapid);
  if (!mapdiv)
    return null;

  // Check for correct version of Google Maps API
  if (typeof GMap2 != "undefined")
  {
    mapdiv.innerHTML = '<div class="toddExtFontSettings" style="padding: 8px;">The Google Map could not be loaded, because the wrong version of the Google Maps API was loaded.<br /><br />Please link to version 3 of the Google Maps API using one of the following URLs:<ul><li>http://maps.google.com/maps/api/js?sensor=<i>set_to_true_or_false</i></li><li>https://maps-api-ssl.google.com/maps/api/js?sensor=<i>true_or_false</i> (secure connection)</li></ul></div>';
    return null;
  }

  // Check for necessary external object definitions
  if (typeof MarkerManager == "undefined")
  {
    options.markermanager = false;
  }
  if (typeof MarkerWithLabel == "undefined")
  {
    mapdiv.innerHTML = '<div class="toddExtFontSettings" style="padding: 8px;">The Google Map could not be loaded, because MarkerWithLabel is undefined. Is markerwithlabel.js loaded?</div>';
    return null;
  }

  // Convert the initial map center from string to google.maps.LatLng object
  options.latlng = toddGM_StringToLatLng(options.center);
  options.bounds = toddGM_StringToBounds(options.restrictto);

  // Create the todd map controller object
  return new toddGM_Map(mapid, options);
}

function toddGM_DeInit(mapobj)
{
  if (mapobj)
    mapobj.DeInit();

  // Google deinitialization code
  try
  {
    google.maps.Unload();
  }
  catch(e) {}
}


///////////////////////////////////////////////////////////////////////////////
// Our general map managing object

function toddGM_Map(mapid, options)
{
  this.callbacks = { CreateButtonImage: toddGM_BindFunction(options.CreateButtonImage, this)
                   , OnInitialized: toddGM_BindFunction(options.OnInitialized, this)
                   , OnClick: toddGM_BindFunction(options.OnClick, this)
                   , OnDblClick: toddGM_BindFunction(options.OnDblClick, this)
                   , OnRightClick: toddGM_BindFunction(options.OnRightClick, this)
                   , OnMoveEnd: toddGM_BindFunction(options.OnMoveEnd, this)
                   , OnZoomEnd: toddGM_BindFunction(options.OnZoomEnd, this)
                   , OnOverlayClick: toddGM_BindFunction(options.OnOverlayClick, this)
                   , OnOverlayDblClick: toddGM_BindFunction(options.OnOverlayDblClick, this)
                   , OnOverlayRightClick: toddGM_BindFunction(options.OnOverlayRightClick, this)
                   , OnOverlayDragEnd: toddGM_BindFunction(options.OnOverlayDragEnd, this)
                   , OnProjectionChanged: toddGM_BindFunction(options.OnProjectionChanged, this)
                   , OnDirections: toddGM_BindFunction(options.OnDirections, this)
                   , OpenInfoWindow: toddGM_BindFunction(options.OpenInfoWindow, this)
                   , CloseInfoWindow: toddGM_BindFunction(options.CloseInfoWindow, this)
                   };

  this.overlays = [];
  this.controls = { zoom: new toddGM_NavControl(this.callbacks)
                  };
  this.shapecolor = options.shapecolor ? options.shapecolor : "#FF0000";

  // Create and initialize the map
  var mapoptions = { center: options.latlng
                   , zoom: options.zoom
                   , mapTypeId: this.GetMapType(options.maptype)
                   , disableDefaultUI: true
                   , disableDoubleClickZoom: true
                   };
  if (options.backgroundcolor)
    mapoptions.backgroundColor = options.backgroundcolor;
  this.map = new google.maps.Map(document.getElementById(mapid), mapoptions);

  // Create an empty OverlayView to calculate pixels from latlngs
  this.calcoverlay = new google.maps.OverlayView();
  this.calcoverlay.draw = function(){}; // Dummy function
  this.calcoverlay.setMap(this.map);

  // Set events
  google.maps.event.addListener(this.map, "click", toddGM_BindFunction(this.OnMapClick, this));
  google.maps.event.addListener(this.map, "dblclick", toddGM_BindFunction(this.OnDblClick, this));
  google.maps.event.addListener(this.map, "rightclick", toddGM_BindFunction(this.OnRightClick, this));
  google.maps.event.addListener(this.map, "bounds_changed", toddGM_BindFunction(this.OnMoveEnd, this));
  google.maps.event.addListener(this.map, "zoom_changed", toddGM_BindFunction(this.OnZoomEnd, this));
  if (this.callbacks.OnProjectionChanged)
    google.maps.event.addListener(this.map, "projection_changed", this.callbacks.OnProjectionChanged);

  // Set map center and restriction bounds (this will check and the initial center as well and adjust it if necessary)
  this.SetBounds(options.bounds);

  // Set controls and properties
  this.SetMoveable(options.moveable);
  this.showcontrols = false;
  this.SetShowControls(options.showcontrols);

  // Initialize marker manager
  this.iconsize = options.iconsize;
  if (options.markermanager != false)
    this.markermanager = new MarkerManager(this.map, { borderPadding: this.iconsize
                                                     , trackMarkers: true
                                                     , maxZoom: 30
                                                     });

  // Create Icon objects for this map's icon definitions
  this.icons = [];
  if (options.icons)
    this.ParseIcons(options.icons);

  // Create a directions service object for computing directions
  this.directionsservice = new google.maps.DirectionsService();
  this.directionsrenderer = null;

  // Use a timeout to delay calling the OnInitialized callback until after toddGM_Initialize has finished
  if (this.callbacks.OnInitialized)
    window.setTimeout(this.callbacks.OnInitialized, 1);
}

toddGM_Map.prototype.DeInit = function toddGM_Map_DeInit()
{
  // Clear event listeners
  google.maps.event.clearInstanceListeners(this.map);

  // Remove map markers
  this.DestroyAllOverlays();

  // Remove controls
  this.controls.zoom.RemoveFromMap();
  this.controls.zoom.DeInit();
}

//ADDME: Update icons on current markers?
toddGM_Map.prototype.ParseIcons = function toddGM_Map_ParseIcons(icons)
{
  for (var i = 0; i < icons.length; ++i)
  {
    // Create a new icon
    var icon = new google.maps.MarkerImage( icons[i].icon
                                          , new google.maps.Size(icons[i].width ? icons[i].width : this.iconsize, icons[i].height ? icons[i].height : this.iconsize)
                                          , null
                                          , new google.maps.Point(icons[i].anchor_x, icons[i].anchor_y)
                                          );
    var shadow = null;
    if (icons[i].shadow)
      shadow = new google.maps.MarkerImage( icons[i].shadow
                                          , new google.maps.Size(icons[i].width ? icons[i].width : this.iconsize, icons[i].height ? icons[i].height : this.iconsize)
                                          , null
                                          , new google.maps.Point(icons[i].anchor_x, icons[i].anchor_y)
                                          );

    // InfoWindow offset, relative from top left position
    var infoOffset = new google.maps.Point(icons[i].popup_x, icons[i].popup_y);

    // The label offset is relative to the anchor point, so first count back to the top left corner, then add our label
    // position, which is relative to the top left corner.
    // To center the label, subtract half the label width from the left position.
    var labelOffset = new google.maps.Point(-(icons[i].label_x - icons[i].anchor_x - 24), -(icons[i].label_y - icons[i].anchor_y));

    this.icons.push({ name: icons[i].name.toUpperCase()
                    , icon: icon
                    , shadow: shadow
                    , labelOffset: labelOffset
                    , infoOffset: infoOffset
                    });
  }
}

toddGM_Map.prototype.GetIcon = function toddGM_Map_GetIcon(name)
{
  if (typeof name != "string")
    name = "";

  // Names are stored in uppercase (case-insensitive name search)
  name = name.toUpperCase();
  for (var i = 0; i < this.icons.length; ++i)
    if (this.icons[i].name == name)
      return this.icons[i];

  // Not found, return the Google default marker icon
  return null;
}

toddGM_Map.prototype.GetMapType = function toddGM_Map_GetMapType(maptype)
{
  switch (maptype)
  {
    case "satellite":
      return google.maps.MapTypeId.SATELLITE;
    case "hybrid":
      return google.maps.MapTypeId.HYBRID;
    case "physical":
      return google.maps.MapTypeId.TERRAIN;
  }
  return google.maps.MapTypeId.ROADMAP;
}

toddGM_Map.prototype.UpdateControls = function toddGM_Map_UpdateControls()
{
  this.controls.zoom.RemoveFromMap();
  if (this.showcontrols)
  {
    if (this.moveable)
      this.controls.zoom.AddToMap(this.map);
  }
}


///////////////////////////////////////////////////////////////////////////////
// Overlays

toddGM_Map.prototype.CheckOverlay = function toddGM_Map_CheckOverlay(overlay)
{
  if (typeof overlay.rowkey == "undefined"
    || typeof overlay.type == "undefined")
    return null;

  switch (overlay.type)
  {
    case "marker":
    {
      // Check for required fields
      if (typeof overlay.lat == "undefined"
        || typeof overlay.lng == "undefined")
        return null;

      // Add missing optional fields
      if (typeof overlay.icon == "undefined")
        overlay.icon = "";
      overlay.toddicon = this.GetIcon(overlay.icon);
      if (typeof overlay.hint == "undefined")
        overlay.hint = "";
      if (typeof overlay.moveable == "undefined")
        overlay.moveable = false;
      if (typeof overlay.selectable == "undefined")
        overlay.selectable = false;
      if (typeof overlay.rowkeys == "undefined" || overlay.rowkeys.length < 1)
        overlay.rowkeys = [ overlay.rowkey ];
    } break;
    case "polygon":
    case "polyline":
    {
      // Check for required fields
      if (typeof overlay.latlngs == "undefined")
        return null;

      // Add missing optional fields
      if (typeof overlay.outlinewidth == "undefined")
        overlay.outlinewidth = 1;
      if (typeof overlay.outlinecolor == "undefined" || overlay.outlinecolor == "")
        overlay.outlinecolor = this.shapecolor;
      if (typeof overlay.outlineopacity == "undefined" || overlay.outlineopacity > 100)
        overlay.outlineopacity = 100;
      else if (overlay.outlineopacity < 0)
        overlay.outlineopacity = 0;
      if (overlay.type == "polygon")
      {
        if ((typeof overlay.reflat != "undefined" && typeof overlay.reflng == "undefined")
          || (typeof overlay.reflng != "undefined" && typeof overlay.reflat == "undefined"))
          return null;
        if (typeof overlay.fillcolor == "undefined" || overlay.fillcolor == "")
          overlay.fillcolor = this.shapecolor;
        if (typeof overlay.fillopacity == "undefined" || overlay.fillopacity > 100)
          overlay.fillopacity = 100;
        else if (overlay.fillopacity < 0)
          overlay.fillopacity = 0;
      }
      if (typeof overlay.selectable == "undefined")
        overlay.selectable = false;
    } break;
    default:
    {
      return null;
    }
  }

  return overlay;
}

toddGM_Map.prototype.GetMarkerOptionsForOverlay = function toddGM_Map_GetMarkerOptionsForOverlay(overlay)
{
  var markeroptions = { position: new google.maps.LatLng(overlay.lat, overlay.lng)
                      , title: overlay.hint
                      , draggable: overlay.moveable
                      , clickable: overlay.selectable || (overlay.infohtml != "")
                      };

  // A default icon is used if the supplied icon does exist
  var defaulticon = !overlay.toddicon;
  if (!defaulticon)
  {
    if (overlay.toddicon.icon)
      markeroptions.icon = overlay.toddicon.icon;
    if (overlay.toddicon.shadow)
      markeroptions.shadow = overlay.toddicon.shadow;

    // Set extra options if this is a labeled marker
    if (overlay.rowkeys.length > 1 || overlay.label)
    {
      markeroptions.draggable = false;
      markeroptions.labelContent = overlay.label;
      if (overlay.rowkeys.length != 1)
        markeroptions.labelContent = overlay.rowkeys.length.toString();
      markeroptions.labelClass = "toddMarkerLabel toddExtFontSettings";
      markeroptions.labelAnchor = overlay.toddicon.labelOffset;
    }
  }

  return markeroptions;
}

toddGM_Map.prototype.CreateMarkerForOverlay = function toddGM_Map_CreateMarkerForOverlay(overlay)
{
  if (overlay.type != "marker")
    return null;

  // Create a Marker (single, unlabeled overlay) or LabeledMarker (clustered overlay or overlay with label) object
  var marker = null;
  var markeroptions = this.GetMarkerOptionsForOverlay(overlay);
  if (markeroptions.labelContent)
    marker = new MarkerWithLabel(markeroptions);
  else
    marker = new google.maps.Marker(markeroptions);

  // Set references
  marker.todd = overlay;
  overlay.marker = marker;

  // Set events (using 'self' construction instead of function bind to preserve original this in callbacks)
  var self = this;
  if (markeroptions.clickable)
    google.maps.event.addListener(marker, "click", function(event)
    {
      // event may be a Google Maps MouseEvent when clicked on the marker, or a DOM MouseEvent when clicked on the label
      if (event.latLng)
        self.OnOverlayClick(event.latLng, this.todd);
      else
        self.OnOverlayClick(self.PointToLatLng(event), this.todd);
    });
  if (overlay.selectable)
    google.maps.event.addListener(marker, "dblclick", function(event)
    {
      // event may be a Google Maps MouseEvent when clicked on the marker, or a DOM MouseEvent when clicked on the label
      if (event.latLng)
        self.OnOverlayDblClick(event.latLng, this.todd);
      else
        self.OnOverlayDblClick(self.PointToLatLng(event), this.todd);
    });
  google.maps.event.addListener(marker, "rightclick", function(event) { self.OnOverlayRightClick(event.latLng, this.todd); });
  if (markeroptions.draggable)
  {
    google.maps.event.addListener(marker, "dragstart", function(event) { self.OnOverlayDragStart(event.latLng, this.todd); });
    google.maps.event.addListener(marker, "dragend", function(event) { self.OnOverlayDragEnd(event.latLng, this.todd); });
  }

  return marker;
}

toddGM_Map.prototype.GetShapeOptionsForOverlay = function toddGM_Map_GetShapeOptionsForOverlay(overlay)
{
  // Create an array of LatLng objects
  var latlngs = [];
  for (var i = 0; i < overlay.latlngs.length; ++i)
    latlngs.push(new google.maps.LatLng((overlay.reflat ? overlay.reflat : 0.0) + overlay.latlngs[i].lat, (overlay.reflng ? overlay.reflng : 0.0) + overlay.latlngs[i].lng));

  var shapeoptions = { path: latlngs
                     , strokeColor: overlay.outlinecolor
                     , strokeWeight: overlay.outlinewidth
                     , strokeOpacity: overlay.outlineopacity / 100
                     , clickable: overlay.selectable
                     , draggable: overlay.moveable
                     };
  switch (overlay.type)
  {
    case "polygon":
    {
      shapeoptions.fillColor = overlay.fillcolor;
      shapeoptions.fillOpacity = overlay.fillopacity / 100;
    } break;
  }
  return shapeoptions;
}

toddGM_Map.prototype.CreateShapeForOverlay = function toddGM_Map_CreateShapeForOverlay(overlay)
{
  if (overlay.type != "polygon" && overlay.type != "polyline")
    return null;

  // Create a Polygon or Polyline object
  var shape = null;
  var shapeoptions = this.GetShapeOptionsForOverlay(overlay);
  switch (overlay.type)
  {
    case "polygon":
      shape = new google.maps.Polygon(shapeoptions);
      break;
    case "polyline":
      shape = new google.maps.Polyline(shapeoptions);
      break;
  }

  // Set references
  shape.todd = overlay;
  overlay.shape = shape;

  // Set events
  var self = this;
  if (overlay.selectable)
  {
    google.maps.event.addListener(shape, "click", function(event) { self.OnOverlayClick(event.latLng, overlay); });
    google.maps.event.addListener(shape, "dblclick", function(event) { self.OnOverlayDblClick(event.latLng, overlay); });
  }
  if (overlay.moveable)
  {
    google.maps.event.addListener(shape, "dragstart", function(event) { self.OnOverlayDragStart(event.latLng, overlay); });
    google.maps.event.addListener(shape, "dragend", function(event) { self.OnOverlayDragEnd(event.latLng, overlay); });
  }

  return shape;
}

toddGM_Map.prototype.AddOverlay = function toddGM_Map_AddOverlay(overlay)
{
  switch (overlay.type)
  {
    case "marker":
    {
      // Create a marker and add it to the map
      var marker = this.CreateMarkerForOverlay(overlay);
      if (this.markermanager)
        this.markermanager.addMarker(marker, 0);
      else
        marker.setMap(this.map);
    } break;
    case "polygon":
    case "polyline":
    {
      // Create a shape and add it to the map
      var shape = this.CreateShapeForOverlay(overlay);
      shape.setMap(this.map);
    } break;
  }

  // Add the overlay
  this.overlays.push(overlay);
}

toddGM_Map.prototype.GetOverlayById = function toddGM_Map_GetOverlayById(rowkey)
{
  for (var i = 0; i < this.overlays.length; ++i)
    if (this.overlays[i].rowkey == rowkey)
    {
      return this.overlays[i];
    }
  return null;
}

toddGM_Map.prototype.UpdateMapOverlay = function toddGM_Map_UpdateMapOverlay(overlay)
{
  switch (overlay.type)
  {
    case "marker":
    {
      if (overlay.marker)
      {
        var markeroptions = this.GetMarkerOptionsForOverlay(overlay);
        if (markeroptions.labelContent)
        {
          //ADDME: MarkerWithLabel (or more precisely, MarkerLabel_) doesn't support setOptions, so we'll just remove the current
          //       marker and add a new one with the updated properties
          this.DestroyOverlay(overlay.rowkey);
          this.AddOverlay(overlay);
        }
        else
          overlay.marker.setOptions(markeroptions);
      }
    } break;
    case "polygon":
    case "polyline":
    {
      if (overlay.shape)
      {
        this.DestroyOverlay(overlay.rowkey);
        this.AddOverlay(overlay);
      }
    } break;
  }
}

toddGM_Map.prototype.DestroyOverlay = function toddGM_Map_DestroyOverlay(rowkey)
{
  for (var i = 0; i < this.overlays.length; ++i)
  {
    var overlay = this.overlays[i];
    if (overlay.rowkey == rowkey)
    {
      switch (overlay.type)
      {
        case "marker":
        {
          // Clear events
          google.maps.event.clearInstanceListeners(overlay.marker);
          // Break circular reference
          overlay.marker.todd = null;
          // Remove marker from map
          if (this.markermanager)
            this.markermanager.removeMarker(overlay.marker);
          else
            overlay.marker.setMap(null);
          // Remove overlay from list of overlays
          this.overlays.splice(i, 1);
          return;
        }
        case "polygon":
        case "polyline":
        {
          // Clear events
          google.maps.event.clearInstanceListeners(overlay.shape);
          // Break circular reference
          overlay.shape.todd = null;
          // Remove shape from map
          overlay.shape.setMap(null);
          // Remove overlay from list of overlays
          this.overlays.splice(i, 1);
          return;
        }
      }
    }
  }
}

toddGM_Map.prototype.DestroyAllOverlays = function toddGM_Map_DestroyAllOverlays()
{
  while (this.overlays.length)
    this.DestroyOverlay(this.overlays[0].rowkey);
}


///////////////////////////////////////////////////////////////////////////////
// Directions

toddGM_Map.prototype.MakeTravelMode = function toddGM_Map_MakeTravelMode(name)
{
  switch (name)
  {
    case "bicycling":
      return google.maps.TravelMode.BICYCLING;
    case "walking":
      return google.maps.TravelMode.WALKING;
  }
  return google.maps.TravelMode.DRIVING;
}

toddGM_Map.prototype.GetTravelModeName = function toddGM_Map_GetTravelModeName(mode)
{
  switch (mode)
  {
    case google.maps.TravelMode.BICYCLING:
      return "bicycling";
    case google.maps.TravelMode.DRIVING:
      return "driving";
    case google.maps.TravelMode.WALKING:
      return "walking";
  }
  return "";
}

// location may either be a string, which is used as a geocoding query (like "dorpsstraat, ons dorp"), a { lat, lng } record
// or a Google LatLng object
toddGM_Map.prototype.LocationToDirectionPoint = function toddGM_Map_LoadDirection(location, query_permitted)
{
  if (query_permitted && typeof location == "string")
    return location;
  if (typeof location == "object")
  {
    if (location instanceof google.maps.LatLng)
      return location;
    if (location.lat && location.lng)
      return new google.maps.LatLng(location.lat, location.lng);
  }
}

/* latlngs: Array of LatLng objects, [lat,lng] objects, or query strings. The first locations will be used as origin, the last
            location will be used as destination, and the other locations will be used as waypoints.
   options: { travelmode:             "driving" // Travel mode (one of "driving", "bicycling" or "walking")
            , avoidhighways:          false     // If highways should be avoided
            , avoidtolls:             false     // If tollways should be avoided
            , overlay_icon:           ""        // The icon to use for waypoints when rendering the route
            , overlay_outlinewidth:   1         // The width of route polyline
            , overlay_outlinecolor:   ""        // The color of route polyline (defaults to default map shape color)
            , overlay_outlineopacity: 100       // The opacity (percentage) of route polyline
            , draggable:              true      // If the route can be modified by the user
            , nodisplay:              false     // Set to true if the route should not be rendered on the map
            , withinstructions:       false     // Set to true if HTML instruction should be provided to the callback function
            }
*/
toddGM_Map.prototype.LoadDirections = function toddGM_Map_LoadDirection(latlngs, options)
{
  this.ClearDirections();
  if (!latlngs || latlngs.length < 2)
    return;

  var origin = this.LocationToDirectionPoint(latlngs[0], true);
  var destination = this.LocationToDirectionPoint(latlngs[latlngs.length - 1], true);
  if (!origin || !destination)
    return;

  var waypoints = [];
  for (var num = latlngs.length - 1, i = 1; i < num; ++i)
  {
    var point = this.LocationToDirectionPoint(latlngs[i]);
    if (point)
      waypoints.push({ location: point, stopover: true });
  }

  this.directionsoptions = options;
  if (!this.directionsoptions)
    this.directionsoptions = {};
  var request = { origin: origin
                , waypoints: waypoints
                , destination: destination
                , travelMode: this.MakeTravelMode(this.directionsoptions.travelmode)
                , avoidHighways: this.directionsoptions.avoidhighways === true
                , avoidTolls: this.directionsoptions.avoidtolls === true
                , unitSystem: google.maps.UnitSystem.METRIC
                };
  this.directionsoptions.travelmode = this.GetTravelModeName(request.travelMode);
  this.directionsservice.route(request, toddGM_BindFunction(this.OnDirectionsCalculated, this));
}

toddGM_Map.prototype.ClearDirections = function toddGM_Map_ClearDirection(latlngs, options)
{
  if (this.directionsrenderer)
  {
    this.directionsrenderer.setMap(null);
    this.directionsrenderer = null;
  }
  this.directionsoptions = null;
}

toddGM_Map.prototype.GetDirections = function toddGM_Map_GetDirections(travelmode)
{
  if (!this.directionsrenderer)
    return null;

  if (this.directionsrenderer.getDirections().routes.length)
  {
    var routeindex = this.directionsrenderer.getRouteIndex();
    // If the route is not shown on the map, we'll just use the first route
    if (typeof routeindex != "number")
      routeindex = 0;
    var route = this.directionsrenderer.getDirections().routes[routeindex];

    // Get waypoints, distance and duration from calculated route
    var waypoints = [];
    var distance = 0, duration = 0;
    var instructions = [];
    for (var num = route.legs.length, i = 0; i < num; ++i)
    {
      var leg = route.legs[i];

      // If this is the first leg, add the start location as well (for other legs, the start location is the end location of
      // the previous leg)
      if (i == 0)
        waypoints.push({ lat: leg.start_location.lat(), lng: leg.start_location.lng() });

      for (var n = leg.via_waypoints.length, j = 0; j < n; ++j)
        waypoints.push({ lat: leg.via_waypoints[j].lat(), lng: leg.via_waypoints[j].lng() });
      waypoints.push({ lat: leg.end_location.lat(), lng: leg.end_location.lng() });

      distance += leg.distance.value; // Distance in meters
      duration += leg.duration.value; // Duration in seconds

      for (var n = leg.steps.length, j = 0; j < n; ++j)
      {
        var step = leg.steps[j];
        instructions.push({ text: step.instructions
                          , duration: step.duration.value
                          , duration_text: step.duration.text
                          , distance: step.distance.value
                          , distance_text: step.distance.text
                          });
      }
    }

    // Get lat/lng coordinates from calculated route polyline
    var latlngs = [];
    for (var num = route.overview_path.length, i = 0; i < num; ++i)
      latlngs.push({ lat: route.overview_path[i].lat(), lng: route.overview_path[i].lng() });

    var directions = { waypoints: waypoints
                     , latlngs: latlngs
                     , distance: distance
                     , duration: duration
                     , copyrights: route.copyrights
                     , warnings: route.warnings
                     };

    if (this.directionsoptions.withinstructions)
      directions.instructions = instructions;
    return directions;
  }
}

toddGM_Map.prototype.OnDirectionsCalculated = function toddGM_Map_OnDirectionsCalculated(result, status)
{
  // The route directions are calculated, render the route
  if (status == google.maps.DirectionsStatus.OK)
  {
    // Set marker options to use the supplied icon
    var markeroptions = this.GetMarkerOptionsForOverlay({ toddicon: this.GetIcon(this.directionsoptions.overlay_icon)
                                                        , rowkeys: []
                                                        });

    // Set polyline options to use the supplied outline properties
    if (typeof this.directionsoptions.overlay_outlinewidth == "undefined")
      this.directionsoptions.overlay_outlinewidth = 1;
    if (typeof this.directionsoptions.overlay_outlinecolor == "undefined" || this.directionsoptions.overlay_outlinecolor == "")
      this.directionsoptions.overlay_outlinecolor = this.shapecolor;
    if (typeof this.directionsoptions.overlay_outlineopacity == "undefined" || this.directionsoptions.overlay_outlineopacity > 100)
      this.directionsoptions.overlay_outlineopacity = 100;
    else if (this.directionsoptions.overlay_outlineopacity < 0)
      this.directionsoptions.overlay_outlineopacity = 0;
    var polylineoptions = this.GetShapeOptionsForOverlay({ latlngs: []
                                                         , outlinecolor: this.directionsoptions.overlay_outlinecolor
                                                         , outlinewidth: this.directionsoptions.overlay_outlinewidth
                                                         , outlineopacity: this.directionsoptions.overlay_outlineopacity
                                                         , type: "polyline"
                                                         });

    // Create a renderer and render the directions
    this.directionsrenderer = new google.maps.DirectionsRenderer({ draggable: this.directionsoptions.draggable !== false
                                                                 , suppressBicyclingLayer: true
                                                                 , suppressInfoWindows: true
                                                                 , markerOptions: markeroptions
                                                                 , polylineOptions: polylineoptions
                                                                 });
    if (!this.directionsoptions.nodisplay)
      this.directionsrenderer.setMap(this.map);
    google.maps.event.addListener(this.directionsrenderer, "directions_changed", toddGM_BindFunction(this.OnDirectionsRendered, this, [ status ]));
    this.directionsrenderer.setDirections(result);
  }
  else if (this.callbacks.OnDirections)
    this.callbacks.OnDirections(status); // No route found, return status only
}

toddGM_Map.prototype.OnDirectionsRendered = function toddGM_Map_OnDirectionsRendered(status)
{
  // The route is rendered or re-rendered (if the user dragged a waypoint), retrieve waypoints and polyline latlngs

  if (this.callbacks.OnDirections)
    this.callbacks.OnDirections(status, this.GetDirections());
}


///////////////////////////////////////////////////////////////////////////////
// Bounds

toddGM_Map.prototype.ZoomToOverlays = function toddGM_Map_ZoomToOverlays(restrict, max_zoom)
{
  // Create a bounds object
  var bounds = new google.maps.LatLngBounds();

  // Add the location of each overlay to the bounds
  for (var i = 0; i < this.overlays.length; ++i)
    bounds.extend(new google.maps.LatLng(this.overlays[i].lat, this.overlays[i].lng));

  this.map.fitBounds(bounds); // fixes the zooming not working correct if map is not visible/was not visible initially

  // Extend the bounds with icon margin (to fully show icons at bounds border)
  bounds = this.GetMapIconBounds(bounds);

  // Fit the bounds object with all overlays
  this.map.fitBounds(bounds);
  if (max_zoom && this.map.getZoom() > max_zoom)
    this.map.setZoom(max_zoom);

  // Restrict to the found bounds
  if (restrict)
    this.SetBounds(max_zoom ? this.map.getBounds() : bounds);
}

toddGM_Map.prototype.SetBounds = function toddGM_Map_SetBounds(bounds)
{
  if (bounds != this.bounds)
  {
    // Set new restriction bounds
    this.bounds = bounds;
    if (this.movelistener)
    {
      google.maps.event.removeListener(this.movelistener);
      this.movelistener = null;
    }

    // Calculate minimum zoomlevel to fit at most the bounds
    this.restrictzoom = 0;
    if (this.bounds)
    {
      // Get map span (lat en lng represent height and width)
      var mapspan = this.map.getBounds().toSpan();
      var maplat = mapspan.lat();
      var maplng = mapspan.lng();
      // Get map zoom
      var mapzoom = this.map.getZoom();
      // Get bounds span (lat en lng represent height and width)
      var boundsspan = this.bounds.toSpan();
      var boundslat = boundsspan.lat();
      var boundslng = boundsspan.lng();

      // Now we will try to fit the map view within the restriction bounds
      if (maplat > boundslat || maplng > boundslng)
      {
        // Either the map's lat or lng do not fit within the bounds, zoom in (decrease map area) until the map fits
        while (maplat > boundslat || maplng > boundslng)
        {
          // With each zoom level, the map's area is divided by 4 (each side is halved)
          ++mapzoom;
          maplat = maplat / 2;
          maplng = maplng / 2;
        }
        // We have a zoom level that fits the whole map
        this.restrictzoom = mapzoom;
      }
      else if (maplat < boundslat && maplng < boundslng)
      {
        // The whole map fits within the bounds, to find the minimum zoom level try to zoom out until it does not fit anymore
        while (mapzoom >= 0 && (maplat < boundslat && maplng < boundslng))
        {
          --mapzoom;
          maplat = maplat * 2;
          maplng = maplng * 2;
        }
        // With this zoomlevel the map does not fit anymore, so our restriction zoom level is the previous level
        this.restrictzoom = mapzoom + 1;
      }
      else
      {
        // The map area equals the restriction bounds area, use the map's current zoom level as restriction zoom level
        this.restrictzoom = mapzoom;
      }

      this.movelistener = google.maps.event.addListener(this.map, "drag", toddGM_BindFunction(this.CheckBounds, this));
      this.map.setOptions({ minZoom: this.restrictzoom });
    }
    else
      this.map.setOptions({ minZoom: 0 });

    // Check map for new bounds
    this.CheckBounds();
  }
}

toddGM_Map.prototype.FitBounds = function toddGM_Map_FitBounds(bounds)
{
  // If restriction bounds defined, don't update viewport
  if (this.bounds)
    return;

  this.map.fitBounds(bounds);
}

// Restrict movement of the map to the given bounds
// Inspired by http://www.ios-solutions.de/files/google_api_restricted_bounds.html
toddGM_Map.prototype.CheckBounds = function toddGM_Map_CheckBounds()
{
  // No restriction bounds defined, no need to check
  if (!this.bounds)
    return;

  // Check if the current map bounds are within the restriction bounds
  var mapbounds = this.map.getBounds();
  if (this.bounds.contains(mapbounds.getNorthEast()) && this.bounds.contains(mapbounds.getSouthWest()))
    return;

  if (this.map.getZoom() < this.restrictzoom)
    this.map.setZoom(this.restrictzoom);

  // If somehow the map area is greater than the bounds area, just center the map and return
  var mapspan = this.map.getBounds().toSpan();
  var boundsspan = this.bounds.toSpan();
  if (mapspan.lat() >= boundsspan.lat() || mapspan.lng() >= boundsspan.lng())
  {
    // Don't move the map if it is already centered (within certain roundoff margins)
    if (!this.map.getCenter().equals(this.bounds.getCenter()))
      this.map.setCenter(this.bounds.getCenter());
    return;
  }

  // Current map bounds and dimensions
  var offsetlat = mapspan.lat() / 2;
  var offsetlng = mapspan.lng() / 2;

  // Current lat and lng
  var mapcenter = this.map.getCenter();
  var lat = mapcenter.lat();
  var lng = mapcenter.lng();

  // Restriction maximum and minimum lat and lng values
  var maxlat = this.bounds.getNorthEast().lat();
  var maxlng = this.bounds.getNorthEast().lng();
  var minlat = this.bounds.getSouthWest().lat();
  var minlng = this.bounds.getSouthWest().lng();

  // Adjust lat and lng to place map bounds within restriction bounds
  if ((lat - offsetlat) < minlat)
    lat = minlat + offsetlat;
  else if ((lat + offsetlat) > maxlat)
    lat = maxlat - offsetlat;
  if ((lng - offsetlng) < minlng)
    lng = minlng + offsetlng;
  else if ((lng + offsetlng) > maxlng)
    lng = maxlng - offsetlng;

  // Move map to new lat and lng
  var newcenter = new google.maps.LatLng(lat, lng);
  if (!mapcenter.equals(newcenter))
    this.map.setCenter(newcenter);
}

// Get the map bounds, extended with an marker icon sized padding, or extend the given bounds
toddGM_Map.prototype.GetMapIconBounds = function toddGM_Map_GetMapIconBounds(bounds)
{
  // Get the map center and convert it to a pixel point
  var center = this.map.getCenter();
  var point = this.LatLngToPixel(center);
  // Move it iconsize pixels to the north east and convert back to latitude/longitude
  point.x += this.iconsize; // Move to the east
  point.y -= this.iconsize; // Move to the north
  var latlng = this.PixelToLatLng(point);
  // Get the latitude and longitude difference between the center and our icon point
  var diflat = latlng.lat() - center.lat();
  var diflng = latlng.lng() - center.lng();

  // Create a new bounds object by extending the current map bounds or reference bounds
  if (!bounds)
    bounds = this.map.getBounds();
  var sw = new google.maps.LatLng(bounds.getSouthWest().lat() - diflat, bounds.getSouthWest().lng() - diflng);
  var ne = new google.maps.LatLng(bounds.getNorthEast().lat() + diflat, bounds.getNorthEast().lng() + diflng);
  return new google.maps.LatLngBounds(sw, ne);
}


///////////////////////////////////////////////////////////////////////////////
// Info window

toddGM_Map.prototype.OpenInfoWindow = function toddGM_Map_OpenInfoWindow(overlay)
{
  // Only call the OpenInfoWindow callback if the CloseInfoWindow callback is also defined
  if (this.callbacks.OpenInfoWindow && this.callbacks.CloseInfoWindow)
    this.callbacks.OpenInfoWindow(overlay);
}

toddGM_Map.prototype.CloseInfoWindow = function toddGM_Map_CloseInfoWindow()
{
  if (this.callbacks.CloseInfoWindow)
    this.callbacks.CloseInfoWindow();
}


///////////////////////////////////////////////////////////////////////////////
// Helper functions

toddGM_Map.prototype.LatLngToPixel = function toddGM_Map_LatLngToPixel(latlng)
{
  return this.calcoverlay.getProjection().fromLatLngToContainerPixel(latlng);
}

toddGM_Map.prototype.PixelToLatLng = function toddGM_Map_PixelToLatLng(pixel)
{
  return this.calcoverlay.getProjection().fromContainerPixelToLatLng(pixel);
}

toddGM_Map.prototype.PointToLatLng = function toddGM_Map_PointToLatLng(point)
{
  return this.map.mapTypes[this.map.getMapTypeId()].projection.fromPointToLatLng(point);
}


///////////////////////////////////////////////////////////////////////////////
// Functions called by Tollium

toddGM_Map.prototype.SetMapType = function toddGM_Map_SetMapType(type)
{
  var maptype = this.GetMapType(type);
  if (maptype)
    this.map.setMapTypeId(maptype);
}

toddGM_Map.prototype.SetCenter = function toddGM_Map_SetCenter(pos)
{
  var latlng = toddGM_StringToLatLng(pos);
  if (latlng)
    this.map.panTo(latlng);
}

toddGM_Map.prototype.SetZoom = function toddGM_Map_SetZoom(zoom)
{
  this.map.setZoom(zoom);
}

toddGM_Map.prototype.SetRestrictTo = function toddGM_Map_SetRestrictTo(restrictto)
{
  this.SetBounds(toddGM_StringToBounds(restrictto));
}

toddGM_Map.prototype.SetViewport = function toddGM_Map_SetViewport(viewport)
{
  this.FitBounds(toddGM_StringToBounds(viewport));
}

toddGM_Map.prototype.SetMoveable = function toddGM_Map_SetMoveable(moveable)
{
  if (moveable != this.moveable)
  {
    this.moveable = moveable;
    this.map.setOptions({ draggable: this.moveable
                        , scrollwheel: this.moveable
                        });
  }
}

toddGM_Map.prototype.SetShowControls = function toddGM_Map_SetShowControls(showcontrols)
{
  if (showcontrols != this.showcontrols)
  {
    this.showcontrols = showcontrols;
    this.UpdateControls();
  }
}

toddGM_Map.prototype.UpdateAllOverlays = function toddGM_Map_UpdateAllOverlays(overlays)
{
  // Add/update incoming overlays
  var added = [];
  for (var i = 0; i < overlays.length; ++i)
  {
    var overlay = this.CheckOverlay(overlays[i]);
    if (!overlay)
      continue;

    if (this.GetOverlayById(overlay.rowkey))
      this.UpdateOverlay(overlay);
    else
      this.AddOverlay(overlay);
    added.push(overlay);
  }

  // Remove obsolete overlays
  var i = 0;
  while (i < this.overlays.length)
  {
    var j;
    for (j = 0; j < added.length; ++j)
      if (this.overlays[i].rowkey == added[j].rowkey)
        break;
    if (j >= added.length)
      this.DestroyOverlay(this.overlays[i].rowkey); // DestroyOverlay splices the overlays array, so don't increment i
    else
      ++i;
  }
}

toddGM_Map.prototype.UpdateOverlay = function toddGM_Map_UpdateOverlay(updated_overlay)
{
  var newoverlay = this.CheckOverlay(updated_overlay);
  if (!newoverlay)
    return;

  var overlay = this.GetOverlayById(newoverlay.rowkey);
  if (overlay)
  {
    // Update overlay properties
    var changed = false;
    for (var p in overlay)
    {
      if (typeof newoverlay[p] != "undefined")
      {
        if (newoverlay[p] != overlay[p])
        {
          overlay[p] = newoverlay[p];
          changed = true;
        }
      }
    }

    // If anything changed, update the overlay
    if (changed)
    {
      this.UpdateMapOverlay(overlay);
    }
  }
}


///////////////////////////////////////////////////////////////////////////////
// Map callback functions

toddGM_Map.prototype.OnMapClick = function toddGM_Map_OnMapClick(event)
{
  if (this.callbacks.OnClick)
    this.callbacks.OnClick(event.latLng);
}

toddGM_Map.prototype.OnDblClick = function toddGM_Map_OnDblClick(event)
{
  if (this.callbacks.OnDblClick)
    this.callbacks.OnDblClick(event.latLng);
}

toddGM_Map.prototype.OnRightClick = function toddGM_Map_OnRightClick(event)
{
  if (this.callbacks.OnRightClick)
    this.callbacks.OnRightClick(event.latLng, this.LatLngToPixel(event.latLng));
}

toddGM_Map.prototype.OnMoveEnd = function toddGM_Map_OnMoveEnd()
{
  this.CheckBounds();
  if (this.callbacks.OnMoveEnd)
    this.callbacks.OnMoveEnd();
}

toddGM_Map.prototype.OnZoomEnd = function toddGM_Map_OnZoomEnd()
{
  if (this.callbacks.OnZoomEnd)
    this.callbacks.OnZoomEnd();
}

toddGM_Map.prototype.OnOverlayClick = function toddGM_Map_OnOverlayClick(latlng, overlay)
{
  if (overlay.infohtml)
    this.OpenInfoWindow(overlay);
  if (overlay.selectable && this.callbacks.OnOverlayClick)
    this.callbacks.OnOverlayClick(overlay, latlng);
}

toddGM_Map.prototype.OnOverlayDblClick = function toddGM_Map_OnOverlayDblClick(latlng, overlay)
{
  if (overlay.selectable && this.callbacks.OnOverlayDblClick)
    this.callbacks.OnOverlayDblClick(overlay, latlng);
}

toddGM_Map.prototype.OnOverlayRightClick = function toddGM_Map_OnOverlayRightClick(latlng, overlay)
{
  if (/*overlay.selectable && */this.callbacks.OnOverlayRightClick)
    this.callbacks.OnOverlayRightClick(overlay, latlng, this.LatLngToPixel(latlng));
}

toddGM_Map.prototype.OnOverlayDragStart = function toddGM_Map_OnOverlayDragStart(latlng, overlay)
{
  this.CloseInfoWindow();
}

toddGM_Map.prototype.OnOverlayDragEnd = function toddGM_Map_OnOverlayDragEnd(latlng, overlay)
{
  if (this.callbacks.OnOverlayDragEnd)
    this.callbacks.OnOverlayDragEnd(overlay, latlng);
}


///////////////////////////////////////////////////////////////////////////////
// Our todd navigation (zoom/move) control

function toddGM_NavControl(callbacks)
{
  this.callbacks = callbacks;

  // Create a container for our buttons
  this.node = document.createElement("div");
  this.node.style.padding = "8px"
  this.node.style.textAlign = "center";

  this.buttons = {};
  if (this.callbacks.CreateButtonImage)
  {
    // Create our buttons buttons and add them to the container
    this.buttons.goup = this.CreateButton("goup", toddGM_BindFunction(this.PanUp, this), this.node);
    this.node.appendChild(document.createElement("br"));
    this.buttons.goleft = this.CreateButton("goleft", toddGM_BindFunction(this.PanLeft, this), this.node);
    this.buttons.goright = this.CreateButton("goright", toddGM_BindFunction(this.PanRight, this), this.node);
    this.node.appendChild(document.createElement("br"));
    this.buttons.godown = this.CreateButton("godown", toddGM_BindFunction(this.PanDown, this), this.node);
    this.node.appendChild(document.createElement("br"));
    this.buttons.zoomin = this.CreateButton("zoomin", toddGM_BindFunction(this.ZoomIn, this), this.node);
    if (this.buttons.zoomin)
      this.buttons.zoomin.style.marginTop = "6px";
    this.buttons.zoomout = this.CreateButton("zoomout", toddGM_BindFunction(this.ZoomOut, this), this.node);
  }
}

toddGM_NavControl.prototype.AddToMap = function(map)
{
  // Insert our button container in the map controls container
  this.map = map;
  this.map.controls[google.maps.ControlPosition.TOP_LEFT].push(this.node);
}

toddGM_NavControl.prototype.RemoveFromMap = function()
{
}

toddGM_NavControl.prototype.DeInit = function toddGM_NavControl_DeInit()
{
  for (var b in this.buttons)
    if (this.buttons[b])
      google.maps.event.clearInstanceListeners(this.buttons[b]);
}

toddGM_NavControl.prototype.CreateButton = function toddGM_NavControl_CreateButton(buttonimage, callback, parent)
{
  // Within the todd context, the button <img> node created by the appserver is created by the containing todd application
  // document, not the iframe document. To be able to use this node in our current document, we have to import using
  // importNode. Unfortunately, Internet Explorer does not support the importNode method, so we'll have to use a hack.
  var external_button = this.callbacks.CreateButtonImage("map_" + buttonimage + ".png", 16, 16);
  if (!external_button)
    return null;

  var button = null;
  if (document.importNode)
    button = document.importNode(external_button, true);
  else
  {
    var div = document.createElement("div");
    div.innerHTML = external_button.outerHTML;
    for (button = div.firstChild; button && button.nodeName.toUpperCase() != "IMG"; button = button.nextSibling);
  }

  button.map = this.map;
  button.style.cursor = "pointer";
  google.maps.event.addDomListener(button, "click", callback);
  parent.appendChild(button);
  return button;
}

toddGM_NavControl.prototype.ZoomIn = function toddGM_NavControl_ZoomIn()
{
  this.map.setZoom(this.map.getZoom() + 1);
}

toddGM_NavControl.prototype.ZoomOut = function toddGM_NavControl_ZoomOut()
{
  this.map.setZoom(this.map.getZoom() - 1);
}

toddGM_NavControl.prototype.PanUp = function toddGM_NavControl_PanUp()
{
  this.map.panBy(0, -this.map.getDiv().offsetHeight / 2);
}

toddGM_NavControl.prototype.PanDown = function toddGM_NavControl_PanDown()
{
  this.map.panBy(0, this.map.getDiv().offsetHeight / 2);
}

toddGM_NavControl.prototype.PanLeft = function toddGM_NavControl_PanLeft()
{
  this.map.panBy(-this.map.getDiv().offsetWidth / 2, 0);
}

toddGM_NavControl.prototype.PanRight = function toddGM_NavControl_PanRight()
{
  this.map.panBy(this.map.getDiv().offsetWidth / 2, 0);
}
