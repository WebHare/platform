import * as test from "@mod-system/js/wh/testframework";
import * as pxl from "@mod-consilio/js/pxl";
import * as whintegration from "@mod-system/js/wh/integration";

let pxlId, pxlEvent;

test.registerTests(
  [ { name: "Test pxl urls"
    , test: (doc, win) =>
      {
        let baseurl = "https://example.org", url, vars;

        // Test valid event names, parameters not specified should not appear on the url
        url = pxl.makePxlUrl(baseurl, "test");
        vars = new URL(url).searchParams;
        test.true(vars.has("pe"));
        test.eq("test", vars.get("pe"));

        url = pxl.makePxlUrl(baseurl, "test_event");
        vars = new URL(url).searchParams;
        test.true(vars.has("pe"));
        test.eq("test_event", vars.get("pe"));

        url = pxl.makePxlUrl(baseurl, "test:event");
        vars = new URL(url).searchParams;
        test.true(vars.has("pe"));
        test.eq("test:event", vars.get("pe"));

        url = pxl.makePxlUrl(baseurl, "1");
        vars = new URL(url).searchParams;
        test.true(vars.has("pe"));
        test.eq("1", vars.get("pe"));

        // Test different data types
        url = pxl.makePxlUrl(baseurl, "test", { ds_1: "test", dn_fun: 42, dn_2: 3.14159265, db_boel: true });
        vars = new URL(url).searchParams;
        test.true(vars.has("pe"));
        test.eq("test", vars.get("pe"));
        test.true(vars.has("ds_1"));
        test.eq("test", vars.get("ds_1"));
        test.true(vars.has("dn_fun"));
        test.eq("42", vars.get("dn_fun"));
        test.true(vars.has("dn_2"));
        test.eq("3.14159265", vars.get("dn_2"));
        test.true(vars.has("db_boel"));
        test.eq("true", vars.get("db_boel"));

        // Test different data type default values
        url = pxl.makePxlUrl(baseurl, "test", { ds_1: "", dn_fun: 0, db_boel: false });
        vars = new URL(url).searchParams;
        test.true(vars.has("pe"));
        test.eq("test", vars.get("pe"));
        test.true(vars.has("ds_1"));
        test.eq("", vars.get("ds_1"));
        test.true(vars.has("dn_fun"));
        test.eq("0", vars.get("dn_fun"));
        test.true(vars.has("db_boel"));
        test.eq("false", vars.get("db_boel"));

        // Test identifier
        url = pxl.makePxlUrl(baseurl, "test", null, { donottrack: "1" });
        vars = new URL(url).searchParams;
        test.false(vars.has("pi"));
        url = pxl.makePxlUrl(baseurl, "test", null, { donottrack: "0" });
        vars = new URL(url).searchParams;
        test.true(vars.has("pi"));
        let id = vars.get("pi");

        pxl.setPxlOptions({ donottrack: "1" });
        url = pxl.makePxlUrl(baseurl, "test");
        vars = new URL(url).searchParams;
        test.false(vars.has("pi"));

        pxl.setPxlOptions({ donottrack: "0" });
        url = pxl.makePxlUrl(baseurl, "test", null, { donottrack: "1" });
        vars = new URL(url).searchParams;
        test.false(vars.has("pi"));
        url = pxl.makePxlUrl(baseurl, "test");
        vars = new URL(url).searchParams;
        test.true(vars.has("pi"));
        test.eq(id, vars.get("pi"));

        // Test not overwriting existing url variables
        baseurl = "https://example.org/?test=1&other=some%26thing";
        url = pxl.makePxlUrl(baseurl, "test", { ds_1: "test", dn_fun: 42, dn_2: 3.14159265, db_boel: true });
        vars = new URL(url).searchParams;
        test.true(vars.has("test"));
        test.eq("1", vars.get("test"));
        test.true(vars.has("other"));
        test.eq("some&thing", vars.get("other"));
        test.true(vars.has("pe"));
        test.eq("test", vars.get("pe"));
        test.true(vars.has("ds_1"));
        test.eq("test", vars.get("ds_1"));
        test.true(vars.has("dn_fun"));
        test.eq("42", vars.get("dn_fun"));
        test.true(vars.has("dn_2"));
        test.eq("3.14159265", vars.get("dn_2"));
        test.true(vars.has("db_boel"));
        test.eq("true", vars.get("db_boel"));

        // Test invalid event names
        test.throws(() => pxl.makePxlUrl("https://example.org"));
        test.throws(() => pxl.makePxlUrl("https://example.org", ""));
        test.throws(() => pxl.makePxlUrl("https://example.org", "test event"));
        test.throws(() => pxl.makePxlUrl("https://example.org", "test.event"));
        test.throws(() => pxl.makePxlUrl("https://example.org", "êvent"));

        // Test invalid data field names
        test.throws(() => pxl.makePxlUrl("https://example.org", "event", { ds: "test" }));
        test.throws(() => pxl.makePxlUrl("https://example.org", "event", { "1": "test" }));
        test.throws(() => pxl.makePxlUrl("https://example.org", "event", { "a:b": "test" }));

        // Test invalid data field values
        test.throws(() => pxl.makePxlUrl("https://example.org", "event", { ds_1: 42 }));
        test.throws(() => pxl.makePxlUrl("https://example.org", "event", { ds_1: true }));
        test.throws(() => pxl.makePxlUrl("https://example.org", "event", { ds_1: { b: "test" } }));
        test.throws(() => pxl.makePxlUrl("https://example.org", "event", { ds_1: new Date() }));

        // Test max url length (access log stores 600 bytes of request url)
        /*TODO: Not sure yet what the new maximum URL length will be
        url = pxl.makePxlUrl(
            "https://example.org/lorem-ipsum-dolor-sit-amet/consectetur-adipiscing-elit/nam-at-condimentum-nunc/vestibulum-ultrices-lectus-dolor/pellentesque-velit-ligula/ornare-eget-neque-in/porta-interdum-tellus/",
            "lorem:ipsum",
            { "lorem_ipsum_dolor_sit_amet_consectetur_adipiscing_elit_nam_at_condimentum_nunc_vestibulum_ultrices_lectus_dolor_pellentesque_velit_ligula_ornare_eget_neque_in_porta_interdum_tellus": "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nam at condimentum nunc. Vestibulum ultrices lectus dolor. Pellentesque velit ligula, ornare eget neque in, porta interdum tellus. Sed sapien leo, semper vel augue nec, interdum vehicula metus. Donec et feugiat nulla. Donec pellentesque eget risus eget commodo. Sed a pharetra nisl, tincidunt sollicitudin mauris. Aliquam erat volutpat. Sed nec iaculis magna, at maximus urna. Mauris erat ante, suscipit sed nibh ut, scelerisque vestibulum felis. Nullam efficitur vel mauris ut dapibus. Vestibulum at quam posuere, varius purus a, pharetra magna. Nulla interdum erat tortor, at laoreet est fermentum eget."
            });
        vars = new URL(url).searchParams;
        test.true(vars.has("pe"));
        test.eq("lorem:ipsum", vars.get("pe"));
        test.false(vars.has("pxl_d"));
        test.true(vars.has("pxl_o"));*/
      }
    }

  , { name: "Test pxl access logging"
    , test: async (doc, win) =>
      {
        pxlId = pxl.getPxlId();
        let eventId = Math.floor(Math.random() * 65536);
        pxlEvent = `testevent:${eventId}`;

        // Send an event with explicit id
        let startTime = new Date();
        pxl.setPxlOptions({ donottrack: "1" });
        pxl.sendPxlEvent(pxlEvent, null, { donottrack: "0" });
        let lines = await test.invoke("mod::consilio/lib/internal/testframework.whlib", "GetAccessLogLines", pxlEvent, startTime.toISOString());
        test.true(lines.length > 0); // 1 or 2 lines, depending on value of preview cookie
        let url = new URL("https://example.org" + lines[0]);
        test.true(url.searchParams.has("pe"));
        test.eq(pxlEvent, url.searchParams.get("pe"));
        test.true(url.searchParams.has("pe"));
        test.eq(pxlEvent, url.searchParams.get("pe"));
        test.true(url.searchParams.has("pi"));
        test.eq(pxlId, url.searchParams.get("pi"));

        // Send an event without explicit id
        startTime = new Date();
        pxl.sendPxlEvent(pxlEvent);
        lines = await test.invoke("mod::consilio/lib/internal/testframework.whlib", "GetAccessLogLines", pxlEvent, startTime.toISOString());
        test.true(lines.length > 0); // 1 or 2 lines, depending on value of preview cookie
        url = new URL("https://example.org" + lines[0]);
        test.true(url.searchParams.has("pe"));
        test.eq(pxlEvent, url.searchParams.get("pe"));
        test.false(url.searchParams.has("pi"));

        // Send an event with data
        startTime = new Date();
        pxl.sendPxlEvent(pxlEvent, { ds_1: pxlId, dn_fun: eventId });
        lines = await test.invoke("mod::consilio/lib/internal/testframework.whlib", "GetAccessLogLines", pxlEvent, startTime.toISOString());
        test.true(lines.length > 0); // 1 or 2 lines, depending on value of preview cookie
        url = new URL("https://example.org" + lines[0]);
        test.true(url.searchParams.has("pe"));
        test.eq(pxlEvent, url.searchParams.get("pe"));
        test.false(url.searchParams.has("pi"));
        test.true(url.searchParams.has("ds_1"));
        test.eq(pxlId, url.searchParams.get("ds_1"));
        test.true(url.searchParams.has("dn_fun"));
        test.eq(`${eventId}`, url.searchParams.get("dn_fun"));
      }
    }

  , "Test live mode never throwing"
  , async function()
    {
      whintegration.config.dtapstage="live";
      whintegration.config.islive=true;
      test.eq(null, pxl.makePxlUrl("https://example.org"), "should not throw in development mode (which tests run in");
    }
  ]);
