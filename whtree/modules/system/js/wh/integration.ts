import * as dompack from 'dompack';
import * as storage from 'dompack/extra/storage';

interface Config {
  [key: string]: unknown;
  obj: unknown;
  site: unknown;
  /** True if the current WebHare is in production or acceptance DTAP stage. Often used to show/hide developer-targed runtime warnings */
  islive: boolean;
  /** Current WebHare's DTAP stage */
  dtapstage: "production" | "acceptance" | "test" | "development";
  /** Numeric server version number (eg 5.02.24 = 50224) */
  server: number;
}

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
  values.forEach(function(item) {
    form.appendChild(dompack.create("input", { type: "hidden", name: item.name, value: item.value }));
  });
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
  dompack.flagUIBusy({ ismodal: options.ismodal || false });

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

  switch (instr.type) {
    case "redirect":
      {
        location.href = instr.url;
      } break;

    case "form":
      {
        submitForm(instr.form.action, instr.form.vars, instr.form.method);
      } break;

    case "refresh":
    case "reload":
      {
        window.location.reload();
      } break;

    case "postmessage":
      {
        if (!instr.target || instr.target === "parent")
          parent.postMessage(instr.message, "*");
        else if (instr.target === "opener") {
          opener.postMessage(instr.message, "*");
          window.close();
        } else
          throw Error("Unknown postmessage target '" + instr.target + "' received");
      } break;

    case "close":
      {
        window.close();
      } break;

    default:
      {
        throw new Error("Unknown submit instruction '" + (instr as { type: string }).type + "' received");
      }
  }
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
  // Is author mode activated through the Publisher?
  if (location.search.includes("wh-feedback-token=")) {
    const url = new URL(location.href);
    const tokentext = url.searchParams.get("wh-feedback-token");
    if (tokentext) {
      const token = JSON.parse(tokentext);
      if (token && token.match(/^[^.]*\.[^.]*\.[^.]*$/)) { // Check if the string has the general JWT header.payload.signature format
        storage.setLocal("wh-feedback:accesstoken", token);
        url.searchParams.delete("wh-feedback-token");
        history.replaceState(null, "", url);
      }
    }
  }

  if (storage.getLocal<string>("wh-feedback:accesstoken")?.match(/^[^.]*\.[^.]*\.[^.]*$/))
    activeAuthorMode();
}

function getIntegrationConfig(): Config {
  let config;
  if (typeof window !== 'undefined') { //check we're in a browser window, ie not serverside or some form of worker
    const whconfigel = typeof document != "undefined" ? document.querySelector('script#wh-config') : null;
    if (whconfigel?.textContent) {
      config = JSON.parse(whconfigel.textContent) as Partial<Config>;
    }
  }

  // Make sure we have obj/site as some sort of object, to prevent crashes on naive 'if ($wh.config.obj.x)' tests'
  return {
    islive: true,
    dtapstage: "production",
    obj: null,
    site: null,
    server: 0,
    ...config
  };
}

if (typeof window !== "undefined" && !document.documentElement.classList.contains("wh-noauthormode")) //we're top level
  setTimeout(checkAuthorMode, 0); //async startup.. also allows it to throw exceptions without breaking anything

export const config = getIntegrationConfig();

