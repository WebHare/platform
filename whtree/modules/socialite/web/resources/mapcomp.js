/* This is the interface between tollium/todd and WebHare's Google Map implementation. It only serves as the 'glue' between
   the HTML here, the Witty variables from the Tollium component and the toddGoogleMap object, which controls the general
   toddGM_Map component. Functions called directly by HareScript go here, as well as HTML load and unload event handlers.
*/

// Our todd map wrapper object
var toddmap;

// Called by body.onunload: Deinitialize the map
function UnloadMap()
{
  toddmap.DeInit();
}

// Called by HareScript: Call a toddGM_Map function with the given name
function CallMapFunction(name /* other arguments are read by the arguments object */)
{
  try
  {
    // Get arguments for called function
    var args = Array.prototype.slice.call(arguments);
    // Strip first element (function name)
    args.splice(0, 1);

    toddmap.CallMapFunction(name, args);
  }
  catch(e)
  {
    var what = "";
    if (typeof e == "string")
      what = e;
    else if (typeof e == "object" && typeof e["message"] == "string")
      what = e.message
    var msg = "Error calling map function '" + name + "'" + (what ? ": " + what : "");
    if (toddDebugging)
      toddAlert(msg);
    else if (window.console)
      console.error(msg);
  }
}

window.addEventListener("message", (event) =>
{
  switch (event.data.type)
  {
    case "UpdateAllOverlays":
    {
      toddmap.CallMapFunction(event.data.type, [ event.data.overlays ]);
      break;
    }
    case "SetMapType":
    {
      toddmap.CallMapFunction(event.data.type, [ event.data.maptype ]);
      break;
    }
    case "SetCenter":
    {
      toddmap.CallMapFunction(event.data.type, [ event.data.center ]);
      break;
    }
    case "SetZoom":
    {
      toddmap.CallMapFunction(event.data.type, [ event.data.zoom ]);
      break;
    }
    case "SetRestrictTo":
    {
      toddmap.CallMapFunction(event.data.type, [ event.data.restrictto ]);
      break;
    }
    case "SetMoveable":
    {
      toddmap.CallMapFunction(event.data.type, [ event.data.moveable ]);
      break;
    }
    case "SetShowControls":
    {
      toddmap.CallMapFunction(event.data.type, [ event.data.showcontrols ]);
      break;
    }
    case "LoadDirections":
    {
      toddmap.CallMapFunction(event.data.type, [ event.data.directions, event.data.options ]);
      break;
    }
    case "SetViewport":
    {
      toddmap.CallMapFunction(event.data.type, [ event.data.viewport ]);
      break;
    }
  }
});

var mapdata = JSON.parse(document.currentScript.dataset.mapdata);
toddmap = new toddGoogleMap({ ...mapdata
                            , mapdiv: "map_canvas"
                            , shapecolor: "#457188" //ADDME: Use skin color
                            , markermanager: true
                            });
