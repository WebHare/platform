import * as dompack from '@webhare/dompack';

//NOTE: Do *NOT* load @webhare/frontend or we enforce the new CSS reset!
import { navigateTo, type NavigateInstruction } from "@webhare/env";
export { frontendConfig as config } from '@webhare/frontend/src/init';

export function executeSubmitInstruction(instr: NavigateInstruction, options?: {
  ismodal?: boolean;
  iframe?: HTMLIFrameElement;
}) {
  if (!instr)
    throw Error("Unknown instruction received");

  options = { ismodal: true, ...options };
  //Are there any cirumstances where you would want to reelase this lock?
  dompack.flagUIBusy({ modal: options.ismodal || false });
  navigateTo(instr);
}
