/** This is currently more or less based on the mootools Cookie library */
/* eslint no-useless-escape: off */

import { isIsolated } from './storage.es';
let isolatedcookies = {};

function escapeRegExp(xx)
{
  return xx.replace(/([-.*+?^${}()|[\]\/\\])/g, '\\$1');
}

//based on mootools cookie
class Cookie
{
  constructor(key,options)
  {
    if(!options)
      options={};

    this.key = key;
    this.options = { path: 'path' in options ? options.path :  '/'
                   , domain: 'domain' in options ? options.domain : false
                   , duration: 'duration' in options ? options.duration : false
                   , secure: 'secure' in options ? options.secure : false
                   , encode: 'encode' in options ? options.encode : true
                   , httponly: 'httpOnly' in options ? options.httpOnly : 'httponly' in options ? options.httponly : false
                   , samesite: 'samesite' in options ? options.samesite : ''
                   };
  }
  write(value)
  {
    if(isIsolated())
    {
      isolatedcookies["c." + this.key] = String(value);
      return;
    }

    if (this.options.encode)
      value = encodeURIComponent(value);
    if (this.options.domain)
      value += '; domain=' + this.options.domain;
    if (this.options.path)
      value += '; path=' + this.options.path;
    if (this.options.duration)
    {
      var date = new Date();
      date.setTime(date.getTime() + this.options.duration * 24 * 60 * 60 * 1000);
      value += '; expires=' + date.toGMTString();
    }
    if (this.options.secure)
      value += '; secure';
    if (this.options.httponly)
      value += '; HttpOnly';
    if (this.options.samesite)
      value += '; SameSite='+this.options.samesite;

    document.cookie = this.key + '=' + value;
    return this;
  }
  read()
  {
    if(isIsolated())
      return isolatedcookies["c." + this.key] || null;

    var value = document.cookie.match('(?:^|;)\\s*' + escapeRegExp(this.key) + '=([^;]*)');
    return (value) ? decodeURIComponent(value[1]) : null;
  }
  remove()
  {
    if(isIsolated())
    {
      delete isolatedcookies["c." + this.key];
      return;
    }
    new Cookie(this.key, Object.assign({}, this.options, {duration: -1})).write('');
  }
}

export function list()
{
  if(isIsolated())
    return Object.entries(isolatedcookies).map(entry => ({ name: entry[0].substr(2), value: entry[1] }));

  return document.cookie.split(';').map(cookie =>
  {
    let parts = cookie.split('=');
    return { name: decodeURIComponent(parts[0].trim()), value:decodeURIComponent(parts[1]||'') };
  });
}

export function write(key, value, options)
{
  return new Cookie(key, options).write(value);
}

export function read(key)
{
  return new Cookie(key).read();
}

export function remove(key, options)
{
  new Cookie(key, options).remove();
}
