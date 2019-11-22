SocialiteSession = function(account,application)
{
  this.account=account;
  this.application=application;
  this.oncomplete=null;
  this.ondenied=null;
  this.requestpermissions=[];
  this.sessionid=SocialiteSession.sessions.length;
  this.securetoken='';
  SocialiteSession.sessions.push(this);
}
SocialiteSession.sessions=[];
SocialiteSession.prototype.__completed = function(securetoken)
{
  this.securetoken=securetoken;
  if(securetoken)
  {
    if(this.oncomplete)
      this.oncomplete.apply(this, [securetoken]);
  }
  else
  {
    if(this.ondenied)
      this.ondenied.apply(this, []);
  }
}
SocialiteSession.prototype.GetAuthenticationWindowURL = function()
{
  //ADDME: full absolute url?
  return '/tollium_todd.res/socialite/auth.shtml'
         + '?account=' + encodeURIComponent(this.account)
         + '&application=' + encodeURIComponent(this.application)
         + '&permissions=' + encodeURIComponent(this.requestpermissions.join('||'))
         + '&ssid=' + this.sessionid;
}

function socialite_ParseURLArgs()
{
  if (window.location.search == '')
    return {};

  var argstring = window.location.search;
  var URLargs = argstring.substring(1).split("&");

  var args = {};

  for ( var paramCount = 0 ; paramCount < URLargs.length ; paramCount++ )
  {
    var argCombo = URLargs[ paramCount ].split("=");
    args[ unescape(argCombo[0]) ] = unescape(argCombo[1]);
  };

  return args;
}

function socialiteNotifyOwnerAfterJSRedirect()
{
  var args = socialite_ParseURLArgs();
  window.opener.SocialiteSession.sessions[args.ssid].__completed(args.securetoken);
}
