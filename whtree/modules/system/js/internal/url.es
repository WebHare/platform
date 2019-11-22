/* THIS LIBRARY WILL BE REMOVED but socialite still depends on it
*/

function decodeURIVariable(val)
{
  return decodeURIComponent(val.replace(/\+/g, '%20'));
}

function getUrlEncVariable(varname, srcarray)
{
  if(!srcarray.length)
    return'';

  varname = varname.toUpperCase();
  for(var i=0;i<srcarray.length;++i)
  {
    var equals=srcarray[i].indexOf('=');
    if(equals==-1)
      continue;
    if(decodeURIComponent(srcarray[i].substr(0,equals)).toUpperCase() == varname)
      return decodeURIVariable(srcarray[i].substr(equals+1));
  }
  return '';
}
function getUrlEncAllVariable(srcarray)
{
  var result = [];
  for(var i=0;i<srcarray.length;++i)
  {
    var equals=srcarray[i].indexOf('=');
    if(equals==-1)
    {
      // the variable exists, but without a value
      result.push({ name:  decodeURIComponent(srcarray[i])
                  , value: null // no value is defined
                  });
      continue;
    }
    else
    {
      result.push({ name:  decodeURIComponent(srcarray[i].substr(0,equals))
                  , value: decodeURIVariable(srcarray[i].substr(equals+1))
                  });
    }
  }
  return result;
}
function replaceOrDeleteVariable(varname, varvalue, doDelete, list)
{
  var newVars = [];
  var findVarname = varname.toUpperCase();
  list.each(function(item)
    {
      var equals=item.indexOf('=');
      if(equals==-1)
        return;
      var thisVarname = decodeURIComponent(item.substr(0,equals)).toUpperCase();
      if (thisVarname == findVarname)
      {
        if (!doDelete)
        {
          newVars.push(encodeURIComponent(varname) + '=' + encodeURIComponent(varvalue));
          doDelete = true;
        }
        return;
      }
      newVars.push(item);
    });

  if (!doDelete)
    newVars.push(encodeURIComponent(varname) + '=' + encodeURIComponent(varvalue));

  return newVars;
}

class URL
{
  constructor(url)
  {
    this.baseurl = '';
    this.vars = [];
    this.hash = '';
    this.hashvars = [];

    var hashstart = url.indexOf('#');
    if(hashstart!=-1)
    {
      this.hash = url.substr(hashstart);
      this.hashvars = this.hash.substr(1).split(';').join('&').split('?').join('&').split('&');
      url=url.substr(0,hashstart);
    }

    var startvars = url.indexOf('?');
    var nextamp = url.indexOf('&');
    var nextsemi = url.indexOf(';');
    if(nextamp!=-1 && (nextamp<startvars || startvars==-1))
      startvars = nextamp;
    if(nextsemi!=-1 && (nextsemi<startvars || startvars==-1))
      startvars = nextsemi;
    if(startvars==-1)
    {
      this.baseurl = url;
    }
    else
    {
      this.vars = url.substr(startvars+1).split(';').join('&').split('?').join('&').split('&');
      this.baseurl = url.substr(0,startvars);
    }
  }

  getVariable (varname)
  {
    return getUrlEncVariable(varname, this.vars);
  }
  getHashVariable(varname)
  {
    return getUrlEncVariable(varname, this.hashvars);
  }
  getAllVariables()
  {
    return getUrlEncAllVariable(this.vars);
  }
  getAllHashVariables()
  {
    return getUrlEncAllVariable(this.hashvars);
  }

  addVariable(varname, varvalue)
  {
    this.vars.push(encodeURIComponent(varname) + '=' + encodeURIComponent(varvalue));
  }
  addHashVariable(varname, varvalue)
  {
    this.hashvars.push(encodeURIComponent(varname) + '=' + encodeURIComponent(varvalue));
    this.__updateHashFromVars();
  }

