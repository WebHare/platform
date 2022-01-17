# Antivirus

## Set up
The virus scanner requires access to a ClamAV virusscanner.

For testing, we recommend running https://hub.docker.com/r/mkodockx/docker-clamav/ using Docker
```bash
docker run --rm -ti -p 3310:3310 docker.io/mkodockx/docker-clamav:alpine-idb-amd64
```

Or to use a persistent database as a volume
```bash
docker run --rm -ti -p 3310:3310 -v clamav:/var/lib/clamav docker.io/mkodockx/docker-clamav:alpine-idb-amd64
```

Keep in mind that the ClamAV socket should be properly firewalled, not be open to untrusted hosts, and not travel
across unprotected networks as the data is not encrypted. See also https://blog.clamav.net/2016/06/regarding-use-of-clamav-daemons-tcp.html
and consider using [stunnel](https://www.stunnel.org) to protect the traffic if needed.

Once installed you need to configure the scanner as follows:
- Open WebHare
- Open the WRD Browser
- Open the `system:config` schema
- Select the `EXTERNALSERVICE` type
- Select the ADD button
- Set SERVICETYPE to `system:clamav`
- Set URL to the `host/ip:port` where ClamAV runs, eg `tcp://2127.0.0.1:3310`

You can set up multiple scanners for load sharing or availability.

## Testing the virus scanner
You can use the `antivirus.whscr` debug script to test if you've installed the
scanner properly

```bash
wh run mod::system/scripts/debug/antivirus.whscr - <<< 'X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR'-'STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
```
