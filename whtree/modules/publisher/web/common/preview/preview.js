(function()
{
  "use strict";

  // This script is used to intercept page navigation from trusted to untrusted domains, e.g. from https://example.org to
  // http://example.org or from https://example.org to https://example.com

  var curdomain = getProtDomain(location.href);
  var cursecure = curdomain.indexOf("https://") === 0;

  // If there is a valid url and there is a window parent (iframe), prevent navigation outside the current domain
  if (curdomain && window.parent)
  {
    document.addEventListener("click", function(event)
    {
      var target = event.target;
      while (target && target.nodeName.toLowerCase() != "a")
        target = target.parentNode;
      if (!target)
        return;

      checkURI(target.href, event);
    }, true);
  }

  function getProtDomain(uri)
  {
    var parts = (uri || "").split("/");
    if (parts.length < 3 || parts[0].substr(-1) !== ":" || parts[1] !== "")
      return "";
    return parts.slice(0, 3).join("/") + "/";
  }

  function checkURI(uri, event)
  {
    if (cursecure && uri.indexOf("https://") !== 0)
    {
      console.warn("Blocked navigation to unsecure \"" + uri + "\"");
      window.parent.postMessage({ type: "blocked", uri: uri }, curdomain);
      if (event)
        event.preventDefault();
    }
  }
})();
