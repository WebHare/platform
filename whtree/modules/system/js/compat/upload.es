import * as dompack from 'dompack';
import * as browser from 'dompack/extra/browser';
import '@mod-system/js/wh/integration'; //make debugflags work


/// Global queue manager object
var queue_manager = null;

let default_upload_chunk_size = 10000000; // 10 MB
var moving_average_max_history = 20000; // average current speed over max 20000 ms of history
var moving_average_min_history = 2000; // Need min 2000ms of history


export default class EventTarget
{
  constructor()
  {
    this.handlers = {};
  }
  addEventListener(eventtype, fn)
  {
    let eventhandlers = this.handlers[eventtype];
    if(!eventhandlers)
      eventhandlers = this.handlers[eventtype] = [];
    eventhandlers.push(fn);
  }
  removeEventListener(eventtype, fn)
  {
    let eventhandlers = this.handlers[eventtype];
    if(eventhandlers)
      eventhandlers = eventhandlers.filter(el => el!=fn);
  }
  dispatchEvent(event)
  {
    if(!('defaultPrevented' in event))
      throw new Error("Parameter passed is not an event");

    let eventhandlers = this.handlers[event.type];
    if(eventhandlers)
      eventhandlers.forEach(fn => fn.call(this, event));
    return event.defaultPrevented;
  }
}

/** Upload item. Might be a group, or an uploader.
    Fires loadstart, progress*, abort/load/error, loadend events.
*/
class RawUploadItem extends EventTarget
{
  constructor()
  {
    super();

    /** Current status of this upload
        '': Not started or busy
        'loaded' Upload complete
        'aborted' Aborted
        'error' An error occurred
    */
    this.status = ''; // '', 'loaded', 'aborted', 'error'

      /// Session id of the item (used to group uploads into one session)
    this.pvt_sessionid = '';

      /// Parent group (used for sharing session ids)
    this.pvt_parentgroup = null;

      /// Starting time of upload
    this.pvt_start = null;

      /// History of progress events (of last moving_average_max_history ms)
    this.pvt_history = [];

      /// Finishing time of upload
    this.pvt_end = null;
  }

  /// Returns the total size of this item
  getUploadSize()
  {
    return 0;
  }

  /// Returns the number of bytes uploaded
  getUploaded()
  {
    return 0;
  }

  /// Schedule this item at a queue (or fire events when empty)
  schedule()
  {
  }

  /// Abort upload of this item. Must fire events (loadstart, abort, loadend) when not yet scheduled!
  abort()
  {
  }

  /// Returns time elapsed, in seconds
  getElapsedTime()
  {
    var now = (new Date).getTime();
    if (!this.pvt_start || this.pvt_start == now)
      return 0;

    if (this.pvt_end)
      now = this.pvt_end;

    return (now - this.pvt_start) / 1000;
  }

  /// Time remaing in seconds (0 if unknown / very long / n/a)
  getRemainingTime()
  {
    var speed = this.getCurrentSpeed();
    if (!speed)
      return 0;
    var remainingbytes = this.getUploadSize() - this.getUploaded();
    return remainingbytes ? (remainingbytes / speed || 1) : 0;
  }

  /// Returns the average speed over the whole upload
  getAverageSpeed()
  {
    return this.getUploaded() / this.getElapsedTime();
  }

  /// Returns speed over last X seconds
  getCurrentSpeed()
  {
    if (this.pvt_history.length <= 1)
      return null;

    var last = this.pvt_history[this.pvt_history.length-1];
    var first = this.pvt_history[0];

    if (last.date - first.date < (this.status == 'loaded' ? 1 : moving_average_min_history))
      return null;

    return (last.loaded - first.loaded) / ((last.date - first.date) / 1000);
  }

  getCompletedFiles()
  {
    return [];
  }

  getFileTokens()
  {
    return [];
  }

  getSessionId()
  {
    return this.pvt_sessionid || (this.pvt_parentgroup && this.pvt_parentgroup.getSessionId()) || '';
  }

  setSessionId (sessionid)
  {
    this.pvt_sessionid = sessionid;
    if (this.pvt_parentgroup)
      this.pvt_parentgroup.setSessionId(sessionid);
  }

