import * as dompack from '@webhare/dompack';
import { navigateTo, NavigateInstruction } from "@webhare/frontend";
export { frontendConfig as config } from "@webhare/frontend";

type FormValueList = Array<{ name: string; value: string }>;

export type SubmitInstruction =
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
    type: "refresh" | "reload";
  } | {
    type: "postmessage";
    message: unknown;
    target?: "parent" | "opener";
  } | {
    type: "close";
  };

//NOTE: generateForm was apparently intended to support key-value pairs in 'values'... but the code never worked due to incorrect Object.kyes usage
function generateForm(action: string, values: FormValueList, method?: "POST") {
  const form = dompack.create("form", { action: action, method: method || "POST", charset: "utf-8" });
  form.append(...values.map(item => dompack.create("input", { type: "hidden", name: item.name, value: item.value })));
  return form;
}

export function submitForm(action: string, values: FormValueList, method?: "POST") {
  const form = generateForm(action, values, method);
  document.body.appendChild(form);
  form.submit();
}

export function executeSubmitInstruction(instr: SubmitInstruction, options?: {
  ismodal?: boolean;
  iframe?: HTMLIFrameElement;
}) {
  if (!instr)
    throw Error("Unknown instruction received");

  options = { ismodal: true, ...options };
  //Are there any cirumstances where you would want to reelase this lock?
  dompack.flagUIBusy({ modal: options.ismodal || false });

  if (options.iframe) {
    switch (instr.type) {
      case "redirect":
        {
          options.iframe.src = instr.url;
        } break;

      case "form":
        {
          // FIXME: Clear iframe if document is not cross-domain accessible
          const idoc = options.iframe.contentDocument || options.iframe.contentWindow?.document;
          if (!idoc)
            throw new Error("Unable to use iframe");

          const form = generateForm(instr.form.action, instr.form.vars, instr.form.method);
          const adopted_form = idoc.adoptNode(form);
          idoc.body.appendChild(adopted_form);
          adopted_form.submit();
        } break;

      default:
        {
          throw Error("Unknown submit instruction '" + instr.type + "' for iframe received");
        }
    }
    return;
  }

  if (instr.type === "refresh")
    instr = { ...instr, type: "reload" };

  navigateTo(instr as NavigateInstruction);
}

function activeAuthorMode() {
  // Check if authormode is already loaded (authormode will load integration.es too and might trigger a loop otherwise)
  if (document.querySelector(`script[src="/.ap/publisher.authormode/ap.js"]`))
    return;

  const script = document.createElement("script");
  script.src = "/.ap/publisher.authormode/ap.js";

  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "/.ap/publisher.authormode/ap.css";
  document.querySelector("head,body")?.append(script, css);
}

function checkAuthorMode() {
  if (document.documentElement.classList.contains("wh-optin-authormode") //for now, you need to explicitly opt-in. this will go away at some point
    && !document.documentElement.classList.contains("wh-noauthormode") //explicit opt-out
    && window.top === window //we're not in an iframe
    && dompack.getLocal<string>("wh-feedback:accesstoken")?.match(/^[^.]*\.[^.]*\.[^.]*$/)) {
    activeAuthorMode();
  }
}

if (typeof window !== "undefined") //in a browser
  setTimeout(checkAuthorMode, 0); //async startup.. also allows it to throw exceptions without breaking anything
