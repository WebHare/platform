import test from "@mod-system/js/wh/testframework";

///run forgot password sequence and navigate through the reset procedure
export function testResetPassword(options)
{
  return [ `Start password reset for ${options.email}`
         , async function()
           {
             test.fill(test.qS('.wh-wrdauth-forgotpassword input[name="email"]'), options.email);
             test.click(test.qS('.wh-wrdauth-forgotpassword__forgotbutton'));
             await test.wait('ui');
           }
         , `Handle password reset mail for ${options.email}`
         , { email: function() { return options.email; }
           , emailtimeout:10000
           , emailhandler:function(emails)
             {
               test.eq(1, emails.length, emails.length==0 ? "No emails!" : "More than expected emails (" + emails.length + ")");
               test.eq(true, emails[0].subject.startsWith("Reset your password for"), "Unexpected subject " + emails[0].subject);

               let resetlink = emails[0].links.filter(link => link.textcontent=="this link")[0];
               test.eq(true, !!resetlink, "Didn't find a reset link");
               test.getWin().location.href = resetlink.href;
             }
           , waits: ['pageload']
           }
         , 'Set my new password'
         , async function()
           {
             test.fill(test.qS('[name="passwordnew"]'), options.newpassword);
             test.fill(test.qS('[name="passwordrepeat"]'), options.newpassword);
             test.click(test.qS('.wh-wrdauth-resetpassword__resetbutton'));

             await test.wait('ui');

             test.click(test.qS(".wh-wrdauth-resetpassword__continuebutton"));
           }
         , { waits: ['pageload']
           }
         ];
}
