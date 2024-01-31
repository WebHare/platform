import * as dompack from '@webhare/dompack';

//NOTE: Do *NOT* load @webhare/frontend or we enforce the new CSS reset!
import { navigateTo, NavigateInstruction } from "@webhare/frontend/src/navigation";
export { frontendConfig as config } from '@webhare/frontend/src/init';

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
