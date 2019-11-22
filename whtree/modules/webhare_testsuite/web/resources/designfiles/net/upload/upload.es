import * as compatupload from '@mod-system/js/compat/upload';
import * as dompack from 'dompack';

let postfix;

function logItemEvent(event, type, elt)
{
  // Log all events
  console.log('event: ', type, 'loaded:', event.loaded || 'n/a', elt && elt.item.status, event.type);

  // Load & progress give actual progress
  if ([ 'load', 'progress' ].includes(event.type))
  {
    if (elt)
    {
      elt.progress.style.width = (event.detail.size ? (80 * event.loaded / event.size) : 0) + 'px';

      /* Items have status
          '': running
          'loaded': completed successfully
          'abort': aborted
          'error': other error
      */
      var speed = elt.item.status == 'loaded' ? elt.item.getAverageSpeed() : elt.item.getCurrentSpeed();

      postfix = 'B/s';
      if (speed > 1100000)
      {
        postfix = 'MB/s';
        speed /= 1000000;
      }
      else if (speed > 1100)
      {
        postfix = 'KB/s';
        speed /= 1000;
      }
      elt.speed.textContent = (speed ? speed.toFixed(1) + " " + postfix : 'n/a');

      // Show the total elapsed time and remaining time
      if (elt.total)
        elt.total.textContent = 'elapsed: ' + elt.item.getElapsedTime().toFixed(0) + 's remaining: ' + elt.item.getRemainingTime().toFixed(0) + 's';

      elt.type.textContent = elt.item.type ? " (type: " + elt.item.type + ")" : "";
      console.log(elt.item);
    }
  }
  else if (elt)
  {
    // Error occurred: show the elapsed time and error
    elt.speed.textContent = elt.item.status;
    if (elt.total)
      elt.total.textContent = 'elapsed: ' + elt.item.getElapsedTime().toFixed(0) + 's status: ' + elt.item.status;
    elt.type.textContent = elt.item.type ? " (type: " + elt.item.type + ")" : "";
  }
}

function addProgress(id, item, name, total)
{
  var span = dompack.create('div', { className: 'progress' });
  document.getElementById('status').appendChild(span);
  var progress = dompack.create('div', { className: 'fill' });
  span.appendChild(progress);
  var speed = dompack.create('div', { className: 'speed' });
  span.appendChild(speed);
  document.getElementById('status').appendChild(document.createTextNode(name));
  var type = dompack.create('span', { 'textContent': item.type ? " type: (" + item.type + ")" : ""});
  document.getElementById('status').appendChild(type);
  document.getElementById('status').appendChild(dompack.create('br'));

  return { progress: progress
         , speed:    speed
         , item:     item
         , total:    total
         , type:     type
         };
}

var currentgroup;

function logGroupEvents(group)
{
  dompack.empty(document.getElementById('status'));
  dompack.empty(document.getElementById('tokens'));
  dompack.empty(document.getElementById('files'));

  group.pvt_subitems.forEach(function(file, i)
    {
      var elt = addProgress('item' + i, file, file.name);

      file.addEventListener('progress', evt => logItemEvent(evt, 'progress file #'+i, elt));
      file.addEventListener('loadstart', evt => logItemEvent(evt, 'loadstart file #'+i, null));
      file.addEventListener('abort', evt => logItemEvent(evt, 'abort file #'+i, elt));
      file.addEventListener('load', evt => logItemEvent(evt, 'load file #'+i, elt));
      file.addEventListener('error', evt => logItemEvent(evt, 'error file #'+i, elt));
      file.addEventListener('loadend', evt => logItemEvent(evt, 'loadend file #'+i, null));
    });

  var elt = addProgress('total', group, 'total', document.getElementById('time'));

  group.addEventListener('loadstart', evt => logItemEvent(evt, 'loadstart:g', null));
  group.addEventListener('progress', evt => logItemEvent(evt, 'progress:g', elt));
  group.addEventListener('load', evt => logItemEvent(evt, 'load:g', elt));
  group.addEventListener('abort', evt => logItemEvent(evt, 'abort:g', elt));
  group.addEventListener('error', evt => logItemEvent(evt, 'error:g', elt));
  group.addEventListener('loadend', evt => logItemEvent(evt, 'loadend:g', null));

  group.addEventListener('loadend', function()
    {
      document.getElementById('tokens').textContent = group.getFileTokens().join('\n');

      group.getCompletedFiles().forEach(function(item)
        {
          document.getElementById('files').appendChild(dompack.create('div',
            { text: 'Name: "' + item.name + '", size: ' + item.size + ', type: ' + item.type + ', token: ' + item.filetoken }));
        });

      console.log('Items:', group.getFileTokens());
      console.log(group.getItems());
    });

  currentgroup = group;
}

function uploadHTML5Files(files, callback)
{
  var group = compatupload.UploadItemGroup.fromFileList(window.location.href, files);
  if (callback)
    group.addEventListener('loadend', callback);
//  else
    logGroupEvents(group);
  group.schedule();
  return group;
}

function devel_upload_init()
{
  document.getElementById('doaction2').addEventListener('click', function()
    {
      var changed = false;
      document.getElementById('myinput').addEventListener('change',
          function()
          {
            if (changed) return;
            changed = true;
            uploadHTML5Files(document.getElementById('myinput').files);
          });
      document.getElementById('myinput').focus();
      document.getElementById('myinput').click();
    });

  document.getElementById('doabort').addEventListener('click', function()
    {
      if (currentgroup)
        currentgroup.abort();
    });

  document.getElementById('dodialoguploadsingle').addEventListener('click', function()
    {
      var group = compatupload.selectAndUploadFile({});

      // Upload starts when loadstart event fires.
      group.addEvent('loadstart', logGroupEvents.bind(null, group));
      return false;
    });

  document.getElementById('dodialoguploadmultiple').addEventListener('click', function()
    {
      var group = compatupload.selectAndUploadFile({ multiple: true });

      // Upload starts when loadstart event fires.
      group.addEventListener('loadstart', logGroupEvents.bind(null, group));

      return false;
    });
}

window.test =
{ runUpload: function(files, callback)
  {
    return uploadHTML5Files(files, callback);
  }
, logGroupEvents: logGroupEvents
};

dompack.onDomReady(devel_upload_init);
