import UploadDialogController from './dialogs/uploadcontroller';
import ImgeditDialogController, { type ImageSettings, type RefPoint } from './dialogs/imgeditcontroller';
import type { ToddCompBase } from './componentbase';
import { MultiFileUploader, requestFiles, type UploadInstructions, type UploadRequestOptions } from '@webhare/upload';
import type { CurrentDragData } from './dragdrop';
import { isTruthy } from '@webhare/std';
import { flagUIBusy } from '@webhare/dompack';
import type { FlatRowKey } from '@mod-tollium/webdesigns/webinterface/components/list/list';

// eslint-disable-next-line @typescript-eslint/no-require-imports
require("../common.lang.json");


export type TolliumUploadedCallback = (files: Array<{
  type: "file";
  filename: string;
  filetoken: string;
}>, closecallback: () => void) => void;

/** Presents a HTML5 file selection dialog, uploads selected files to a component (with progress dialog). On success,
    calls processing callback that must close the progress dialog by callback.
*/
export async function uploadFiles(component: ToddCompBase, uploadedcallback: TolliumUploadedCallback, options?: UploadRequestOptions) {
  const files = await requestFiles(options);
  if (!files) {
    uploadedcallback([], () => { });
    return;
  }

  const uploader = new MultiFileUploader(files);
  void runUpload(component, uploader, uploadedcallback);
}

async function uploadBlobs(component: ToddCompBase, blobs: Blob[], uploadedcallback: TolliumUploadedCallback) {
  const uploader = new MultiFileUploader(blobs.map(blob => new File([blob], "blob", { type: blob.type })));
  void runUpload(component, uploader, uploadedcallback);
}

async function uploadFilesWithPath(component: ToddCompBase, files: ItemWithFullpath[], uploadedcallback: TolliumUploadedCallback) {
  const uploader = new MultiFileUploader(files.map(item => item.file));
  void runUpload(component, uploader, uploadedcallback);
}

async function runUpload(component: ToddCompBase, uploader: MultiFileUploader, uploadedcallback: TolliumUploadedCallback) {
  const response = await component.asyncRequest<UploadInstructions>("canUpload", uploader.manifest);
  const aborter = new AbortController;
  const uploadcontroller = new UploadDialogController(component.owner, aborter);
  using lock = component.owner.lockScreen();
  void lock;

  try {
    const result = await uploader.upload(response, { onProgress: uploadcontroller.onProgress, signal: aborter.signal });
    uploadcontroller.gotEnd({ success: true }); //disables cancel button until we have a chance to fully dismiss the dialog
    uploadcontroller.close();
    uploadedcallback(result.map(i => ({ type: "file", filename: i.name, filetoken: i.token })), () => { });
  } catch (e) {
    console.error("upload exception", e);
    //TODO uploadcontroller.gotEnd({ success: false });  - and give the user a chance to see it? how to trigger?

    uploadedcallback([], () => uploadcontroller.close());
  }
}

type ItemWithFullpath = { file: File; fullpath: string };

async function gatherUploadFiles(items: FileSystemEntry[]): Promise<ItemWithFullpath[]> {
  const files: ItemWithFullpath[] = [];

  for (let i = 0; i < items.length; ++i) {
    if (items[i].isDirectory) {
      const contents = await new Promise<FileSystemEntry[]>(resolve => {
        const reader = (items[i] as FileSystemDirectoryEntry).createReader();
        reader.readEntries(resolve);
      });
      files.push(...await gatherUploadFiles(contents));
    } else {
      const file: File = await new Promise<File>(resolve => (items[i] as FileSystemFileEntry).file(resolve));
      files.push({ file, fullpath: items[i].fullPath });
    }
  }
  return files;
}

export type ImageUploadCallbackData = {
  name: string;
  token: string;
  //note that refpoint needs to be lowercase here as asyncQueue will snake_case it oherwise
  extradata: { imageeditor: { refpoint: RefPoint | null } };
};
export type ImageUploadCallback = (data: ImageUploadCallbackData) => Promise<void>;

