/* whprivileged - whitelisted privileged operations for containers running WebHare as an unprivileged user

   Installed by the container build as /opt/container/whprivileged, owned by root:whdata and mode 4750 (setuid root,
   only executable by root and members of 'whdata').

   When WebHare runs as an unprivileged user (WEBHARE_IN_DOCKER and WEBHARE_DOCKER_USER are both set) the dataroot
   (/opt/whdata, usually a mounted volume) stays owned by root:root. The unprivileged user can't create, rename or remove
   anything directly inside it, which protects eg. the PostgreSQL and OpenSearch data from being moved or replaced.
   This helper sets up the entries that need to exist in the dataroot and starts the services as their own users.

   The 'caller' below is the real uid of the invoking process (ie. the WebHare user). Its environment is never used to
   decide which files to touch or to whom they should belong.

   Operations:
     prepare-dataroot     Create (or take over from root) the top-level directories and files WebHare writes to, owned
                          by the caller. Removes obsolete files.
     prepare-postgresql   Create postgresql/ owned by 'postgres' (mode 0710: the caller can traverse but not list or
                          modify it) and postgresql/blob and postgresql/tmp owned by the caller
     prepare-opensearch   Create opensearch/ owned by 'opensearch' (mode 0700). Renames a legacy elasticsearch/ folder
     prepare-restore      Create postgresql.restore/ owned by the caller to extract a backup into
     finish-restore       Move postgresql.restore/db and postgresql.restore/blob into a new postgresql/ folder, handing
                          the database over to 'postgres'
     clear-restoremode    Remove webhare.restoremode
     run-as <user> <program> [args...]
                          Run a program as 'postgres', 'opensearch' or 'chrome'. We stay around as its parent to forward
                          signals, as the caller isn't allowed to signal the program directly, and exit with its status.
                          These users exist to isolate those services, the caller can already control them (eg. through
                          the database) so letting it run arbitrary programs as these users doesn't give it any new
                          access. The environment and stdin/stdout/stderr and other open file descriptors are passed on
                          unchanged (puppeteer may use fds 3/4 as a communication pipe) but note that glibc removes
                          'unsecure' variables (LD_*, TMPDIR, MALLOC_*, ...) from the environment of setuid programs.

   Safety considerations:
   - This binary is linked statically against the blex objects it needs (see base_makefile) and only depends on system
     libraries: glibc ignores $ORIGIN rpaths for setuid binaries, and /opt/wh may be writable by the WebHare user.
   - We don't use Blex::InvokeMyMain: it changes signal dispositions (which would be inherited by the programs we start)
     and initializes libraries we don't need.
   - Mount points (eg. volumes or directories shared from the host) are left alone and never descended into.
   - All filesystem access is relative to directory file descriptors opened with O_NOFOLLOW, and ownership is changed
     through O_PATH descriptors. A symlink planted by an unprivileged user is never followed.
   - When taking over a tree, only entries owned by the users we expect (root for data from a container that ran WebHare
     as root, or eg. postgres) are changed. Directories are processed depth first and changed only after their contents,
     so the unprivileged user can't add anything to a directory we still have to process. Root-owned files with multiple
     hard links are skipped, they might be links to files outside the dataroot.
*/

#include <blex/blexlib.h>
#include <blex/getopt.h>
#include <blex/path.h>

