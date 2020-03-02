import * as test from '@mod-system/js/wh/testframework';
import * as dompack from 'dompack';
import * as domfocus from '@mod-system/js/dom/focus';

let setupdata;
let rand = Math.floor(100000000*Math.random())
let testemail = rand + '-testformfile-online+jstest@beta.webhare.net';
let testemail2 = rand + '-testformfile2-online+jstest@beta.webhare.net';
let editlink;
let testemail_guid;

test.registerTests(
  [ { test: async function()
      {
        setupdata = await test.invoke('module::webhare_testsuite/internal/testsite.whlib', 'BuildWebtoolForm', { which: "custom", addtscustomcomp: true });
      }
    }

  , { loadpage: function() { return setupdata.url + "?error=formunavailable"; }
    }

  , { test: function()
      {
        let content = test.qS('#content');
        test.eq("The form is currently unavailable", content.textContent.trim(), "Cannot find default form unavailable text");
      }
    }

  , { loadpage: function() { return setupdata.url; }
    }

  , async function()
    {
      test.true(test.canClick('[data-wh-form-group-for="greeting_new"]'), "Should see 'new' text");
      test.false(test.canClick('[data-wh-form-group-for="greeting_change"]'), "Should not see 'change' text");
      test.false(test.canClick('[data-wh-form-group-for="greeting_cancel"]'), "Should not see 'cancel' text");
      test.false(test.canClick('[data-wh-form-group-for="thankyou"]'), "Should not see thankyou");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_cancelled"]'), "Should not see thankyou_cancelled text");


      test.eq(1, test.qSA('[name="tscustom.sub"]').length, "There should be just one tscustom.sub!");
      test.fill(test.qSA('input[type=text]')[0], 'Joe');
      test.fill(test.qSA('input[type=email]')[0], testemail);
      test.fill(test.qS('[name="tscustom.sub"]'), 'filledsub');
      test.fill(test.qS('[name="textarea"]'), 'TextAreaVulling');
      test.click(test.qSA('[type=submit]')[0]);
      await test.wait('ui');

      test.true(domfocus.hasFocus(test.qS('#webtoolform-tscustom-1')), "custom field's first element should be focused");
      test.eq("Kies de 2e optie. Sub: filledsub", test.qS('[data-wh-form-group-for="tscustom"] .wh-form__error').textContent);
      test.click(test.qS('#webtoolform-tscustom-2'));
      test.click(test.qSA('[type=submit]')[0]);
      await test.wait('ui');
    }

  , 'Request results'
  , async function()
    {
      test.true(test.canClick('[data-wh-form-group-for="thankyou"]'), "Should see thankyou");
      test.false(test.canClick('[data-wh-form-group-for="thankyou_cancelled"]'), "Should not see thankyou_cancelled text");

      // Check if the first name is merged into the thankyou text
      test.eqMatch(/Joe/, test.qS('[data-wh-form-group-for="thankyou"]').textContent);

      testemail_guid = test.qS('form[data-wh-form-resultguid]').dataset.whFormResultguid;
      let formresult = await test.invoke('module::webhare_testsuite/internal/testsite.whlib', 'GetWebtoolFormResult', testemail_guid, { which:"custom"});
      test.eq('tollium:tilde.firstname', formresult.fields[0].title);
      test.eq(':Email', formresult.fields[1].title); //':' as its not a tid but just a plain untranslated field
      test.eq('FIRSTNAME', formresult.fields[0].name);

      test.eq(testemail_guid, formresult.guid);
      test.eq('Joe', formresult.response.firstname);
      test.eq("TextAreaVulling",formresult.response.textarea);
      test.eq(testemail, formresult.response[ formresult.fields[1].name.toLowerCase() ]);
      test.eq(testemail, formresult.idfield);
      test.eq(6,formresult.pagedata.electric);
      test.eq("something",formresult.pagedata.ihavegot);
      test.eq(1,formresult.numresults);
      test.eq({c1:false, c2: true, subvalue: "filledsub"}, formresult.response.tscustom);

      editlink = formresult.editlink;
    }

  , 'Process mail'
  , { email: function() { return 'mailresult+jstest@beta.webhare.net'; }
    , emailtimeout:60000
    , emailhandler:function(emails)
      {
        test.eq(1,emails.length,"No emails!");
        test.eq("Your Form Was Filled", emails[0].subject);
      }
    }

  , { loadpage: function() { return editlink; }
    }

  , 'Test results prefill and edit'
  , async function()
    {
      let namefield = test.qSA('input[type=text]')[0], emailfield = test.qSA('input[type=email]')[0];
      test.true(test.canClick('[data-wh-form-group-for="greeting_change"]'), "Should see 'change' text");
      test.false(test.canClick('[data-wh-form-group-for="greeting_new"]'), "Should not see 'new' text");
      test.false(test.canClick('[data-wh-form-group-for="greeting_cancel"]'), "Should not see 'cancel' text");

      test.eq('Joe', namefield.value);
      test.eq(testemail, emailfield.value);
      test.false(test.qS('[name="tscustom"][value="val1"]').checked);
      test.true(test.qS('[name="tscustom"][value="val2"]').checked);
      test.eq('filledsub', test.qS('[name="tscustom.sub"]').value);
      test.eq('TextAreaVulling', test.qS('[name="textarea"]').value);

      namefield.value = 'Jim';

      test.true(emailfield.disabled, 'email field should be disabled');
      //but we'll hack our way around it!
      emailfield.value = testemail2; //should be ignored by the form itself

      test.click(test.qSA('[type=submit]')[0]);
      await test.wait('ui');

      test.eq(testemail_guid, test.qS('form[data-wh-form-resultguid]').dataset.whFormResultguid);
      let formresult = await test.invoke('module::webhare_testsuite/internal/testsite.whlib', 'GetWebtoolFormResult', testemail_guid, { which:"custom"});
      test.eq(1,formresult.numresults);
      test.eq('Jim', formresult.response.firstname);
      test.eq(testemail, formresult.response[ formresult.fields[1].name.toLowerCase() ]);
      test.eq(testemail, formresult.idfield);
    }

  , 'Test editing through id field'
  , { loadpage: function() { return setupdata.url; }
    }
  , async function()
    {
      let namefield = test.qSA('input[type=text]')[0], emailfield = test.qSA('input[type=email]')[0];
      namefield.value="Timmy";
      emailfield.value=testemail;

      test.click(test.qS('#webtoolform-tscustom-2'));
      test.click(test.qSA('[type=submit]')[0]);
      await test.wait('ui');

      test.eq(testemail_guid, test.qS('form[data-wh-form-resultguid]').dataset.whFormResultguid);

      let formresult = await test.invoke('module::webhare_testsuite/internal/testsite.whlib', 'GetWebtoolFormResult', testemail_guid, { which:"custom"});
      test.eq(1,formresult.numresults);
    }

  , 'Process mail'
  , { email: function() { return 'mailresult+jstest@beta.webhare.net'; }
    , emailtimeout:60000
    , emailhandler:function(emails)
      {
        test.eq(1,emails.length,"No emails!");
        test.eq("Your Form Was Filled", emails[0].subject);
      }
    }

  , 'Test cancellation'
  , { loadpage: function() { return editlink + "?cancel=1"; }
    }

  , async function()
    {
      test.false(test.canClick('[data-wh-form-group-for="thankyou"]'), "Should not see thankyou");
      test.true(test.canClick('[data-wh-form-group-for="thankyou_cancelled"]'), "Should  see thankyou_cancelled text");
    }
  ]);

