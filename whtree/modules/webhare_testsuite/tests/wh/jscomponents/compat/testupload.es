import * as compatupload from '@mod-system/js/compat/upload';
import * as test from '@mod-tollium/js/testframework';
import JSONRPC from '@mod-system/js/net/jsonrpc';

var group;
var requestresult;

test.registerTests(
  [ { loadpage: '/tollium_todd.res/webhare_testsuite/designfiles/net/upload/upload.shtml'
    }

  , { name: 'testupload'
    , wait: function(doc,win,callback)
      {
        test.false(!window.Blob);

        // Create a blob
        var blob1 = new Blob([ '1234'  ], { type: "text/plain" });
        var blob2 = new Blob([ '23456'  ], { type: "" });

        // Just add some names to emulate file
        blob1.name = 'file1.txt';
        blob2.name = 'file2.txt';

        group = win.test.runUpload([ blob1, blob2 ], callback);

        var items = group.getItems();
        test.eq(2, items.length);
        test.eq('text/plain', items[0].type);
        test.eq(4, items[0].size);
        test.eq('', items[1].type);
        test.eq(5, items[1].size);
      }
    }

  , { name: 'testupload_checkresult'
    , wait: function(doc,win,callback)
      {
        test.eq('loaded', group.status);
        test.eq('loaded', group.getItems()[0].status);
        test.eq('loaded', group.getItems()[1].status);

        let rpc = new JSONRPC(
            { url: "/wh_services/webhare_testsuite/testnoauth/"
            , appendfunctionname: true
            });

        rpc.request(
            'GetWebserverUploadedFiles',
            [ group.getFileTokens() ],
            function(result) { console.log('ok', result); requestresult = result; callback(); },
            function(result) { console.log('fail', result); callback(); });
      }
    }

  , { name: 'testupload_checkuploadedfiles'
    , test: function(doc,win)
      {
        test.eq(
            [ { contenttype: "text/plain"
              , data: "7110EDA4D09E062AA5E4A390B0A572AC0D2C0220"
              , filename: "file1.txt"
              }
            , { contenttype: "text/plain"
              , data: "C24D0A1968E339C3786751AB16411C2C24CE8A2E"
              , filename: "file2.txt"
              }
            ], requestresult);
      }
    }

  , { name: 'testmegafile'
    , wait: function(doc,win,callback)
      {
        test.false(!window.Blob);

        // Make 2 strings 64MB in length
        var megafile_1 = '12345678';
        var megafile_2 = '87654321';
        for (var i = 0; i < 26-4; ++i)
        {
          megafile_1 += megafile_1;
          megafile_2 += megafile_2;
        }

        // Create a blob
        var blob1 = new Blob([ megafile_1 ]);
        var blob2 = new Blob([ megafile_2 ]);

        // Just add some names to emulate file
        blob1.name = 'file1.txt';
        blob2.name = 'file2.txt';

        group = win.test.runUpload([ blob1, blob2 ], callback);

        var items = group.getItems();
        test.eq(2, items.length);
        test.eq(megafile_1.length, items[0].size);
        test.eq(megafile_2.length, items[1].size);
      }
    }

  , { name: 'testmegafile_checkresult'
    , wait: function(doc,win,callback)
      {
        test.eq('loaded', group.status);
        test.eq('loaded', group.getItems()[0].status);
        test.eq('loaded', group.getItems()[1].status);

        let rpc = new JSONRPC(
            { url: "/wh_services/webhare_testsuite/testnoauth/"
            , appendfunctionname: true
            });

        rpc.request(
            'GetWebserverUploadedFiles',
            [ group.getFileTokens() ],
            function(result) { console.log('ok', result); requestresult = result; callback(); },
            function(result) { console.log('fail', result); callback(); });
      }
    }

  , { name: 'testmegafile_checkuploadedfiles'
    , test: function(doc,win)
      {
        test.eq(
            [ { contenttype: "text/plain"
              , data: '1B656360F31543C2865AF0EC1ABBB1589091E481'
              , filename: "file1.txt"
              }
            , { contenttype: "text/plain"
              , data: '9EDCB693038A5FEF733730ABB8BCD1542DF75276'
              , filename: "file2.txt"
              }
            ], requestresult);
      }
    }

  , { name: 'testSelectAndUpload'
    , test: async function(doc, win)
      {
        prepareUploadTest(test.qS('#myinput'),[ { url: '/tests/webhare.png'
                                             , filename: 'webhare.png'
                                             } ]);

        let uploadfiles = await compatupload.selectFiles();
        let group = new compatupload.UploadSession(uploadfiles);

        requestresult =
        { events: []
        , group: group
        , finishevent: null
        };

        group.addEventListener("wh:upload-start",   function() { requestresult.events.push('loadstart'); });
        group.addEventListener("wh:upload-end",     function() { requestresult.events.push('loadend'); });

        let files = await group.upload();

        test.eq([ 'loadstart', 'loadend' ], requestresult.events);

        test.eq(1, files.length);
        test.eq('webhare.png', files[0].name);
        test.eq(4355, files[0].size);
        test.eq('image/png', files[0].type);
      }
    }

  ]);
