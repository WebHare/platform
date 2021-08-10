"use strict";

function runLoginPage()
{
  var data = document.documentElement.dataset;

  try
  {
    if(window.parent && window.parent.__webhareBrowserFrameAPI)
    {
      window.addEventListener("message", function(evt)
      {
        if(evt.data.type == "wrd:loginresponse")
          location.href = evt.data.submitinstruction.url; //TODO Assuming "redirect" may not be safe
      });

      var publisherwindow = window.parent.parent;
      publisherwindow.postMessage({type: "wrd:loginrequest", link: data.link, logincontrol: data.logincontrol }, "*");
      return;
    }
  }
  catch(ignore)
  {
    console.error("exception from publisher_login frame", ignore);
  }
  location.href = data.link;
}

runLoginPage();
