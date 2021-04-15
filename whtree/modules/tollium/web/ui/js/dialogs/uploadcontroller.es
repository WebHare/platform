import "../../common.lang.json";
import * as dompack from "dompack";
import { getTid } from "@mod-tollium/js/gettid";


/** Uploads a wh.net.upload UploadItem / UploadItemGroup, while displaying a progress dialog.
    On finish, a load (or error) event is fired. If no items are present, the load event is
    fired immediately.
    @param screen Owner screen
    @param group Group to upload (upload starts immediately)
*/
class UploadDialogController
{ constructor(screen, uploadsession)
  {
    this.screen = null;
    this.dialog = null;
    //this.group = null;
    this.done = false;
    this.busylock = null;

    this.uploadsession = uploadsession;
    this.screen = screen;

    if(this.uploadsession.isStarted())
      throw new Error("UploadDialogController must be set up before starting the uploadsession");

    // Mark the ui busy for testing purposes
    this.busylock = dompack.flagUIBusy();

    this.uploadsession.addEventListener("wh:upload-start", evt => this.gotStart());
    this.uploadsession.addEventListener("wh:upload-progress", evt => this.gotProgress());
    this.uploadsession.addEventListener("wh:upload-end", evt => this.gotEnd(evt.detail));
  }

  /** Compute division factor, postfix and presentation values for a list of byte-sites
      Uses the max value to compute the best presentation
  */
  computePresentationSizes(values)
  {
    var max = Math.max.apply(null, values);
    var divider = 1024, postfix = 'KB';
    if (max > 1250 * 1024)
      divider = 1024*1024, postfix = 'MB';

    return { divider:   divider
           , postfix:   postfix
           , values:    values.map(function(i) { return { txt: (i / divider).toFixed(1) }; })
           };
  }

  /// Calculate the progress texts to show
  computeTexts()
  {
    var state = this.uploadsession.getStatus();
    var size_stuff = this.computePresentationSizes([ state.uploaded, state.size ]);
    var speed_stuff = this.computePresentationSizes([ state.speed ]);

    var retval =
        { progress: 100 * state.uploaded / state.size
        , sizes: size_stuff.values[0].txt + ' / ' + size_stuff.values[1].txt + ' ' + size_stuff.postfix
        , speed: state.speed ? speed_stuff.values[0].txt + ' ' + speed_stuff.postfix + '/s' : getTid('tollium:shell.upload.progress.calculating')
        };
    return retval;
  }

  gotStart()
  {
    var texts = this.computeTexts();
    this.dialog = this.screen.displayapp.createScreen(
        { frame:        { bodynode: 'root'
                        , specials: ['cancelaction']
                        , title: getTid('tollium:shell.upload.progress.title')
                        }
        , root:         { type: 'panel', lines: [{ layout: "block", items: [ {item:"body"} ]}
                                                ,{ layout: "block", items: [ {item:"footer"} ]}
                                                ]
                        }
        , body:         { type: 'panel'
                        , lines: [ { title: getTid('tollium:shell.upload.progress.progress'), items: [{item:"progress"}]}
                                 , { title: getTid('tollium:shell.upload.progress.size'), items: [{item:"sizestxt"}] }
                                 , { title: getTid('tollium:shell.upload.progress.speed'), items: [{item:"speedtxt"}] }
                                 ]
                        , spacers: { top:true, bottom:true, left:true, right:true }
                        , width: '75x'
                        }
        , footer:       { type: 'panel'
                        , lines: [{items: [{item:"cancelbutton"}], layout:'right'}
                                 ]
                        , spacers: { top:true, bottom:true, left:true, right:true }
                        , isfooter: true
                        , width:'1pr'
                        }
        , progress:     { type: 'progress', width: '1pr' }
        , sizestxt:     { type: 'text', value: texts.sizes }
        , speedtxt:     { type: 'text', value: texts.speed }
        , cancelaction: { type: 'action', hashandler: true, unmasked_events: ['execute'] } //ADDME can we lose the hashandler requirement? perhaps even unmasked_events ?
        , cancelbutton: { type: 'button', title: getTid('tollium:common.actions.cancel'), action: 'cancelaction' }
        });

    this.dialog.getComponent('progress').onMsgSetValMax({ max: 100, value: texts.progress });
    this.dialog.setMessageHandler("cancelaction", "execute", this.wantAbort.bind(this));
    this.dialog.setMessageHandler("frame", "close", this.wantAbort.bind(this));
  }

  gotProgress()
  {
    if (this.dialog)
    {
      var texts = this.computeTexts();
      this.dialog.getComponent('progress').onMsgSetValMax({ max: 100, value: texts.progress });
      this.dialog.getComponent('sizestxt').setValue(texts.sizes, false);
      this.dialog.getComponent('speedtxt').setValue(texts.speed, false);
    }
  }

  gotEnd(detail)
  {
    if (this.dialog)
    {
      // Disable cancel for visual feedback
      this.dialog.getComponent('cancelbutton').setEnabled(false);
    }

    if(!detail.success)
    {
      //TODO can't we use simplescreen.es here?
      this.done = true;

      var errormessagedialog = this.screen.displayapp.createScreen(
          { frame:        { bodynode: 'root', specials: ['closeaction'], title: getTid('tollium:shell.upload.messages.errortitle') }
          , root:         { type: 'panel', lines: [{ layout: "block", items: [ {item:"body"} ]}
                                                  ,{ layout: "block", items: [ {item:"footer"} ]}
                                                  ]
                          }
          , body:         { type: 'panel'
                          , lines: [ { items: [{item:"text"}], layout:'left' }
                                   ]
                          , spacers: { top:true, bottom:true, left:true, right:true }
                          }
          , footer:       { type: 'panel'
                          , lines: [ { items: [{item:"closebutton"}], layout:'right' }
                                   ]
                          , spacers: { top:true, bottom:true, left:true, right:true }
                          , isfooter: true
                          , width:'1pr'
                          }
          , text:         { type: 'text', value: getTid('tollium:shell.upload.messages.unknownerror') }
          , closeaction:  { type: 'action', hashandler: true, unmasked_events: ['execute'] } //ADDME can we lose the hashandler requirement? perhaps even unmasked_events ?
          , closebutton:  { type: 'button', title: getTid('tollium:common.actions.close'), action: 'closeaction' }
          });

      errormessagedialog.setMessageHandler("closeaction", "execute", this.gotErrorDialogClose.bind(this, errormessagedialog));
      errormessagedialog.setMessageHandler("frame", "close", this.gotErrorDialogClose.bind(this, errormessagedialog));
    }
  }

  gotErrorDialogClose(errordialog, data, callback)
  {
    // Unbusy for this handler
    callback();

    // Close the error dialog, then the progress dialog
    errordialog.terminateScreen();
    this.close();
  }

  wantAbort(data, callback)
  {
    // Unbusy for this handler
    callback();

    // If already done (and still showing the dialog) we're waiting for tollium callbacks to close the dialog.
    // So ignore user abort.
    if (this.done)
      return;

    // Abort upload & close dialog
    this.uploadsession.abort();
    //this.close();
  }

  close()
  {
    // Abort group (noop if already done with loading)
    //this.group.abort();

    // Close progress dialog if still present
    if (this.dialog)
      this.dialog.terminateScreen();
    this.dialog = null;

    // Close busylock if still present
    if (this.busylock)
      this.busylock.release();
    this.busylock = null;
  }
}

export default UploadDialogController;
