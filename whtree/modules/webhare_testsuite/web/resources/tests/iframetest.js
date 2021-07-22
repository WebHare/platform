var parenthost = '*';

$toddIFrame =
  { sendCallback: function(data)
    {
      window.parent.postMessage({ type: 'callback', data: data }, parenthost);
    }
  };

function listener(event)
{
  console.log("EVENT", event);
  switch (event.data.type)
  {
    case 'calljs':
      {
        var func = window[event.data.funcname];
        if (func)
          func.apply(window, event.data.args);
        else
          console.log("missing func", funcname);
      } break;
    case 'data':
      {
        document.getElementById('data').value = event.data.data.text;
      } break;
  }

  if(event.data.answer)
    window.parent.postMessage( { question: event.data.answer * event.data.answer }, event.origin);
}

window.addEventListener('message', listener);

function func1()
{
  var calls = document.getElementById('calls');
  var args = Array.prototype.slice.apply(arguments);
  calls.value += 'func1 '+ args.join(' ') + '\n';

  $toddIFrame.sendCallback({ type: 'receivedcall', args: args });
}


function adda(event)
{
  document.getElementById('data').value += 'a';
  console.log("Add-A function invoked in iframe - posting with type=data to parent frame");
  window.parent.postMessage({ type: 'data', data: { text: document.getElementById('data').value } }, '*');
  event.stopPropagation();
  event.preventDefault();
}
window.addEventListener
  ? document.getElementById('adda').addEventListener('click', adda)
  : document.getElementById('adda').attachEvent('onclick', adda);
