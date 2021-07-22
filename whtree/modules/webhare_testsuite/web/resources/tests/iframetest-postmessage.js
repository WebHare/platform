function listener(event)
{
  if(event.data.answer)
    window.parent.postMessage( { question: event.data.answer * event.data.answer }, event.origin);
  if(event.data.request)
    window.parent.postMessage( { response: event.data.request * event.data.request, __requesttoken: event.data.__requesttoken }, event.origin);
}
window.addEventListener('message', listener);
