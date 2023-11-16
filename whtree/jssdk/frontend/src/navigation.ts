import { create } from "@webhare/dompack";

type FormValueList = Array<{ name: string; value: string }>;

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

function generateForm(action: string, values: FormValueList, method?: "POST") {
  const form = create("form", { action: action, method: method || "POST", charset: "utf-8" });
  form.append(...values.map(item => create("input", { type: "hidden", name: item.name, value: item.value })));
  return form;
}

function submitForm(action: string, values: FormValueList, method?: "POST") {
  const form = generateForm(action, values, method);
  document.body.appendChild(form);
  form.submit();
}

/** Navigate to a specific URL (may be hookable by other scripts)
* @param navigation - Target URL or NavigateInstruction
*/
export function navigateTo(navigation: string | NavigateInstruction) {
  //NOTE: integration.ts#executeSubmitInstruction had more features, eg modal and iframe, but let's see whether we need them..

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
