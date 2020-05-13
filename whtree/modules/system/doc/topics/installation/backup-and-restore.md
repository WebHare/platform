# Backup and restore

To backup WebHare remotely, use https://gitlab.com/webhare/backup/

## Restore

### Using Docker
DATAFOLDER should be the folder from which you'll be running webhare, and should not contain a 'dbase' directory yet.

BACKUPFOLDER should be the folder containing the backup. we're assuming the backup is named 'backup too'
```
docker run --rm -ti -v BACKUPFOLDER:/backup DATAFOLDER:/opt/whdata webhare/webhare-core:master /opt/webhare/bin/dbserver --restore /backup/backup --restoreto /opt/whdata/dbase
```


### With a checked-out WebHare
To restore a WebHare database backed up using the above webhare-backup with a checked out WebHare installation:

- get the data (rsync or ssh)

- configure an environment for the restore, and restore

```
export WEBHARE_DATAROOT=$HOME/projects/whdata/restore
export WEBHARE_BASEPORT=33100
export WEBHARE_ISRESTORED=1
export WEBHARE_NOINSTALLATIONINFO=1
wh restore $HOME/projects/whdata/restore.db
```

the code above assumes the data to restore was in `$HOME/projects/whdata/restore.db`.

you'll need to export the same environment variables to actually run the restored database with `wh console` or to execute
other `wh` commands.


## Backup/restore development
To test local backup/restore process (this assumes wh-moe2 is a throwaway installation)

```bash
# optionally use WEBHARE_INITIALDB=postgresql
wh-moe2 freshdbconsole
# on a second console
wh-moe2 backuplocal
# if waiting for the checkpoint takes too long
wh-moe2 psql -c "CHECKPOINT"
# when the backup is done:
wh-moe2 terminate

# move the database aside. one of:
mv $(wh-moe2 getdatadir)/dbase $(wh-moe2 getdatadir)/dbase.bak
# OR
mv $(wh-moe2 getdatadir)/postgresql $(wh-moe2 getdatadir)/postgresql.bak

# restore it!
wh-moe2 restore $(wh-moe2 getdatadir)/backups/$(ls $(wh-moe2 getdatadir)/backups/ |sort -r|head -n1)

# test it, check you don't see any initialization stuff
wh-moe2 console
```