  getEventDetail()
  {
    return { uploaded: this.getUploaded()
           , size: this.getUploadSize()
           , speed: this.getCurrentSpeed()
           };
  }

  fireLoadStart()
  {
    if(dompack.debugflags.upl)
      console.log("[upl] firing loadstart", this);

    this.pvt_start = (new Date).getTime();
    dompack.dispatchCustomEvent(this, 'loadstart', { bubbles:false, cancelable:false, detail: { type: 'loadstart' }});
  }

  fireProgress()
  {
    if(dompack.debugflags.upl)
      console.log("[upl] firing loadprogress", this);

    var size = this.getUploadSize();
    var loaded = this.getUploaded();

    this.addProgressToHistory(loaded);
    dompack.dispatchCustomEvent(this, 'progress', { bubbles:false, cancelable:false, detail: { loaded: loaded, size: size }});
  }

  fireLoad()
  {
    if(dompack.debugflags.upl)
      console.log("[upl] firing load", this);

    var size = this.getUploadSize();
    var loaded = this.getUploaded();
    this.pvt_end = (new Date).getTime();

    this.addProgressToHistory(loaded);
    dompack.dispatchCustomEvent(this, 'load', { bubbles:false, cancelable:false, detail: { loaded: loaded, size: size }});
  }

  addProgressToHistory(loaded)
  {
    var now = (new Date).getTime();
    this.pvt_history.push({ date: now, loaded: loaded });
    while ((now - this.pvt_history[0].date) > moving_average_max_history) //
      this.pvt_history.splice(0, 1);
  }

  fireLoadEnd()
  {
    if(dompack.debugflags.upl)
      console.log("[upl] firing loadend", this);

    if (!this.pvt_end)
      this.pvt_end = (new Date).getTime();
    dompack.dispatchCustomEvent(this, "loadend", { bubbles:false, cancelable:false });
  }
}

/** Upload item that does uploading by itself
    Fires loadstart, progress*, abort/load/error, loadend
*/
class SchedulableRawUploadItem extends RawUploadItem
{
  constructor()
  {
    super();
  }
  schedule()
  {
    queue_manager.schedule(this);
  }

  canStart()
  {
  }

  start()
  {
  }

  getCompletedFiles()
  {
    return [];
  }

  getFileTokens()
  {
    return [];
  }
}

/** Aggregates multiple uploader items into one unified upload (all sub-items are aborted upon error). Fires events
    as if the group is one big uploaded item

    This is used to group the chunks of a single file upload, but also to group the files in a multifile upload
*/
class UploaderAggregator extends RawUploadItem
{
  constructor()
  {
    super();
    this.pvt_subitems=[];
    this.pvt_aborting = false;
    this.pvt_sentloadstart = false;
    this.pvt_sentloadend = false;
  }

  setItems(subitems)
  {
    this.status = '';
    this.pvt_subitems = subitems;
    this.pvt_aborting = false;
    this.pvt_sentloadstart = false;
    this.pvt_sentloadend = false;

    // Listen to events of the sub-items
    this.pvt_subitems.forEach(function(i)
      {
        i.pvt_parentgroup = this;
        i.addEventListener('loadstart', this.gotLoadStart.bind(this));
        i.addEventListener('progress', this.fireProgress.bind(this));
        i.addEventListener('abort', this.gotAbort.bind(this));
        i.addEventListener('error', this.gotError.bind(this));
        i.addEventListener('load', this.gotLoad.bind(this));
        i.addEventListener("loadend", this.gotLoadEnd.bind(this));
      }.bind(this));
  }

  /// Schedule all subitems, run some events when empty
  schedule()
  {
    this.pvt_subitems.forEach(function(i,idx) { i.schedule(); });

    if (!this.pvt_subitems.length) //simulate an upload
    {
      this.gotLoadStart(null);
      this.gotLoad(null);
      this.gotLoadEnd(null);
    }
  }

  getUploadSize()
  {
    var size = 0;
    this.pvt_subitems.forEach(function(i) { size += i.getUploadSize(); });
    return size;
  }

  getUploaded()
  {
    var loaded = 0;
    this.pvt_subitems.forEach(function(i) { loaded += i.getUploaded(); });
    return loaded;
  }

