//DO NOT IMPORT: we don't want to be responsible for a dep injection causing a failure on live!

let warned = [];

function scanPublisherForm(form)
{
  if(!form.propWhFormhandler && !form.action.startsWith('http')) //suspect..
    console.error("No RPC handler registered for this form!",form);
}

function scanWRDLoginForm(form)
{
  if(form.classList.contains('whplugin-wrdauth-loginform'))
    console.warn("Post WebHare 4.17, replace whplugin-wrdauth-loginform with the wh-wrdauth__loginform class");

  if(form.method.toUpperCase()!='POST')
    console.error("WRDAuth Login forms must use POST to prevent credentials ever appearing on the URL", form); //eg. if the click isn't intercepted
  if(!form.elements.login)
    console.error("Missing input[name=login] in WRDAuth login form",form);
  else if(!['text','email'].includes(form.elements.login.type))
    console.error("input[name=login] should be of type 'text' or 'email'",form);

  if(!form.elements.password)
    console.error("Missing input[name=password] in WRDAuth password form",form);
  else if(form.elements.password.type != 'password')
    console.error("input[name=password] MUST be of type 'password'",form);
}

function scanPlugins()
{
  Array.from(document.querySelectorAll("*[class^=wh-wrdauth__loginform]")).forEach(node =>
  {
    if(!node.whplugin_processed)
      errorOnce("wrdjsapi", "You may need to import the WRD JS Api, see https://code.webhare.com/wrd/wrdauth/jsapi/");
  });

  var nodes=document.querySelectorAll("*");
  for(var i=0;i<nodes.length;++i)
  {
    var node=nodes[i];
    if(node.whplugin_processed)
      continue;

    if(!node.classList)
      continue;
    var pluginclass = '';
    for (var j=0;j<node.classList.length;++j)
      if(node.classList[j].substr(0,9) == 'whplugin-')
        pluginclass = node.classList[j];
    if(!pluginclass)
      continue; //no class starting with whplugin-

    console.error("Node has plugin class '" + pluginclass + "' but was not processed by any loaded JS library", node);
    //well known classes
    var type = pluginclass.split('-')[1];
    if(type=="newsletter")
      console.log('Your siteprofile probably needs a <newsletterintegration xmlns="http://www.webhare.net/xmlns/newsletter" accounttag="..." /> node');
  }
}

function errorOnce(tag, ...msg)
{
  if(warned.includes(tag))
    return;

  warned.push(tag);
  console.error(...msg);
}

function checkDataLayer()
{
  if(!window.dataLayer)
    errorOnce("datalayer", "GTM features used but window.dataLayer not present - did you setup GTM integration?");
}

function checkGTMSubmit(form)
{
  checkDataLayer();
  if(!window.__gtmformsubmit)
    errorOnce("gtmsubmit", "gtm-data-submit enabled on form but @mod-publisher/js/analytics/gtm not loaded");
}

function checkForm(form)
{
  if(form.dataset.whFormId)
    scanPublisherForm(form);
  if(form.classList.contains('wh-wrdauth__loginform') || form.classList.contains('whplugin-wrdauth-loginform'))
    scanWRDLoginForm(form);
  if(form.dataset.gtmSubmit)
    checkGTMSubmit(form);
}

export function scanCommonErrors()
{
  let whconfigel = typeof document != "undefined" ? document.querySelector('script#wh-config') : null;
  if(whconfigel)
  {
    let whconfig = JSON.parse(whconfigel.textContent);
    if(whconfig["socialite:gtm"] && !window.dataLayer)
      errorOnce("datalayer", "<gtm> plugin has been configured for assetpacks or selfhosting, but @mod-publisher/js/analytics/gtm is not loaded");
    if(whconfig["ga4"] && !window.gtag)
      errorOnce("ga4", "<googleanalytics4> plugin has been configured but @mod-publisher/js/analytics/ga4 is not loaded");
  }

  scanPlugins();
  Array.from(document.querySelectorAll('form')).forEach(form => checkForm(form));

  if(window.__dompackdeprecated)
    console.warn("Loading " + window.__dompackdeprecated.length + " deprecated dompack library:",window.__dompackdeprecated);
}
