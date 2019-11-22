import test from "@mod-system/js/wh/testframework";

let setupdata;
let rand = Math.floor(100000000*Math.random());
let testemail = rand + "-testformfile-online+jstest@beta.webhare.net";
let confirmlink;
let testemail_guid;

test.registerTests(
  [ "Load and submit form"
  , async function()
    {
      setupdata = await test.invoke("module::webhare_testsuite/internal/testsite.whlib", "BuildWebtoolForm", { which: "custom", mailconfirmation: true });

      await test.load(setupdata.url);

      test.false(test.canClick('[data-wh-form-group-for="thankyou"]'), "Should not see thankyou");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_cancelled"]'), "Should not see thankyou_cancelled text");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_unconfirmed"]'), "Should not see thankyou_unconfirmed text");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_confirmed"]'), "Should not see thankyou_confirmed text");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_duplicate"]'), "Should not see thankyou_duplicate text");

      test.fill(test.qSA("input[type=text]")[0], "Pietje & Henkie");
      test.fill(test.qSA("input[type=email]")[0], testemail);
      test.click(test.qSA("[type=submit]")[0]);

      await test.wait("ui");
    }

  , "Request results"
  , async function()
    {
      test.false(test.canClick('[data-wh-form-group-for="thankyou"]'), "Should not see thankyou");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_cancelled"]'), "Should not see thankyou_cancelled text");
      test.true(test.canClick('[data-wh-form-group-for="thankyou_unconfirmed"]'), "Should see thankyou_unconfirmed text");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_confirmed"]'), "Should not see thankyou_confirmed text");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_duplicate"]'), "Should not see thankyou_duplicate text");

      testemail_guid = test.qS("form[data-wh-form-resultguid]").dataset.whFormResultguid;
      let formresult = await test.invoke("module::webhare_testsuite/internal/testsite.whlib", "GetWebtoolFormResult", testemail_guid, { which:"custom", allowpending: true });
      test.true(formresult.response);
      test.eq("Pietje & Henkie", formresult.response.firstname);
      test.eq("new", formresult.submittype);
      test.eq("pending", formresult.status);
      test.eq(testemail, formresult.response[ formresult.fields[1].name.toLowerCase() ]);
    }

  , "Process confirmation mail"
  , { email: testemail
    , emailtimeout: 6000
    , emailhandler: function(emails)
      {
        test.eq(1, emails.length, "No emails!");
        test.eq("Confirm your email address", emails[0].subject);

        confirmlink = emails[0].links.filter(_ => _.textcontent = "click here").map(_ => _.href)[0];
      }
    }

  , "Confirm result"
  , async function()
    {
      await test.load(confirmlink);

      test.false(test.canClick('[data-wh-form-group-for="thankyou"]'), "Should not see thankyou");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_cancelled"]'), "Should not see thankyou_cancelled text");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_unconfirmed"]'), "Should not see thankyou_unconfirmed text");
      test.true(test.canClick('[data-wh-form-group-for="thankyou_confirmed"]'), "Should see thankyou_confirmed text");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_duplicate"]'), "Should not see thankyou_duplicate text");

      let formresult = await test.invoke("module::webhare_testsuite/internal/testsite.whlib", "GetWebtoolFormResult", testemail_guid, { which:"custom", allowpending: true });
      test.true(formresult.response);
      test.eq("Pietje & Henkie", formresult.response.firstname);
      test.eq("confirm", formresult.submittype);
      test.eq("final", formresult.status);
      test.eq(testemail, formresult.response[ formresult.fields[1].name.toLowerCase() ]);
    }

  , "Process results mail"
  , { email: testemail
    , emailtimeout: 6000
    , emailhandler: function(emails)
      {
        test.eq(1, emails.length, "No emails!");
        test.eq("About Your Submission", emails[0].subject);
      }
    }

    // When submitting the same email address, the existing entry is updated after confirmation, should not trigger the
    // 'duplicate' state
  , "Reload and resubmit form updating the submission"
  , async function()
    {
      await test.load(setupdata.url);

      test.false(test.canClick('[data-wh-form-group-for="thankyou"]'), "Should not see thankyou");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_cancelled"]'), "Should not see thankyou_cancelled text");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_unconfirmed"]'), "Should not see thankyou_unconfirmed text");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_confirmed"]'), "Should not see thankyou_confirmed text");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_duplicate"]'), "Should not see thankyou_duplicate text");

      test.fill(test.qSA("input[type=text]")[0], "Pietje & Henkie");
      test.fill(test.qSA("input[type=email]")[0], testemail);
      test.click(test.qSA("[type=submit]")[0]);

      await test.wait("ui");
    }

  , "Request results"
  , async function()
    {
      test.false(test.canClick('[data-wh-form-group-for="thankyou"]'), "Should not see thankyou");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_cancelled"]'), "Should not see thankyou_cancelled text");
      test.true(test.canClick('[data-wh-form-group-for="thankyou_unconfirmed"]'), "Should see thankyou_unconfirmed text");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_confirmed"]'), "Should not see thankyou_confirmed text");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_duplicate"]'), "Should not see thankyou_duplicate text");

      testemail_guid = test.qS("form[data-wh-form-resultguid]").dataset.whFormResultguid;
      let formresult = await test.invoke("module::webhare_testsuite/internal/testsite.whlib", "GetWebtoolFormResult", testemail_guid, { which:"custom", allowpending: true });
      test.true(formresult.response);
      test.eq("Pietje & Henkie", formresult.response.firstname);
      test.eq("change", formresult.submittype);
      test.eq("pending", formresult.status);
      test.eq(testemail, formresult.response[ formresult.fields[1].name.toLowerCase() ]);
    }

  , "Process confirmation mail"
  , { email: testemail
    , emailtimeout: 6000
    , emailhandler: function(emails)
      {
        test.eq(1, emails.length, "No emails!");
        test.eq("Confirm your email address", emails[0].subject);

        confirmlink = emails[0].links.filter(_ => _.textcontent = "click here").map(_ => _.href)[0];
      }
    }

  , "Confirm result"
  , async function()
    {
      await test.load(confirmlink);

      test.false(test.canClick('[data-wh-form-group-for="thankyou"]'), "Should not see thankyou");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_cancelled"]'), "Should not see thankyou_cancelled text");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_unconfirmed"]'), "Should not see thankyou_unconfirmed text");
      test.true(test.canClick('[data-wh-form-group-for="thankyou_confirmed"]'), "Should not see thankyou_confirmed text");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_duplicate"]'), "Should see thankyou_duplicate text");

      let formresult = await test.invoke("module::webhare_testsuite/internal/testsite.whlib", "GetWebtoolFormResult", testemail_guid, { which:"custom", allowpending: true });
      test.true(formresult.response);
      test.eq("Pietje & Henkie", formresult.response.firstname);
      test.eq("confirm", formresult.submittype);
      test.eq("final", formresult.status);
      test.eq(testemail, formresult.response[ formresult.fields[1].name.toLowerCase() ]);
    }

  , "Process results mail"
  , { email: testemail
    , emailtimeout: 6000
    , emailhandler: function(emails)
      {
        test.eq(1, emails.length, "No emails!");
        test.eq("About Your Submission", emails[0].subject);
      }
    }

    // Adding 'testduplicate=1' disables the 'overwriteexisting' property of the email address, so we can submit a second
    // entry with the same address, which should trigger the 'duplicate' state
  , "Reload and resubmit form with duplicate address"
  , async function()
    {
      await test.load(setupdata.url + "?testduplicate=1");

      test.false(test.canClick('[data-wh-form-group-for="thankyou"]'), "Should not see thankyou");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_cancelled"]'), "Should not see thankyou_cancelled text");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_unconfirmed"]'), "Should not see thankyou_unconfirmed text");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_confirmed"]'), "Should not see thankyou_confirmed text");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_duplicate"]'), "Should not see thankyou_duplicate text");

      test.fill(test.qSA("input[type=text]")[0], "Pietje & Henkie");
      test.fill(test.qSA("input[type=email]")[0], testemail);
      test.click(test.qSA("[type=submit]")[0]);

      await test.wait("ui");
    }

  , "Request results"
  , async function()
    {
      test.false(test.canClick('[data-wh-form-group-for="thankyou"]'), "Should not see thankyou");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_cancelled"]'), "Should not see thankyou_cancelled text");
      test.true(test.canClick('[data-wh-form-group-for="thankyou_unconfirmed"]'), "Should see thankyou_unconfirmed text");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_confirmed"]'), "Should not see thankyou_confirmed text");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_duplicate"]'), "Should not see thankyou_duplicate text");

      testemail_guid = test.qS("form[data-wh-form-resultguid]").dataset.whFormResultguid;
      let formresult = await test.invoke("module::webhare_testsuite/internal/testsite.whlib", "GetWebtoolFormResult", testemail_guid, { which:"custom", allowpending: true });
      test.true(formresult.response);
      test.eq("Pietje & Henkie", formresult.response.firstname);
      test.eq("new", formresult.submittype);
      test.eq("pending", formresult.status);
      test.eq(testemail, formresult.response[ formresult.fields[1].name.toLowerCase() ]);
    }

  , "Process confirmation mail"
  , { email: testemail
    , emailtimeout: 6000
    , emailhandler: function(emails)
      {
        test.eq(1, emails.length, "No emails!");
        test.eq("Confirm your email address", emails[0].subject);

        confirmlink = emails[0].links.filter(_ => _.textcontent = "click here").map(_ => _.href)[0];
      }
    }

  , "Confirm result"
  , async function()
    {
      await test.load(confirmlink);

      test.false(test.canClick('[data-wh-form-group-for="thankyou"]'), "Should not see thankyou");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_cancelled"]'), "Should not see thankyou_cancelled text");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_unconfirmed"]'), "Should not see thankyou_unconfirmed text");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_confirmed"]'), "Should not see thankyou_confirmed text");
      test.true(test.canClick('[data-wh-form-group-for="thankyou_duplicate"]'), "Should see thankyou_duplicate text");

      let formresult = await test.invoke("module::webhare_testsuite/internal/testsite.whlib", "GetWebtoolFormResult", testemail_guid, { which:"custom", allowpending: true });
      test.true(formresult.response);
      test.eq("Pietje & Henkie", formresult.response.firstname);
      test.eq("new", formresult.submittype);
      test.eq("pending", formresult.status);
      test.eq(testemail, formresult.response[ formresult.fields[1].name.toLowerCase() ]);
    }
  ]);