  abort()
  {
    if (this.pvt_subitems.length)
    {
      if (!this.pvt_aborting)
        this.pvt_aborting = true;
      this.pvt_subitems.forEach(i => { if (!i.status) i.abort(); });
    }
    else // Always send an abort back, even when not having items yet.
    {
      this.gotLoadStart(null);
      this.gotAbort(null);
      this.gotLoadEnd(null);
    }
  }

  getCompletedFiles()
  {
    var result = [];
    if (this.status == 'loaded')
      this.pvt_subitems.forEach(function(i) { result = result.concat(i.getCompletedFiles()); });
    //sanitize the result, don't leak internal data

    return result.map( file => ({ name: file.name, filetoken: file.filetoken, size: file.size, fileinfo:file.fileinfo, type: file.type, url: file.downloadurl, fullpath: file.fullpath }));
  }

  getFileTokens()
  {
    var result = [];
    if (this.status == 'loaded')
      this.pvt_subitems.forEach(function(i) { result = result.concat(i.getFileTokens()); });
    return result;
  }

  gotLoadStart(event)
  {
    if (!this.pvt_sendloadstart)
    {
      this.pvt_sendloadstart = true;
      this.fireLoadStart();
    }
  }

  gotAbort(event)
  {
    if (!this.status)
    {
      this.status = 'aborted';
      dompack.dispatchCustomEvent(this, 'abort', { bubbles:false, cancelable:false });
      this.abort();
    }
  }

  gotError(event)
  {
    if (!this.status)
    {
      this.status = 'error';
      dompack.dispatchCustomEvent(this, 'error', { bubbles:false, cancelable:false });
      this.abort();
    }
  }

  gotLoad(event)
  {
    if (!this.status && !this.pvt_subitems.some(function(i) { return i.status != 'loaded'; }))
    {
      this.status = 'loaded';
      this.fireLoad();
    }
  }

  gotLoadEnd(event)
  {
    if (!this.pvt_subitems.some(function(i) { return i.status == ''; }) && !this.pvt_sendloadend)
    {
      this.pvt_sendloadend = true;
      this.fireLoadEnd();
    }
  }
}


/** HTML 5 upload items, wraps a HTML5 file
*/
export class Html5UploadItem extends UploaderAggregator
{
  constructor(host, html5file, options)
  {
    super();

    /// Name of the file
    this.name = '';

    /// Size of the file
    this.size = 0;

    /// Default upload chunk size
    this.upload_chunk_size = (options ? options.uploadchunksize : 0) || default_upload_chunk_size;

    /// Content-type of the file
    this.type = '';

    /// File token (to retrieve the file on the server)
    this.filetoken = '';

    /// Detectfiletype info
    this.fileinfo = null;

    /// Original File object (if applicable)
    this.file = null;

    /// Parameters to send in request
    this.params = {};

    /// Base transfer url
    this.transferbaseurl = '';

    this.pvt_host = '';
    this.pvt_fileid = 0;

    this.pvt_host = host;
    this.name = html5file.name;
    this.size = html5file.size;
    this.type = html5file.type;
    this.fullpath = html5file.fullpath || '';
    this.file = html5file;
    this.params = options&&options.params?{...options.params}:{};
    this.pvt_file = html5file;
  }

  schedule()
  {
    var items = [];

    var total = this.file.size;
    if(!(total >= 0))
      throw new Error("Invalid file size received"); //would cause an endless loop!

    var ofs = 0;
    while (true)
    {
      // Upload in chunks
      var chunksize = Math.min(this.upload_chunk_size, total - ofs);

      items.push(new Html5SingleChunk(this,
        { offset:   ofs
        , size:     chunksize
        , host:     this.pvt_host
        }));

      ofs += chunksize;
      if (ofs == total)
        break;
    }

    this.setItems(items);
    this.transferbaseurl = items[0].transferbaseurl;
    super.schedule();
  }

  getCompletedFiles()
  {
    return this.status == 'loaded' ? [ this ] : [];
  }

  getFileTokens()
  {
    return this.filetoken ? [ this.filetoken ] : [];
  }
}

