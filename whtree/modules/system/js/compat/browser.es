import * as whintegration from '@mod-system/js/wh/integration';
if(!whintegration.config.islive)
{
  console.warn("compat/browser is unmaintained and has been deprecated");
}


/*
  Adapted from MooTools Browser, which is MIT-style licensed.
  See: https://github.com/mootools/mootools-core/blob/master/Source/Browser/Browser.js

  - Converted into standalone library by making it CommonJS-compatible
  - Removed MooTools dependencies Object.extend and Function.attempt
  - Removed MooTools-specifc String.stripScripts, window.Document, window.Window, window.Element and window.Event
  - Removed IE9-specific code and Browser.Platform.ipod
  - Added 'legacy' compatibility stuff (MooTools 1.4/1.5 compatibility)
*/

var parse = function(ua, platform){
  ua = ua.toLowerCase();
  platform = (platform ? platform.toLowerCase() : '');

  // chrome is included in the edge UA, so need to check for edge first,
  // before checking if it's chrome.
  var UA = ua.match(/(edge)[\s\/:]([\w\d\.]+)/);
  if (!UA){
    UA = ua.match(/(opera|ie|firefox|chrome|trident|crios|version)[\s\/:]([\w\d\.]+)?.*?(safari|(?:rv[\s\/:]|version[\s\/:])([\w\d\.]+)|$)/) || [null, 'unknown', 0];
  }

  if (UA[1] == 'trident'){
    UA[1] = 'ie';
    if (UA[4]) UA[2] = UA[4];
  } else if (UA[1] == 'crios'){
    UA[1] = 'chrome';
  }

  platform = ua.match(/ip(?:ad|od|hone)/) ? 'ios' : (ua.match(/(?:webos|android)/) || ua.match(/mac|win|linux/) || ['other'])[0];
  if (platform == 'win') platform = 'windows';

  return {
    name: (UA[1] == 'version') ? UA[3] : UA[1],
    version: parseFloat((UA[1] == 'opera' && UA[4]) ? UA[4] : UA[2]),
    platform: platform
  };
};

var Browser = parse(navigator.userAgent, navigator.platform);

if (Browser.name == 'ie' && document.documentMode){
  Browser.version = document.documentMode;
}

Browser.Features = {
  xpath: !!(document.evaluate),
  air: !!(window.runtime),
  query: !!(document.querySelector),
  json: !!(window.JSON)
};
Browser.parseUA = parse;

Browser[Browser.name] = true;
Browser[Browser.name + parseInt(Browser.version, 10)] = true;

if (Browser.name == 'ie' && Browser.version >= '11'){
  delete Browser.ie;
}

var platform = Browser.platform;
if (platform == 'windows'){
  platform = 'win';
}
Browser.Platform = {
  name: platform
};
Browser.Platform[platform] = true;

// Request

Browser.Request = (function(){
  return new XMLHttpRequest();
})();

Browser.Features.xhr = !!(Browser.Request);

Browser.exec = function(text){
  if (!text) return text;
  if (window.execScript){
    window.execScript(text);
  } else {
    var script = document.createElement('script');
    script.setAttribute('type', 'text/javascript');
    script.text = text;
    document.head.appendChild(script);
    document.head.removeChild(script);
  }
  return text;
};

document.html = document.documentElement;
if (!document.head) document.head = document.getElementsByTagName('head')[0];

Browser.Engine = {};

var setEngine = function(name, version){
  Browser.Engine.name = name;
  Browser.Engine[name + version] = true;
  Browser.Engine.version = version;
};

if (Browser.ie){
  Browser.Engine.trident = true;

  switch (Browser.version){
    case 6: setEngine('trident', 4); break;
    case 7: setEngine('trident', 5); break;
    case 8: setEngine('trident', 6);
  }
}

if (Browser.firefox){
  Browser.Engine.gecko = true;

  if (Browser.version >= 3) setEngine('gecko', 19);
  else setEngine('gecko', 18);
}

if (Browser.safari || Browser.chrome){
  Browser.Engine.webkit = true;

  switch (Browser.version){
    case 2: setEngine('webkit', 419); break;
    case 3: setEngine('webkit', 420); break;
    case 4: setEngine('webkit', 525);
  }
}

if (Browser.opera){
  Browser.Engine.presto = true;

  if (Browser.version >= 9.6) setEngine('presto', 960);
  else if (Browser.version >= 9.5) setEngine('presto', 950);
  else setEngine('presto', 925);
}

if (Browser.name == 'unknown'){
  switch ((navigator.userAgent.toLowerCase().match(/(?:webkit|khtml|gecko)/) || [])[0]){
    case 'webkit':
    case 'khtml':
      Browser.Engine.webkit = true;
      break;
    case 'gecko':
      Browser.Engine.gecko = true;
  }
}

// Legacy compatibility
if(typeof Browser.platform == "undefined") //mootools 1.4
{
  // Quick fix for MooTools not recognizing IE11, probably fixed in MooTools 1.5
  if (Browser.name === "unknown")
  {
    if (navigator.userAgent.toLowerCase().indexOf('trident/7.0') > -1) {
      Browser.name = 'ie';
      Browser.version = '11';

      Browser[Browser.name] = true;
      Browser[Browser.name + parseInt(Browser.version, 10)] = true;
    }
  }

  Browser.platform = Browser.Platform.name;
}
if(typeof Browser.Platform == "undefined") //moo 1.5
{
  if(! (Browser.name == "ie" && parseInt(Browser.version) >= 11) ) //do not set 'Browser.ie' on IE11, as mootools 1.5 doesn't do that either, not even in compat mode
    Browser[Browser.name] = true;
  Browser[Browser.name + parseInt(Browser.version, 10)] = true;

  Browser.Platform = {};
  Browser.Platform[Browser.platform] = true;
}

export default Browser;
