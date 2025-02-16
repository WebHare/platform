import { encodeString } from "@webhare/std";

export function encodeAttr(s: string): string {
  return encodeString(s, "attribute");
}

export function getAssetPackIntegrationCode(assetpack: string, { designRoot = '', cacheBuster = '' } = {}) {
  let scriptsettings = '';
  if (designRoot !== "")
    scriptsettings += ' crossorigin="anonymous"';
  scriptsettings += ' async type="module"';

  let bundleBaseUrl = "/.wh/ea/ap/" + assetpack.replace(":", ".") + "/";
  if (cacheBuster)
    bundleBaseUrl = "/!" + encodeURIComponent(cacheBuster) + bundleBaseUrl;
  if (designRoot)
    bundleBaseUrl = new URL(designRoot, bundleBaseUrl).toString();

  return `<link rel="stylesheet" href="${encodeAttr(bundleBaseUrl)}ap.css">`
    + `<script src="${encodeAttr(bundleBaseUrl)}ap.mjs"${scriptsettings}></script>`;
}
