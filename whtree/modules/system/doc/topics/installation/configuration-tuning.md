# Configuration and tuning of WebHare hosts

## sysctl knob: max_user_watches
Linux's inotify system requires a 'watch' for every directory that's being watched.
A system with a couple of dozen modules and deep node_modules hierarchies in each
module will easily have tens of thousands of directories to watch, exceeding the
8192 default.

The sysctl fs.inotify.max_user_watches should be increased - we recommend 65536

## sysctl knob: max_map_count
By default, Linux limits a process to about 65535 mappings. The database server
relies heavily on mmap, and a database with about 4GB of records and a similarly
sized index can easily require more.

We recommend setting this a lot higher. Setting sysctl vm.max_map_count to
6553650 should suffice for most installations up to 15GB of records.

# macOS Tweaks
Please note that macOS (OS/X) is not an officialy supported WebHare platform
and not recommended for any production use, but it's still quite usable as
a development platform.

If WebHare complains about too few open files you should raise the open file
limit, eg
```bash
ulimit -n 2048
```

You may want to add this to your `~/.profile`.

If you're still running into file issues, you mave to update the global maximum
files setting:

```bash
sudo launchctl limit maxfiles 1000000 1000000
```
You may have to restart your terminal for this setting to take effect

To make this permanent (i.e not reset when you reboot), create /etc/launchd.conf containing:
```
limit maxfiles 1000000 1000000
```

Then you can use ulimit (but without the sudo) to adjust your process limit.

See also: https://superuser.com/questions/302754/increase-the-maximum-number-of-open-file-descriptors-in-snow-leopard
