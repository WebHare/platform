//  set_qtext := parser->RemoveFromSet(parser->set_ascii, "\t\r\n \\\""); // from rfc 2822
//  set_text := parser->RemoveFromSet(parser->set_ascii, "\r\n"); // from rfc 2822
//  set_atext := parser->set_alpha || parser->set_digit || "!#$%&'*+-/=?^_`{|}~"; // from rfc 2822
//  set_fws := " \r\n\t";
//  set_ctext := parser->RemoveFromSet(parser->set_ascii, "()\\"); // from rfc 2822

function checkPhrase(phrase)
{
  // phrase = 1*word / obs-phrase
  // word = atom / quoted-string
  // atom = [CFWS] 1*atext [CFWS]
  // ccontent = ctext / quoted-pair / comment
  // comment = "(" *([FWS] ccontent) [FWS] ")"
  // CFWS = *([FWS] comment) (([FWS] comment) / FWS)
  // quoted-pair = ("\" text)
  // qcontent = qtext / quoted-pair
  // quoted-string = [CFWS] DQUOTE *([FWS] qcontent) [FWS] DQUOTE [CFWS]

  for (var i = 0; i < phrase.length; )
  {
    while (i < phrase.length && ' \r\n\t'.indexOf(phrase.substr(i, 1)) != -1)
      ++i;

    if (phrase.substr(i, 1) == '(')  // comment
    {
      ++i;
      var nesting = 1;
      while (nesting > 0 && i < phrase.length)
      {
        // accept ctext (= ascii - '()\\')
        while (i < phrase.length && '()\\'.indexOf(phrase.substr(i, 1)) == -1 && phrase.charCodeAt(i) < 128)
          ++i;
        switch (phrase.substr(i, 1))
        {
        case ')': --nesting; break;
        case '(': ++nesting; break;
        case '\\':
          {
            ++i;
            // Accept only text (ascii - '\r\n')
            if ('\r\n'.indexOf(phrase.substr(i, 1)) != -1 || phrase.charCodeAt(i) >= 128)
              return false;
          } break;
        default:
          return false;
        }
        ++i;
      }
      if (nesting != 0)
        return false;
    }
    else if (phrase.substr(i, 1) == '"')
    {
      // Parse quoted-string
      // Eat starting '"'
      ++i;
      var finished = false;
      while (!finished)
      {
        // Accept qtext + fws (ascii - '\t\r\n \"' + '\t\r\n ')
        while (i < phrase.length && '"\\'.indexOf(phrase.substr(i, 1)) == -1 && phrase.charCodeAt(i) < 128)
          ++i;
        switch (phrase.substr(i, 1))
        {
        case '"': finished = true; break;
        case '\\':
          {
            ++i;
            // Accept only text (ascii - '\r\n')
            if ('\r\n'.indexOf(phrase.substr(i, 1)) != -1 || phrase.charCodeAt(i) >= 128)
              return false;
          } break;
        default:
          {
            return false;
          }
        }
        // Eat ending '"' or char trailing \\
        ++i;
      }
    }
    else
    {
      var set_atext = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&'*+-/=?^_`{|}~";
      var cnt = 0;
      // Must be atom - must be non-empty or end of string please
      for (; i < phrase.length; ++i, ++cnt)
        if (set_atext.indexOf(phrase.substr(i, 1)) == -1)
          break;
      if (cnt == 0 && i < phrase.length)
        return false;
    }
  }
  return true;
}

function checkRoute(route)
{
  //ADDME to be implemented
  return true;
}

function checkQuoted(word)
{
  for (var i = 1; i < word.length; ++i)
  {
    var ch = word.substr(i, 1);
    if ("\t\r\n \\\"".indexOf(ch) == -1 && word.charCodeAt(i) < 128)
      continue;

    if (ch == '"')
      return i == word.length - 1;
    if (ch != '\\')  // If not a slash: it was a non-qtext thingy
      return false;

    ++i;  // quoated-pair: Eat "\"
    ch = word.substr(i, 1);
    if ("\r\n".indexOf(ch) != -1 || word.charCodeAt(i) >= 128) // Is text (ascii - '\r\n')
      return false;
  }
  return false; // should've ended with '"'
}


function checkAtom(word)
{
  for (var i = 0; i < word.length; ++i)
  {
    var ch = word.substr(i, 1);

    //Check for space & specials
    if ('()<>@,;:\\".[] '.indexOf(ch) != -1)
      return false;

    if (ch.charCodeAt(0) <= 31 || ch.charCodeAt(0) >= 127)
      return false;
  }

  return true;
}


function checkLocalPart(localpart)
{
  if (localpart == "")
    return false;

  if (localpart.substr(0, 1) == '"' && localpart.substr(localpart.length - 1) == '"')
    return checkQuoted(localpart);

  var words = localpart.split('.');
  for (var i = 0; i < words.length; ++i)
  {
    if (!checkAtom(words[i]))
      return false;
  }

  return true;
}

function checkDomain(domain)
{
  if (domain.substr(domain.length - 1) == ".")
    domain = domain.substr(0, domain.length - 1);

  var subdomains = domain.split(".");
  if (subdomains.length < 2)
    return false;

  for (var i = 0; i < subdomains.length; ++i)
  {
    var subdomain = subdomains[i];
    if (subdomain == "")
      return false;

    if (!checkAtom(subdomain))
      return false;
  }

  return true;
}

export function isValidEmailAddress(emailaddress)
{
  var name_addr_check = emailaddress.split('<');

  // First check if we have a simple address or a name & address pair

  if (name_addr_check.length == 2)
  {
    if (name_addr_check[1].substr(name_addr_check[1].length - 1) != '>')
      return false;

    // check if the name's valid
    if (!checkPhrase(name_addr_check[0]))
      return false;

    var routeaddress = name_addr_check[1];
    routeaddress = routeaddress.substr(0, routeaddress.length - 1);

    var route_check = routeaddress.split(':');

    if (route_check.length == 2)
    {
      // check if the route is valid
      if (!checkRoute(route_check[0]))
        return false;

      emailaddress = route_check[1];
    }
    else if (route_check.length == 1)
      emailaddress = routeaddress;
    else
      return false;
  }
  else if (name_addr_check.length != 1)
    return false;

  // Now check the simple address

  var address_spec = emailaddress.split('@');

  if (address_spec.length != 2)
    return false;

  if (!checkLocalPart(address_spec[0]))
    return false;

  if (!checkDomain(address_spec[1]))
    return false;

  return true;
}
