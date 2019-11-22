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
                   , document: 'document' in options ? options.document : document
                   , encode: 'encode' in options ? options.encode : true
                   , httpOnly: 'httpOnly' in options ? options.httpOnly : false
                   };
  }
  write(value)
  {
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
    if (this.options.httpOnly)
      value += '; HttpOnly';
    this.options.document.cookie = this.key + '=' + value;
    return this;
  }
  read()
  {
    var value = this.options.document.cookie.match('(?:^|;)\\s*' + escapeRegExp(this.key) + '=([^;]*)');
    return (value) ? decodeURIComponent(value[1]) : null;
  }
  dispose()
  {
    new Cookie(this.key, Object.assign({}, this.options, {duration: -1})).write('');
    return this;
  }
}

Cookie.write = function(key, value, options)
{
  return new Cookie(key, options).write(value);
};

Cookie.read = function(key)
{
  return new Cookie(key).read();
};

Cookie.dispose = function(key, options)
{
  return new Cookie(key, options).dispose();
};

module.exports = Cookie;
