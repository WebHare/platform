import UploadDialogController from './dialogs/uploadcontroller';
import ImgeditDialogController from './dialogs/imgeditcontroller';
import * as compatupload from '@mod-system/js/compat/upload';

require("../common.lang.json");


function getUploadTolliumData(component)
{
  return JSON.stringify(
          { l: component.owner.hostapp.whsid
          , w: component.owner.screenname
          , n: component.name
          });
}

/** Presents a HTML5 file selection dialog, uploads selected files to a component (with progress dialog). On success,
    calls processing callback that must close the progress dialog by callback.
    @param component Component
    @param uploadcallback Signature: function(files, dialogclosecallback)
    @param options
    @cell options.mimetypes Array of mime types of files that are accepted (can also contain "image/*", "audio/*" or "video/*")
    @cell options.multiple
*/
export async function uploadFiles(component, uploadedcallback, options)
{
  //Note: this works because selectAndUploadFile will always yield at some point, allowing us to receive the value of group, and allowing onLoadstart to use it
  options={...options};

  let files = await compatupload.selectFiles({ mimetype:options.mimetypes
                                             , multiple:options.multiple
                                             });

  uploadBlobs(component, files, uploadedcallback);
}

/** Presents a HTML5 file selection dialog, receive selected files. On success, calls processing callback.
    @param component Component
    @param uploadcallback Signature: function(files)
    @param options
    @cell options.mimetypes Array of mime types of files that are accepted (can also contain "image/*", "audio/*" or "video/*")
    @cell options.multiple
*/
export async function receiveFiles(component, options)
{
  options = options || {};
  return compatupload.selectFiles({ mimetype:options.mimetypes
                                  , multiple:options.multiple
                                  });
}

export async function uploadBlobs(component, blobs, uploadedcallback, options)
{
  let uploader = new compatupload.UploadSession(blobs, { params: { tolliumdata: getUploadTolliumData(component) } });
  let uploadcontroller = new UploadDialogController(component.owner, uploader);
  let result = await uploader.upload();

  try
  {
    uploadedcallback(result, () => uploadcontroller.close());
  }
  catch(e)
  {
    console.error("upload exception",e);
    uploadedcallback([], () => uploadcontroller.close());
  }
}

async function gatherUploadFiles(items)
{
  let files = [];

  for (let i=0;i<items.length;++i)
  {
    if(items[i].isDirectory)
    {
      let contents = await new Promise((resolve,reject)=>
      {
        let reader = items[i].createReader();
        reader.readEntries(resolve);
      });
      files = files.concat(await gatherUploadFiles(contents));
    }
    else
    {
      files.push(await new Promise((resolve,reject)=>
      {
        items[i].file(blob =>
        {
          blob.fullpath = items[i].fullPath;
          resolve(blob);
        });
      }));
    }
  }
  return files;
}



/** Given an accepted drop, upload files to a component (with progress dialog), call callback when done (successfully)
    Marks tollium as busy until callback is called.
    @param component
    @param dragdata Dragdata (return value of $todd.checkDropTarget)
    @param callback Callback to call when done uploading. Signature: function(draginfo, dialogclosecallback)
    @cell draginfo.source Source: 'local'/'files'/'external'
    @cell draginfo.sourcecomp Source component name (only if source == 'local')
    @cell items List of items (for type='file', with cells 'token' and 'name')
    @cell dialogclosecallback Callback to close the progress dialog after drop has finished)
*/
export async function uploadFilesForDrop(component, dragdata, callback)
{
  var draginfo = dragdata.getData();
  var files = dragdata.getFiles();

  var islocal = !dragdata.hasExternalSource() && draginfo && draginfo.source.owner == component.owner;
  var gotfiles = files && files.length;

  var msg =
      { source:     islocal ? 'local' : gotfiles ? 'files' : 'external'
      , sourcecomp: islocal ? draginfo.source.name : ''
      , items:      draginfo ? draginfo.items : []
      , dropeffect: dragdata.getDropEffect()
      };

  if (!gotfiles)
  {
    // No files? Just a busy lock is good enough
    var busylock = component.owner.displayapp.getBusyLock();
    callback(msg, busylock.release.bind(busylock));
    return;
  }

  // If this is a drop through an <acceptfile type="edit" > accept rule, open the image editor before uploading
  if (files.length == 1 && dragdata.acceptrule && dragdata.acceptrule.imageaction == "edit")
  {
    var file = files[0];
    if (!ImgeditDialogController.checkTypeAllowed(component.owner, file.type))
      return;

    const options = { imgsize: dragdata.acceptrule.imgsize
                    };
    const dialog = new ImgeditDialogController(component.owner, options);
    dialog.loadImageBlob(file, { filename: file.name });

    const done = await dialog.defer.promise;

    if (done.blob)
    {
      // Start upload of the file
      uploadBlobs(component, [done.blob],
        function(files, closedialogcallback)
        {
          if (!files.length)
          {
            // got an error uploading the file
            closedialogcallback();
            done.editcallback();
            return;
          }

          // There is only 1 file uploaded
          var filename = ensureExtension(files[0].name, files[0].fileinfo.extension);

          msg.items.push({ type: 'file', token: files[0].filetoken, name: filename, extradata: null, fullpath: file.fullpath });

          callback(msg, function()
          {
            closedialogcallback();
            done.editcallback();
          });
        });
    }
    else
    {
      // Nothing to upload, we're done
      done.editcallback();
    }
  }
  else
  {
    let items = dragdata.getItems();
    if(items.length && items[0].webkitGetAsEntry)
    {
      //we'll build a new filelist
      files = await gatherUploadFiles(items.map(item => item.webkitGetAsEntry()));
    }

    // Start upload of the file
    uploadBlobs(component, files,
      function(files, closedialogcallback)
      {
        // got an error uploading the file?
        if (!files.length)
          return void closedialogcallback();

        // Files are uploaded, add them to the items list
        files.forEach(file =>
        {
          msg.items.push({ type: 'file', token: file.filetoken, name: file.name, fullpath: file.fullpath });
        });

        callback(msg, closedialogcallback);
      });
  }
}

export function ensureExtension(filename, extension)
{
  if (!filename || !extension)
    return filename;
  if (extension.indexOf(".") != 0)
    extension = "." + extension;

  // Check for the right extension (png vs jpg, depending on lossless)
  var extdot = filename.lastIndexOf(".");
  if (extdot < 0)
    filename += extension;
  else if (filename.substr(extdot) != extension)
    filename = filename.substr(0, extdot) + extension;
  return filename;
}