export async function handleImageUpload(component: ToddCompBase, file: File | { type: string; url?: string; name: string; source_fsobject: number; refPoint?: RefPoint }, imgcallback: ImageUploadCallback, options: {
  mimetype: string;
  imgsize: unknown;
  action: string;
}) {
  if ("refpoint" in file)
    throw new Error("refpoint? should be refPoint"); //TODO remove once imageedit typings are complete

  const imageeditdialog = new ImgeditDialogController(component.owner, options);
  const settings: ImageSettings = {
    refPoint: "refPoint" in file && file.refPoint ? file.refPoint : null,
    fileName: file.name
  };

  if ("lastModified" in file) //ugly way to dfiferentiate a real 'uploaded' File from EditImage.file
    imageeditdialog.loadImageBlob(file, settings);
  else
    imageeditdialog.loadImageSrc(file.url, settings);

  const done = await imageeditdialog.defer.promise;
  // Note: settings is null when the image wasn't edited after upload
  if (done.blob) {
    const handleUploadedBlobs = async (files: Array<{
      type: "file";
      filename: string;
      filetoken: string;
    }>, uploadcallback: () => void) => {
      // Only called when a file is actually uploaded
      const extradata = {
        imageeditor: {
          // source_fsobject: parseInt(file.source_fsobject) || 0, //FIXME where to preserve this? what is the source? why do we even have this number on the client side?
          refpoint: done.settings && done.settings.refPoint
        }
      };
      await imgcallback({ name: file.name, token: files[0].filetoken, extradata });
      uploadcallback();
      done.editcallback();
    };

    void uploadBlobs(component, [done.blob], (files, uploadcallback) => void handleUploadedBlobs(files, uploadcallback));
  } else {
    // Nothing to upload, we're done
    done.editcallback();
  }
}

export type DropMessage = {
  source: 'local' | 'files' | 'external';
  sourcecomp: string; //name of component where the drag originated (if local)
  items: unknown[];
  dropeffect: 'copy' | 'move' | 'link' | 'none' | '';
  droplocation?: string;
  target?: FlatRowKey;
};

/** Given an accepted drop, upload files to a component (with progress dialog), call callback when done (successfully)
    Marks tollium as busy until callback is called.
    @param component - Component
    @param dragdata - Dragdata (return value of $todd.checkDropTarget)
    @param callback - Callback to call when done uploading. Signature: function (draginfo, dialogclosecallback)
*/
export async function uploadFilesForDrop(component: ToddCompBase, dragdata: CurrentDragData, callback: (msg: DropMessage, resolve: () => void) => void) {
  const draginfo = dragdata.getData();

  const islocal: boolean = !dragdata.hasExternalSource() && draginfo && draginfo.source.owner === component.owner;
  const firstFile: File | null = dragdata.getFiles()[0] ?? null;

  const msg: DropMessage = {
    source: islocal ? 'local' : firstFile ? 'files' : 'external',
    sourcecomp: islocal ? draginfo.source.name : '',
    items: draginfo ? draginfo.items : [],
    dropeffect: dragdata.getDropEffect()
  };

  if (!firstFile) {
    // No files? Just a busy lock is good enough
    const busylock = component.owner.lockScreen();
    callback(msg, busylock.release.bind(busylock));
    return;
  }

  // If this is a drop through an <acceptfile type="edit" > accept rule, open the image editor before uploading
  if (dragdata.acceptrule && dragdata.acceptrule.imageaction === "edit") {
    void handleImageUpload(component, firstFile, async (imgdata: ImageUploadCallbackData) => {
      msg.items.push({ type: 'file', ...imgdata, extradata: null });
      return new Promise<void>(resolve => callback(msg, resolve));
    },
      { mimetype: firstFile.type, imgsize: dragdata.acceptrule.imgsize, action: "" });

    return;
  }

  // Not a drop on an imgedit, just upload the files
  const items = dragdata.getItems();

  let files: ItemWithFullpath[];
  { //we'll build a new filelist. setup a quick lock for compatibility with existing tests which don't necesarily expect this await
    //TODO make this cleaner but we need more control over the upload dialog then .. we need to keep the lock *until* the subdialog is visible
    using lock = flagUIBusy();
    void lock;
    files = await gatherUploadFiles(items.map(item => item.webkitGetAsEntry()).filter(isTruthy));
  }

  // Start upload of the file
  void uploadFilesWithPath(component, files,
    function (receivedFiles, closedialogcallback) {
      // got an error uploading the file?
      if (!receivedFiles.length)
        return void closedialogcallback();

      // Files are uploaded, add them to the items list
      receivedFiles.forEach((file, idx) => {
        msg.items.push({ type: 'file', token: file.filetoken, name: file.filename, fullpath: files[idx].fullpath });
      });

      callback(msg, closedialogcallback);
    });
}
