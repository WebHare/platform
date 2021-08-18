/*! LOAD: wh.util.jstests, tollium:ui/js/components.js !*/
import * as test from '@mod-tollium/js/testframework';
import $todd from "@mod-tollium/web/ui/js/support";
import { distributeSizes } from '@mod-tollium/web/ui/js/componentbase';


$todd.DebugTypedLog = function()
{
  var args = Array.prototype.slice.call(arguments);
  args.splice(0, 1);
  console.log.apply(console, args);
};

test.registerTests(
  [ { loadpage: 'about:blank'
    }

  , { test: function(doc,win)
      {
        // This triggered a bug, which should be fixed by now
        let sizeobjs = [ { xml_set: "1pr", min: 116, calc: 1 }
                       , { xml_set: "1pr", min: 146, calc: 1 }
                       , { xml_set: "1pr", min: 52, calc: 1 }
                       , { xml_set: "1pr", min: 94, calc: 1 }
                       , { xml_set: "1pr", min: 145, calc: 1 }
                       , { xml_set: "1pr", min: 140, calc: 1 }
                       , { xml_set: "1pr", min: 132, calc: 1 }
                       , { xml_set: "1pr", min: 116, calc: 1 }
                       , { xml_set: "1pr", min: 63, calc: 1 }
                       , { xml_set: "1pr", min: 45, calc: 1 }
                       , { xml_set: "1pr", min: 289, calc: 1 }
                       , { xml_set: "1pr", min: 61, calc: 1 }
                       ];

        var remaining = distributeSizes(1399, sizeobjs);
        test.eq(0, remaining);

        // The total of min sizes > available -> should throw
        sizeobjs =     [ { xml_set: "1pr", min: 116, calc: 1 }
                       , { xml_set: "1pr", min: 146, calc: 1 }
                       , { xml_set: "1pr", min: 52, calc: 1 }
                       , { xml_set: "1pr", min: 94, calc: 1 }
                       , { xml_set: "1pr", min: 145, calc: 1 }
                       , { xml_set: "1pr", min: 140, calc: 1 }
                       , { xml_set: "1pr", min: 132, calc: 1 }
                       , { xml_set: "1pr", min: 116, calc: 1 }
                       , { xml_set: "1pr", min: 63, calc: 1 }
                       , { xml_set: "1pr", min: 45, calc: 1 }
                       , { xml_set: "1pr", min: 289, calc: 1 }
                       , { xml_set: "1pr", min: 61, calc: 1 }
                       ];
        var success = false;
        try
        {
          distributeSizes(1398, sizeobjs, true, null, {intolerant:true});
        }
        catch (e)
        {
          success = true;
        }
        test.true(success, "expected an exception distributing 1398 pixels");
      }
    }
  ]);
