+function(){ //scope guard - we are directly loaded into the page

var websocketbase, bundleid = null, bundlecssnode;
var toolbar = null, toolbar_assetstatus=null, toolbar_cssreload=null, toolbar_cssreloadcheck=null,toolbar_pagereload=null;
var toolbar_filestatus=null,toolbar_pagerepublishreload=null;
var toolbar_resstatus=null,toolbar_resreload=null,toolbar_resreloadcheck=null;
var toolbar_fullreload=null,toolbar_fullreloadcheck=null;
var toolbar_fullsourcemap=null,toolbar_fullsourcemapcheck=null;
var toolbar_hidetools=null;
var bundlestatus = null, bundlecssbaselink = null;
var filestatus = null;
var reloadonok = false;
var livesocket = null;
var hadrecompile = false;
var hadrepublish = false;
var hadresourcechange = false;
var whoutputtoolsdata = null;

function setupWebsocket()
{
  var toolssocket;
  try
  {
    toolssocket = new WebSocket(websocketbase + "outputtools.whsock");
  }
  catch(e) //eg IE Security error
  {
    console.error("Unable to set up websocket");
    console.error(e);
    return;
  }

  // In IE11, it is too dangerous to continue after the unload event
  window.addEventListener("unload", function() { toolssocket.close(); } );

  toolssocket.addEventListener('open', function()
  {
    if(bundleid)
      toolssocket.send(JSON.stringify({ type: 'watchassetpack', uuid: bundleid }));
    toolssocket.send(JSON.stringify({ type: 'watchurl', url: window.location.href }));
    if (whoutputtoolsdata && whoutputtoolsdata.resources)
      toolssocket.send(JSON.stringify({ type: 'watchresources', resources: whoutputtoolsdata.resources }));
    livesocket = toolssocket;
  });
  toolssocket.addEventListener('message', function(event)
  {
    var msgdata = JSON.parse(event.data);
    var i, realerrors;

    if(msgdata.type=="greeting")
      return;

    if(msgdata.type=="assetpack")
    {
      if(msgdata.iscompiling)
      {
        console.warn("Your assets are out of date and are being recompiled");
        hadrecompile = true;

        if (toolbar_fullreloadcheck.checked && !reloadonok)
        {
          toolbar_pagereload.classList.add("wh-outputtool__pagereload-scheduled");
          reloadonok = true;
        }
      }
      else if(msgdata.haserrors)
      {
        console.error("Your assets are out of date because of a compilation error");
        console.log(msgdata.errors);
      }

      var compilingdone = !msgdata.iscompiling && bundlestatus && bundlestatus.iscompiling && !msgdata.haserrors;
      bundlestatus = { iscompiling: msgdata.iscompiling, isok: !msgdata.haserrors, fullsourcemap: msgdata.fullsourcemap };
      updateToolbar();

      checkReload();

      if(!msgdata.iscompiling && msgdata.haserrors)
      {
        realerrors = msgdata.info.errors;
        for(i=0;i<realerrors.length;++i)
        {
          if(realerrors[i].resource)
            console.log("Error involving", realerrors[i].resource);
          console.log(realerrors[i].message);
        }
      }
      if(compilingdone)
        onCompilingDone();
      return;
    }
    if(msgdata.type=="assetpack-missing")
    {
      console.warn("Your assetpack has been removed");
      bundlestatus = null;
      updateToolbar();
      return;
    }
    if(msgdata.type=="file")
    {
      if(msgdata.ispreview)
        return;

      if(!msgdata.hasfile)
      {
        console.warn("This page is not associated with a file");
      }
      else if(msgdata.isdeleted)
      {
        console.warn("This file has been deleted");
      }
      else if(msgdata.ispublishing)
      {
        console.warn("This file is being republished");
        hadrepublish = true;

        if (toolbar_fullreloadcheck.checked && !reloadonok)
        {
          toolbar_pagerepublishreload.classList.add("wh-outputtool__pagerepublishreload-scheduled");
          reloadonok = true;
        }
      }
      else if(msgdata.haserrors)
      {
        console.error("Republishing this file failed with errors");
        console.log(msgdata.message);
      }
      else if(msgdata.haswarnings)
      {
        console.error("Republishing this file completed with warnings");
        console.log(msgdata.message);
      }

      var publishingdone = !msgdata.ispublishing && bundlestatus && bundlestatus.ispublishing && !msgdata.haserrors;
      filestatus = { hasfile: msgdata.hasfile, isdeleted: msgdata.isdeleted, ispublishing: msgdata.ispublishing, isok: !msgdata.haserrors, haswarnings: msgdata.haswarnings };
      updateToolbar();

      checkReload();

      if(publishingdone && msgdata.haserrors)
      {
        realerrors = msgdata.info.errors;
        for(i=0;i<realerrors.length;++i)
          console.log(realerrors[i].message);
      }
      return;
    }
    if(msgdata.type=="resource-change")
    {
      hadresourcechange = true;
      if (toolbar_resreloadcheck.checked)
        reloadonok = true;
      updateToolbar();
      checkReload();
      return;
    }
    console.error("Unexpected message of type '" + msgdata.type + "'", event);
  });

  updateToolbar();
}

function checkReload()
{
  if (!reloadonok)
    return;

  var bundle_done = !bundlestatus || (!bundlestatus.iscompiling);
  var file_done = !filestatus || (!filestatus.deleted && !filestatus.ispublishing);
  if (bundle_done && file_done)
  {
    var bundle_ok = !bundlestatus || bundlestatus.isok;
    var file_ok = !filestatus || filestatus.isok;

    if (bundle_ok && file_ok)
    {
      console.log("Reloading page");
      reloadonok = false;
      if (window.parent && window.parent !== window)
        window.parent.postMessage('wh-outputtools-reload', location.origin);
      window.location.reload();
      console.log("Reloading scheduled");
    }
    else
    {
      console.log("Compilation/publishing failed, cancelling reload");
      reloadonok = false;
      toolbar_pagereload.classList.remove("wh-outputtool__pagereload-scheduled");
      toolbar_pagerepublishreload.classList.remove("wh-outputtool__pagerepublishreload-scheduled");
    }
  }
}

function onCompilingDone()
{
  if(toolbar_cssreloadcheck.checked)
  {
    fetch(bundlecssbaselink, { cache: "reload" }).then( function()
    {
      bundlecssnode.href = "";
      setTimeout( function() { bundlecssnode.href = bundlecssbaselink; },1);
    });
  }
}

function onCssReloadChange()
{
  if(toolbar_cssreloadcheck.checked)
    delete localStorage["whoutputtool-cssreload"];
  else
    localStorage["whoutputtool-cssreload"] = "false";
}

function onFullReloadChange()
{
  if(toolbar_fullreloadcheck.checked)
  {
    sessionStorage["whoutputtool-fullreload"] = "true";
    if (hadrecompile || hadrepublish)
    {
      reloadonok = true;
      checkReload();
    }
  }
  else
    delete sessionStorage["whoutputtool-fullreload"];
}

function onResReloadChange()
{
  if(toolbar_resreloadcheck.checked)
  {
    sessionStorage["whoutputtool-resreload"] = "true";
    if (hadresourcechange)
    {
      reloadonok = true;
      checkReload();
    }
  }
  else
    delete sessionStorage["whoutputtool-resreload"];
}

function onFullSourceMapChange()
{
  if (!bundlestatus)
    return;
  if (!livesocket)
    return;

  livesocket.send(JSON.stringify({ type: 'setfullsourcemap', uuid: bundleid, value: toolbar_fullsourcemapcheck.checked }));
  reloadonok = true;
  bundlestatus.iscompiling = true;
  updateToolbar();
  toolbar_pagereload.classList.add("wh-outputtool__pagereload-scheduled");
}

function onPageReloadClick(e)
{
  console.log("onPageReloadClick", e);
  e.preventDefault();
  e.stopPropagation();
  if (!bundlestatus)
    return;
  if (!livesocket)
    return;

  toolbar_pagereload.classList.add("wh-outputtool__pagereload-scheduled");
  reloadonok = true;
  if (!bundlestatus || (!bundlestatus.iscompiling && (!hadrecompile || !bundlestatus.isok)))
  {
    livesocket.send(JSON.stringify({ type: 'recompileassetpack', uuid: bundleid}));
    bundlestatus.iscompiling = true;
    updateToolbar();
  }

  // Also republish if republishing had failed
  if (!filestatus || (!filestatus.isrepublishing && !filestatus.isok))
  {
    livesocket.send(JSON.stringify({ type: 'republishfile', url: window.location.href }));
    if(filestatus)
      filestatus.ispublishing = true;
    updateToolbar();
  }

  checkReload();
}

function onPageRepublishReloadClick(e)
{
  console.log("onPageRepublishReloadClick", e);
  e.preventDefault();
  e.stopPropagation();
  if (!filestatus)
    return;
  if (!livesocket)
    return;

  toolbar_pagerepublishreload.classList.add("wh-outputtool__pagerepublishreload-scheduled");
  reloadonok = true;
  if (!filestatus || (!filestatus.isrepublishing && (!hadrepublish || !filestatus.isok)))
  {
    livesocket.send(JSON.stringify({ type: 'republishfile', url: window.location.href }));
    filestatus.ispublishing = true;
    updateToolbar();
  }

  // Also recompile if bundle compile failed
  if (!bundlestatus || (!bundlestatus.iscompiling && !bundlestatus.isok))
  {
    livesocket.send(JSON.stringify({ type: 'recompileassetpack', uuid: bundleid}));
    bundlestatus.iscompiling = true;
    updateToolbar();
  }

  checkReload();
}

function onMessage(event)
{
  if (event.data === "wh-outputtools-reload" && sessionStorage["whoutputtool-fullreload"])
  {
    console.log("Child iframe reloaded, doing full page reload");
    reloadonok = true;
    checkReload();
  }
}

function onDomReady()
{
  document.documentElement.classList.add("wh-outputtool--active");

  toolbar = document.createElement("wh-outputtools");
  toolbar.innerHTML =
'<wh-outputtool class="wh-outputtool wh-outputtool__assetstatus"></wh-outputtool>'
+ '<wh-outputtool class="wh-outputtool wh-outputtool__pagereload" title="Reload after current recompile">↻</wh-outputtool>'
+ '<wh-outputtool class="wh-outputtool wh-outputtool__filestatus"></wh-outputtool>'
+ '<wh-outputtool class="wh-outputtool wh-outputtool__resstatus"></wh-outputtool>'
+ '<wh-outputtool class="wh-outputtool wh-outputtool__pagerepublishreload" title="Reload after current recompile">↻</wh-outputtool>'
+ '<wh-outputtool class="wh-outputtool wh-outputtool__cssreload"><input id="__wh-outputtool__cssreload" type="checkbox" tabindex="-1"><label for="__wh-outputtool__cssreload">auto-reload CSS</label></wh-outputtool>'
+ '<wh-outputtool class="wh-outputtool wh-outputtool__fullreload"><input id="__wh-outputtool__fullreload" type="checkbox" tabindex="-1"><label for="__wh-outputtool__fullreload">auto-reload page</label></wh-outputtool>'
+ '<wh-outputtool class="wh-outputtool wh-outputtool__resreload"><input id="__wh-outputtool__resreload" type="checkbox" tabindex="-1"><label for="__wh-outputtool__resreload">auto-reload resources</label></wh-outputtool>'
+ '<wh-outputtool class="wh-outputtool wh-outputtool__fullsourcemap"><input id="__wh-outputtool__fullsourcemap" type="checkbox" tabindex="-1"><label for="__wh-outputtool__fullsourcemap">full source map</label></wh-outputtool>'
+ '<wh-outputtool class="wh-outputtool wh-outputtool__hidetools"><span>hide tools</span></wh-outputtool>'
;

  document.body.appendChild(toolbar);
  toolbar_assetstatus = toolbar.querySelector('.wh-outputtool__assetstatus');
  toolbar_pagereload = toolbar.querySelector('.wh-outputtool__pagereload');
  toolbar_pagereload.addEventListener("click", onPageReloadClick);
  toolbar_filestatus = toolbar.querySelector('.wh-outputtool__filestatus');
  toolbar_resstatus = toolbar.querySelector('.wh-outputtool__resstatus');
  toolbar_pagerepublishreload = toolbar.querySelector('.wh-outputtool__pagerepublishreload');
  toolbar_pagerepublishreload.addEventListener("click", onPageRepublishReloadClick);

  toolbar_cssreload = toolbar.querySelector('.wh-outputtool__cssreload');
  toolbar_cssreloadcheck = toolbar_cssreload.querySelector('input');
  toolbar_cssreloadcheck.checked = localStorage["whoutputtool-cssreload"] != "false";
  toolbar_cssreloadcheck.onchange = onCssReloadChange;

  toolbar_fullreload = toolbar.querySelector('.wh-outputtool__fullreload');
  toolbar_fullreloadcheck = toolbar_fullreload.querySelector('input');
  toolbar_fullreloadcheck.checked = sessionStorage["whoutputtool-fullreload"] == "true";
  toolbar_fullreloadcheck.onchange = onFullReloadChange;

  toolbar_resreload = toolbar.querySelector('.wh-outputtool__resreload');
  toolbar_resreloadcheck = toolbar_resreload.querySelector('input');
  toolbar_resreloadcheck.checked = sessionStorage["whoutputtool-resreload"] == "true";
  toolbar_resreloadcheck.onchange = onResReloadChange;

  toolbar_fullsourcemap = toolbar.querySelector('.wh-outputtool__fullsourcemap');
  toolbar_fullsourcemapcheck = toolbar_fullsourcemap.querySelector('input');
  toolbar_fullsourcemapcheck.checked = sessionStorage["whoutputtool-fullsourcemap"] == "true";
  toolbar_fullsourcemapcheck.onchange = onFullSourceMapChange;

  toolbar_hidetools = toolbar.querySelector('.wh-outputtool__hidetools');
  toolbar_hidetools.addEventListener("click", onHideToolsClick);

  updateToolbar();

  var renderingsummarynode = document.getElementById("wh-rendering-summary");
  if(renderingsummarynode)
  {
    var renderingsummary = JSON.parse(renderingsummarynode.textContent);
    if(renderingsummary.invokedwitties)
      renderingsummary.invokedwitties.forEach(function(witty, idx)
      {
        console.groupCollapsed("Witty #" + (idx+1) + ": " + witty.component);
        console.log(witty.data);
        console.groupCollapsed("Stacktrace");
        witty.stacktrace.forEach(function (trace)
        {
          console.log(trace.filename + ":" + trace.line + ":" + trace.col + " " + trace.func);
        });
        console.groupEnd();
        console.groupEnd();
      });
  }

  whoutputtoolsdata = document.getElementById("wh-outputtoolsdata");
  if (whoutputtoolsdata)
    whoutputtoolsdata = JSON.parse(whoutputtoolsdata.textContent);

  if (livesocket && whoutputtoolsdata && whoutputtoolsdata.resources)
    livesocket.send(JSON.stringify({ type: 'watchresources', resources: whoutputtoolsdata.resources }));

  setupWebsocket();
}

function updateToolbar()
{
  if(!toolbar)
    return;

  var assetsstatus = bundlestatus ? bundlestatus.iscompiling ? "compiling" : bundlestatus.isok ? (hadrecompile ? "outdated" : "OK") : "ERRORS" : "unknown";
  toolbar_assetstatus.textContent = assetsstatus;

  var className = "wh-outputtool__assetstatus-" + assetsstatus.toLowerCase();
  var classNames = toolbar_assetstatus.className.split(" ");
  if (classNames.indexOf(className) < 0)
  {
    classNames = classNames.filter(function(cls)
    {
      return cls.indexOf("wh-outputtool__assetstatus-") != 0;
    });
    classNames.push(className);
    toolbar_assetstatus.className = classNames.join(" ");
  }

  var showfilestatus = filestatus
      ? filestatus.hasfile
            ? filestatus.isdeleted
                  ? "deleted"
                  : filestatus.ispublishing
                        ? "publishing"
                        : filestatus.isok
                              ? (hadrepublish
                                    ? "outdated"
                                    : filestatus.haswarnings
                                          ? "warnings"
                                          : "OK")
                              : "ERRORS"
            : "na"
      : "unknown";
  toolbar_filestatus.textContent = showfilestatus;
  toolbar_filestatus.style.display = filestatus && !filestatus.ispreview ? '' : 'none';
  toolbar_pagerepublishreload.style.display = filestatus && !filestatus.ispreview ? '' : 'none';

  className = "wh-outputtool__filestatus-" + showfilestatus.toLowerCase();
  classNames = toolbar_filestatus.className.split(" ");
  if (classNames.indexOf(className) < 0)
  {
    classNames = classNames.filter(function(cls)
    {
      return cls.indexOf("wh-outputtool__filestatus-") != 0;
    });
    classNames.push(className);
    toolbar_filestatus.className = classNames.join(" ");
  }

  var showresstatus = hadresourcechange ? "modified" : "OK";
  toolbar_resstatus.textContent = showresstatus;
  toolbar_resstatus.style.display = whoutputtoolsdata && whoutputtoolsdata.resources ? '' : 'none';
  toolbar_resstatus.className = "wh-outputtool wh-outputtool__resstatus wh-outputtool__resstatus-" + (hadresourcechange ? "modified" : "ok");

  toolbar_fullsourcemapcheck.disabled = !bundlestatus;
  if (bundlestatus)
    toolbar_fullsourcemapcheck.checked = bundlestatus.fullsourcemap;
}

function onHideToolsClick()
{
  toolbar.parentNode.removeChild(toolbar);
}

///////////////////////////////////////////////////////////////////////////
//
// Init
//
var outputtoolsnode = document.querySelector('#wh-publisher-outputtools');
websocketbase = 'ws' + location.origin.substr(4) + "/.publisher/common/outputtools/";

outputtoolsnode = outputtoolsnode.previousElementSibling;
for(;outputtoolsnode;outputtoolsnode=outputtoolsnode.previousElementSibling)
  if(outputtoolsnode.src && outputtoolsnode.src.match(/ap.js$/))
  {
    bundlecssnode = outputtoolsnode;
    while(bundlecssnode && bundlecssnode.tagName!="LINK")
      bundlecssnode = bundlecssnode.previousElementSibling;

    bundlecssbaselink = bundlecssnode.href;
    var toks = outputtoolsnode.src.split('/');
    bundleid = toks[toks.length-2];
    break;
  }

document.addEventListener("DOMContentLoaded", onDomReady);
window.addEventListener("message", onMessage);

}(); //scope guard
