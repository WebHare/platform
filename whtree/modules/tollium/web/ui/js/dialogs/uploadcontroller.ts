import "../../common.lang.json";
import * as dompack from "dompack";
import { getTid } from "@webhare/gettid";
import type { UploadProgressStatus } from "@webhare/upload";
import type { ObjFrame } from "@mod-tollium/webdesigns/webinterface/components/frame/frame";
import type ObjProgress from "@mod-tollium/webdesigns/webinterface/components/progress/progress";


/** Displaying a progress dialog during a \@webhare/frontend uploader
    @param screen - Owner screen
*/
export default class UploadDialogController {
  started = false;
  lastProgress?: UploadProgressStatus;
  aborter;
  screen: ObjFrame;
  dialog?: ObjFrame;
  done = false;
  busylock?;

  constructor(screen: ObjFrame, aborter: AbortController) {
    this.aborter = aborter;
    this.screen = screen;

    // Mark the ui busy for testing purposes
    this.busylock = dompack.flagUIBusy();
  }

  onProgress = (progress: UploadProgressStatus) => {
    this.lastProgress = progress;
    if (!this.started) {
      this.started = true;
      this.gotStart();
    }
    this.gotProgress();
  };

  /** Compute division factor, postfix and presentation values for a list of byte-sites
      Uses the max value to compute the best presentation
  */
  computePresentationSizes(values: number[]) {
    const max = Math.max(...values);
    let divider = 1024, postfix = 'KB';
    if (max > 1250 * 1024) {
      divider = 1024 * 1024;
      postfix = 'MB';
    }

    return {
      divider: divider,
      postfix: postfix,
      values: values.map(i => ({ txt: (i / divider).toFixed(1) }))
    };
  }

  /// Calculate the progress texts to show
  computeTexts() {
    const state = { uploaded: this.lastProgress?.uploadedBytes || 0, size: this.lastProgress?.totalBytes || 0, speed: this.lastProgress?.uploadSpeed || 0 };
    const size_stuff = this.computePresentationSizes([state.uploaded, state.size]);
    const speed_stuff = this.computePresentationSizes([state.speed]);

    const retval =
    {
      progress: 100 * state.uploaded / state.size,
      sizes: size_stuff.values[0].txt + ' / ' + size_stuff.values[1].txt + ' ' + size_stuff.postfix,
      speed: state.speed ? speed_stuff.values[0].txt + ' ' + speed_stuff.postfix + '/s' : getTid('tollium:shell.upload.progress.calculating')
    };
    return retval;
  }

  gotStart() {
    const texts = this.computeTexts();
    this.dialog = this.screen.displayapp!.createScreen(
      {
        frame: {
          bodynode: 'root',
          specials: ['cancelaction'],
          title: getTid('tollium:shell.upload.progress.title')
        },
        root: {
          type: 'panel', lines: [
            { layout: "block", items: [{ item: "body" }] },
            { layout: "block", items: [{ item: "footer" }] }
          ]
        },
        body: {
          type: 'panel',
          lines: [
            { title: getTid('tollium:shell.upload.progress.progress'), items: [{ item: "progress" }] },
            { title: getTid('tollium:shell.upload.progress.size'), items: [{ item: "sizestxt" }] },
            { title: getTid('tollium:shell.upload.progress.speed'), items: [{ item: "speedtxt" }] }
          ],
          spacers: { top: true, bottom: true, left: true, right: true },
          width: '75x',
          minwidth: '35x', //setting an absolute width on a panel will enforce it as a minwidth unless explicitly set differently
        },
        footer: {
          type: 'panel',
          lines: [{ items: [{ item: "cancelbutton" }], layout: 'right' }],
          spacers: { top: true, bottom: true, left: true, right: true },
          isfooter: true,
          width: '1pr'
        },
        progress: { type: 'progress', width: '1pr' },
        sizestxt: { type: 'text', value: texts.sizes },
        speedtxt: { type: 'text', value: texts.speed },
        cancelaction: { type: 'action', hashandler: true, unmasked_events: ['execute'] }, //ADDME can we lose the hashandler requirement? perhaps even unmasked_events ?
        cancelbutton: { type: 'button', title: getTid('~cancel'), action: 'cancelaction' }
      });

    (this.dialog.getComponent('progress') as ObjProgress).onMsgSetValMax({ max: 100, value: texts.progress });
    this.dialog.setMessageHandler("cancelaction", "execute", this.wantAbort.bind(this));
    this.dialog.setMessageHandler("frame", "close", this.wantAbort.bind(this));
  }

  gotProgress() {
    if (this.dialog) {
      const texts = this.computeTexts();
      (this.dialog.getComponent('progress') as ObjProgress).onMsgSetValMax({ max: 100, value: texts.progress });
      this.dialog.getComponent('sizestxt')!.setValue(texts.sizes);
      this.dialog.getComponent('speedtxt')!.setValue(texts.speed);
    }
  }

  gotEnd(detail: { success: boolean }) {
    if (this.dialog) {
      // Disable cancel for visual feedback
      this.dialog.getComponent('cancelbutton')!.setEnabled(false);
    }

    if (!detail.success) {
      //TODO can't we use simplescreen.es here?
      this.done = true;

      const errormessagedialog = this.screen.displayapp!.createScreen(
        {
          frame: { bodynode: 'root', specials: ['closeaction'], title: getTid('tollium:shell.upload.messages.errortitle') },
          root: {
            type: 'panel', lines: [
              { layout: "block", items: [{ item: "body" }] },
              { layout: "block", items: [{ item: "footer" }] }
            ]
          },
          body: {
            type: 'panel',
            lines: [{ items: [{ item: "text" }], layout: 'left' }],
            spacers: { top: true, bottom: true, left: true, right: true }
          },
          footer: {
            type: 'panel',
            lines: [{ items: [{ item: "closebutton" }], layout: 'right' }],
            spacers: { top: true, bottom: true, left: true, right: true },
            isfooter: true,
            width: '1pr'
          },
          text: { type: 'text', value: getTid('tollium:shell.upload.messages.unknownerror') },
          closeaction: { type: 'action', hashandler: true, unmasked_events: ['execute'] }, //ADDME can we lose the hashandler requirement? perhaps even unmasked_events ?
          closebutton: { type: 'button', title: getTid('~close'), action: 'closeaction' }
        });

      errormessagedialog.setMessageHandler("closeaction", "execute", this.gotErrorDialogClose.bind(this, errormessagedialog));
      errormessagedialog.setMessageHandler("frame", "close", this.gotErrorDialogClose.bind(this, errormessagedialog));
    }
  }

  gotErrorDialogClose(errordialog: ObjFrame, data: unknown, callback: () => void) {
    // Unbusy for this handler
    callback();

    // Close the error dialog, then the progress dialog
    errordialog.terminateScreen();
    this.close();
  }

  wantAbort(data: unknown, callback: () => void) {
    // Unbusy for this handler
    callback();

    // If already done (and still showing the dialog) we're waiting for tollium callbacks to close the dialog.
    // So ignore user abort.
    if (this.done)
      return;

    // Abort upload & close dialog
    this.aborter.abort();
    //this.close();
  }

  close() {
    // Close progress dialog if still present
    if (this.dialog)
      this.dialog.terminateScreen();
    this.dialog = undefined;

    // Close busylock if still present
    if (this.busylock)
      this.busylock.release();
    this.busylock = undefined;
  }
}
