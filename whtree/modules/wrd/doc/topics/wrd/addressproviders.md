# Address verification providers

## PDOK
```harescript
  SetupWRDAddressVerification(wrdschema, [ type := "pdok" ]);
```

## postcodeapi.nu
```harescript
  SetupWRDAddressVerification(wrdschema, [ type := "postcodeapi.nu"
                                         , apikey := "loopback"
                                         ]);
```

## webservices.nl
```harescript
  SetupWRDAddressVerification(wrdschema, [ type := "webservices.nl"
                                         , user := ""
                                         , password := ""
                                         ]);
```

# Testing address verification
Select the Netherlands and type one of the following addresses:

| Address | Result |
| --- | --- |
| `7500 OO 0` | Fail with error code `lookup_failed`: there was an error looking up data - maybe the service is not configured correctly or was unavailable |
| `7500 OO 1` | Fail with error code `not_supported`: the operation is not supported for this service |
| `7500 OO 2` | Fail with error code `zip_not_found`: there is no address with the given zip and nr_detail |
| `7500 OO 3` | Fail with error code `address_not_found`: there is no address with the given street, nr_detail and city |
| `7500 OO 4` | Fail with error code `not_enough_data`: not enough data to do an address lookup |
| `7500 OO 5` | Fail with error code `invalid_zip`: invalid zip code |
| `7500 OO 296` | Show which address verification provider is used for this field |
