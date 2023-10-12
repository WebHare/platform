/* This is the interface between tollium/todd and WebHare's Google Map implementation. It only serves as the 'glue' between
   the HTML here, the Witty variables from the Tollium component and the toddGoogleMap object, which controls the general
   toddGM_Map component. Functions called directly by HareScript go here, as well as HTML load and unload event handlers.
*/

// Our todd map wrapper object
var toddmap;

// Called by body.onunload: Deinitialize the map
function unloadMap() {
  toddmap.deInit();
}

window.addEventListener("message", (event) => {
  switch (event.data.type) {
    case "UpdateAllOverlays": {
      toddmap.callMapFunction(event.data.type, event.data.overlays);
      break;
    }
    case "SetMapType": {
      toddmap.callMapFunction(event.data.type, event.data.maptype);
      break;
    }
    case "SetCenter": {
      toddmap.callMapFunction(event.data.type, event.data.center);
      break;
    }
    case "SetZoom": {
      toddmap.callMapFunction(event.data.type, event.data.zoom);
      break;
    }
    case "SetRestrictTo": {
      toddmap.callMapFunction(event.data.type, event.data.restrictto);
      break;
    }
    case "SetMoveable": {
      toddmap.callMapFunction(event.data.type, event.data.moveable);
      break;
    }
    case "SetShowControls": {
      toddmap.callMapFunction(event.data.type, event.data.showcontrols);
      break;
    }
    case "LoadDirections": {
      toddmap.callMapFunction(event.data.type, event.data.directions, event.data.options);
      break;
    }
    case "SetViewport": {
      toddmap.callMapFunction(event.data.type, event.data.viewport);
      break;
    }
  }
});

var mapdata = JSON.parse(document.currentScript.dataset.mapdata);
toddmap = new toddGoogleMap({
  ...mapdata,
  mapdiv: "map_canvas",
  shapecolor: "#308fe2", //ADDME: Use skin color
  markermanager: true
});
