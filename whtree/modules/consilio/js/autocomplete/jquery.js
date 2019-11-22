/** Provides an autocomplete handler compatible with jQuery */

var searchrpc = require('@mod-consilio/js/internal/search.rpc.json');

/* ADDMEs:
   - enrich missing options from WHBase consilio settings
   - when more adapters appear, share code and structure (options etc)
   */
function getSuggestSource(options)
{
  if(!options)
    options={};
  if(!options.catalog)
    throw new Error("No catalog specified");

  // http://api.jqueryui.com/autocomplete/#option-source
  return function (request, callback)
         {
           searchrpc.suggest({ type: "catalog"
                             , catalog: options.catalog
                             }, request.term,
                             { doccount: ""
                             , count: options.count || 10
                             // ADDME restricturl ? does that even work with suggest ?
                             }
                             ).then(
           function(data)
           {
             //returning a flat array
             callback(data.values.map(function(item) { return item.value; }));
           }).catch(
           function()
           {
             callback();
           });
         };
}

module.exports = { getSuggestSource: getSuggestSource };
