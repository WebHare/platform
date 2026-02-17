const warned: string[] = [];

function scanPublisherForm(form: HTMLFormElement) {
  if (!form.propWhFormhandler && !form.action.startsWith('http') && form.dataset.whFormHandler) //suspect..
    console.error(`No RPC handler registered for this form - setup a handler for '${form.dataset.whFormHandler}'`, form);
}

function scanWRDLoginForm(form: HTMLFormElement) {
  if (form.classList.contains('whplugin-wrdauth-loginform'))
    console.warn("Post WebHare 4.17, replace whplugin-wrdauth-loginform with the wh-wrdauth__loginform class");

  if (form.method.toUpperCase() !== 'POST')
    console.error("WRDAuth Login forms must use POST to prevent credentials ever appearing on the URL", form); //eg. if the click isn't intercepted

  const login = form.elements.namedItem('login');
  const password = form.elements.namedItem('password');
  if (!login)
    console.error("Missing input[name=login] in WRDAuth login form", form);
  else if (!['text', 'email'].includes((login as HTMLInputElement).type))
    console.error("input[name=login] should be of type 'text' or 'email'", form);

  if (!password)
    console.error("Missing input[name=password] in WRDAuth password form", form);
  else if ((password as HTMLInputElement).type !== 'password')
    console.error("input[name=password] MUST be of type 'password'", form);
}

type WRDAuthPlugin = HTMLElement & { whplugin_processed?: boolean };

function scanPlugins() {
  Array.from(document.querySelectorAll("*[class^=wh-wrdauth__loginform]")).forEach(node => {
    if (!(node as WRDAuthPlugin).whplugin_processed && !node.hasAttribute("data-wh-wrdauth-attached"))
      errorOnce("wrdjsapi", "You may need to import the WRD JS Api, see https://www.webhare.dev/reference-next/wrdauth/");
  });

  const nodes = document.querySelectorAll("*");
  for (let i = 0; i < nodes.length; ++i) {
    const node = nodes[i];
    if ((node as WRDAuthPlugin).whplugin_processed)
      continue;

    if (!node.classList)
      continue;
    let pluginclass = '';
    for (let j = 0; j < node.classList.length; ++j)
      if (node.classList[j].substr(0, 9) === 'whplugin-')
        pluginclass = node.classList[j];
    if (!pluginclass)
      continue; //no class starting with whplugin-

    console.error("Node has plugin class '" + pluginclass + "' but was not processed by any loaded JS library", node);
    //well known classes
    const type = pluginclass.split('-')[1];
    if (type === "newsletter")
      console.log('Your siteprofile probably needs a <newsletterintegration xmlns="http://www.webhare.net/xmlns/newsletter" accounttag="..." /> node');
  }
}

function errorOnce(tag: string, ...msg: unknown[]) {
  if (warned.includes(tag))
    return;

  warned.push(tag);
  console.error(...msg);
}

function checkDataLayer() {
  if (!window.dataLayer)
    errorOnce("datalayer", "GTM features used but window.dataLayer not present - did you setup GTM integration?");
}

function checkGTMSubmit(form: HTMLFormElement) {
  checkDataLayer();
  if (!("__gtmformsubmit" in window))
    errorOnce("gtmsubmit", "gtm-data-submit enabled on form but @mod-publisher/js/analytics/gtm not loaded");
}

function checkForm(form: HTMLFormElement) {
  if (form.dataset.whFormId)
    scanPublisherForm(form);
  if (form.classList.contains('wh-wrdauth__loginform') || form.classList.contains('whplugin-wrdauth-loginform'))
    scanWRDLoginForm(form);
  if (form.dataset.gtmSubmit)
    checkGTMSubmit(form);
}

export function scanCommonErrors() {
  const whconfigel = typeof document !== "undefined" ? document.querySelector('script#wh-config') : null;
  if (whconfigel) {
    const whconfig = JSON.parse(whconfigel.textContent!);
    if (whconfig["socialite:gtm"] && !window.dataLayer)
      errorOnce("datalayer", "<gtm> plugin has been configured for assetpacks or selfhosting, but @mod-publisher/js/analytics/gtm is not loaded");
    if (whconfig["ga4"] && !("gtag" in window))
      errorOnce("ga4", "<googleanalytics4> plugin has been configured but @mod-publisher/js/analytics/ga4 is not loaded");
  }

  scanPlugins();
  Array.from(document.querySelectorAll('form')).forEach(form => checkForm(form));
}

if (document.readyState === "complete")
  setTimeout(scanCommonErrors, 100);
else //give all async JS scripts a chance to complete loading
  window.addEventListener("load", () => setTimeout(scanCommonErrors, 100));