/** This component uploads a html5 chunk to the upload receiver
*/
class Html5SingleChunk extends SchedulableRawUploadItem
{
  /** @param uploadfile Upload file
      @param firstchunk For second+ chunks, reference to first chunk (needed to stitch them together at server side)
      @param options
      @cell options.name Name of chunk (needed for first chunk)
      @cell options.fullsize Full size of file (needed for first chunk)
      @cell options.offset Offset of chunk within file
  */
  constructor(uploadfile, options)
  {
    super();
    this.uploadfile = uploadfile;
    this.xmlhttp = null;
    this.pvt_loaded = 0;
    this.pvt_sendloadstart = false;
    this.pvt_sendloadend = false;
    this.options = { offset: 0, size:0, host: '', ...options};
    this.transferbaseurl = (new URL("/.system/filetransfer/filetransfer.shtml", this.options.host)).toString();
  }

  getUploadSize()
  {
    return this.options.size;
  }

  getUploaded()
  {
    return this.pvt_loaded;
  }

  /// Returns whether this chunk can start uploading (either first chunk or first chunk has completed)
  canStart()
  {
    return this.options.offset == 0 || this.uploadfile.sessionid != '';
  }

  /** Start upload. Events will be sent (loadstart + progress* + (abort|error|load) + loadend) during upload
  */
  start()
  {
    this.xmlhttp = new XMLHttpRequest;
    if (this.xmlhttp.overrideMimeType) // IE doesn't have this.
      this.xmlhttp.overrideMimeType("application/octet-stream");

    if (!this.canStart())
      throw new Error("First chunk must have finished for rest of chunks to be sent");

    var url = this.transferbaseurl + "?type=upload-html5&offset=" + this.options.offset
              + "&chunksize=" + this.options.size
              + "&sessionid=" + this.getSessionId();
    if (this.options.offset != 0)
      url += "&fileid=" + this.uploadfile.pvt_fileid;
    else
    {
      url += "&size=" + this.uploadfile.size
          + "&filename=" + encodeURIComponent(this.uploadfile.name);
      Object.keys(this.uploadfile.params).forEach( key => { url += "&" + encodeURIComponent(key) + "=" + encodeURIComponent(this.uploadfile.params[key]); });
    }

    this.xmlhttp.upload.addEventListener('progress', this.gotProgress.bind(this));
    this.xmlhttp.addEventListener('loadstart', this.gotLoadStart.bind(this));
    this.xmlhttp.addEventListener('abort', this.gotAbort.bind(this));
    this.xmlhttp.addEventListener('error', this.gotError.bind(this));
    this.xmlhttp.addEventListener('load', this.gotLoad.bind(this));
    this.xmlhttp.addEventListener("loadend", this.gotLoadEnd.bind(this));

    this.xmlhttp.open("POST", url, true, "", "");

    // Slice only when we are are really a subset of the data to be sent
    let data;
    if (this.options.offset != 0 || this.options.size != this.uploadfile.file.size)
      data = this.uploadfile.file.slice(this.options.offset, this.options.offset + this.options.size);
    else
      data = this.uploadfile.file;

    /* FIXME: it seems that android browser doesn't like this code -
       work around it!
    */
    this.xmlhttp.send(data);
  }

  /// Aborts upload
  abort()
  {
    if (!this.status)
    {
      if (this.xmlhttp)
        this.xmlhttp.abort();
      else
      {
        this.gotAbort(null);
        this.gotLoadEnd(null);
      }
    }
  }

  gotLoadStart(event)
  {
    if (!this.pvt_sentloadstart)
    {
      this.pvt_sentloadstart = true;
      this.fireLoadStart();
    }
  }

  gotProgress(event)
  {
    this.pvt_loaded = event.loaded;
    this.fireProgress();
  }

  gotAbort(event)
  {
    if (!this.status)
    {
      this.status = 'aborted';
      dompack.dispatchCustomEvent(this, 'abort', { bubbles:false, cancelable:false });
    }
  }

  gotError(event)
  {
    if (!this.status)
    {
      this.status = 'error';
      dompack.dispatchCustomEvent(this, 'error', { bubbles:false, cancelable:false });
    }
  }

