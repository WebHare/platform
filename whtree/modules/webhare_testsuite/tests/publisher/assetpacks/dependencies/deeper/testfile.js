/* this verifies an issue we found with the object-inspect polyfill which attempts to block util.inspect from loading in
   the browser using package.jsno. unfortunately this also causes esbuild to trigger a load against 'util.inspect',
   not 'util.inspect.js', cconfusing our dependency analysis. reported as https://github.com/evanw/esbuild/issues/3459 */
require('./util.inspect');
