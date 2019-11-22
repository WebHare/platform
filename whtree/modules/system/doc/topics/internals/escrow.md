# Escrow documentation

If you're looking to install a deposited escrow package, read the restore section immediately below.

For information on how to create an escrow package from the git source tree, see 'building an escrow package' below

## How to restore an Escrow package

Make sure you have Docker running. Then, to build:
```
docker build -t webhare/webhare-escrow-build .
```

That's it. To run it:
```
docker run --rm -v YOUR-DATA-FOLDER:/opt/whdata -p 80:80 -p 443:443 -p 8000:8000 webhare/webhare-escrow-build
```

YOUR-DATA-FOLDER should contain the database backup you received. If everything was extracted to the proper location,
YOUR-DATA-FOLDER/dbase/db-1.whrf should exist.

## Building an escrow package

WHBUILD_ESCROW=1 wh builddocker

When completed, a local archive 'webhare-escrow-XXX.tar.gz' will be created. This is the result of your build

## Verifying the package

```
mkdir testdir
cd testdir
tar zxf ../webhare-escrow-*.tar.gz
ls #ensure README.md exists, so you know you're in the right folder
docker build -t webhare/webhare-escrow-build .
docker run --rm -p <A-FREE-PORT-NUMBER>:8000 webhare/webhare-escrow-build
```

visit http://127.0.0.1:8000/ and verify that the Installation wizard is asking you to add a sysop
