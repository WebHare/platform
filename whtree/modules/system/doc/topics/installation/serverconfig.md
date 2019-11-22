# Server configuration
Server configuration files (`serverconfig.xml`) allow you to automate WebHare
installation and configuration, which can be useful for CI scenarios or to
automate deployment. Creating a serverconfig is not required to use WebHare.

An example server configuration file:
```
<serverconfig xmlns="http://www.webhare.net/xmlns/system/serverconfig">
  <identity servername="webhare8801" dtapstage="development" />
  <addwebserver url="http://127.0.0.1:8801/" type="interface" bindto="127.0.0.1:8801" />
</serverconfig>
```
