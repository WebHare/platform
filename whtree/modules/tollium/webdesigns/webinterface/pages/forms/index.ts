import * as dompack from "@webhare/dompack";
import "./forms.scss";
import { isValidEmail } from "@webhare/std";

// When clicking the 'forgot password' link, add the email address to the url, so the forgot password form can be prefilled
dompack.register(".wh-wrdauth-login__forgotpasswordlink", node => {
  const url = new URL((node as HTMLAnchorElement).href);
  const login = document.getElementById("login-login");
  if ((login as HTMLInputElement)?.autocomplete.includes("email"))
    dompack.addDocEventListener(node, "click", () => {
      const email = (login as HTMLInputElement).value;
      if (isValidEmail(email))
        url.searchParams.set("email", email);
      else
        url.searchParams.delete("email");
      (node as HTMLAnchorElement).href = url.toString();
    }, { capture: true });
});

// Links inside forms (probably other places in tollium?) should open in new windows
dompack.register<HTMLAnchorElement>(".wh-form a[href]", node => {
  node.setAttribute("target", "_blank");
  node.setAttribute("rel", "noopener noreferrer");
});
