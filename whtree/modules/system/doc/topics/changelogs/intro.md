## Unskippable upgrades
Some upgrades cannot be skipped. These are:
- 3.10.xx: You should upgrade to the latest 3.10 version before switching to WebHare 4
- 4.03: 4.04 cleans out a lot of upgrade scripts, and 4.03 is the last version to support the 'old' mailqueue. You need to ensure all mail is sent before upgrading above 4.03
- 4.08: 4.09 cleans up a lot yet again
- 4.16: 4.17 cleans up a lot, and removes a lot of obsoleted code.
- 4.26: 4.27 adds PostgreSQL support and a lot of cleanup scripts are WHDB/dbserver specific

So, to upgrade from 3.08 to 4.27, go through 3.10.xx, 4.03, 4.08, 4.16 and 4.26 first. You should also make sure 4.16 has finished
any conversions (check the managed tasks) before continuing the update, as the wrd/fs settings upgrade done in 4.10 can take
quite a bit of time.

## How to upgrade
Before you upgrade, check the changelogs of the relevant versions to see if there
are any important deprecations.

You should also regularly look for important deprecations and changes you may have
missed:

- `wh check` - lists current issues (you should always set up monitoring for this command)
- `wh softreset --sp` - recompiles and reports siteprofile issues
- `wh checkmodule "*"` - validate all modules

Although our scripts cannot catch all issues (feedback welcome!) it may
be able to give you some heads up about things you can fix to prevent future
incompatibilities issues, or just to simply improve performance
