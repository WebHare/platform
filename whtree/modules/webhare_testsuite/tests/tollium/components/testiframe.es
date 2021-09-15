import * as test from "@mod-tollium/js/testframework";
import * as preload from 'dompack/extra/preload';


function iframeAddEventOnce(node, eventname, callback)
{
  var regfunc;
  regfunc = function(event)
    {
      if (node.removeEventListener)
        node.removeEventListener(eventname, regfunc);
      else
        node.detachEvent('on'+eventname, regfunc);
      return callback.apply(this, arguments);
    };

  if (node.addEventListener)
    node.addEventListener(eventname, regfunc);
  else
    node.attachEvent('on' + eventname, regfunc);
}

var lasttextareavalue = '';

test.registerTests(
  [ { loadpage: test.getTestScreen('tests/basecomponents.iframetest')
    , waits: [ 'ui' ]
    }

  , { name: 'iframeloadwait'
    , test: function(doc,win)
      {
        lasttextareavalue = test.qSA('textarea')[0].value;
        //var iframe = test.qSA('iframe')[0];
        test.click(test.getMenu(['I00']));
      }
    , waits: [ function() { return test.qSA('textarea')[0].value != lasttextareavalue; } ]
    }

  , { name: 'iframeinitialcall'
    , wait: function(doc,win,callback)
      {
        var iframe = test.qSA('iframe')[0];
        var calls = iframe.contentWindow.document.getElementById('calls');
        test.eq('func1 1 test\n', calls.value);

        var textarea = test.qSA('textarea')[0];
        test.eq('{"args":[1,"test"],"type":"receivedcall"}', textarea.value.trim());

        test.click(test.getMenu(['I04']));
        iframeAddEventOnce(iframe.contentWindow, 'message', function(){console.error("GOT MESSAGE"); callback(); });
      }
    , waits: [ 'ui' ]
    }

  , { name: 'serverdataupdate'
    , test: function(doc, win)//, callback)
      {
        var iframe = test.qSA('iframe')[0];
        var data = iframe.contentWindow.document.getElementById('data');
        test.eq('datab', data.value);
        //win.addEvent('message:once', callback);

        // execute 'add a' action
        iframe.contentWindow.document.getElementById('adda').click();
        test.eq('databa', data.value); //this simply tests if the iframe processed its click correctly
        console.log('should start ui wait');
      }
    , waits: [ 100, 'ui' ] //100msec as we have no good wait to 'wait' for the postmessage. a less racy alternative would continously press I04 and see if the data is there yet
    }

  , { name: 'clientdataupdate_prepare'
    , wait: function(doc, win, callback)
      {
        var iframe = test.qSA('iframe')[0];

        // Add 'b' to iframe data
        test.click(test.getMenu(['I04']));
        iframeAddEventOnce(iframe.contentWindow, 'message', callback);
      }
    , waits: [ 'ui' ]
    }

  , { name: 'clientdataupdate'
    , test: function(doc, win)
      {
        var iframe = test.qSA('iframe')[0];
        var data = iframe.contentWindow.document.getElementById('data');
        test.eq('databab', data.value);

        // SetHTMLContent
        test.click(test.getMenu(['I01']));
      }
    , waits: [ 'ui' , (doc,win) =>
        {
          var iframe = test.qSA('iframe')[0];
          let source = iframe.contentWindow.document.getElementById('source');
          return source && 'htmlcontent2' == source.dataset.source;
        }
      ]
    }

  , { name: 'iframehtmlcontent'
    , test: async function(doc,win)
      {
        var iframe = test.qSA('iframe')[0];

        // Test html content
        test.eq('htmlcontent2', iframe.contentWindow.document.getElementById('source').dataset.source);
        let imgpreload = await preload.promiseImage(iframe.contentWindow.document.getElementById('image').src);
        test.eq(428, imgpreload.width);

        // Do a JS call outside of loading stage
        test.click(test.getMenu(['I03']));
      }
    , waits: [ 100, 'ui' ]
    }

  , { name: 'normalcall'
    , test: function(doc,win)
      {
        // Test if call was handled properly
        var textarea = test.qSA('textarea')[0];
        test.eq('{"args":[1,"test"],"type":"receivedcall"}\n' +
               'data:data\n' +
               'data:databa\n' +
               '{"args":[3,"test"],"type":"receivedcall"}', textarea.value.trim());
      }
    }

  , "iframe blobcontent"
  , async function()
    {
      // Next test: go to blob content
      test.click(test.getMenu(['I02']));

      //wait for blobcontent4 to appear
      await test.wait( () => test.qS("iframe").contentWindow.document.getElementById('source')
                             && test.qS("iframe").contentWindow.document.getElementById('source').dataset.source == 'blobcontent4');

      let imgpreload = await preload.promiseImage(test.qS("iframe").contentWindow.document.getElementById('image').src);
      test.eq(428, imgpreload.width);

      //next tes: grab links
      test.click(test.getMenu(['I05']));
      await test.wait('ui');
    }

  , { name: 'clicklink'
    , test: async function(doc,win)
      {
        var iframe = test.qSA('iframe')[0];
        //wait for us to have intercepted the click handler
        await test.wait( () => iframe.contentWindow.whIframeAttached === true);

        var iframdoc = iframe.contentWindow.document;
        iframdoc.getElementById('link').click();
      }
    , waits: [ 'ui' ]
    }

  , { name: 'clicklink verify'
    , test: function(doc,win)
      {
        var textarea = test.qSA('textarea')[0];
        test.eq('{"args":[1,"test"],"type":"receivedcall"}\n' +
               'data:data\n' +
               'data:databa\n' +
               '{"args":[3,"test"],"type":"receivedcall"}\n' +
               'click:http://www.webhare.dev/', textarea.value.trim());
      }
    }

  , { name: 'postmessage'
    , test: async function()
      {
        test.compByName('callbacks').querySelector('textarea').value='';
        test.click(test.getMenu(['I06'])); //postmessage

        let result = await test.wait( () => test.compByName('callbacks').querySelector('textarea').value);
        let origin = test.getWin().location.origin;
        test.eq(`message:{"question":1764}\norigin:${origin}`, result);
      }
    }
  , { name: 'postrequest'
    , test: async function()
      {
        test.compByName('callbacks').querySelector('textarea').value='';
        test.click(test.getMenu(['I07'])); //postrequest

        await test.wait(function() { return !!test.compByName('callbacks').querySelector('textarea').value });

        let result = test.compByName('callbacks').querySelector('textarea').value;
        test.eq(`response:{"response":1764}`, result);
      }
    }

  , { loadpage: test.getTestScreen('tests/basecomponents.iframetestincontents')
    , waits: [ 'ui', function()
      { /*var iframe = test.qSA('iframe')[0]; */
        return !!test.qSA('iframe')[0].contentWindow.document.querySelector('#source, .wh-errorinfo');
      }
      ]
    }
  , { name:"test iframe load when component renamed"
    , test:function(doc,win)
      {
        var iframe = test.qSA('iframe')[0];
        test.eq('htmlcontent1', iframe.contentWindow.document.getElementById('source').dataset.source);
      }
    , xfail: true
    }

  ]);
