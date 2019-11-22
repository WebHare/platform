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
  if (typeof GMap2 == "undefined")
  {
    mapdiv.innerHTML = '<div class="toddExtFontSettings" style="padding: 8px;">The Google Map could not be loaded, because the wrong version of the Google Maps API was loaded.<br /><br />Please link to version 2 of the Google Maps API using the following URL:<ul><li>http://maps.google.com/maps?file=api&amp;v=2&amp;key=<i>apikey</i>&sensor=<i>true_or_false</i></li></ul></div>';
    return null;
  }

  if (google.maps.BrowserIsCompatible())
  {
    // Check for necessary external object definitions
    if (typeof MarkerManager == "undefined")
    {
      options.markermanager = false;
    }
    if (typeof LabeledMarker == "undefined")
    {
      mapdiv.innerHTML = '<div class="toddExtFontSettings" style="padding: 8px;">The Google Map could not be loaded, because LabeledMarker is undefined. Is labeledmarker.js loaded?</div>';
      return null;
    }

    // Save default minimum zoom level functions for all map types
    var maptypes = G_DEFAULT_MAP_TYPES;
    for (var i=0; i<maptypes.length; ++i)
      maptypes[i].getDefaultMinimumResolution = maptypes[i].getMinimumResolution;


    // Convert the initial map center from string to google.maps.LatLng object
    options.latlng = toddGM_StringToLatLng(options.center);
    options.bounds = toddGM_StringToBounds(options.restrictto);

    // Create the todd map controller object
    return new toddGM_Map(mapid, options);
  }

  mapdiv.innerHTML = '<div class="toddExtFontSettings" style="padding: 8px;">The Google Map could not be loaded, because the browser is not supported or an invalid API key was supplied.</div>';
  return null;
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
  var self = this;

  this.callbacks = { CreateButtonImage: options.CreateButtonImage
                   , OnInitialized: options.OnInitialized
                   , OnClick: options.OnClick
                   , OnDblClick: options.OnDblClick
                   , OnRightClick: options.OnRightClick
                   , OnMoveEnd: options.OnMoveEnd
                   , OnZoomEnd: options.OnZoomEnd
                   , OnOverlayClick: options.OnOverlayClick
                   , OnOverlayDblClick: options.OnOverlayDblClick
                   , OnOverlayRightClick: options.OnOverlayRightClick
                   , OnOverlayDragEnd: options.OnOverlayDragEnd
                   , OpenInfoWindow: options.OpenInfoWindow
                   , CloseInfoWindow: options.CloseInfoWindow
                   };

  this.overlays = new Array();
  this.controls = { zoom: new toddGM_NavControl(this.callbacks)
                  };
  this.shapecolor = options.shapecolor ? options.shapecolor : "#FF0000";

  // Create and initialize the map
  var mapoptions = new Object();
  if (options.backgroundcolor)
    mapoptions.backgroundColor = options.backgroundcolor;
  // Currently we're supporting "map", "satellite", "hybrid" and "physical"
  mapoptions.mapTypes = [ toddGM_MapType("map")
                        , toddGM_MapType("satellite")
                        , toddGM_MapType("hybrid")
                        , toddGM_MapType("physical")
                        ];
  this.map = new google.maps.Map2(document.getElementById(mapid), mapoptions);
  google.maps.Event.addListener(this.map, "load", function() { self.OnLoad(); });

  // Set map center and restriction bounds (this will check and the initial center as well and adjust it if necessary)
  this.map.setCenter(options.latlng, options.zoom);
  this.SetBounds(options.bounds);

  // Set controls and properties
  this.map.disableGoogleBar();
  this.map.disableDoubleClickZoom();
  this.map.enableContinuousZoom();
  this.SetMoveable(options.moveable);
  this.showcontrols = false;
  this.SetShowControls(options.showcontrols);

  // Set events
  google.maps.Event.addListener(this.map, "click", function(overlay, latlng, overlaylatlng) { self.OnMapClick(overlay, latlng, overlaylatlng); });
  google.maps.Event.addListener(this.map, "dblclick", function(overlay, latlng) { self.OnDblClick(overlay, latlng); });
  google.maps.Event.addListener(this.map, "singlerightclick", function(point, src, overlay) { self.OnRightClick(point, src, overlay); });
  google.maps.Event.addListener(this.map, "move", function() { self.OnMove(); });
  google.maps.Event.addListener(this.map, "moveend", function() { self.OnMoveEnd(); });
  google.maps.Event.addListener(this.map, "zoomend", function(oldLevel, newLevel) { self.OnZoomEnd(oldLevel, newLevel); });

  // Initialize marker manager
  this.iconsize = options.iconsize;
  if (options.markermanager != false)
    this.markermanager = new MarkerManager(this.map, { borderPadding: this.iconsize
                                                     , trackMarkers: true
                                                     });

  // Create Icon objects for this map's icon definitions
  this.icons = new Array();
  if (options.icons)
    this.ParseIcons(options.icons);

  // Initialize requested map type
  this.SetMapType(options.maptype);
}
toddGM_Map.prototype = new Object();

