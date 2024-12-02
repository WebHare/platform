import { sendPxl, PxlData, getPxlSessionId } from "@webhare/frontend";
import * as test from "@webhare/test-frontend";
import * as pxl from "@mod-consilio/js/pxl";

declare module "@webhare/frontend" {
  interface PxlDataTypes {
    "webhare_testsuite:aa": {
      s: string;
      n?: number;
      b?: boolean;
    };
    "webhare_testsuite:nobiggy": {
      b: bigint;
    };
    "webhare_testsuite:event": object;
  }
}

let pxlId, pxlEvent: string = '', startTime = new Date;

async function getPxlLogLines() {
  return await test.invoke("mod::webhare_testsuite/tests/consilio/data/pxltest.whlib#GetPxlLogFiles", getPxlSessionId(), startTime.toISOString()) as string[];
}

test.run([
  "Test pxl urls",
  function () {
    let baseurl = "https://example.org", url, vars;

    // Test valid event names, parameters not specified should not appear on the url
    url = pxl.makePxlURL(baseurl, "webhare_testsuite:test")!;
    vars = new URL(url).searchParams;
    test.assert(vars.has("pe"));
    test.eq("webhare_testsuite:test", vars.get("pe"));

    url = pxl.makePxlURL(baseurl, "webhare_testsuite:test_event")!;
    vars = new URL(url).searchParams;
    test.assert(vars.has("pe"));
    test.eq("webhare_testsuite:test_event", vars.get("pe"));

    url = pxl.makePxlURL(baseurl, "test:event")!;
    vars = new URL(url).searchParams;
    test.assert(vars.has("pe"));
    test.eq("test:event", vars.get("pe"));

    url = pxl.makePxlURL(baseurl, "webhare_testsuite:e1")!;
    vars = new URL(url).searchParams;
    test.assert(vars.has("pe"));
    test.eq("webhare_testsuite:e1", vars.get("pe"));

    // Test different data types
    url = pxl.makePxlURL(baseurl, "webhare_testsuite:test", { ds_1: "test", dn_fun: 42, dn_2: 3.14159265, db_boel: true })!;
    vars = new URL(url).searchParams;
    test.assert(vars.has("pe"));
    test.eq("webhare_testsuite:test", vars.get("pe"));
    test.assert(vars.has("ds_1"));
    test.eq("test", vars.get("ds_1"));
    test.assert(vars.has("dn_fun"));
    test.eq("42", vars.get("dn_fun"));
    test.assert(vars.has("dn_2"));
    test.eq("3.14159265", vars.get("dn_2"));
    test.assert(vars.has("db_boel"));
    test.eq("true", vars.get("db_boel"));

    // Test different data type default values
    url = pxl.makePxlURL(baseurl, "webhare_testsuite:test", { ds_1: "", dn_fun: 0, db_boel: false })!;
    vars = new URL(url).searchParams;
    test.assert(vars.has("pe"));
    test.eq("webhare_testsuite:test", vars.get("pe"));
    test.assert(vars.has("ds_1"));
    test.eq("", vars.get("ds_1"));
    test.assert(vars.has("dn_fun"));
    test.eq("0", vars.get("dn_fun"));
    test.assert(vars.has("db_boel"));
    test.eq("false", vars.get("db_boel"));

    // Test identifier
    url = pxl.makePxlURL(baseurl, "webhare_testsuite:test", null, { pi: "anonymous" })!;
    vars = new URL(url).searchParams;
    test.eq("anonymous", vars.get("pi"));
    url = pxl.makePxlURL(baseurl, "webhare_testsuite:test", null)!;
    vars = new URL(url).searchParams;
    test.eq(/^[-_0-9A-Za-z]{22}$/, vars.get("pi"));
    const id = vars.get("pi");

    pxl.setPxlOptions({ pi: "anonymous" });
    url = pxl.makePxlURL(baseurl, "webhare_testsuite:test")!;
    vars = new URL(url).searchParams;
    test.eq("anonymous", vars.get("pi"));

    pxl.setPxlOptions({ pi: undefined });
    url = pxl.makePxlURL(baseurl, "webhare_testsuite:test", null, { pi: "anonymous" })!;
    vars = new URL(url).searchParams;
    test.eq("anonymous", vars.get("pi"));
    url = pxl.makePxlURL(baseurl, "webhare_testsuite:test")!;
    vars = new URL(url).searchParams;
    test.eq(id, vars.get("pi"));

    // Test not overwriting existing url variables
    baseurl = "https://example.org/?test=1&other=some%26thing";
    url = pxl.makePxlURL(baseurl, "webhare_testsuite:test", { ds_1: "test", dn_fun: 42, dn_2: 3.14159265, db_boel: true })!;
    vars = new URL(url).searchParams;
    test.assert(vars.has("test"));
    test.eq("1", vars.get("test"));
    test.assert(vars.has("other"));
    test.eq("some&thing", vars.get("other"));
    test.assert(vars.has("pe"));
    test.eq("webhare_testsuite:test", vars.get("pe"));
    test.assert(vars.has("ds_1"));
    test.eq("test", vars.get("ds_1"));
    test.assert(vars.has("dn_fun"));
    test.eq("42", vars.get("dn_fun"));
    test.assert(vars.has("dn_2"));
    test.eq("3.14159265", vars.get("dn_2"));
    test.assert(vars.has("db_boel"));
    test.eq("true", vars.get("db_boel"));

    // Test invalid event names
    //@ts-expect-error -- we really want to pass just one parameter here
    test.throws(/Invalid event/, () => pxl.makePxlURL("https://example.org"));
    test.throws(/Invalid event/, () => pxl.makePxlURL("https://example.org", ""));
    test.throws(/Invalid event/, () => pxl.makePxlURL("https://example.org", "test event"));
    test.throws(/Invalid event/, () => pxl.makePxlURL("https://example.org", "test.event"));
    test.throws(/Invalid event/, () => pxl.makePxlURL("https://example.org", "êvent"));

    // Test invalid data field names
    //@ts-expect-error -- plus runtime should catch it
    test.throws(/Invalid data/, () => pxl.makePxlURL("https://example.org", "webhare_testsuite:event", { ds: "test" }));
    //@ts-expect-error -- plus runtime should catch it
    test.throws(/Invalid data/, () => pxl.makePxlURL("https://example.org", "webhare_testsuite:event", { "1": "test" }));
    //@ts-expect-error -- plus runtime should catch it
    test.throws(/Invalid data/, () => pxl.makePxlURL("https://example.org", "webhare_testsuite:event", { "a:b": "test" }));

    // Test invalid data field values
    //@ts-expect-error -- plus runtime should catch it
    test.throws(/Invalid value/, () => pxl.makePxlURL("https://example.org", "webhare_testsuite:event", { ds_1: 42 }));
    //@ts-expect-error -- plus runtime should catch it
    test.throws(/Invalid value/, () => pxl.makePxlURL("https://example.org", "webhare_testsuite:event", { ds_1: true }));
    //@ts-expect-error -- plus runtime should catch it
    test.throws(/Invalid value/, () => pxl.makePxlURL("https://example.org", "webhare_testsuite:event", { ds_1: { b: "test" } }));
    //@ts-expect-error -- plus runtime should catch it
    test.throws(/Invalid value/, () => pxl.makePxlURL("https://example.org", "webhare_testsuite:event", { ds_1: new Date() }));

    // Test max url length (access log stores 600 bytes of request url)
    /*TODO: Not sure yet what the new maximum URL length will be
    url = pxl.makePxlURL(
        "https://example.org/lorem-ipsum-dolor-sit-amet/consectetur-adipiscing-elit/nam-at-condimentum-nunc/vestibulum-ultrices-lectus-dolor/pellentesque-velit-ligula/ornare-eget-neque-in/porta-interdum-tellus/",
        "lorem:ipsum",
        { "lorem_ipsum_dolor_sit_amet_consectetur_adipiscing_elit_nam_at_condimentum_nunc_vestibulum_ultrices_lectus_dolor_pellentesque_velit_ligula_ornare_eget_neque_in_porta_interdum_tellus": "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nam at condimentum nunc. Vestibulum ultrices lectus dolor. Pellentesque velit ligula, ornare eget neque in, porta interdum tellus. Sed sapien leo, semper vel augue nec, interdum vehicula metus. Donec et feugiat nulla. Donec pellentesque eget risus eget commodo. Sed a pharetra nisl, tincidunt sollicitudin mauris. Aliquam erat volutpat. Sed nec iaculis magna, at maximus urna. Mauris erat ante, suscipit sed nibh ut, scelerisque vestibulum felis. Nullam efficitur vel mauris ut dapibus. Vestibulum at quam posuere, varius purus a, pharetra magna. Nulla interdum erat tortor, at laoreet est fermentum eget."
        });
    vars = new URL(url).searchParams;
    test.assert(vars.has("pe"));
    test.eq("lorem:ipsum", vars.get("pe"));
    test.assert(!vars.has("pxl_d"));
    test.assert(vars.has("pxl_o"));*/
  },
  "Test pxl access logging",
  async function () {
    pxlId = pxl.getPxlId();
    const eventId = Math.floor(Math.random() * 65536);
    pxlEvent = `webhare_testsuite:testevent_${eventId}`;

    // Send an event with explicit id
    startTime = new Date();
    pxl.setPxlOptions({ pi: "anonymous" });
    pxl.sendPxlEvent(pxlEvent, null, { pi: undefined });
    let lines = await getPxlLogLines();
    test.assert(lines.length > 0); // 1 or 2 lines, depending on value of preview cookie
    let url = new URL("https://example.org" + lines[0]);
    test.assert(url.searchParams.has("pe"));
    test.eq(pxlEvent, url.searchParams.get("pe"));
    test.assert(url.searchParams.has("pe"));
    test.eq(pxlEvent, url.searchParams.get("pe"));
    test.assert(url.searchParams.has("pi"));
    test.eq(pxlId, url.searchParams.get("pi"));

    // Send an event without explicit id
    startTime = new Date();
    pxl.sendPxlEvent(pxlEvent);
    lines = await getPxlLogLines();
    test.assert(lines.length > 0); // 1 or 2 lines, depending on value of preview cookie
    url = new URL("https://example.org" + lines[0]);
    test.assert(url.searchParams.has("pe"));
    test.eq(pxlEvent, url.searchParams.get("pe"));
    test.eq("anonymous", url.searchParams.get("pi"));

    // Send an event with data
    startTime = new Date();
    pxl.sendPxlEvent(pxlEvent, { ds_1: pxlId, dn_fun: eventId });

    // Test typed PXL events
    //@ts-expect-error -- unregistered event
    sendPxl("webhare_testsuite:nosuchevent", { str: "a" });
    //@ts-expect-error -- incorrect event
    sendPxl("webhare_testsuite:aa", { invalid: "a" });
    //@ts-expect-error -- incorrect types in event
    test.throws(/'bigint'.*'b'/, () => sendPxl("webhare_testsuite:nobiggy", { b: 12n }));
    sendPxl("webhare_testsuite:aa", { s: "string", n: 1, b: true });
    sendPxl("webhare_testsuite:event", {}); //TODO would be nice to define a way to not send data at all with an event
    //To get rid of any type checking
    void await new Promise<void>(resolve => sendPxl<PxlData>("webhare_testsuite:unregistered", {}, { onComplete: resolve }));

    lines = await getPxlLogLines();

    test.assert(lines.length > 0); // 1 or 2 lines, depending on value of preview cookie
    url = new URL("https://example.org" + lines[0]);
    test.assert(url.searchParams.has("pe"));
    test.eq(pxlEvent, url.searchParams.get("pe"));
    test.eq("anonymous", url.searchParams.get("pi"));
    test.assert(url.searchParams.has("ds_1"));
    test.eq(pxlId, url.searchParams.get("ds_1"));
    test.assert(url.searchParams.has("dn_fun"));
    test.eq(`${eventId}`, url.searchParams.get("dn_fun"));

    const aaEvents = lines.filter((line) => line.includes("webhare_testsuite%3Aaa"));
    test.eq("a", new URL(aaEvents[0], location.href).searchParams.get("ds_invalid"), "It's still transmitted, verify the rwapping");
    test.eq("string", new URL(aaEvents[1], location.href).searchParams.get("ds_s"));
    test.eq('1', new URL(aaEvents[1], location.href).searchParams.get("dn_n"));
    test.eq('true', new URL(aaEvents[1], location.href).searchParams.get("db_b"));
  }
  /* TODO restore these tests when we have a way to overwrite islive/dtapstage. might be worth the trouble to add that to SiteResponse (overwriting the #wh-config)
   ,   "Test live mode never throwing",
      async function () {
        whintegration.config.dtapstage = "live";
        whintegration.config.islive = true;
        test.eq(null, pxl.makePxlURL("https://example.org"), "should not throw in development mode (which tests run in");
      }
  */
]);
