function sendNotification(form, approve)
{
  var xhr = new XMLHttpRequest();
  var formdata = new FormData(form);
  formdata.append("approve", approve);
  formdata.append("sleep", "0");
  formdata.append("isnotify", "1");
  xhr.onload = function()
  {
    // navigate on load (is easy for tests to wait for)
    var strippedurl = location.href.replace(/&notified=[^&]*/, "");
    location.href = strippedurl + "&notified=" + approve;
  };
  xhr.open("POST", location.href);
  xhr.send(formdata);
  return false;
}

document.getElementById("notifyapprovepayment").addEventListener("click", function(evt)
{
  sendNotification(this.parentNode, 'approved');
});

document.getElementById("notifyrejectpayment").addEventListener("click", function(evt)
{
  sendNotification(this.parentNode, 'rejected');
});

document.getElementById("notifypending").addEventListener("click", function(evt)
{
  sendNotification(this.parentNode, 'pending');
});
