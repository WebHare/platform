/* Identify devices for the purpose of analytics/tracing
   NOT a library for feature detection!
   Originally based on Mootools.Browser
*/

type Platform = "windows" | "ios" | "webos" | "android" | "linux" | "mac" | "other";
type Device = "desktop" | "mobile" | "tablet" | "";

export type UserAgentInfo =
  {
    /** Browser name, eg 'chrome' or 'firefox' */
    name: string;
    /** Browser numeric version (eg 97) */
    version: number;
    /** Platform the browser is running on (eg 'windows') */
    platform: Platform;
    /** Type of device (eg 'desktop' or 'tablet' for an iPad) */
    device: Device;
    /** platform-browsername-version eg ios-safari-11 */
    triplet: string;
  };

export function parseUserAgent(ua: string): UserAgentInfo {
  ua = ua.toLowerCase();

  // chrome is included in the edge UA, so need to check for edge first, before checking if it's chrome.
  // safari is included in the miuibrowser UA, so need to check for miuibrowser first, before checking if it's safari.
  let UA: RegExpMatchArray | null = ua.match(/(edge|miuibrowser)[\s/:]([\w\d.]+)/);
  if (!UA)
    UA = ua.match(/(opera|ie|firefox|chrome|trident|crios|version)[\s/:]([\w\d.]+)?.*?(safari|(?:rv[\s/:]|version[\s/:])([\w\d.]+)|$)/);
  if (!UA) { //try ios 11.4.1
    UA = ua.match(/; cpu os ([\d]+)/);
    if (UA)
      UA = ['', 'safari', UA[1]];
  }
  if (!UA)
    UA = ['', 'unknown', "0"];

  if (UA[1] === 'trident') {
    UA[1] = 'ie';
    if (UA[4]) UA[2] = UA[4];
  } else if (UA[1] === 'crios') {
    UA[1] = 'chrome';
  }

  let platform = ua.match(/ip(?:ad|od|hone)/) ? 'ios' : (ua.match(/(?:webos|android)/) || ua.match(/mac|win|linux/) || ['other'])[0];
  if (platform === 'win')
    platform = 'windows';

  const name = (UA[1] === 'version') ? UA[3] : UA[1];
  const version = parseInt((UA[1] === 'opera' && UA[4]) ? UA[4] : UA[2]);
  const device = ua.match(/ipad/) ? 'tablet' : ['ios', 'webos', 'android'].includes(platform) ? 'mobile' : ['mac', 'windows', 'linux'].includes(platform) ? 'desktop' : '';

  return {
    name,
    version,
    platform: platform as Platform,
    device,
    triplet: platform + '-' + name + '-' + version
  };
}

//module.exports =
export const browser: Readonly<UserAgentInfo> = Object.freeze(parseUserAgent(globalThis.navigator?.userAgent || ""));
