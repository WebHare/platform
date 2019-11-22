# Running WebHare in Docker

## Developers
The recommended way to run WebHare inside a docker for development is:

```bash
  docker run -ti --rm --name webhare -p 80:80 -p 443:443 \
  -v ~/whdata:/opt/whdata webhare/webhare-core:master
```

On macOS and Linux, `~` refers to your home directory. On Windows you should
replace `~` with `%USERPROFILE%` and type the entire command on one line,
removing any `\` characters at the end of the lines.

What these options do:

- `-ti`: Run interactively in a terminal. This allows you to use CTRL+C to abort
- `--rm`: Delete the container once its stopped. All data should be on data volumes anyway
- `--name webhare`: Names the container so you can `docker exec webhare`
- `-p <port>:<port>`: Publishes the specified port (80 and 443)
- `-v <outside path>:<inside path>`: Mounts the specified path onto the specified internal path
- `webhare/webhare-core:master`: The [tag](https://hub.docker.com/r/webhare/webhare-core/tags) to install

### Using a data volume
Using a data volume is often more stable and improves performance on Windows and macOS hosts,
but requires you to take care to not accidentally delete it as it will live inside your
Docker virtual machine. If you go this route, we recommend frequently backupping it.

When using a data volume you may still want to mount `/opt/whmodules` to a normal path
and use that to store your module development.

To create and use a volume, and have a separate module dir in `whmodules`:
```bash
  docker volume create webhare-data
  docker run -ti --rm --name webhare -p 80:80 -p 443:443 \
  -v webhare-data:/opt/whdata -v ~/whmodules:/opt/whmodules webhare/webhare-core:master
```

For more information see [Manage data in Docker](https://docs.docker.com/storage/)

## Docker caveats
If you run Docker inside a VirtualBox VM, do not store WebHare's data or modules
folder on a VirtualBox 'shared folder'. WebHare requires the use of `mmap()`
which will fail on this filesystem. See also [https://www.virtualbox.org/pipermail/vbox-dev/2013-April/011349.html]

## Troubleshooting

### Core dumps
Process core dumps are disabled by default but you can enable them with `prlimit`:

```bash
docker exec -ti <containerid> /bin/bash
prlimit -p `pidof webserver` -cunlimited:unlimited
```

You can force a coredump by sending a QUIT signal to the process (eg `pkill -QUIT webserver`).

Coredumps generally end up in the /tmp/ directory. If you cannot find the coredumps,
check the various [/proc/ settings](http://man7.org/linux/man-pages/man5/core.5.html).

