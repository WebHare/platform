console.log("up!");

var didloginaction = false;
var didconnectaction=false;

window.addEventListener("message", function(event)
{
  if(event.data.dopeering) //we're asked to setup peering
  {
    var login = document.querySelector("t-textedit[data-name=loginname] input");
    if(login)
    {
      //use an override token to pass the login dialog, as wrdauth cookies won't work on non-https due to samestie= restrictions, and CI runs on http
      var newurl = new URL(location.href);
      newurl.searchParams.set("overridetoken", event.data.dopeering.overridetoken);
      newurl.searchParams.set("openas", "twoharetest@beta.webhare.net");
      console.log(newurl.toString());
      location.href = newurl.toString();
      return;
    }

    var clientid = document.querySelector("t-text[data-name=clientid]");
    if(clientid)
    {
      var grantbutton = document.querySelector("t-button[data-name=submitbutton]");
      if (grantbutton)
      {
        if(didconnectaction)
          return;

        grantbutton.click();
        didconnectaction=true;
        return;
      }
    }
  }
});
