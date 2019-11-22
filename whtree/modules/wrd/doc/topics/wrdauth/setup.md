You need to update your wrdschema definition to import the authentication schema, and specify the accounttype and fields to use. An example that uses the emailfield for both login and email:

```xml
<schemadefinition xmlns="http://www.webhare.net/xmlns/wrd/schemadefinition"
                  accounttype="WRD_PERSON"
                  accountloginfield="WRD_CONTACT_EMAIL"
                  accountemailfield="WRD_CONTACT_EMAIL"
                  accountpasswordfield="PASSWORD">

  <import definitionfile="mod::wrd/data/wrdschemas/authschema.xml" />
  <object tag="WRD_AUTHDOMAIN">
    <values matchattribute="WRD_TAG">
      <value>
        <field tag="WRD_TITLE">My website</field>
        <field tag="WRD_TAG">WEBSITE</field>
        <field tag="WRDAUTH_LANGUAGE">en</field>
        <field tag="WRDAUTH_LASTLOGINFIELD">LASTLOGIN</field>
        <field tag="WRDAUTH_LASTIPFIELD">LASTIP</field>
      </value>
    </values>
  </object>

  <object tag="WRD_PERSON">
    <attributes>
      <free tag="LASTIP" title="Last IP address"/>
      <datetime tag="LASTLOGIN" title="Last login"/>
      <email tag="WRD_CONTACT_EMAIL" title="E-mail" required="1" unique="1"/>
      <password tag="PASSWORD" title="Password"/>
    </attributes>
  </object>
</schemadefinition>
```

## Siteprofile WRD auth

```xml
<wrdauth xmlns="http://www.webhare.net/xmlns/wrd"
         wrdschema="YOURSCHEMA"
         sitetag="WEBSITE"
         api2017="true"
         cookiename="webharelogin-YOURCOKIE" />
```
cookiename must be a string starting with webharelogin- and not contain any underscores

Make sure the value of sitetag is the same as the `<field tag="WRD_TAG">WEBSITE</field>` from your WRD schema definition.

Optional attributes:
- cachefields: a space-separated list of WRD fields from the loggedin entity to store in the user info (refreshed at login or session restoration)
- supportobjectname: reference to a support object to handle logins, eg to override the JavaScript userinfo

An example support object:
```harescript

LOADLIB "mod::wrd/lib/auth.whlib";

PUBLIC OBJECTTYPE MyWRDAuthSupport EXTEND WRDAuthSupportBase
<
  UPDATE PUBLIC RECORD FUNCTION GetJSUserInfo()
  {
    RECORD info := this->plugin->GetLoggedinEntityFields(["WRD_CONTACT_EMAIL"]);
    IF(NOT RecordExists(info))
      RETURN DEFAULT RECORD;

    RETURN [ email := info.wrd_contact_email ];
  }
```

`GetJSUserInfo()` is invoked by the Login RPC and restoresession.shtml, and
provides the userinfo for `wrdauth.getAuthenticationProvider.getUserInfo()`

```
