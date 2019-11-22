# The WebHare database
Database management

## Cloning a database to a new server
You can prepare a database clone for transfer to a different server, eg. to test an upgrade

This example assumes the path `/opt/webhare/var/dbclone.tmp` is on the same filesystem as the database. You should use a different path if it isn't.
The clonerestoredb backs up the database and immediately restores it, hardlinking the restored blobs if possible.
```
wh clonerestoredb /opt/webhare/var/dbclone.tmp
```


Go to the new server. Ensure WebHare is installed but shut down. Remove /opt/webhare/dbase
and copy the database from the source server

```
scp -r root@<source server>:/opt/webhare/var/clonedb.tmp/dbase /opt/webhare/dbase
```

Check if the dbase folder and its contents are owned by user 'webhare'. If not, `chown -R webhare /opt/webhare/dbase`

To prevent your clone from sending mails, set the installationtype to 'restore' in a custom /opt/webhare/etc/webhare-config.xml file ie:

```
<apconfig xmlns="http://www.webhare.net/xmlns/webhare/apconfig">
  <global installationtype="restore">
    <database>
...
```

## Repairing metadata
Please note that metadata repairs are usually destructive, as WebHare will
delete metadata that's preventing the database server from starting or applying
metadata changes. If you need to recover data in the broken tables, you will
need to manually insert proper metadata records instead of having scripts fix it.

Unless you have a database you don't care about, fixing metadata is generally
best left to experts.

Here's the procedure - at your own risk!
```
# Start the database in recovery mode
/opt/webhare/bin/dbserver --listen 127.0.0.1:13679 --dbasefolder /opt/whdata/dbase --recoverymode
# Run the recovery script mode
wh run modulescript::system/database/checkdefinitionschema.whscr
# Apply any fixes suggested by the recoverty script
wh run modulescript::system/database/checkdefinitionschema.whscr --fix

# Now, CTRL+C the database server and start WebHare normally
```
