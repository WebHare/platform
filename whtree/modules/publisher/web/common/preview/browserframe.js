"use strict";

var iframe;       // The content iframe
var margins = {}; // Precalculated margins
var todd;         // Todd communication object
var onload;       // iframe load event listener
var previewpdf = false;

var was_user_interaction = false; //time of last interaction with the iframe.

var curdata;

// Initialize todd communication
todd = new $toddiframe({ onresize: onIframeResize
                       , ondata: onIframeData
                       });

// Cache prevention variable
var commit = location.search;

function onInteraction()
{
  was_user_interaction = true;
}

window.domReady = function()
{
  // Initialize the iframe (read margins)
  iframe = document.getElementById("contentframe");
  var styles = getComputedStyle(iframe);
  [ "top", "right", "bottom", "left" ].forEach(function(pos)
  {
    margins[pos] = parseInt(styles["margin-" + pos]);
  });
  iframe.style.margin = "0";

  window.addEventListener("message", onIframeMessage);
  iframe.addEventListener("load", onIframeLoad);
};

window.suggestRenderingPDF = function(pdfurl)
{
  if(!previewpdf)
    return;

  /* With the current sandbox settings, there isn't anything to stop a script
     from removing the sandbox attributes by itself, so we don't see any need
     to protect the pdfurl either. We'll just have to trust our own users
     (and WebHare should be in a different origin anyway) */
  var iframe = document.getElementById("contentframe");
  iframe.removeAttribute("sandbox");
  iframe.src = pdfurl;
}

function getPreviewCookie()
{
  var value = document.cookie.match('(?:^|;)\\s*__whpub_preview=([^;]*)');
  return (value) ? decodeURIComponent(value[1]) : null;
}
function setPreviewCookie(value)
{
  document.cookie = "__whpub_preview=" + encodeURIComponent(value) + "; path=/";
}

// Iframe component was resized
function onIframeResize()
{
  applySize();
}

// Received updated iframe data (requested device size, url)
function onIframeData()
{
  var cursrc = curdata ? curdata.src : null;
  curdata = todd.getData();

  if(curdata)
    previewpdf = curdata.previewpdf;

  if (curdata && curdata.src !== cursrc)
  {
    if(curdata.dontnavigate)
    {
      //console.log("isInteraction: ignoring external nav requets for " + cursrc);
      was_user_interaction = false;
      return;
    }

    // Set the preview cookie if unset, 'preview' doesn't trigger the dev bar but does trigger content interception
    if(!getPreviewCookie())
      setPreviewCookie("preview");

    // Mark this window as being inside the publisher. sessionstorage doesn't escape the tab so this should usually suffice
    sessionStorage["wh-publisher-preview-frame"] = "1";

    // Load the src into the iframe (the cookie makes sure the view proxy will handle the request)
    iframe.sandbox="allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts";
    iframe.src = curdata.src || "about:blank";
  }
  applySize();
}

function onIframeLoad(event)
{
  var uri = "";
  try
  {
    var win = event.target.contentWindow;
    uri = win.location.href;

    var head = win.document && win.document.querySelector("head");
    if (head)
    {
      var script = win.document.createElement("script");
      script.setAttribute("src", "/.publisher/common/preview/preview.js" + commit);
      head.appendChild(script);

      win.addEventListener("mousedown", onInteraction, true);
    }
  }
  catch (e)
  {
  }

  if (uri && curdata)
  {
    curdata.src = uri;
    //Only forward navigation events if the last interaction was 'recent'
    if(was_user_interaction)
    {
      //console.log("isInteraction: informing about local navigation to " + curdata.src);
      todd.doCallback({ type: "urlloaded", src: curdata.src });
    }
  }
}

function onIframeMessage(event)
{
  if (location.href.substr(0, event.origin.length) !== event.origin)
    return;

  switch (event.data.type)
  {
    case "blocked":
    {
      todd.doCallback({ type: "navigationprevented", uri: event.data.uri });
      break;
    }
  }
}

function applySize()
{
  if (!curdata)
    return;
  if (!curdata.width || !curdata.height)
  {
    iframe.style.display = "none";
    return;
  }

  if (curdata.fill)
  {
    iframe.className = "fullscreen";
  }
  else
  {
    iframe.className = "";

    // The iframe always gets the requested size; it will be scaled into view if necessary
    iframe.style.width = curdata.width + "px";
    iframe.style.height = curdata.height + "px";

    // Get viewport dimensions (subtract margins)
    var viewport = { width: Math.max(document.documentElement.clientWidth, window.innerWidth || 0) - margins.left - margins.right
                   , height: Math.max(document.documentElement.clientHeight, window.innerHeight || 0) - margins.top - margins.bottom
                   };

    // If the iframe is smaller than the viewport, just center the iframe within the viewport
    if (curdata.width <= viewport.width && curdata.height <= viewport.height)
    {
      iframe.style.transform = "";

      iframe.style.left = (Math.round((viewport.width - curdata.width) / 2) + margins.left) + "px";
      iframe.style.top = (Math.round((viewport.height - curdata.height) / 2) + margins.top) + "px";
    }
    else
    {
      // Make the iframe fit in the viewport by zooming it
      var fracx = viewport.width / curdata.width;
      var fracy = viewport.height / curdata.height;
      var zoomfactor = Math.min(fracx, fracy);
      iframe.style.transform = "scale(" + zoomfactor + ")";

      // Center the iframe horizontally or vertically
      if (fracx < fracy)
      {
        var newy = Math.min(Math.round(fracx * curdata.height), viewport.height);
        iframe.style.left = margins.left + "px";
        iframe.style.top = (Math.round((viewport.height - newy) / 2) + margins.top) + "px";
      }
      else
      {
        var newx = Math.min(Math.round(fracy * curdata.width), viewport.width);
        iframe.style.left = (Math.round((viewport.width - newx) / 2) + margins.left) + "px";
        iframe.style.top = margins.top + "px";
      }
    }
  }

  // Show the iframe (it's hidden initially)
  iframe.style.display = "block";
}

window.__webhareBrowserFrameAPI = {};

domReady();
