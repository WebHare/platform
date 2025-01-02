/* eslint-disable @typescript-eslint/no-misused-promises, @typescript-eslint/no-floating-promises -- FIXME: needs API rework  */

import * as dompack from '@webhare/dompack';
import * as dialogapi from 'dompack/api/dialog';
import { type RTDEditElement } from './index';
import RPCFormBase from '../../rpc';
import { getFormService } from "@webhare/forms/src/formservice";
import type { FormSubmitEmbeddedResult } from '../../formbase';

class EmbedVideoForm extends RPCFormBase {
  constructor(node: HTMLFormElement, private dialog: dialogapi.DialogBase, private rtd: RTDEditElement) {
    super(node);
  }

  async onSubmitSuccess(result: FormSubmitEmbeddedResult<{
    video: {
      network: string;
      videoid: string;
    };
  }>) {
    if (result.video) {
      this.rtd.insertVideoByURL('x-wh-embedvideo:' + result.video.network + ':' + result.video.videoid);
      this.dialog.resolve(null);
    }
  }
}

export async function insertVideo(rtd: HTMLElement) {
  const formloadlock = dompack.flagUIBusy();
  const formhandler = rtd.closest('form')?.propWhFormhandler;
  if (!formhandler) {
    console.error("Cannot find formhandler for node", rtd);
    throw new Error("Cannot find formhandler for RTD node");
  }
  const formdata = await getFormService().requestBuiltinForm((formhandler as RPCFormBase).getRPCFormIdentifier(), 'rtd', 'embedvideo');

  const dialog = dialogapi.createDialog();
  dialog.contentnode!.innerHTML = formdata.html;

  new EmbedVideoForm(dompack.qR(dialog.contentnode!, 'form'), dialog, rtd as RTDEditElement);
  formloadlock.release();

  await dialog.runModal();
}
