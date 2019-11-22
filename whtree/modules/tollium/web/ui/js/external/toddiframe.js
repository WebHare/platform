/** @short The todd iframe communication object
    @long This object provides communications between the iframe content and todd. If direct communication is possible (i.e.
          if the iframe content is in the same domain as todd), $todd is available to the iframe content and action enabling
          is possible.
    @param options Optional settings
    @cell options.oncallback An event handler to handle callbacks sent by the TolliumIframe's DoCallback function
    @cell options.onprint A handler which is called when TolliumIframe's Print function is called (if not specified, the iframe
                          contents is printed by default)
    @cell options.onresize A handler which is called when the iframe node has resized
    @cell options.ondata A handler which is called when the iframe data object has resized
    @cell options.targetorigin The url at which messages are targeted (if not specified, all targets are accepted)
*/
function $toddiframe(options)
{
  options = options || {};

  // If not specified, accept any target origin
  this.__targetorigin = options.targetorigin || "*";

  // The iframe data object
  this.__data = null;

  // Store the supplied event handlers
  if (options.oncallback && typeof options.oncallback == "function")
    this.__oncallback = options.oncallback;
  if (options.onprint && typeof options.onprint == "function")
    this.__onprint = options.onprint;
  if (options.onresize && typeof options.onresize == "function")
    this.__onresize = options.onresize;
  if (options.ondata && typeof options.ondata == "function")
    this.__ondata = options.ondata;

  // Listen to the 'message' event
  var self = this;
  var onmessage = function() { self.__onMessage.apply(self, arguments); };
  if (window.addEventListener)
    window.addEventListener("message", onmessage);
  else
    window.attachEvent("onmessage", onmessage);
}

/** @short Post a message from the iframe to todd
*/
$toddiframe.prototype.postMessage = function(message)
{
  //console.log("postMessage "+message.type);
  window.parent.postMessage(message, this.__targetorigin);
};

/** @short Do a callback from the iframe to todd with the given data
    @param data The data to send with the callback
*/
$toddiframe.prototype.doCallback = function(data)
{
  this.postMessage({ type: "callback", data: data });
};

/** @short Get the iframe data object
*/
$toddiframe.prototype.getData = function()
{
  return this.__data;
};

/** @short Update the iframe data object
    @param data The new iframe data object
*/
$toddiframe.prototype.setData = function(data)
{
  this.__data = data;
  this.postMessage({ type: "data", data: this.__data });
};

/** @short Show a menu at a given position
    @param menuname The name of the menu to show
    @param x The x position to show the menu at, relative to the top left of the iframe
    @param y The y position to show the menu at, relative to the top left of the iframe
*/
$toddiframe.prototype.showContextMenu = function(menuname, x, y)
{
  this.postMessage({ type: "contextmenu", name: menuname, x: x, y: y });
};

/** @short Check enabled state of all actions
    @param selectionflags The flags for the current selection
*/
$toddiframe.prototype.actionEnabler = function(selectionflags)
{
  this.postMessage({ type: "actionenabler", selectionflags: selectionflags });
};

// Handle incoming events. Process some standard iframe event types here, otherwise call the supplied onmessage event handler
// with the event data.
$toddiframe.prototype.__onMessage = function(e)
{
  e = e || window.event;
  var message = e.data;
  if (message && message.type)
  {
    switch (message.type)
    {
      case "calljs":
        var func = window[message.funcname];
        if (func)
          func.apply(window, message.args);
        else
          console.error("Cannot find function '" + message.funcname + "' to call");
        return;

      case "data":
        this.__data = message.data;
        if (this.__ondata)
          this.__ondata.call(window);
        return;

      case "callback":
        if (this.__oncallback)
          this.__oncallback.call(window, message.data);
        return;

      case "print":
        if (this.__onprint)
          this.__onprint.call(window);
        else
          window.print();
        return;

      case "resize":
        if (this.__onresize)
          this.__onresize.call(window);
        return;
    }
  }
};