  deleteVariable(varname)
  {
    this.vars = replaceOrDeleteVariable(varname, '', true, this.vars);
  }
  deleteHashVariable(varname)
  {
    this.hashvars = replaceOrDeleteVariable(varname, '', true, this.hashvars);
    this.__updateHashFromVars();
  }
  replaceVariable(varname, varvalue)
  {
    this.vars = replaceOrDeleteVariable(varname, varvalue, false, this.vars);
  }
  replaceHashVariable(varname, varvalue)
  {
    this.hashvars = replaceOrDeleteVariable(varname, varvalue, false, this.hashvars);
    this.__updateHashFromVars();
  }
  __updateHashFromVars()
  {
    var hash = '';
    this.hashvars.each( item => hash += (hash==''?'#':'&' + item ));
    this.hash = hash;
  }
  getUrl()
  {
    let url = this.baseurl;
    if (this.vars.length)
      url += "?" + this.vars.join("&");
    return url + this.hash;
  }
  getHash()
  {
    return this.hash;
  }
  resolveToAbsoluteURL(relurl)
  {
    return resolveToAbsoluteURL(this.baseurl, relurl);
  }
}

/** @short Collapse a path containing duplicate slashes, '.' and '..' entries
    @long This function returns the shortest possible path that points to the
          same location as the specified path. It also eliminates any '..'
          entries at the beginning of the path.
          Any terminating slash is also cleared, unless this path refers to a root directory.
    @param path Path to collapse
    @example
//Logs "/a/b/c"
console.log($wh.collapsePath("/a/b/g/../c/"));

//Logs "b" (because drive letters are ignored)
console.log($wh.collapsePath("A:/../b"));

    @return The cleaned and collapsed path
*/
function collapsePath(url)
{
  var parts = url.split('/');

  // Absolute URL? Remove the first /, add back later
  var prepend = '';
  if (parts.length > 1 && !parts[0])
  {
    parts.unshift();
    prepend = '/';
  }

  for (var i = 0; i < parts.length;)
  {
    if (parts[i] == '.' || !parts[i]) // '/./' = '/', '//' = '/'
      parts.splice(i, 1);
    else if (parts[i] == '..') // 'a/../' = '', ../ = ''
    {
      if (i == 0)
        parts.splice(i, 1);
      else
        parts.splice(--i, 2);
    }
    else
      ++i;
  }
  return prepend + parts.join('/');
}

function getSchemeDefaultPort(scheme)
{
  switch(scheme) //port numbers from RFC1738
  {
    case "ftp": { return 21; }
    case "http": { return 80; }
    case "gopher": { return 70; }
    case "nntp": { return 119; }
    case "telnet": { return 23; }
    case "wais": { return 210; }
    case "prospero": { return 1525; }
    //well known protocols
    case "https": { return 443; }
    case "ldap": { return 389; }
    case "ldaps": { return 636; }
    case "smtp": { return 25; }
    default: { return 0; }
  }
}

function splitURLQueryHash(url)
{
  var query_part = '';
  var fragment_part = '';

  var fragment_pos = url.indexOf('#');
  if (fragment_pos!=-1)
  {
    fragment_part = url.substr(fragment_pos, url.length);
    url = url.substr(0,fragment_pos);
  }

  var query_pos = url.indexOf('?');
  if(query_pos!=-1)
  {
    query_part = url.substr(query_pos, url.length);
    url = url.substr(0, query_pos);
  }
  return { path: url
         , query: query_part
         , fragment: fragment_part
         };
}

