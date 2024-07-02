import * as dompack from '@webhare/dompack';
import * as dialogapi from 'dompack/api/dialog';
import RTDField from './index';
import RPCFormBase from '../../rpc';
import publisherFormService from "@webhare/forms/src/formservice";
import type { FormSubmitEmbeddedResult } from '../../formbase';

class EmbedVideoForm extends RPCFormBase {
  dialog;
  rtd;

  constructor(node: HTMLFormElement, dialog: dialogapi.DialogBase, rtd: HTMLElement) {
    super(node);
    this.dialog = dialog;
    this.rtd = rtd;
  }

  async onSubmitSuccess(result: FormSubmitEmbeddedResult<{
    video: {
      network: string;
      videoid: string;
    };
  }>) {
    if (result.video) {
      await RTDField.getForNode(this.rtd)!.insertVideoByURL('x-wh-embedvideo:' + result.video.network + ':' + result.video.videoid);
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
  const formdata = await publisherFormService.requestBuiltinForm((formhandler as RPCFormBase).getServiceSubmitInfo(), 'rtd', 'embedvideo');

  const dialog = dialogapi.createDialog();
  dialog.contentnode!.innerHTML = formdata.html;

  new EmbedVideoForm(dompack.qR(dialog.contentnode!, 'form'), dialog, rtd);
  formloadlock.release();

  await dialog.runModal();
}
