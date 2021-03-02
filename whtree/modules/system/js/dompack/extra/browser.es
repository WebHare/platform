/* @recommendedimport: import * as browser from 'dompack/extra/browser';

   Identify devices for the purpose of analytics/tracing
   NOT a library for feature detection!

   Based on Mootools.Browser
*/
/* eslint no-useless-escape: off */

export function parseUserAgent(ua)
{
  ua = ua.toLowerCase();

  // chrome is included in the edge UA, so need to check for edge first,
  // before checking if it's chrome.
  var UA = ua.match(/(edge)[\s\/:]([\w\d\.]+)/);
  if (!UA)
    UA = ua.match(/(opera|ie|firefox|chrome|trident|crios|version)[\s\/:]([\w\d\.]+)?.*?(safari|(?:rv[\s\/:]|version[\s\/:])([\w\d\.]+)|$)/);
  if (!UA) //try ios 11.4.1
  {
    UA = ua.match(/; cpu os ([\d]+)/);
    if(UA)
      UA = [null, 'safari', parseInt(UA[1]) ];
  }
  if (!UA)
    UA = [null, 'unknown', 0];

  if (UA[1] == 'trident'){
    UA[1] = 'ie';
    if (UA[4]) UA[2] = UA[4];
  } else if (UA[1] == 'crios'){
    UA[1] = 'chrome';
  }

  let platform = ua.match(/ip(?:ad|od|hone)/) ? 'ios' : (ua.match(/(?:webos|android)/) || ua.match(/mac|win|linux/) || ['other'])[0];
  if (platform == 'win') platform = 'windows';

  let ret = { name: (UA[1] == 'version') ? UA[3] : UA[1],
              version: parseInt((UA[1] == 'opera' && UA[4]) ? UA[4] : UA[2]),
              platform: platform,
              device: ua.match(/ipad/) ? 'tablet' : [ 'ios', 'webos', 'android' ].includes(platform) ? 'mobile' : [ 'mac', 'windows', 'linux' ].includes(platform) ? 'desktop' : ''
            };
  if (ret.name == 'ie' && !ret.version && document.documentMode)
    ret.version = document.documentMode;

  return ret;
}

//module.exports =
let browser = parseUserAgent(navigator.userAgent);

export function getName()
{
  return browser.name;
}
export function getVersion()
{
  return browser.version;
}
export function getPlatform()
{
  return browser.platform;
}
export function getDevice()
{
  return browser.device;
}
export function getTriplet()
{
  return browser.platform + '-' + browser.name + '-' + browser.version;
}
