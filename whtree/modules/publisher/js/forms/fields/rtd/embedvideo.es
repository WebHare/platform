import * as dompack from 'dompack';
import * as dialogapi from 'dompack/api/dialog';
import RTDField from './index';
import RPCFormBase from '../../rpc';
import * as formservice from '../../internal/form.rpc.json';

class EmbedVideoForm extends RPCFormBase
{
  constructor(node, dialog, rtd)
  {
    super(node);
    this.dialog = dialog;
    this.rtd = rtd;
  }

  async onSubmitSuccess(result)
  {
    if(result.video)
    {
      await RTDField.getForNode(this.rtd).insertVideoByURL('x-wh-embedvideo:' + result.video.network + ':' + result.video.videoid);
      this.dialog.resolve();
    }
  }
}

export async function insertVideo(rtd)
{
  let formloadlock = dompack.flagUIBusy({ component: rtd });
  let formhandler = dompack.closest(rtd, 'form').propWhFormhandler;
  if(!formhandler)
  {
    console.error("Cannot find formhandler for node",rtd);
    throw new Error("Cannot find formhandler for RTD node");
  }
  let formdata = await formservice.requestBuiltinForm(formhandler.getServiceSubmitInfo(),'rtd','embedvideo');

  let dialog = dialogapi.createDialog();
  dialog.contentnode.innerHTML = formdata.html;

  new EmbedVideoForm(dialog.contentnode.querySelector('form'), dialog, rtd);
  formloadlock.release();

  await dialog.runModal();
}