toddGM_Map.prototype.DeInit = function toddGM_Map_DeInit()
{
  // Clear event listeners
  google.maps.Event.clearInstanceListeners(this.map);

  // Remove map markers
  this.DestroyAllOverlays();

  // Remove controls
  this.map.removeControl(this.controls.zoom);
  this.controls.zoom.DeInit();
}

//ADDME: Update icons on current markers?
toddGM_Map.prototype.ParseIcons = function toddGM_Map_ParseIcons(icons)
{
  for (var i = 0; i < icons.length; ++i)
  {
    // Create a new icon
    var icon = new google.maps.Icon();
    icon.image = icons[i].icon;
    if (icons[i].shadow)
      icon.shadow = icons[i].shadow;
    icon.iconSize = new google.maps.Size(icons[i].width ? icons[i].width : this.iconsize, icons[i].height ? icons[i].height : this.iconsize);
    icon.shadowSize = new google.maps.Size(icons[i].width ? icons[i].width : this.iconsize, icons[i].height ? icons[i].height : this.iconsize);
    icon.iconAnchor = new google.maps.Point(icons[i].anchor_x, icons[i].anchor_y);
    icon.infoWindowAnchor = new google.maps.Point(icons[i].popup_x, icons[i].popup_y);

    // The label offset is relative to the anchor point, so first count back to the top left corner, then add our label
    // position, which is relative to the top left corner.
    // To center the label, subtract half the label width from the left position.
    var labelOffset = new google.maps.Size(icons[i].label_x - icons[i].anchor_x - 24, icons[i].label_y - icons[i].anchor_y);

    this.icons.push({ name: icons[i].name.toUpperCase()
                    , icon: icon
                    , labelOffset: labelOffset
                    });
  }
}

toddGM_Map.prototype.GetIcon = function toddGM_Map_GetIcon(name)
{
  if (typeof name != "string")
    name = "";

  // Names are stored in uppercase (case-insensitive name search)
  name = name.toUpperCase();
  if (name != "G_DEFAULT_ICON")
  {
    for (var i = 0; i < this.icons.length; ++i)
      if (this.icons[i].name == name)
        return this.icons[i];
  }

  // Not found, return the Google default marker icon
  return { icon: G_DEFAULT_ICON
         , defaulticon: true
         };
}

toddGM_Map.prototype.GetMapType = function toddGM_Map_GetMapType(maptype)
{
  var maptypes = this.map.getMapTypes();
  for (var i=0; i<maptypes.length; ++i)
  {
    if (maptypes[i].name == maptype)
      return maptypes[i];
  }
  return null;
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
          google.maps.Event.clearInstanceListeners(overlay.marker);
          // Break circular reference
          overlay.marker.todd = null;
          // Remove marker from map
          if (this.markermanager)
            this.markermanager.removeMarker(overlay.marker);
          else
            this.map.removeOverlay(overlay.marker);
          // Remove overlay from list of overlays
          this.overlays.splice(i, 1);
          return;
        }
        case "polygon":
        case "polyline":
        {
          // Clear events
          google.maps.Event.clearInstanceListeners(overlay.shape);
          // Break circular reference
          overlay.shape.todd = null;
          // Remove shape from map
          this.map.removeOverlay(overlay.shape);
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
        this.map.addOverlay(marker);
    } break;
    case "polygon":
    case "polyline":
    {
      // Create a shape and add it to the map
      var shape = this.CreateShapeForOverlay(overlay);
      this.map.addOverlay(shape);
    } break;
  }

  // Add the overlay
  this.overlays.push(overlay);
}

