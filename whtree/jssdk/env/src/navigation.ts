type FormValueList = Array<{ name: string; value: string }>;

/** A navigation instruction encapsulates the next step that a client has to take in eg. a login, payment or wizard flow.
 * Use navigateTo to execute a navigation in a browser
*/

export type NavigateInstruction =
  {
    type: "redirect";
    url: string;
  } | {
    type: "form";
    form: {
      action: string;
      vars: FormValueList;
      method?: "POST";
    };
  } | {
    type: "reload";
  } | {
    type: "postmessage";
    message: unknown;
    target?: "parent" | "opener";
  } | {
    type: "close";
  };

function submitForm(action: string, values: FormValueList, method = "POST") {
  const form = document.createElement("form");
  form.method = method;
  form.action = action;
  form.append(...values.map(item => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = item.name;
    input.value = item.value;
    return input;
  }));
  document.body.appendChild(form);
  form.submit();
}

/** Navigate to a specific URL (may be hookable by other scripts)
* @param navigation - Target URL or NavigateInstruction
*/
export function navigateTo(navigation: string | NavigateInstruction) {
  if (typeof window === "undefined")
    throw new Error(`navigateTo() is not available in this environment`);

  if (typeof navigation === "string")
    navigation = { type: "redirect", url: navigation };

  switch (navigation.type) {
    case "redirect":
      {
        location.href = navigation.url;
      } break;

    case "form":
      {
        submitForm(navigation.form.action, navigation.form.vars, navigation.form.method);
      } break;

    case "reload":
      {
        window.location.reload();
      } break;

    case "postmessage":
      {
        if (!navigation.target || navigation.target === "parent")
          window.parent.postMessage(navigation.message, "*");
        else if (navigation.target === "opener") {
          window.opener.postMessage(navigation.message, "*");
          window.close();
        } else
          throw Error("Unknown postmessage target '" + navigation.target + "' received");
      } break;

    case "close":
      {
        window.close();
      } break;

    default:
      throw new Error(`Unknown navigation type '${(navigation as { type: string }).type}'`);
  }
}
