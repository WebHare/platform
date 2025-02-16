import { getAssetPackBase } from "@mod-platform/js/concepts/frontend"; //TODO should probably move here in WH5.7 but too much for a backport
import { encodeString } from "@webhare/std";

export function encodeAttr(s: string): string {
  return encodeString(s, "attribute");
}

export function getAssetPackIntegrationCode(assetpack: string, { designRoot = '', cacheBuster = '' } = {}) {
  let scriptsettings = '';
  if (designRoot !== "")
    scriptsettings += ' crossorigin="anonymous"';
  scriptsettings += ' async type="module"';

  let bundleBaseUrl = getAssetPackBase(assetpack);
  if (cacheBuster)
    bundleBaseUrl = "/!" + encodeURIComponent(cacheBuster) + bundleBaseUrl;
  if (designRoot)
    bundleBaseUrl = new URL(designRoot, bundleBaseUrl).toString();

  return `<link rel="stylesheet" href="${encodeAttr(bundleBaseUrl)}ap.css">`
    + `<script src="${encodeAttr(bundleBaseUrl)}ap.mjs"${scriptsettings}></script>`;
}
