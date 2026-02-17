/* We load the full devtools package (and also give a 'quick' place to add control of the exact loading) *iff* outputtools.js
  isn't in our way. (which should only happen if code explicitly includes it, or WebHare isn't uptodate yet)
*/
function tellBootstrap(assetpack) {
  console.error(`Unable to load assetpack '${assetpack}' - check https://my.webhare.dev/?app=system:dashboard(publisher%3Aassetpackcontrol)`);
}
function loadAssetPackage(assetpack) {
  const name = assetpack.replace(":", ".");
  const script = document.createElement("script");
  script.src = new URL(`/.wh/ea/ap/${name}/ap.mjs`, import.meta.url).toString();
  script.type = "module";

  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = new URL(`/.wh/ea/ap/${name}/ap.css`, import.meta.url).toString();

  // console.log("[dev/debugjs] activating, chainloading devtools.es");
  script.onload = function() {
    setTimeout(function() {
      if (!window.__loadedDevTools.has(assetpack))
        tellBootstrap(assetpack);
    }, 3000); //if it hasn't finished loading in 3 seconds, it's probably corrupt
  };
  script.onerror = () => tellBootstrap(assetpack);

  document.querySelector("head").append(script, css);
  return script;
}

function debugLoader() {
  window.__loadedDevTools = new Set;
  loadAssetPackage("devkit:devtools");
  if (document.querySelector(`script[src$="/.wh/ea/ap/tollium.webinterface/ap.mjs"]`) || document.querySelector(`script[src$="/.wh/ea/ap/platform.tollium/ap.mjs"]`))
    loadAssetPackage("devkit:tolliumtools");
}

debugLoader();