#include <dirent.h>
#include <fcntl.h>
#include <grp.h>
#include <pwd.h>
#include <signal.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace
{

std::string const DataRoot = "/opt/whdata";
char const AllowedGroup[] = "whdata";

/// Top level directories in the dataroot that belong to the WebHare user
char const * const WebHareDirs[] =
  { "archivedmodules", "backups", "caches", "config", "ephemeral", "etc", "generated", "geoip", "home", "installedmodules"
  , "log", "node_modules", "output", "preparedbackup", "root", "storage", "system-cache", "tmp" };

/// Top level files in the dataroot that WebHare writes. WebHare will have to update them in place as it can't replace them
char const * const WebHareFiles[] =
  { ".webhare.pid", ".webhare-envsettings.sh", "webhare.version", "eslint.config.mjs", "package.json", ".npmrc"
  , "tsconfig.json" };

/// Top level files that are no longer used
char const * const ObsoleteFiles[] = { "webhare-config.xml" };

typedef std::vector< uid_t > UidSet;

uid_t caller_uid;
gid_t whdata_gid;
unsigned warnings;

/// Error that aborts the current operation
class Failure : public std::runtime_error
{
        public:
        explicit Failure(std::string const &what) : std::runtime_error(what) { }
};

[[noreturn]] void Fail(std::string const &msg)
{
        throw Failure(msg);
}

[[noreturn]] void FailOS(std::string const &msg)
{
        throw Failure(msg + ": " + Blex::GetLastOSError());
}

void Warn(std::string const &msg)
{
        Blex::ErrStream() << "whprivileged: warning: " << msg;
        ++warnings;
}

void Info(std::string const &msg)
{
        Blex::ErrStream() << "whprivileged: " << msg;
}

/// Owned file descriptor
class Fd
{
        public:
        Fd() : fd(-1) { }
        explicit Fd(int _fd) : fd(_fd) { }
        Fd(Fd &&rhs) : fd(rhs.fd) { rhs.fd = -1; }
        Fd& operator=(Fd &&rhs) { if (this != &rhs) { Reset(); fd = rhs.fd; rhs.fd = -1; } return *this; }
        ~Fd() { Reset(); }

        int Get() const { return fd; }
        bool IsValid() const { return fd >= 0; }
        void Reset() { if (fd >= 0) close(fd); fd = -1; }

        private:
        Fd(Fd const &) = delete;
        Fd& operator=(Fd const &) = delete;

        int fd;
};

Fd OpenAt(int parentfd, std::string const &name, int flags)
{
        return Fd(openat(parentfd, name.c_str(), flags | O_NOFOLLOW | O_CLOEXEC));
}

struct stat StatFd(int fd, std::string const &path)
{
        struct stat st;
        if (fstat(fd, &st) != 0)
            FailOS("Cannot stat " + path);
        return st;
}

bool Contains(UidSet const &set, uid_t uid)
{
        return std::find(set.begin(), set.end(), uid) != set.end();
}

bool CallerIsAllowed()
{
        if (getuid() == 0 || getgid() == whdata_gid)
            return true;

        int ngroups = getgroups(0, nullptr);
        if (ngroups < 0)
            FailOS("getgroups");

        std::vector< gid_t > groups(ngroups);
        ngroups = getgroups(groups.size(), groups.data());
        if (ngroups < 0)
            FailOS("getgroups");
        groups.resize(ngroups);

        return std::find(groups.begin(), groups.end(), whdata_gid) != groups.end();
}

/// The uid and primary gid of a service user
struct ServiceUser
{
        uid_t uid;
        gid_t gid;
};

ServiceUser LookupUser(std::string const &name)
{
        struct passwd *pw = getpwnam(name.c_str());
        if (!pw)
            Fail("User '" + name + "' does not exist");
        if (pw->pw_uid == 0 || pw->pw_gid == 0)
            Fail("User '" + name + "' must not have uid or gid 0");
        return ServiceUser{ pw->pw_uid, pw->pw_gid };
}

/// Open the dataroot and verify nobody but root can modify it - otherwise none of our checks make sense
Fd OpenDataRoot()
{
        Fd fd(open(DataRoot.c_str(), O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC));
        if (!fd.IsValid())
            FailOS("Cannot open " + DataRoot);

        struct stat st = StatFd(fd.Get(), DataRoot);
        if (st.st_uid != 0 || (st.st_mode & (S_IWGRP | S_IWOTH)))
            Fail(DataRoot + " must be owned by root and not be writable by group or others");
        return fd;
}

/// Change ownership of the entry 'fd' (an O_PATH or regular descriptor)
bool ChownFd(int fd, uid_t uid, gid_t gid)
{
        return fchownat(fd, "", uid, gid, AT_EMPTY_PATH | AT_SYMLINK_NOFOLLOW) == 0;
}

/// Give all entries inside dirfd that are owned by a user in 'from' to uid:gid, depth first
void ClaimContents(int dirfd, std::string const &path, uid_t uid, gid_t gid, UidSet const &from)
{
        dev_t dir_dev = StatFd(dirfd, path).st_dev;

        int listfd = dup(dirfd);
        if (listfd < 0)
            FailOS("dup");
        DIR *dir = fdopendir(listfd);
        if (!dir)
        {
                close(listfd);
                FailOS("Cannot list " + path);
        }
        std::unique_ptr< DIR, int(*)(DIR*) > dircloser(dir, &closedir);

        while (struct dirent *entry = readdir(dir))
        {
                std::string name = entry->d_name;
                if (name == "." || name == "..")
                    continue;

                std::string subpath = Blex::MergePath(path, name);
                Fd fd = OpenAt(dirfd, name, O_PATH);
                if (!fd.IsValid())
                {
                        if (errno != ENOENT)
                            Warn("Cannot open " + subpath + ": " + Blex::GetLastOSError());
                        continue;
                }

                struct stat st;
                if (fstat(fd.Get(), &st) != 0)
                {
                        Warn("Cannot stat " + subpath + ": " + Blex::GetLastOSError());
                        continue;
                }
                if (st.st_dev != dir_dev) //never cross into other mounts
                    continue;

                if (st.st_uid == uid && st.st_gid == gid) //already ours. we still need to descend into directories though
                {
                        if (!S_ISDIR(st.st_mode))
                            continue;
                }
                else if (!Contains(from, st.st_uid))
                {
                        continue; //owned by someone else, leave it (and its contents) alone
                }

                if (S_ISDIR(st.st_mode))
                {
                        // Reopen as a real directory descriptor - O_PATH descriptors can't be listed. Verify it's still the same dir
                        Fd subdirfd = OpenAt(dirfd, name, O_DIRECTORY);
                        struct stat subst;
                        if (!subdirfd.IsValid() || fstat(subdirfd.Get(), &subst) != 0 || subst.st_dev != st.st_dev || subst.st_ino != st.st_ino)
                        {
                                Warn(subpath + " changed while we were processing it, skipping");
                                continue;
                        }
                        ClaimContents(subdirfd.Get(), subpath, uid, gid, from);
                        if (fchown(subdirfd.Get(), uid, gid) != 0)
                            Warn("Cannot chown " + subpath + ": " + Blex::GetLastOSError());
                }
                else if (S_ISREG(st.st_mode) || S_ISLNK(st.st_mode))
                {
                        if (S_ISREG(st.st_mode) && st.st_uid == 0 && st.st_nlink > 1)
                            Warn("Not changing ownership of " + subpath + ": it's owned by root and has multiple hard links");
                        else if (!ChownFd(fd.Get(), uid, gid))
                            Warn("Cannot chown " + subpath + ": " + Blex::GetLastOSError());
                }
                // else: we don't touch sockets, fifos or device nodes
        }
}

/** Ensure parentfd/name is a directory owned by uid:gid. If it's missing, create it. If it's owned by root or by a user
    in 'from', take it and its contents over. Applies 'mode' when creating or taking over the directory, or always if
    force_mode is set.
    @return An open descriptor for the directory, invalid if we can't or won't use it */
Fd EnsureDir(int parentfd, std::string const &path, std::string const &name, uid_t uid, gid_t gid, mode_t mode, bool force_mode, UidSet const &from)
{
        bool created = false;
        if (mkdirat(parentfd, name.c_str(), 0700) == 0)
            created = true;
        else if (errno != EEXIST)
            FailOS("Cannot create " + path);

        Fd fd = OpenAt(parentfd, name, O_DIRECTORY);
        if (!fd.IsValid())
        {
                Warn(path + " is not a directory: " + Blex::GetLastOSError());
                return Fd();
        }

        struct stat st = StatFd(fd.Get(), path);
        if (st.st_dev != StatFd(parentfd, path).st_dev) //a mount (eg. a volume or a directory shared from the host). not ours to manage
            return fd;

        if (st.st_uid != uid)
        {
                if (st.st_uid != 0 && !Contains(from, st.st_uid))
                {
                        Warn("Leaving " + path + " alone: it's owned by uid " + std::to_string(st.st_uid));
                        return Fd();
                }

                if (!created) //take over the contents too, eg. data from a container that ran WebHare as root
                {
                        UidSet claimfrom = from;
                        if (!Contains(claimfrom, 0))
                            claimfrom.push_back(0);
                        Info("Taking over " + path + " for uid " + std::to_string(uid));
                        ClaimContents(fd.Get(), path, uid, gid, claimfrom);
                }
        }
        if (st.st_uid != uid || st.st_gid != gid)
        {
                if (fchown(fd.Get(), uid, gid) != 0)
                    FailOS("Cannot chown " + path);
                force_mode = true;
        }

        if ((force_mode || created) && (st.st_mode & 07777) != mode && fchmod(fd.Get(), mode) != 0)
            FailOS("Cannot chmod " + path);
        return fd;
}

/// Ensure parentfd/name is a regular file owned by the caller, creating an empty one if needed
void EnsureCallerFile(int parentfd, std::string const &name)
{
        std::string path = Blex::MergePath(DataRoot, name);
        Fd fd(openat(parentfd, name.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0640));
        if (fd.IsValid())
        {
                if (fchown(fd.Get(), caller_uid, whdata_gid) != 0)
                    FailOS("Cannot chown " + path);
                return;
        }
        if (errno != EEXIST)
            FailOS("Cannot create " + path);

        fd = OpenAt(parentfd, name, O_PATH);
        if (!fd.IsValid())
            FailOS("Cannot open " + path);

        struct stat st = StatFd(fd.Get(), path);
        if (st.st_uid == caller_uid)
            return;

        if (!S_ISREG(st.st_mode) || st.st_uid != 0 || st.st_nlink > 1)
            Warn("Leaving " + path + " alone: not a regular file owned by root");
        else if (!ChownFd(fd.Get(), caller_uid, whdata_gid))
            FailOS("Cannot chown " + path);
}

/// Remove parentfd/name if it's a regular file
void RemoveFile(int parentfd, std::string const &name)
{
        std::string path = Blex::MergePath(DataRoot, name);
        struct stat st;
        if (fstatat(parentfd, name.c_str(), &st, AT_SYMLINK_NOFOLLOW) != 0)
        {
                if (errno != ENOENT)
                    Warn("Cannot stat " + path + ": " + Blex::GetLastOSError());
                return;
        }
        if (!S_ISREG(st.st_mode))
        {
                Warn("Not removing " + path + ": not a regular file");
                return;
        }
        if (unlinkat(parentfd, name.c_str(), 0) != 0 && errno != ENOENT)
            FailOS("Cannot remove " + path);
}

/// Open parentfd/name, which must be a directory owned by uid
Fd OpenOwnedDir(int parentfd, std::string const &path, std::string const &name, uid_t uid)
{
        Fd fd = OpenAt(parentfd, name, O_DIRECTORY);
        if (!fd.IsValid())
            FailOS("Cannot open " + path);
        if (StatFd(fd.Get(), path).st_uid != uid)
            Fail(path + " is not owned by uid " + std::to_string(uid));
        return fd;
}

void PrepareDataRoot()
{
        Fd rootfd = OpenDataRoot();

        for (char const *name : WebHareDirs)
            EnsureDir(rootfd.Get(), Blex::MergePath(DataRoot, name), name, caller_uid, whdata_gid, 0750, false, UidSet());
        for (char const *name : WebHareFiles)
            EnsureCallerFile(rootfd.Get(), name);
        for (char const *name : ObsoleteFiles)
            RemoveFile(rootfd.Get(), name);
}

/// Create the caller-owned blob and tmp folders inside an open postgresql folder
void PreparePostgreSQLUserDirs(int psfd, uid_t postgres_uid)
{
        // A WebHare that ran as root had postgres own the restored blobs
        UidSet from{ postgres_uid };
        for (char const *name : { "blob", "tmp" })
            EnsureDir(psfd, Blex::MergePath(DataRoot, std::string("postgresql/") + name), name, caller_uid, whdata_gid, 0750, false, from);
}

void PreparePostgreSQL()
{
        ServiceUser pg = LookupUser("postgres");
        Fd rootfd = OpenDataRoot();

        Fd psfd = EnsureDir(rootfd.Get(), Blex::MergePath(DataRoot, "postgresql"), "postgresql", pg.uid, whdata_gid, 0710, true, UidSet());
        if (!psfd.IsValid())
            Fail("Cannot prepare " + Blex::MergePath(DataRoot, "postgresql"));
        PreparePostgreSQLUserDirs(psfd.Get(), pg.uid);
}

void PrepareOpenSearch()
{
        ServiceUser os = LookupUser("opensearch");
        Fd rootfd = OpenDataRoot();

        // Rename old data folder
        struct stat st;
        if (fstatat(rootfd.Get(), "opensearch", &st, AT_SYMLINK_NOFOLLOW) != 0 && errno == ENOENT
            && fstatat(rootfd.Get(), "elasticsearch", &st, AT_SYMLINK_NOFOLLOW) == 0 && S_ISDIR(st.st_mode))
        {
                if (renameat(rootfd.Get(), "elasticsearch", rootfd.Get(), "opensearch") != 0)
                    FailOS("Cannot rename " + Blex::MergePath(DataRoot, "elasticsearch") + " to opensearch");
        }

        Fd osfd = EnsureDir(rootfd.Get(), Blex::MergePath(DataRoot, "opensearch"), "opensearch", os.uid, os.gid, 0700, true, UidSet());
        if (!osfd.IsValid())
            Fail("Cannot prepare " + Blex::MergePath(DataRoot, "opensearch"));
}

void PrepareRestore()
{
        Fd rootfd = OpenDataRoot();
        Fd fd = EnsureDir(rootfd.Get(), Blex::MergePath(DataRoot, "postgresql.restore"), "postgresql.restore", caller_uid, whdata_gid, 0700, true, UidSet());
        if (!fd.IsValid())
            Fail("Cannot prepare " + Blex::MergePath(DataRoot, "postgresql.restore"));
}

void FinishRestore()
{
        ServiceUser pg = LookupUser("postgres");
        Fd rootfd = OpenDataRoot();

        std::string const psroot = Blex::MergePath(DataRoot, "postgresql");
        std::string const restoreroot = Blex::MergePath(DataRoot, "postgresql.restore");

        struct stat st;
        if (fstatat(rootfd.Get(), "postgresql", &st, AT_SYMLINK_NOFOLLOW) == 0 || errno != ENOENT)
            Fail(psroot + " already exists");

        Fd restorefd = OpenOwnedDir(rootfd.Get(), restoreroot, "postgresql.restore", caller_uid);
        OpenOwnedDir(restorefd.Get(), Blex::MergePath(restoreroot, "db"), "db", caller_uid);
        OpenOwnedDir(restorefd.Get(), Blex::MergePath(restoreroot, "blob"), "blob", caller_uid);

        Fd psfd = EnsureDir(rootfd.Get(), psroot, "postgresql", pg.uid, whdata_gid, 0710, true, UidSet());
        if (!psfd.IsValid())
            Fail("Cannot create " + psroot);

        // Move the database into place first so the caller can no longer add anything to it, then hand it to postgres
        if (renameat(restorefd.Get(), "db", psfd.Get(), "db") != 0)
            FailOS("Cannot move the restored database into place");

        std::string const dbpath = Blex::MergePath(psroot, "db");
        Fd dbfd = OpenOwnedDir(psfd.Get(), dbpath, "db", caller_uid);
        ClaimContents(dbfd.Get(), dbpath, pg.uid, whdata_gid, UidSet{ caller_uid });
        if (fchown(dbfd.Get(), pg.uid, whdata_gid) != 0 || fchmod(dbfd.Get(), 0700) != 0)
            FailOS("Cannot hand " + dbpath + " to postgres");

        if (renameat(restorefd.Get(), "blob", psfd.Get(), "blob") != 0)
            FailOS("Cannot move the restored blobs into place");
        PreparePostgreSQLUserDirs(psfd.Get(), pg.uid);

        restorefd.Reset();
        if (unlinkat(rootfd.Get(), "postgresql.restore", AT_REMOVEDIR) != 0)
            Warn("Cannot remove " + restoreroot + ": " + Blex::GetLastOSError());
}

void ClearRestoreMode()
{
        Fd rootfd = OpenDataRoot();
        RemoveFile(rootfd.Get(), "webhare.restoremode");
}

volatile sig_atomic_t child_pid;

void ForwardSignal(int sig)
{
        if (child_pid > 0)
            kill(child_pid, sig);
}

/// Wait for the child, forwarding termination signals to it, and exit with its status
[[noreturn]] void SuperviseChild()
{
        struct sigaction sa;
        memset(&sa, 0, sizeof sa);
        sa.sa_handler = ForwardSignal; //no SA_RESTART, we want waitpid to return so we notice the child exiting
        sigemptyset(&sa.sa_mask);
        for (int sig : { SIGHUP, SIGINT, SIGQUIT, SIGTERM, SIGUSR1, SIGUSR2, SIGALRM, SIGWINCH, SIGCONT })
            sigaction(sig, &sa, nullptr);

        int status;
        while (true)
        {
                pid_t res = waitpid(child_pid, &status, 0);
                if (res == child_pid)
                    break;
                if (res < 0 && errno != EINTR)
                    FailOS("waitpid");
        }

        if (WIFEXITED(status))
            _exit(WEXITSTATUS(status));

        // Die the same way our child did so our parent sees the same result
        int sig = WTERMSIG(status);
        signal(sig, SIG_DFL);
        sigset_t unblock;
        sigemptyset(&unblock);
        sigaddset(&unblock, sig);
        sigprocmask(SIG_UNBLOCK, &unblock, nullptr);
        raise(sig);
        _exit(128 + sig);
}

/// Report an error in the forked child of RunAs. Only uses async-signal-safe functions
[[noreturn]] void ChildFail(char const *msg)
{
        ssize_t ignored = write(2, msg, strlen(msg));
        (void)ignored;
        _exit(127);
}

[[noreturn]] void RunAs(std::string const &username, std::vector< std::string > const &command)
{
        ServiceUser user;
        std::vector< gid_t > groups;

        // These match the users and groups the root-based container used (chpst -u postgres:whdata etc)
        if (username == "postgres")
        {
                user = LookupUser("postgres");
                user.gid = whdata_gid;
                groups = { whdata_gid };
        }
        else if (username == "opensearch")
        {
                user = LookupUser("opensearch");
                groups = { user.gid, whdata_gid };
        }
        else if (username == "chrome")
        {
                user = LookupUser("chrome");
                groups = { user.gid };
        }
        else
        {
                Fail("run-as: unsupported user '" + username + "'");
        }

        // Build argv before forking, so the child doesn't need to allocate
        std::vector< char * > argv;
        for (auto const &arg : command)
            argv.push_back(const_cast< char * >(arg.c_str()));
        argv.push_back(nullptr);

        // Drop supplementary groups and switch to the target group (needs root, so do it before forking)
        if (setgroups(groups.size(), groups.data()) != 0)
            FailOS("setgroups");
        if (setresgid(user.gid, user.gid, user.gid) != 0)
            FailOS("setresgid");

        /* We can't simply exec the program: the caller (eg. the WebHare service manager) wouldn't be allowed to signal it to
           stop it. So we stay around as a parent that forwards signals. Block them until we've set up forwarding */
        sigset_t all, old;
        sigfillset(&all);
        sigprocmask(SIG_BLOCK, &all, &old);

        pid_t parent_pid = getpid();
        pid_t pid = fork();
        if (pid < 0)
            FailOS("fork");

        if (pid > 0)
        {
                child_pid = pid;
                /* The parent keeps the caller as real uid so the caller can signal us, and the target user as effective uid so we
                   can signal the child. Changing credentials also makes us non-dumpable so the caller can't ptrace us */
                if (setresuid(caller_uid, user.uid, user.uid) != 0)
                {
                        kill(pid, SIGKILL);
                        FailOS("setresuid");
                }
                /* We don't need any of the caller's file descriptors except stdin/out/err (for puppeteer, its pipe should close
                   when the browser exits) */
                close_range(3, ~0U, 0);
                sigprocmask(SIG_SETMASK, &old, nullptr);
                SuperviseChild();
        }

        /* Child. Only use async-signal-safe functions from here on: ChildFail writes a fixed message and _exits */
        // Drop the uid (real, effective and saved)
        if (setresuid(user.uid, user.uid, user.uid) != 0)
            ChildFail("whprivileged: setresuid failed\n");

        // Paranoia: verify we can't get root back
        if (setuid(0) == 0 || seteuid(0) == 0)
            ChildFail("whprivileged: still able to regain root after dropping privileges\n");

        // None of these services need setuid helpers (chrome is started with --no-sandbox). Make sure they can't use any
        if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0)
            ChildFail("whprivileged: prctl(PR_SET_NO_NEW_PRIVS) failed\n");
        // If our parent is killed (eg. SIGKILL from the service manager), take the child down too
        if (prctl(PR_SET_PDEATHSIG, SIGKILL, 0, 0, 0) != 0)
            ChildFail("whprivileged: prctl(PR_SET_PDEATHSIG) failed\n");
        if (getppid() != parent_pid) //parent already gone
            _exit(127);

        sigprocmask(SIG_SETMASK, &old, nullptr);
        execvp(argv[0], argv.data());

        char const prefix[] = "whprivileged: cannot execute ";
        ssize_t ignored = write(2, prefix, sizeof prefix - 1);
        ignored = write(2, argv[0], strlen(argv[0]));
        ignored = write(2, "\n", 1);
        (void)ignored;
        _exit(127);
}

