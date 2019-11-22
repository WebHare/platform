# Custom tollium backend
## CUSTOM BACKEND
You can use wrdauth WRD schemas to run a separate backend. To do this, create a file of type "http://www.webhare.net/xmlns/tollium/applicationportal" (in a site that has a `<wrdauth>` node in its site profile, refer to [wrdauth info](#siteprofile-wrd-auth) on how to setup `<wrdauth>`).

Also, using the 'WRD Browser' application, make sure to check the 'User management schema option in the schema properties.

Now, by visiting the newly created file, you should get a separate WebHare backend. This backend uses the WRD schema. At the start, there's no user yet. To be able to login to the new environment, use this command from the CLI:

```shell
wh cli getoverride
```

This will give you an URL with '?overridetoken=....', which you can use on the URL of the created file. Using this URL, you should create a sysop user first:

1) Synchronize the user database: start application "User Management" => Menu => "Synchronize database"

2) In the user management application, create a new user and grant the "Sysop" rights: select user => "Grant right..." => "Miscellaneous" => "Sysop"

Now you should be able to login to the new backend with the created user.