toddGM_Map.prototype.GetOverlayById = function toddGM_Map_GetOverlayById(rowkey)
{
  for (var i = 0; i < this.overlays.length; ++i)
    if (this.overlays[i].rowkey == rowkey)
      return this.overlays[i];
  return null;
}

toddGM_Map.prototype.CreateMarkerForOverlay = function toddGM_Map_CreateMarkerForOverlay(overlay)
{
  if (overlay.type != "marker")
    return null;

  // Retrieve icon
  var toddicon = this.GetIcon(overlay.icon);
  var defaulticon = toddicon.defaulticon;

  // Create a Marker (single, unlabeled overlay) or LabeledMarker (clustered overlay or overlay with label) object
  var marker = null;
  if ((overlay.rowkeys.length == 1 && !overlay.label) || defaulticon)
  {
    marker = new google.maps.Marker(new google.maps.LatLng(overlay.lat, overlay.lng), { icon: toddicon.icon
                                                                                      , title: overlay.hint
                                                                                      , bouncy: true
                                                                                      , draggable: overlay.moveable// && !defaulticon
                                                                                      , clickable: (overlay.selectable || overlay.infohtml)// && !defaulticon
                                                                                      });
  }
  else
  {
    var label = overlay.label;
    if (overlay.rowkeys.length != 1)
      label = overlay.rowkeys.length.toString();
    marker = new LabeledMarker(new google.maps.LatLng(overlay.lat, overlay.lng), { icon: toddicon.icon
                                                                                 , title: overlay.hint
                                                                                 , draggable: false
                                                                                 , clickable: overlay.selectable
                                                                                 , labelText: label
                                                                                 , labelClass: "toddMarkerLabel toddExtFontSettings"
                                                                                 , labelOffset: toddicon.labelOffset
                                                                                 });
  }

  // Set references
  marker.todd = overlay;
  overlay.marker = marker;

  // Set events
  var self = this;
  if (overlay.selectable || overlay.infohtml)
    google.maps.Event.addListener(marker, "click", function(mapsoverlay, latlng) { self.OnOverlayClick(overlay, latlng); });
  if (overlay.selectable)
    google.maps.Event.addListener(marker, "dblclick", function(mapsoverlay, latlng) { self.OnOverlayDblClick(overlay, latlng); });
  if (overlay.moveable)
  {
    google.maps.Event.addListener(marker, "dragstart", function(latlng) { self.OnOverlayDragStart(overlay, latlng); });
    google.maps.Event.addListener(marker, "dragend", function(latlng) { self.OnOverlayDragEnd(overlay, latlng); });
  }

  return marker;
}

toddGM_Map.prototype.CreateShapeForOverlay = function toddGM_Map_CreateShapeForOverlay(overlay)
{
  if (overlay.type != "polygon" && overlay.type != "polyline")
    return null;

  // Create an array of LatLng objects
  var latlngs = new Array();
  for (var i = 0; i < overlay.latlngs.length; ++i)
    latlngs.push(new google.maps.LatLng((overlay.reflat ? overlay.reflat : 0.0) + overlay.latlngs[i].lat, (overlay.reflng ? overlay.reflng : 0.0) + overlay.latlngs[i].lng));

  // Create a Polygon or Polyline object
  var shape = null;
  switch (overlay.type)
  {
    case "polygon":
    {
      shape = new google.maps.Polygon( latlngs
                                     , overlay.outlinecolor != "transparent" ? overlay.outlinecolor : "#000000"
                                     , overlay.outlinewidth
                                     , overlay.outlinecolor != "transparent" ? overlay.outlineopacity / 100 : 0
                                     , overlay.fillcolor != "transparent" ? overlay.fillcolor : "#000000"
                                     , overlay.fillcolor != "transparent" ? overlay.fillopacity / 100 : 0
                                     , { clickable: overlay.selectable
                                       });
    } break;
    case "polyline":
    {
      shape = new google.maps.Polyline( latlngs
                                     , overlay.outlinecolor != "transparent" ? overlay.outlinecolor : "#000000"
                                     , overlay.outlinewidth
                                     , overlay.outlinecolor != "transparent" ? overlay.outlineopacity / 100 : 0
                                      , { clickable: overlay.selectable
                                        });
    } break;
  }

  // Set references
  shape.todd = overlay;
  overlay.shape = shape;

  // Set events
  var self = this;
  if (overlay.selectable)
  {
    google.maps.Event.addListener(shape, "click", function(mapsoverlay, latlng) { self.OnOverlayClick(overlay, latlng); });
    google.maps.Event.addListener(shape, "dblclick", function(mapsoverlay, latlng) { self.OnOverlayDblClick(overlay, latlng); });
  }
  if (overlay.moveable)
  {
    google.maps.Event.addListener(shape, "dragstart", function(latlng) { self.OnOverlayDragStart(overlay, latlng); });
    google.maps.Event.addListener(shape, "dragend", function(latlng) { self.OnOverlayDragEnd(overlay, latlng); });
  }

  return shape;
}

