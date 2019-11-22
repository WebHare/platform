///////////////////////////////////////////////////////////////////////////////
// Our todd info window

function toddGM_InfoWindow(overlay)
{
  this.edges = new Object();
  this.overlay = overlay;
}
toddGM_InfoWindow.prototype = new google.maps.Overlay();

toddGM_InfoWindow.prototype.initialize = function toddGM_InfoWindow_initialize(map)
{
  this.map = map;

  this.node = document.createElement("div");
  this.node.className = "toddInfoWindow";

  // All elements are absolute positioned, so in order to avoid having to use z-indices, first add the content div and then
  // position the borders on top of it
  this.contentnode = document.createElement("div");
  this.contentnode.className = "toddInfoWindow-contents";

  // The close button, which floats to the right of the info window
  this.closebutton = document.createElement("div");
  this.closebutton.className = "toddInfoWindow-close";
  this.closebutton.appendChild(document.createTextNode("\xA0"));
  this.contentnode.appendChild(this.closebutton);

  // The actual content holder
  this.contents = document.createElement("span");
  this.contents.className = "toddExtFontSettings";
  this.contents.appendChild(document.createTextNode("\xA0"));
  this.contentnode.appendChild(this.contents);

  this.node.appendChild(this.contentnode);

  // Top border
  this.edges.nw = document.createElement("div");
  this.edges.nw.className = "toddInfoWindow-nw";
  this.edges.nw.appendChild(document.createTextNode("\xA0"));
  this.node.appendChild(this.edges.nw);
  this.edges.n = document.createElement("div");
  this.edges.n.className = "toddInfoWindow-n";
  this.edges.n.appendChild(document.createTextNode("\xA0"));
  this.node.appendChild(this.edges.n);
  this.edges.ne = document.createElement("div");
  this.edges.ne.className = "toddInfoWindow-ne";
  this.edges.ne.appendChild(document.createTextNode("\xA0"));
  this.node.appendChild(this.edges.ne);

  // Left and right borders
  this.edges.w = document.createElement("div");
  this.edges.w.className = "toddInfoWindow-w";
  this.edges.w.appendChild(document.createTextNode("\xA0"));
  this.node.appendChild(this.edges.w);
  this.edges.e = document.createElement("div");
  this.edges.e.className = "toddInfoWindow-e";
  this.edges.e.appendChild(document.createTextNode("\xA0"));
  this.node.appendChild(this.edges.e);

  // Bottom border
  this.edges.sw = document.createElement("div");
  this.edges.sw.className = "toddInfoWindow-sw";
  this.edges.sw.appendChild(document.createTextNode("\xA0"));
  this.node.appendChild(this.edges.sw);
  this.edges.s = document.createElement("div");
  this.edges.s.className = "toddInfoWindow-s";
  this.edges.s.appendChild(document.createTextNode("\xA0"));
  this.node.appendChild(this.edges.s);
  this.edges.se = document.createElement("div");
  this.edges.se.className = "toddInfoWindow-se";
  this.edges.se.appendChild(document.createTextNode("\xA0"));
  this.node.appendChild(this.edges.se);

  // Info window tail
  this.edges.tail = document.createElement("div");
  this.edges.tail.className = "toddInfoWindow-tail";
  this.edges.tail.appendChild(document.createTextNode("\xA0"));
  this.node.appendChild(this.edges.tail);

  if (this.overlay)
    this.Open(this.overlay);
}

toddGM_InfoWindow.prototype.redraw = function toddGM_InfoWindow_redraw(force)
{
  if (this.overlay)
  {
    // Reposition the info window
    var iconanchor = this.overlay.marker.getIcon().iconAnchor;
    var infoanchor = this.overlay.marker.getIcon().infoWindowAnchor;
    var pos = this.map.fromLatLngToDivPixel(this.overlay.marker.getPoint());
    this.node.style.top = (pos.y - this.contentheight - 20/*padding + tail height*/ - iconanchor.y + infoanchor.y) + "px";
    this.node.style.left = (pos.x - 60/*tail left*/ - iconanchor.x + infoanchor.x) + "px";
  }
}

toddGM_InfoWindow.prototype.remove = function toddGM_InfoWindow_remove()
{
  // Clean up
  google.maps.Event.clearListeners(this.node);
  if (this.node.parentNode)
    this.node.parentNode.removeChild(this.node);
  this.overlay = null;
}

toddGM_InfoWindow.prototype.copy = function toddGM_InfoWindow_copy()
{
  return new toddGM_InfoWindow(this.overlay);
};

// Open the info window for a given overlay.
toddGM_InfoWindow.prototype.Open = function toddGM_InfoWindow_Open(overlay)
{
  this.overlay = overlay;

  this.map.getPane(G_MAP_FLOAT_PANE).appendChild(this.node);

  var self = this;
  google.maps.Event.addDomListener(this.node, "mousedown", function(e) { return self.OnClick(e, false); });
  google.maps.Event.addDomListener(this.node, "dblclick", function(e) { return self.OnClick(e, false); });
  google.maps.Event.addDomListener(this.closebutton, "mousedown", function(e) { return self.OnClick(e, false); });
  google.maps.Event.addDomListener(this.closebutton, "click", function(e) { return self.OnClick(e, true); });

  this.OverlayUpdated();
};

// Call this function if the infohtml value of an overlay has been changed. This will update the contents and reposition
// the info window if necessary.
toddGM_InfoWindow.prototype.OverlayUpdated = function toddGM_InfoWindow_OverlayUpdated()
{
  if (this.overlay)
  {
    this.contents.innerHTML = this.overlay.infohtml;
    this.Relayout();
  }
};

toddGM_InfoWindow.prototype.Relayout = function toddGM_InfoWindow_Relayout()
{
  // Reset height before calculating new height
  this.contentnode.style.height = "";
  this.contentwidth = this.contentnode.clientWidth - 10/*padding*/;
  this.contentheight = this.contentnode.clientHeight;
  if (this.contentheight < 23) // minimum height
  {
    this.contentheight = 23;
    this.contentnode.style.height = this.contentheight + "px";
  }

  // Set border sizes
  this.edges.n.style.width = this.contentwidth + "px";
  this.edges.s.style.width = this.contentwidth + "px";
  this.edges.w.style.height = this.contentheight + "px";
  this.edges.e.style.height = this.contentheight + "px";

  // Position right borders
  this.edges.ne.style.left = (this.contentwidth + 5/*border width*/) + "px";
  this.edges.e.style.left = (this.contentwidth + 5/*border width*/) + "px";
  this.edges.se.style.left = (this.contentwidth + 5/*border width*/) + "px";

  // Position bottom borders
  this.edges.sw.style.top = (this.contentheight + 5/*border width*/) + "px";
  this.edges.s.style.top = (this.contentheight + 5/*border width*/) + "px";
  this.edges.se.style.top = (this.contentheight + 5/*border width*/) + "px";
  this.edges.tail.style.top = (this.contentheight + 9/*2*border width - 1 pixel*/) + "px";

  this.redraw();
}

// Close the info window.
toddGM_InfoWindow.prototype.Close = function toddGM_InfoWindow_Close(e)
{
  this.remove();
}

toddGM_InfoWindow.prototype.OnClick = function toddGM_InfoWindow_OnClick(e, shouldclose)
{
  // Cancel the event, so it will not be handled by the map as well
  if (!e)
    e = window.event;
  if(e && e.stopPropagation)
  {
    e.stopPropagation();
  }
  else
  {
    window.event.cancelBubble = true;
    window.event.returnValue = false;
  }

  // Close the info window, if requested
  if (shouldclose)
    this.Close();

  return false;
}
