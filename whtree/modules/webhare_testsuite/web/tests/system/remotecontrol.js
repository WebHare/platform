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
      if(didloginaction)
        return;
      login.value = "twoharetest@beta.webhare.net";
      document.querySelector("t-textedit[data-name=password] input").value = "secret";
      document.querySelector("t-button[data-name=loginbutton]").click();
      didloginaction=true;
      return;
    }

    var scopes = document.querySelector("t-text[data-name=scopes]");
    if(scopes)
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
