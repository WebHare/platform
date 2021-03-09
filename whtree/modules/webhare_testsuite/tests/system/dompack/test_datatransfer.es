import * as test from "@mod-system/js/wh/testframework";
import * as pointer from "dompack/testframework/pointer.es";

test.registerTests(
[ "Datatransfer object"
, async function()
  {
    let dds = new pointer.SimulatedDragDataStore(null);

    let dt = new pointer.SimulatedDataTransfer(dds, "read/write", "copy");
    dds.currentDragOperation = "link";

    dt.effectAllowed = "linkMove";
    test.eq("linkMove", dds.effectAllowed);
    test.eq("linkMove", dt.effectAllowed);

    dt.dropEffect = "copy";
    test.eq("link", dds.currentDragOperation);
    test.eq("copy", dt.dropEffect);

    dt.setData("x-webhare/yeey", "str");
    test.eq("str", dt.getData("x-webhare/yeey"));
    test.eq(1, dt.items.length);
    test.eq("string", dt.items[0].kind);
    test.eq("x-webhare/yeey", dt.items[0].type);
    const item0 = dt.items[0];

    test.eq(1, dt.types.length);
    test.eq("x-webhare/yeey", dt.types[0]);
    test.eq(0, dt.files.length);

    dt._detach();

    test.eq(0, dt.items.length);
    test.eq("", item0.kind);
    test.eq("", item0.type);
    test.eq(0, dt.types.length);
    test.eq(0, dt.files.length);

    // protected mode
    dt = new pointer.SimulatedDataTransfer(dds, "protected", "move");
    test.eq(1, dt.items.length);
    test.eq("string", dt.items[0].kind);
    test.eq("x-webhare/yeey", dt.items[0].type);
    test.eq(1, dt.types.length);
    test.eq("x-webhare/yeey", dt.types[0]);
    dt.effectAllowed = "copy";
    test.eq("linkMove", dt.effectAllowed);
    dt.dropEffect = "move";
    test.eq("move", dt.dropEffect);
    test.eq(0, dt.files.length);

    // read mode
    dt = new pointer.SimulatedDataTransfer(dds, "read");
    test.eq(1, dt.items.length);
    test.eq("string", dt.items[0].kind);
    test.eq("x-webhare/yeey", dt.items[0].type);
    dt.effectAllowed = "copy";
    test.eq("linkMove", dt.effectAllowed);
    dt.dropEffect = "move";
    test.eq("move", dt.dropEffect);
    test.eq(0, dt.files.length);

    dt = new pointer.SimulatedDataTransfer(dds, "read/write");
    dt.clearData("does-not-exist");
    dt.items.add("str", "second/item");
    test.eq(2, dt.items.length);
    dt.clearData("second/item");
    test.eq(1, dt.items.length);
    dt.clearData();
    test.eq(0, dt.items.length);

    dt.items.add(new File([ "test" ], "testfile.txt", { type : 'text/plain' }));
    test.eq(1, dt.items.length);
    test.eq(1, dt.files.length);
    test.eq("testfile.txt", dt.files[0].name);
  }
]);
