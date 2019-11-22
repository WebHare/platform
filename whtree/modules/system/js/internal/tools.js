"use strict";

function readAllofStdin()
{
  process.stdin.setEncoding('utf8');
  return new Promise(function(resolve,reject)
  {
    var datasofar = '';

    process.stdin.on('readable', function() {
      var chunk = process.stdin.read();
      if (chunk !== null) {
        datasofar += chunk;
      }
    });

    process.stdin.on('end', function() {
      resolve(datasofar);
    });
  });
}

function createDeferred()
{
  var deferred =
    { promise: null
    , resolve: null
    , reject: null
    };

  deferred.promise = new Promise(function(resolve, reject) { deferred.resolve = resolve; deferred.reject = reject; });
  return deferred;
}

exports.readAllofStdin = readAllofStdin;
exports.createDeferred = createDeferred;