  gotLoad(event)
  {
    if (this.xmlhttp.status == 200)
    {
      this.pvt_loaded = this.options.size;
      var data = JSON.parse(this.xmlhttp.responseText);
      if (data && data.sessionid)
        this.setSessionId(data.sessionid);
      if (!this.uploadfile.pvt_fileid)
        this.uploadfile.pvt_fileid = (data && data.fileid) || 0;
      if (data && data.filetoken)
        this.uploadfile.filetoken = data.filetoken;
      if (data && data.fileinfo)
        this.uploadfile.fileinfo = data.fileinfo;

      if (data && data.complete)
      {
        this.uploadfile.type = data.contenttype;
        this.uploadfile.downloadurl = data.downloadurl;
      }
      this.status = 'loaded';
      this.fireLoad();
    }
    else
      this.gotError(event);
  }

  gotLoadEnd(event)
  {
    if (!this.pvt_sentloadend)
    {
      this.pvt_sentloadend = true;
      this.fireLoadEnd();
    }
  }
}


/** A group of upload items
*/
export class UploadItemGroup extends UploaderAggregator
{
  getItems()
  {
    return this.pvt_subitems.slice();
  }
}

/// Generate a group of items from a file input element
UploadItemGroup.fromFileList = function (uploadhost, filelist, options)
{
  var items = [];
  for (var i = 0; i < filelist.length; ++i)
    items.push(new Html5UploadItem(uploadhost, filelist[i], options));

  var group = new UploadItemGroup;
  group.setItems(items);
  return group;
};

/** Upload manager
*/
class UploadManager
{
  constructor()
  {
    this.pending=[];
    this.running=[];
  }
  schedule(item)
  {
    if (item instanceof SchedulableRawUploadItem)
    {
      item.addEventListener("loadend", this.gotEnd.bind(this, item));
      this.pending.push(item);
    }
    else
      item.schedule();

    this.processQueue();
  }

  gotEnd(item)
  {
    if(this.pending.indexOf(item) >= 0)
      this.pending.splice(this.pending.indexOf(item),1);
    if(this.running.indexOf(item) >= 0)
      this.running.splice(this.running.indexOf(item),1);
    this.processQueue();
  }

  processQueue()
  {
    if(dompack.debugflags.upl)
      console.log("[upl] process queue, running: " + this.running.length + " pending: " + this.pending.length, this);

    if (this.running.length < 1 && this.pending.length)
    {
      for (var i = 0; i < this.pending.length; ++i)
      {
        var item = this.pending[i];
        if (item.canStart())
        {
          this.pending.splice(i, 1);
          --i;
          this.running.push(item);
          item.start();
          if (this.running.length == 1)
            break;
        }
      }
    }

    if (this.running.length < 1 && this.pending.length)
      throw "Got blocked items in the queue";
  }
}

queue_manager = new UploadManager;


// Last input used for selecting a file that doesn't have files set
let lastinputnode = null;

/** Open a file selection dialog and upload one or more files. Can only be called within a click handler!
    @param options
    @cell options.multiple Whether to allow multiple file upload
    @cell options.mimetypes Array of mime types of files that are accepted (can also contain "image/*", "audio/*" or "video/*")
    @cell options.capture Optional input capture's attribute ('capture', 'user', 'environment', etc)
    @return Selection result object. Fires 'load' or 'abort'
    @cell return.input Used input element
    @cell return.files List of selected files (only valid when 'load' event has fired)
*/
export function selectFiles(options)
{
  options = {...options};
  let uploaddefer = dompack.createDeferred();

  let inputOptions = { type: "file"
                     , accept: (options.mimetypes || []).join(",")
                     , multiple: options.multiple
                     , style: { display: "none" }
                     };

  if (options.capture)
    inputOptions.capture = options.capture;

  let input = dompack.create('input', inputOptions);

  //let selectlock = dompack.flagUIBusy();

  // IE 10 & 11 won't open the file browser if the input element isn't in the DOM
  if (browser.getName() == 'ie')
  {
    if (lastinputnode)
      document.body.removeChild(lastinputnode);
    lastinputnode = input;
    document.body.appendChild(input);
  }

  // Set a handler on next action to capture someone cancelling the upload without telling us (browsers dont inform us the dialog is gone)
  var canceluploadhandler = function()
  {
    uploaddefer.resolve([]);
    window.removeEventListener('mousedown', canceluploadhandler, true);
    window.removeEventListener('keydown', canceluploadhandler, true);
  };
  window.addEventListener('mousedown', canceluploadhandler, true);
  window.addEventListener('keydown', canceluploadhandler, true);

  input.addEventListener("change", (event) =>
  {
    // Store files in input, destroy input element
    uploaddefer.resolve(input.files || []);
  });
  input.addEventListener("wh:upload-fake", (event) =>
  {
    uploaddefer.resolve(event.detail.files || []);
  });

  let uploader = null;
  try
  {
    uploader = window.top.wh_testapi_fakeupload;
    if(uploader)
    {
      if(dompack.debugflags.upl)
        console.log("[upl] Need to invoke callback to simulate upload");

      window.top.wh_testapi_fakeupload = null;
      setTimeout(() => uploader(input), 0);
      return uploaddefer.promise;
    }
  }
  catch(e)
  {
    //ignore fialure to grab the fake upload
  }

  if(dompack.debugflags.upl)
    console.log("[upl] Invoking browser's sendfile");
  // On IE, this blocks. Delay starting the upload on IE giving the user a consistent interface - loadstart event signals start
  input.click();

  return uploaddefer.promise;
}

