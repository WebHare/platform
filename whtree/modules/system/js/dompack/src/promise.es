// Workaround babel error that 'Promise.defer = ' isn't converted to the Babel promise type
let PromiseType = Promise;
if(!PromiseType.prototype.finally)
{
  /** Finally function for promises (executes callback without parameters, waits on returned thenables, then fulfills with
      original result
  */
  PromiseType.prototype.finally = function(callback)
  {
    // From https://github.com/domenic/promises-unwrapping/issues/18
    var constructor = this.constructor;
    return this.then(
      function(value) { return constructor.resolve(callback()).then(function() { return value; }); },
      function(reason) { return constructor.resolve(callback()).then(function() { throw reason; }); });
  };
}

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