//we need stricter encoding of URL parts before the first slash
function strictEncodeURL(indata)
{
  indata = encodeURIComponent(indata);
  indata = indata.replace(/\//g, '%2F');
  return indata;
}

function packAuthority(scheme, user, pwd, host, port)
{
  var authority = '';
  if(user != "")
  {
    authority = authority + strictEncodeURL(user);
    if(pwd != "")
      authority = authority + ":" + strictEncodeURL(pwd);
    authority = authority + "@";
  }

  //ip host names require special work
  if (host.match(/::/))
    authority = authority + "[" + host + "]";
  else
    authority = authority + strictEncodeURL(host);
  if(port != getSchemeDefaultPort(scheme))
    authority = authority + ":" + port;

  return authority;
}

/** @short Unpack a URL into its parts
    @long This function splits and parses as much of a URL as possible. The parts it cannot decode, will require a manual DecodeURL when interpreted!
    @param inurl URL to decode
    @return A record explaining this URL
    @cell(string) return.scheme URL Scheme (in lowercase, url-decoded)
    @cell(string) return.schemespecificpart The data after the colon (NOT decoded!)
    @cell(string) return.user Username (url-decoded)
    @cell(string) return.password Password (url-decoded)
    @cell(string) return.host The host to connect to (url-decoded)
    @cell(string) return.port The port to connect to (if not specified, and the URL scheme does not specify a default, it will be 0)
    @cell(string) return.urlpathslash True if the URL path started with a slash
    @cell(string) return.urlpath The path and variables requested (NOT decoded! does not include the slash following the hostname/port number)
    @cell(boolean) return.secure True if this is a secure (SSL, TLS) protocol
*/
function unpackURL(inurl)
{
  var retval =  { scheme: ""
                , schemespecificpart: ""
                , user: ""
                , password: ""
                , host: ""
                , port: 0
                , urlpathslash: false
                , urlpath: ""
                , secure: false
                };

  var missingslash = false;
  var firstcolon = inurl.indexOf(':');
  if (firstcolon == -1)
  {
    retval.scheme = inurl;
    return retval;
  }

  retval.scheme = decodeURIComponent(inurl.substr(0, firstcolon)).toLowerCase();
  inurl = inurl.substr(firstcolon+1);
  retval.schemespecificpart = inurl;

  if (retval.schemespecificpart.substr(0, 2) != "//") //not an internet host format
    return retval;

  inurl = inurl.substr(2);

  //Find the first slash, it terminates the user..port part
  var firstslash = inurl.indexOf('/');
  if (firstslash == -1)
    firstslash = inurl.length;

  var firstat = inurl.indexOf('@');
  if (firstat>=0 && firstat < firstslash)
  {
    //Username and possible password are present
    var pwdcolon = inurl.indexOf(':');
    if (pwdcolon>=0 && pwdcolon < firstat)
    {
      retval.user = decodeURIComponent(inurl.substr(0, pwdcolon));
      retval.password = decodeURIComponent(inurl.substr(pwdcolon+1, firstat-pwdcolon-1));
    }
    else
    {
      retval.user = decodeURIComponent(inurl.substr(0, firstat));
    }
    inurl = inurl.substr(firstat+1);
    firstslash = inurl.indexOf('/');
    if (firstslash == -1)
      firstslash = inurl.length;
  }

  //Common mistake, at least in http* urls, specifying a ? right after the URL (ADDME perhaps this shoud apply for all URLs? check rfc)
  if(retval.scheme == "http" || retval.scheme == "https")
  {
    var firstquestionmark = inurl.indexOf('?');
    if(firstquestionmark != -1 && firstquestionmark < firstslash)
    {
      firstslash = firstquestionmark;
      missingslash = true;
    }
  }

  var closing_bracket = 0;
  if(inurl.substr(0, 1) == "[") //RFC3986 IP-literal
    closing_bracket = inurl.indexOf(']');

  if(closing_bracket>0) //Indeed an IP-literal
  {
    retval.host = decodeURIComponent(inurl.substr(1, closing_bracket-1));
    if (inurl.substr(closing_bracket+1, 1) == ':') //port follows
      retval.port = parseInt(decodeURIComponent(inurl.substr(closing_bracket+2, firstslash-closing_bracket-2)),0);
    else
      retval.port = getSchemeDefaultPort(retval.scheme);
  }
  else
  {
    var portcolon = inurl.indexOf(':');
    if(portcolon>=0 && portcolon < firstslash)
    {
      retval.host = decodeURIComponent(inurl.substr(0,portcolon));
      retval.port = parseInt(decodeURIComponent(inurl.substr(portcolon+1, firstslash-portcolon-1)),0);
    }
    else
    {
      retval.host = decodeURIComponent(inurl.substr(0,firstslash));
      retval.port = getSchemeDefaultPort(retval.scheme);
    }
  }

  retval.urlpathslash = !(missingslash || firstslash==inurl.length);
  retval.urlpath = inurl.substr(firstslash + (missingslash ? 0 : 1));
  retval.secure = ["aas","ftps","https","imaps","ldaps","shttp","sips","ssh","sftp"].indexOf(retval.scheme) != -1;
  return retval;
}

/** @short Repack a split URL back into a string
    @cell unpackedurl.scheme URL Scheme
    @cell unpackedurl.schemespecificpart The data after the colon. Ignored if 'host' is set (should be properly url-encoded)
    @cell unpackedurl.user Username
    @cell unpackedurl.password Password
    @cell unpackedurl.host The host to connect to
    @cell unpackedurl.port The port to connect tp
    @cell unpackedurl.urlpathslash Optional, true if the urlpath should start with a slash (note that if urlpath is non-empty, this flag is ignored)
    @cell unpackedurl.urlpath The path and variables requested (should be properly url-encoded) - for backwards compatibility, this never includes the initial slash.
*/
function repackURL(unpackedurl)
{
  var url = encodeURIComponent(unpackedurl.scheme);
  url = url + ":";

  if(unpackedurl.host != "") //we need a host
  {
    var urlpathslash = unpackedurl.urlpath != "" || unpackedurl.urlpathslash;
    url = url + "//"
             + packAuthority(unpackedurl.scheme, unpackedurl.user, unpackedurl.password, unpackedurl.host, unpackedurl.port)
             + (urlpathslash ? "/" : "") + unpackedurl.urlpath;
  }
  else
  {
    url = url + unpackedurl.schemespecificpart;
  }
  return url;
}

/** @short Is this URL absolute ?
    @param url URL to check
    @param consider_root_absolute Consider URLs starting with '/' to be absolute (although they are actually relative to the current server)
    @return True if the specified URL is absolute
*/
function isAbsoluteURL(url, consider_root_absolute)
{
  // Ported from wh::internet/urls.whlib
  var first_slash = url.indexOf('/');
  if (first_slash == 0)
    return consider_root_absolute || false;

  var first_colon = url.indexOf(':');

  //If a protocol appears (colon) before the first/any slash, the URL is absolute
  if (first_colon != -1 && (first_colon < first_slash || first_slash == -1))
    return true;
  //URLs containing no initial slash or protocol are relative
  return false;
}

function resolveToAbsoluteURL(baseurl, newurl)
{
  if (isAbsoluteURL(newurl, false))
    return newurl;

  var striptempprotocol = false;
  if (baseurl.substr(0, 2) == "//")
  {
    striptempprotocol = true;
    baseurl = "x-resolvetemp:" + baseurl;
  }

  var unpacked = unpackURL(baseurl);
  var is_authority_rewrite = newurl.substr(0,2) == "//" && unpacked.schemespecificpart.substr(0,2) == "//";

  if (is_authority_rewrite)
    unpacked = unpackURL(unpacked.scheme + ":" + newurl); //overwrite the URL basics

  //Now we need to rewrite the urlpath in 'unpacked'
  var split = splitURLQueryHash(unpacked.urlpath);
  var must_terminate = split.path.match(/.+\/$/) || split.path.match(/\/\.\.$/) || split.path.match(/\/\.$/) || split.path == '..' || split.path == '.';
  if (!is_authority_rewrite)
  {
    var splitnewurl = splitURLQueryHash(newurl);
    if (splitnewurl.path != "")
    {
      must_terminate = splitnewurl.path.match(/.+\/$/) || splitnewurl.path.match(/\/\.\.$/) || splitnewurl.path.match(/\/\.$/) || splitnewurl.path == '..' || splitnewurl.path == '.';

      if(splitnewurl.path.substr(0,1) == "/") //absolute path update
        split.path = splitnewurl.path;
      else //relative path update
        split.path = split.path.substr(0, split.path.lastIndexOf('/')) + "/" + splitnewurl.path;

      split.query = splitnewurl.query;
    }

    if(splitnewurl.path != "" || splitnewurl.query != "")
      split.query = splitnewurl.query;

    split.fragment = splitnewurl.fragment;
  }

  //Collapse the path
  split.path = collapsePath("/" + split.path, false);
  if (must_terminate && !split.path.match(/\/$/))
    split.path = split.path + "/";

  //Rewrite the URL
  unpacked.urlpath = split.path.substr(1) + split.query + split.fragment;

  var retval = repackURL(unpacked);
  if (striptempprotocol && retval.substr(0, 14) == "x-resolvetemp:")
    retval = retval.substr(14);

  return retval;
}

function makeRelativeLinkFromURL(current_url, convert_url, scope)
{
  scope = scope || '';
  if(!["","protocol","root"].contains(scope))
    throw "Invalid scope for MakeRelativeLinkFromURL: only '', 'protocol' and 'root' are supported";

  //Print("MakeRelativeLinkFromURL " || current_url || ' * ' || convert_url || '\n');

  var striptempprotocol = false;
  if (current_url.substr(0, 2) == "//")
  {
    striptempprotocol = true;
    current_url = "x-resolvetemp:" + current_url;
  }

  //Ensure convert_url is absolute and both URLs are collapsed
  convert_url = resolveToAbsoluteURL(current_url, convert_url);
  current_url = resolveToAbsoluteURL(current_url, current_url);

  var base = unpackURL(current_url);
  var convert = unpackURL(convert_url);

  if(base.scheme != convert.scheme) //schemes differ
    return convert_url; //There's no relative way to jump between URLs

  if(base.schemespecificpart.substr(0, 2) != "//") //not an internet host format
    return convert_url; //No definition of relative URLs

  if(base.host != convert.host || base.port != convert.port || scope == "protocol") //Host/port part differs
    return convert.schemespecificpart; //a //link which rests host but not scheme, should do

  if(scope=="root")
    return "/" + convert.urlpath;

  var split_current = splitURLQueryHash(base.urlpath);
  var split_convert = splitURLQueryHash(convert.urlpath);

  if(split_current.path == split_convert.path) //Basically the same resource, but possibly different scripting parameters
  {
    if(split_current.query != split_convert.query && split_convert.query != "" && split_convert.fragment != "") //different queries
      return split_convert.query + split_convert.fragment;
    if(split_convert.fragment!="")
      return split_convert.fragment;
    if(split_convert.query!="")
      return split_convert.query; //repeat query for ie-compat
  }

  var curpath = split_current.path.split("/");
  var destpath = split_convert.path.split("/");

  //Figure out equal part
  var equalpart = 0;
  while(equalpart < curpath.length && equalpart < destpath.length && curpath[equalpart] == destpath[equalpart])
    ++equalpart;

  var rellink = '';
  if(equalpart < curpath.length) //we need to go up a few levels
  {
    for(var i=0;i<curpath.length-equalpart-1;++i)
      rellink = rellink + "../";
  }
  if(equalpart < destpath.length) //we need to go down these levels
  {
    rellink = rellink + destpath.slice(equalpart).join("/");
  }

  if(rellink == "") //the urls were completely identical
    rellink = destpath[curpath.length-1] != "" ? destpath[curpath.length-1] : "./";

  var retval = rellink + split_convert.query + split_convert.fragment;
  if (striptempprotocol && retval.substr(0, 14) == "x-resolvetemp:")
    retval = retval.substr(14);

  return retval;
}

function isValidHTTPURL(url)
{
  var unpacked = unpackURL(url);

  if (!["http","https"].contains(unpacked.scheme))
    return false;

  if (unpacked.port < 1 || unpacked.port > 65535)
    return false;

  if (unpacked.host == "")
    return false;

  return true;
}

function updateURLVariables(url, changes)
{
  let o = new URL(url);
  Object.keys(changes).forEach(key =>
  {
    let value = changes[key];
    if (value)
      o.replaceVariable(key, value);
    else
      o.deleteVariable(key);
  });
  return o.getUrl();
}

module.exports = { isValidHTTPURL: isValidHTTPURL
                 , makeRelativeLinkFromURL: makeRelativeLinkFromURL
                 , resolveToAbsoluteURL: resolveToAbsoluteURL
                 , collapsePath: collapsePath
                 , unpackURL: unpackURL
                 , repackURL: repackURL
                 , isAbsoluteURL: isAbsoluteURL
                 , URL: URL
                 , updateURLVariables: updateURLVariables
                 };
