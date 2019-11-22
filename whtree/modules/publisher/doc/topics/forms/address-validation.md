# Address fields in forms

The `<address>` field can be used in forms to ask for an address. The value of an address field is a WRD-compatible address record, i.e. it will have fields like `COUNTRY`, `STREET`, `NR_DETAIL`, `ZIP`, etc. Which fields are used for which countries is configured in the WRD world info. It is rendered as a country pulldown, which controls the single-line text fields that are shown for the address subfields.

## Country selection

By default, all available countries are offered in the country pulldown. To limit this selection or change the ordering, the `countrylist` attribute can be used:

```xml
  <!-- Show only Netherlands, Belgium and Germany -->
  <address name="myaddress" tid=".address" countrylist="NL BE DE" />
```

A dash can be used to insert a divider:

```xml
  <!-- Show Netherlands, Belgium and Germany, then a divider, followed by the other EU countries -->
  <address name="myaddress" tid=".address" countrylist="NL BE DE - AT BG CY CZ DK EE ES FI FR GB GR HR HU IE IT LU LV MT PL PT RO SE SI SK" />
```

## Override subfield titles

The titles of the subfields can be overridden in the form's XML or dynamically:

```xml
  <address name="myaddress" tid=".address">
    <fieldtitle tag="street" title="Straatnaam" /><!-- Use "Straatnaam" as the title for the "street" field -->
    <fieldtitle tag="nr_detail" tid=".housenumber" /><!-- The tid ".housenumber" is used as title -->
    <fieldtitle tag="zip" /><!-- The tid ".address-zip" (".address" tid + "-" + tag) is used as title -->
  </address>
```

```harescript
  INSERT CELL city := "Woonplaats" INTO ^myaddress->fieldtitles;
```

## Address validation

The `<address>` field has support for automatic address validation and completion. It is enabled by default for Dutch addresses using the [PDOK Locatieserver API](https://github.com/PDOK/locatieserver/wiki/API-Locatieserver), which can be used on a fair use policy base.

### Configure address validation

The address validation configuration can be set through the registry. To configure address validation for your module, add a registry key to store the configuration:

```xml
  <moduleregistry>
    <node name="config">
      <record name="addressvalidation" />
    </node>
  </moduleregistry>
```

Create a module configuration screen to edit the registry key:

```xml
  <meta configscreen="screens/sysmgmt.xml#editconfig">
    [...]
  </meta>
```

```xml
<screens
    xmlns="http://www.webhare.net/xmlns/tollium/screens"
    xmlns:s="http://www.webhare.net/xmlns/system/components"
    xmlns:w="http://www.webhare.net/xmlns/wrd/components">

  <screen name="editconfig" title="Configuration">
    <compositions>
      <s:registrynode name="config" node="mymodule.config" />
    </compositions>
    <body>
      <w:addressvalidation composition="config" cellname="addressvalidation" />
    </body>
    <footer>
      <defaultformbuttons buttons="ok cancel" />
    </footer>
  </screen>

</screens>
```

```harescript
<?wh

LOADLIB "mod::system/lib/configure.whlib";

LOADLIB "mod::tollium/lib/screenbase.whlib";


PUBLIC STATIC OBJECTTYPE EditConfig EXTEND TolliumScreenBase
<
  MACRO Init()
  {
    ^config->ReadFromRegistry();
  }
  BOOLEAN FUNCTION Submit()
  {
    OBJECT work := this->BeginWork();
    ^config->WriteToRegistry();
    RETURN work->Finish();
  }
>;
```

Refer to the registry key with the address validation configuration in your site profile:

```xml
  <apply>
    <to type="all"/>
    <addressvalidation xmlns="http://www.webhare.net/xmlns/wrd/siteprofile" registrykey="modules.mymodule.config.addressvalidation" />
  </apply>
```