toddGM_Map.prototype.UpdateMapOverlay = function toddGM_Map_UpdateMapOverlay(overlay)
{
  switch (overlay.type)
  {
    case "marker":
    {
      //ADDME: We would like to change only the updated marker properties. However, the Google Maps API only allows us to update
      //       the latitude/longitude, so to update all other properties, we have to remove the current marker and add a new one
      //       with the updated properties.
      if (overlay.marker)
      {
        // Clear and re-add overlay
        this.DestroyOverlay(overlay.rowkey);
        this.AddOverlay(overlay);
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

toddGM_Map.prototype.UpdateControls = function toddGM_Map_UpdateControls()
{
  this.map.removeControl(this.controls.zoom);
  if (this.showcontrols)
  {
    if (this.moveable)
      this.map.addControl(this.controls.zoom);
  }
}

toddGM_Map.prototype.ZoomToOverlays = function toddGM_Map_ZoomToOverlays(restrict)
{
  // Create a bounds object
  var bounds = new google.maps.LatLngBounds();

  // Add the location of each overlay to the bounds
  for (var i = 0; i < this.overlays.length; ++i)
    bounds.extend(new google.maps.LatLng(this.overlays[i].lat, this.overlays[i].lng));

  // Extend the bounds with icon margin (to fully show icons at bounds border)
  bounds = this.GetMapIconBounds(bounds);

  // Set zoom level and center to fit the bounds object with all overlays
  this.map.setZoom(this.map.getBoundsZoomLevel(bounds));
  this.map.setCenter(bounds.getCenter());

  // Restrict to the found bounds
  if (restrict)
    this.SetBounds(bounds);
}

toddGM_Map.prototype.SetBounds = function toddGM_Map_SetBounds(bounds)
{
  if (bounds != this.bounds)
  {
    // Set new restriction bounds
    this.bounds = bounds;

    // Calculate minimum zoomlevel to fit at most the bounds
    var restrictzoom = 0;
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
        restrictzoom = mapzoom;
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
        restrictzoom = mapzoom + 1;
      }
      else
      {
        // The map area equals the restriction bounds area, use the map's current zoom level as restriction zoom level
        restrictzoom = mapzoom;
      }
    }
    // Apply the minimum zoomlevel to all current map types
    var maptypes = this.map.getMapTypes();
    for (var i=0; i<maptypes.length; ++i)
      maptypes[i].restrictzoom = restrictzoom;
    // Adjust current zoom level if necessary
    if (this.map.getZoom() < restrictzoom)
      this.map.setZoom(restrictzoom);

    // Check map for new bounds
    this.CheckBounds();
  }
}

// Restrict movement of the map to the given bounds
// Inspired by http://www.ios-solutions.de/files/google_api_restricted_bounds.html
toddGM_Map.prototype.CheckBounds = function toddGM_Map_CheckBounds()
{
  // No restriction bounds defined, no need to check
  if (!this.bounds)
    return;

  // Check if the current map bounds are within the restriction bounds
  if (this.bounds.containsBounds(this.map.getBounds()))
    return;

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
  var point = this.map.fromLatLngToContainerPixel(center);
  // Move it iconsize pixels to the north east and convert back to latitude/longitude
  point.x += this.iconsize; // Move to the east
  point.y -= this.iconsize; // Move to the north
  var latlng = this.map.fromContainerPixelToLatLng(point);
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
// Functions called by Tollium

toddGM_Map.prototype.SetMapType = function toddGM_Map_SetMapType(type)
{
  var maptype = this.GetMapType(type);
  if (maptype)
    this.map.setMapType(maptype);
}

toddGM_Map.prototype.SetCenter = function toddGM_Map_SetCenter(pos)
{
  var point = toddGM_StringToLatLng(pos);
  if (point)
  {
    //ADDME: panTo doesn't always seem to work, but why? It seems to have to do with initial zoom level or calling panTo too
    //       soon. setCenter doesn't seem to have this limitation, so we'll just use that instead, which works but doesn't
    //       have the nice scrolling effect.
//    this.map.panTo(point);
    this.map.setCenter(point);
  }
}

toddGM_Map.prototype.SetZoom = function toddGM_Map_SetZoom(zoom)
{
  this.map.setZoom(zoom);
}

toddGM_Map.prototype.SetRestrictTo = function toddGM_Map_SetRestrictTo(restrictto)
{
  this.SetBounds(toddGM_StringToBounds(restrictto));
}

toddGM_Map.prototype.SetMoveable = function toddGM_Map_SetMoveable(moveable)
{
  if (moveable != this.moveable)
  {
    this.moveable = moveable;
    if (this.moveable)
    {
      this.map.enableDragging();
      this.map.enableScrollWheelZoom();
    }
    else
    {
      this.map.disableDragging();
      this.map.disableScrollWheelZoom();
    }
    this.UpdateControls();
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
  var added = new Array();
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
      this.UpdateMapOverlay(overlay);
  }
}


///////////////////////////////////////////////////////////////////////////////
// Map callback functions

toddGM_Map.prototype.OnLoad = function toddGM_Map_OnLoad()
{
  if (this.callbacks.OnInitialized)
  {
    // Use a timeout to delay calling the OnInitialized callback until after toddGM_Initialize has finished
    window.setTimeout(this.callbacks.OnInitialized, 1);
  }
}

toddGM_Map.prototype.OnMapClick = function toddGM_Map_OnMapClick(overlay, latlng, overlaylatlng)
{
  if (!overlay)
  {
    if (this.callbacks.OnClick)
      this.callbacks.OnClick(latlng);
  }
}

toddGM_Map.prototype.OnDblClick = function toddGM_Map_OnDblClick(overlay, latlng)
{
  if (this.callbacks.OnDblClick)
    this.callbacks.OnDblClick(latlng);
}

toddGM_Map.prototype.OnRightClick = function toddGM_Map_OnRightClick(point, src, overlay)
{
  if (overlay)
  {
    if (/*overlay.todd.selectable && */this.callbacks.OnOverlayRightClick)
      this.callbacks.OnOverlayRightClick(overlay.todd, point);
  }
  else
  {
    if (this.callbacks.OnRightClick)
      this.callbacks.OnRightClick(point);
  }
}

toddGM_Map.prototype.OnMove = function toddGM_Map_OnMove()
{
  this.CheckBounds();
}

toddGM_Map.prototype.OnMoveEnd = function toddGM_Map_OnMoveEnd()
{
  if (this.callbacks.OnMoveEnd)
    this.callbacks.OnMoveEnd();
}

toddGM_Map.prototype.OnZoomEnd = function toddGM_Map_OnZoomEnd(oldLevel, newLevel)
{
  if (this.callbacks.OnZoomEnd)
    this.callbacks.OnZoomEnd();
}

toddGM_Map.prototype.OnOverlayClick = function toddGM_Map_OnOverlayClick(overlay, latlng)
{
  if (overlay.infohtml)
    this.OpenInfoWindow(overlay);
  if (overlay.selectable && this.callbacks.OnOverlayClick)
    this.callbacks.OnOverlayClick(overlay, latlng);
}

toddGM_Map.prototype.OnOverlayDblClick = function toddGM_Map_OnOverlayDblClick(overlay, latlng)
{
  if (overlay.selectable && this.callbacks.OnOverlayDblClick)
    this.callbacks.OnOverlayDblClick(overlay, latlng);
}

toddGM_Map.prototype.OnOverlayDragStart = function toddGM_Map_OnOverlayDragStart(overlay, latlng)
{
  this.CloseInfoWindow();
}

toddGM_Map.prototype.OnOverlayDragEnd = function toddGM_Map_OnOverlayDragEnd(overlay, latlng)
{
  if (this.callbacks.OnOverlayDragEnd)
    this.callbacks.OnOverlayDragEnd(overlay, latlng);
}


///////////////////////////////////////////////////////////////////////////////
// Our todd navigation (zoom/move) control

function toddGM_NavControl(callbacks)
{
  this.callbacks = callbacks;
  this.buttons = new Object;
}
toddGM_NavControl.prototype = new google.maps.Control();

// Called by google.maps.Map2.addControl()
toddGM_NavControl.prototype.initialize = function toddGM_NavControl_initialize(map)
{
  this.map = map;

  // Create a container for our buttons
  this.node = document.createElement("div");
  this.node.style.textAlign = "center";

  if (this.callbacks.CreateButtonImage)
  {
    var self = this;

    // Create our buttons buttons and add them to the container
    this.buttons.goup = this.CreateButton("goup", function(e) { self.PanUp(e); }, this.node);
    this.node.appendChild(document.createElement("br"));
    this.buttons.goleft = this.CreateButton("goleft", function(e) { self.PanLeft(e); }, this.node);
    this.buttons.goright = this.CreateButton("goright", function(e) { self.PanRight(e); }, this.node);
    this.node.appendChild(document.createElement("br"));
    this.buttons.godown = this.CreateButton("godown", function(e) { self.PanDown(e); }, this.node);
    this.node.appendChild(document.createElement("br"));
    this.buttons.zoomin = this.CreateButton("zoomin", function(e) { self.ZoomIn(e); }, this.node);
    if (this.buttons.zoomin)
      this.buttons.zoomin.style.marginTop = "6px";
    this.buttons.zoomout = this.CreateButton("zoomout", function(e) { self.ZoomOut(e); }, this.node);
  }

  // Insert our button container in the map controls container
  this.map.getContainer().appendChild(this.node);
  return this.node;
}

// Called by google.maps.Map2.addControl()
toddGM_NavControl.prototype.getDefaultPosition = function toddGM_NavControl_getDefaultPosition()
{
  // Position this control at the top left corner, at 8 pixels from the map's edge
  return new google.maps.ControlPosition(G_ANCHOR_TOP_LEFT, new google.maps.Size(8, 8));
}

toddGM_NavControl.prototype.DeInit = function toddGM_NavControl_DeInit()
{
  for (var b in this.buttons)
    if (this.buttons[b])
      google.maps.Event.clearInstanceListeners(this.buttons[b]);
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
  google.maps.Event.addDomListener(button, "click", callback);
  parent.appendChild(button);
  return button;
}

toddGM_NavControl.prototype.ZoomIn = function toddGM_NavControl_ZoomIn()
{
  this.map.zoomIn();
}

toddGM_NavControl.prototype.ZoomOut = function toddGM_NavControl_ZoomOut()
{
  this.map.zoomOut();
}

toddGM_NavControl.prototype.PanUp = function toddGM_NavControl_PanUp()
{
  this.map.panDirection(0, 1);
}

toddGM_NavControl.prototype.PanDown = function toddGM_NavControl_PanDown()
{
  this.map.panDirection(0, -1);
}

toddGM_NavControl.prototype.PanLeft = function toddGM_NavControl_PanLeft()
{
  this.map.panDirection(1, 0);
}

toddGM_NavControl.prototype.PanRight = function toddGM_NavControl_PanRight()
{
  this.map.panDirection(-1, 0);
}


///////////////////////////////////////////////////////////////////////////////
// Our custom map types

function toddGM_MapType(name)
{
  var orgmaptype = G_NORMAL_MAP;
  switch(name)
  {
    case "satellite":
      orgmaptype = G_SATELLITE_MAP;
      break;
    case "hybrid":
      orgmaptype = G_HYBRID_MAP;
      break;
    case "physical":
      orgmaptype = G_PHYSICAL_MAP;
      break;
  }
  var maptype = new Object();
  for (i in orgmaptype)
    maptype[i] = orgmaptype[i];

  maptype.name = name;
  maptype.restrictzoom = 0;
  maptype.minimumzoom = orgmaptype.getMinimumResolution();
  maptype.getMinimumResolution = function()
                                 {
                                   return this.restrictzoom > this.minimumzoom ? this.restrictzoom : this.minimumzoom;
                                 };
  return maptype;
}


///////////////////////////////////////////////////////////////////////////////
// Our directions travel modes

function toddGM_TravelMode(value, reverse)
{
  if (reverse)
  {
    switch (value)
    {
      case G_TRAVEL_MODE_WALKING:
        return "walking";
    }
    return "driving";
  }

  switch(value)
  {
    case "walking":
      return G_TRAVEL_MODE_WALKING;
  }
  return G_TRAVEL_MODE_DRIVING;
}
