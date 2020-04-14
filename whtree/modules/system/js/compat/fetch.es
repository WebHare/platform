if(!window.__dompackdeprecated)
  window.__dompackdeprecated=[];
window.__dompackdeprecated.push("@mod-system/js/compat/fetch");

/* Fetch polyfill from https://github.com/github/fetch/blob/master/fetch.js
   Usage:  require('@mod-system/js/compat/fetch')

   Doc: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
*/
require('whatwg-fetch');
module.exports=fetch;
