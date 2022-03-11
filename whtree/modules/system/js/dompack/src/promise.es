/** Create a promise together with resolve & reject functions
    @return
    @cell return.promise
    @cell return.resolve
    @cell return.reject
*/
export function createDeferred()
{
  var deferred =
    { promise: null
    , resolve: null
    , reject: null
    };

  deferred.promise = new Promise(function(resolve, reject) { deferred.resolve = resolve; deferred.reject = reject; });
  return deferred;
}