int ShowSyntax(std::string const &error)
{
        if (!error.empty())
            Blex::ErrStream() << "whprivileged: " << error;
        Blex::ErrStream() << "Syntax: whprivileged prepare-dataroot | prepare-postgresql | prepare-opensearch | prepare-restore\n"
                             "                    | finish-restore | clear-restoremode\n"
                             "                    | run-as <postgres|opensearch|chrome> <program> [args...]";
        return EXIT_FAILURE;
}

int PrivilegedMain(int argc, char const * const argv[])
{
        Blex::OptionParser::Option optionlist[] =
        { Blex::OptionParser::Option::Param("command", true)
        , Blex::OptionParser::Option::ParamList("args")
        , Blex::OptionParser::Option::ListEnd()
        };
        Blex::OptionParser options(optionlist);
        if (!options.Parse(std::vector< std::string >(argv, argv + argc)))
            return ShowSyntax(options.GetErrorDescription());

        std::string const command = options.Param("command");
        std::vector< std::string > args;
        if (options.Exists("args"))
            args = options.ParamList("args");

        if (geteuid() != 0)
            Fail("Not running as root - this binary must be owned by root and have the setuid bit set");

        struct group *grp = getgrnam(AllowedGroup);
        if (!grp)
            Fail(std::string("Group '") + AllowedGroup + "' does not exist");
        whdata_gid = grp->gr_gid;

        // File permissions (root:whdata 4750) should already enforce this, but don't depend on that
        if (!CallerIsAllowed())
            Fail(std::string("Caller is not root or a member of group '") + AllowedGroup + "'");

        caller_uid = getuid();

        if (command == "run-as")
        {
                if (args.size() < 2)
                    return ShowSyntax("run-as requires a user and a program");
                RunAs(args[0], std::vector< std::string >(args.begin() + 1, args.end()));
        }

        if (!args.empty())
            return ShowSyntax("Unexpected arguments for '" + command + "'");

        umask(022);
        if (command == "prepare-dataroot")
            PrepareDataRoot();
        else if (command == "prepare-postgresql")
            PreparePostgreSQL();
        else if (command == "prepare-opensearch")
            PrepareOpenSearch();
        else if (command == "prepare-restore")
            PrepareRestore();
        else if (command == "finish-restore")
            FinishRestore();
        else if (command == "clear-restoremode")
            ClearRestoreMode();
        else
            return ShowSyntax("Unknown command '" + command + "'");

        return warnings ? 2 : 0;
}

} // End of anonymous namespace

int main(int argc, char *argv[])
{
        try
        {
                return PrivilegedMain(argc, argv);
        }
        catch (std::exception &e)
        {
                Blex::ErrStream() << "whprivileged: " << e.what();
                return EXIT_FAILURE;
        }
}
