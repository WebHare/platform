import { dtapStage } from "@webhare/env";

let didconnectaction = false;

if (dtapStage === "development") //this is only needed for the peerserver test
  window.addEventListener("message", event => {
    if (event.data.dopeering) { //we're asked to setup peering
      const login = document.querySelector("t-textedit[data-name=loginname] input");
      if (login) {
        //use an override token to pass the login dialog, as wrdauth cookies won't work on non-https due to samestie= restrictions, and CI runs on http
        const newurl = new URL(location.href);
        newurl.searchParams.set("overridetoken", event.data.dopeering.overridetoken);
        newurl.searchParams.set("openas", "twoharetest@beta.webhare.net");
        location.href = newurl.toString();
        return;
      }

      const clientid = document.querySelector("t-text[data-name=clientid]");
      if (clientid) {
        const grantbutton = document.querySelector<HTMLButtonElement>("button[data-name=submitbutton]");
        if (grantbutton) {
          if (didconnectaction)
            return;

          grantbutton.click();
          didconnectaction = true;
          return;
        }
      }
    }
  });