export class UploadSession extends EventTarget
{
  constructor(files,options)
  {
    super();
    if(dompack.debugflags.upl)
      console.log("[upl] Create upload session",files,options);

    options = {...options};
    let host = options.host || dompack.getBaseURI();
    this.started = false;
    this.anyerror = false;

    /* Note: we explicitly let an empty file list pass. for event resolution
             purposes, we'll pretend it was an abort */
    if(files.length)
    {
      this.group = new UploadItemGroup(options);
      let items = Array.from(files).map(function(item)
          {
            return new Html5UploadItem(host, item, { params: options.params });
          });

      this.group.setItems(items);
    }
  }

  isStarted()
  {
    return this.started;
  }

  getStatus()
  {
    return this.group ? this.group.getEventDetail() : { uploaded:0, size:0, speed:0 };
  }

  abort()
  {
    if(dompack.debugflags.upl)
      console.log("[upl] Upload session abort invoked",this);
    this.gotabort=true;
    this.group.abort();
  }

  upload()
  {
    let uploaddefer = dompack.createDeferred();
    this.started=true;
    if(!this.group) //empty file list - like an abort, but never send the events
    {
      uploaddefer.resolve([]);
      return uploaddefer.promise;
    }

    this.group.addEventListener("loadstart", evt =>
    {
      if(dompack.debugflags.upl)
        console.log("[upl] Upload session dispatching wh:upload-start", this);
      this.started = true;
      dompack.dispatchCustomEvent(this, "wh:upload-start", { bubbles: false
                                                           , cancelable:false
                                                           });
    });
    this.group.addEventListener("progress", evt =>
    {
      if(dompack.debugflags.upl)
        console.log("[upl] Upload session dispatching wh:upload-progress");
      dompack.dispatchCustomEvent(this, "wh:upload-progress", { bubbles: false
                                                              , cancelable:false
                                                              });
    });
    this.group.addEventListener("error", event => this.anyerror = true);
    this.group.addEventListener("loadend", evt =>
    {
      let result = this.gotabort || this.anyerror ? [] : this.group.getCompletedFiles();
      if(dompack.debugflags.upl)
        console.log("[upl] Upload session dispatching wh:upload-end", this, result);

      dompack.dispatchCustomEvent(this, "wh:upload-end", { bubbles: false
                                                         , cancelable:false
                                                         , detail: { success: this.gotabort || !this.anyerror
                                                                   , files: result
                                                                   }
                                                         });
      uploaddefer.resolve(result);
    });

    this.group.schedule();
    return uploaddefer.promise;
  }
}

export function getFileAsDataURL(file)
{
  return new Promise( (resolve,reject) =>
  {
    let reader = new FileReader;
    reader.onload = function(readdata)
    {
      resolve(reader.result);
    };
    reader.onerror = function()
    {
      reject(new Error("Failed to load file"));
    };
    reader.readAsDataURL(file);
  });
}

export function setDefaultUploadChunkSize(newchunksize)
{
  default_upload_chunk_size = newchunksize;
}

