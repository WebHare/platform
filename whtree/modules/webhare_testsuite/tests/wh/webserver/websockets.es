import * as test from '@mod-tollium/js/testframework';
import { createDeferred } from "dompack";

var socket;

var deferrederrorpromise;

function expectMessage(expect)
{
  var deferred = createDeferred();
  var func = function(event)
    {
      socket.removeEventListener('message', func);
      if (event.data != expect)
      {
        try
        {
          throw new Error('wrong data!, got: ' + event.data + ', wanted: '+ expect);
        }
        catch (e)
        {
          deferred.reject(e);
          throw e;
        }
      }
      deferred.resolve();
    };

  socket.addEventListener('message', func);
  return Promise.race([ deferred.promise, deferrederrorpromise.promise ]);
}

function getTestString(len)
{
  var s = '';
  while (s.length < len)
    s += s.length;
  return s.substr(0, len);
}

test.registerTests(
  [ { name: 'init'
    , xfail: !window.WebSocket
    , test: function(doc, win)
      {
        var url = new URL("/tollium_todd.res/webhare_testsuite/tests/websockets/echo.whsock", location.href);
        url.protocol = url.protocol == 'https:' ? 'wss:' : 'ws:';
        socket = new WebSocket(url.toString());

        deferrederrorpromise = createDeferred();
        socket.addEventListener('error', function() { deferrederrorpromise.reject(); deferrederrorpromise = createDeferred(); });

        var deferred = createDeferred();
        socket.addEventListener('open', deferred.resolve);
        return Promise.race([ deferred.promise, deferrederrorpromise.promise ]);
      }
    }
  , { name: '0'
    , xfail: !window.WebSocket
    , test: function(doc, win)
      {
        var str = getTestString(0);
        socket.send(str);
        return expectMessage('Echo: '+str);
      }
    }
  , { name: '126-7'
    , xfail: !window.WebSocket
    , test: function(doc, win)
      {
        var str = getTestString(126-7);
        socket.send(str);
        return expectMessage('Echo: '+str);
      }
    }
  , { name: '126-6'
    , xfail: !window.WebSocket
    , test: function(doc, win)
      {
        var str = getTestString(126-6);
        socket.send(str);
        return expectMessage('Echo: '+str);
      }
    }
  , { name: '126-5'
    , xfail: !window.WebSocket
    , test: function(doc, win)
      {
        var str = getTestString(126-5);
        socket.send(str);
        return expectMessage('Echo: '+str);
      }
    }
  , { name: '126-1'
    , test: function(doc, win)
      {
        var str = getTestString(126-1);
        socket.send(str);
        return expectMessage('Echo: '+str);
      }
    }
  , { name: '126'
    , xfail: !window.WebSocket
    , test: function(doc, win)
      {
        var str = getTestString(126-0);
        socket.send(str);
        return expectMessage('Echo: '+str);
      }
    }
  , { name: '64KB - 7'
    , xfail: !window.WebSocket
    , test: function(doc, win)
      {
        var str = getTestString(65536-7);
        socket.send(str);
        return expectMessage('Echo: '+str);
      }
    }
  , { name: '64KB - 6'
    , xfail: !window.WebSocket
    , test: function(doc, win)
      {
        var str = getTestString(65536-6);
        socket.send(str);
        return expectMessage('Echo: '+str);
      }
    }
  , { name: '64KB - 5'
    , xfail: !window.WebSocket
    , test: function(doc, win)
      {
        var str = getTestString(65536-5);
        socket.send(str);
        return expectMessage('Echo: '+str);
      }
    }
  , { name: '64KB - 1'
    , xfail: !window.WebSocket
    , test: function(doc, win)
      {
        var str = getTestString(65536-1);
        socket.send(str);
        return expectMessage('Echo: '+str);
      }
    }
  , { name: '64KB'
    , xfail: !window.WebSocket
    , test: function(doc, win)
      {
        var str = getTestString(65536-0);
        socket.send(str);
        return expectMessage('Echo: '+str);
      }
    }
  , { name: '64KB + 1'
    , xfail: !window.WebSocket
    , test: function(doc, win)
      {
        var str = getTestString(65536+1);
        socket.send(str);
        return expectMessage('Echo: '+str);
      }
    }
  , { name: '128KB'
    , xfail: !window.WebSocket
    , test: function(doc, win)
      {
        var str = getTestString(65536*2);
        socket.send(str);
        return expectMessage('Echo: '+str);
      }
    }
  , { name: '256KB'
    , xfail: !window.WebSocket
    , test: function(doc, win)
      {
        var str = getTestString(65536*4);
        socket.send(str);
        return expectMessage('Echo: '+str);
      }
    }
  , { name: '512KB'
    , xfail: !window.WebSocket
    , test: function(doc, win)
      {
        var str = getTestString(65536*8);
        socket.send(str);
        return expectMessage('Echo: '+str);
      }
    }
  , { name: '1MB'
    , xfail: !window.WebSocket
    , test: function(doc, win)
      {
        var str = getTestString(65536*16);
        socket.send(str);
        return expectMessage('Echo: '+str);
      }
    }
  ]);
