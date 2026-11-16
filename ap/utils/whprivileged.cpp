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
   - All filesystem access is relative to directory file descriptors and never follows symlinks (see the *At functions in
     blex/path.h). Ownership of entries is only changed after verifying they're still the object we examined (race-free
     on Linux, using O_PATH descriptors). A symlink planted by an unprivileged user is never followed.
   - When taking over a tree, only entries owned by the users we expect (root for data from a container that ran WebHare
     as root, or eg. postgres) are changed. Directories are processed depth first and changed only after their contents,
     so the unprivileged user can't add anything to a directory we still have to process. Root-owned files with multiple
     hard links are skipped, they might be links to files outside the dataroot.
*/

#include <blex/blexlib.h>
#include <blex/getopt.h>
#include <blex/path.h>
#include <blex/threads.h>

#include <signal.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cstring>
#include <stdexcept>
#include <string>
#include <vector>

namespace
{

using Blex::FileDescriptor;
using Blex::FilePermissions::AccessFlags;

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

bool LastErrorIs(std::errc error)
{
        return Blex::GetLastOSErrorCode() == error;
}

Blex::PathStatus StatFd(int fd, std::string const &path)
{
        Blex::PathStatus st(fd);
        if (!st.Exists())
            FailOS("Cannot stat " + path);
        return st;
}

bool Contains(UidSet const &set, uid_t uid)
{
        return std::find(set.begin(), set.end(), uid) != set.end();
}

bool CallerIsAllowed()
{
        return getuid() == 0 || Blex::IsProcessInGroup(whdata_gid);
}

/// The uid and primary gid of a service user
struct ServiceUser
{
        uid_t uid;
        gid_t gid;
};

ServiceUser LookupUser(std::string const &name)
{
        ServiceUser user;
        if (!Blex::LookupUser(name, &user.uid, &user.gid))
            Fail("User '" + name + "' does not exist");
        if (user.uid == 0 || user.gid == 0)
            Fail("User '" + name + "' must not have uid or gid 0");
        return user;
}

/// Open the dataroot and verify nobody but root can modify it - otherwise none of our checks make sense
FileDescriptor OpenDataRoot()
{
        FileDescriptor fd = Blex::OpenDirectoryNoFollow(DataRoot);
        if (!fd.IsValid())
            FailOS("Cannot open " + DataRoot);

        Blex::PathStatus st = StatFd(fd.Get(), DataRoot);
        if (st.GetOwner() != 0 || (st.GetUnixAccess() & (S_IWGRP | S_IWOTH)))
            Fail(DataRoot + " must be owned by root and not be writable by group or others");
        return fd;
}

/// Give all entries inside dirfd that are owned by a user in 'from' to uid:gid, depth first
void ClaimContents(int dirfd, std::string const &path, uid_t uid, gid_t gid, UidSet const &from)
{
        dev_t dir_dev = StatFd(dirfd, path).GetDevice();

        std::vector< std::string > names;
        if (!Blex::ListDirectoryAt(dirfd, &names))
            FailOS("Cannot list " + path);

        for (std::string const &name : names)
        {
                std::string subpath = Blex::MergePath(path, name);
                Blex::PathStatus st;
                st.StatAt(dirfd, name);
                if (!st.Exists())
                {
                        if (!LastErrorIs(std::errc::no_such_file_or_directory))
                            Warn("Cannot stat " + subpath + ": " + Blex::GetLastOSError());
                        continue;
                }
                if (st.GetDevice() != dir_dev) //never cross into other mounts
                    continue;

                if (st.GetOwner() == uid && st.GetGroup() == gid) //already ours. we still need to descend into directories though
                {
                        if (!st.IsDir())
                            continue;
                }
                else if (!Contains(from, st.GetOwner()))
                {
                        continue; //owned by someone else, leave it (and its contents) alone
                }

                if (st.IsDir())
                {
                        // Open the directory to process its contents. Verify it's still the same dir
                        FileDescriptor subdirfd = Blex::OpenDirectoryAt(dirfd, name);
                        if (!subdirfd.IsValid() || !Blex::PathStatus(subdirfd.Get()).IsSameObject(st))
                        {
                                Warn(subpath + " changed while we were processing it, skipping");
                                continue;
                        }
                        ClaimContents(subdirfd.Get(), subpath, uid, gid, from);
                        if (!Blex::SetOwner(subdirfd.Get(), uid, gid))
                            Warn("Cannot chown " + subpath + ": " + Blex::GetLastOSError());
                }
                else if (st.IsFile() || st.IsLink())
                {
                        if (st.IsFile() && st.GetOwner() == 0 && st.GetLinkCount() > 1)
                            Warn("Not changing ownership of " + subpath + ": it's owned by root and has multiple hard links");
                        else if (!Blex::SetOwnerAt(dirfd, name, uid, gid, st))
                            Warn("Cannot chown " + subpath + ": " + Blex::GetLastOSError());
                }
                // else: we don't touch sockets, fifos or device nodes
        }
}

/** Ensure parentfd/name is a directory owned by uid:gid. If it's missing, create it. If it's owned by root or by a user
    in 'from', take it and its contents over. Applies 'mode' when creating or taking over the directory, or always if
    force_mode is set.
    @return An open descriptor for the directory, invalid if we can't or won't use it */
FileDescriptor EnsureDir(int parentfd, std::string const &path, std::string const &name, uid_t uid, gid_t gid, unsigned mode, bool force_mode, UidSet const &from)
{
        bool created = false;
        if (Blex::CreateDirAt(parentfd, name, AccessFlags(0700)))
            created = true;
        else if (!LastErrorIs(std::errc::file_exists))
            FailOS("Cannot create " + path);

        FileDescriptor fd = Blex::OpenDirectoryAt(parentfd, name);
        if (!fd.IsValid())
        {
                Warn(path + " is not a directory: " + Blex::GetLastOSError());
                return FileDescriptor();
        }

        Blex::PathStatus st = StatFd(fd.Get(), path);
        if (st.GetDevice() != StatFd(parentfd, path).GetDevice()) //a mount (eg. a volume or a directory shared from the host). not ours to manage
            return fd;

        if (st.GetOwner() != uid)
        {
                if (st.GetOwner() != 0 && !Contains(from, st.GetOwner()))
                {
                        Warn("Leaving " + path + " alone: it's owned by uid " + std::to_string(st.GetOwner()));
                        return FileDescriptor();
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
        if (st.GetOwner() != uid || st.GetGroup() != gid)
        {
                if (!Blex::SetOwner(fd.Get(), uid, gid))
                    FailOS("Cannot chown " + path);
                force_mode = true;
        }

        if ((force_mode || created) && unsigned(st.GetUnixAccess() & 07777) != mode && !Blex::SetUNIXPermissions(fd.Get(), AccessFlags(mode)))
            FailOS("Cannot chmod " + path);
        return fd;
}

/// Ensure parentfd/name is a regular file owned by the caller, creating an empty one if needed
void EnsureCallerFile(int parentfd, std::string const &name)
{
        std::string path = Blex::MergePath(DataRoot, name);
        FileDescriptor fd = Blex::CreateFileAt(parentfd, name, AccessFlags(0640));
        if (fd.IsValid())
        {
                if (!Blex::SetOwner(fd.Get(), caller_uid, whdata_gid))
                    FailOS("Cannot chown " + path);
                return;
        }
        if (!LastErrorIs(std::errc::file_exists))
            FailOS("Cannot create " + path);

        Blex::PathStatus st;
        st.StatAt(parentfd, name);
        if (!st.Exists())
            FailOS("Cannot stat " + path);
        if (st.GetOwner() == caller_uid)
            return;

        if (!st.IsFile() || st.GetOwner() != 0 || st.GetLinkCount() > 1)
            Warn("Leaving " + path + " alone: not a regular file owned by root");
        else if (!Blex::SetOwnerAt(parentfd, name, caller_uid, whdata_gid, st))
            FailOS("Cannot chown " + path);
}

/// Remove parentfd/name if it's a regular file
void RemoveFile(int parentfd, std::string const &name)
{
        std::string path = Blex::MergePath(DataRoot, name);
        Blex::PathStatus st;
        st.StatAt(parentfd, name);
        if (!st.Exists())
        {
                if (!LastErrorIs(std::errc::no_such_file_or_directory))
                    Warn("Cannot stat " + path + ": " + Blex::GetLastOSError());
                return;
        }
        if (!st.IsFile())
        {
                Warn("Not removing " + path + ": not a regular file");
                return;
        }
        if (!Blex::RemoveFileAt(parentfd, name) && !LastErrorIs(std::errc::no_such_file_or_directory))
            FailOS("Cannot remove " + path);
}

/// Does parentfd/name not exist? (false if it exists or we can't tell)
bool IsMissing(int parentfd, std::string const &name)
{
        Blex::PathStatus st;
        st.StatAt(parentfd, name);
        return !st.Exists() && LastErrorIs(std::errc::no_such_file_or_directory);
}

/// Open parentfd/name, which must be a directory owned by uid
FileDescriptor OpenOwnedDir(int parentfd, std::string const &path, std::string const &name, uid_t uid)
{
        FileDescriptor fd = Blex::OpenDirectoryAt(parentfd, name);
        if (!fd.IsValid())
            FailOS("Cannot open " + path);
        if (StatFd(fd.Get(), path).GetOwner() != uid)
            Fail(path + " is not owned by uid " + std::to_string(uid));
        return fd;
}

void PrepareDataRoot()
{
        FileDescriptor rootfd = OpenDataRoot();

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
        FileDescriptor rootfd = OpenDataRoot();

        FileDescriptor psfd = EnsureDir(rootfd.Get(), Blex::MergePath(DataRoot, "postgresql"), "postgresql", pg.uid, whdata_gid, 0710, true, UidSet());
        if (!psfd.IsValid())
            Fail("Cannot prepare " + Blex::MergePath(DataRoot, "postgresql"));
        PreparePostgreSQLUserDirs(psfd.Get(), pg.uid);
}

void PrepareOpenSearch()
{
        ServiceUser os = LookupUser("opensearch");
        FileDescriptor rootfd = OpenDataRoot();

        // Rename old data folder
        if (IsMissing(rootfd.Get(), "opensearch"))
        {
                Blex::PathStatus st;
                st.StatAt(rootfd.Get(), "elasticsearch");
                if (st.IsDir() && !Blex::MovePathAt(rootfd.Get(), "elasticsearch", rootfd.Get(), "opensearch"))
                    FailOS("Cannot rename " + Blex::MergePath(DataRoot, "elasticsearch") + " to opensearch");
        }

        FileDescriptor osfd = EnsureDir(rootfd.Get(), Blex::MergePath(DataRoot, "opensearch"), "opensearch", os.uid, os.gid, 0700, true, UidSet());
        if (!osfd.IsValid())
            Fail("Cannot prepare " + Blex::MergePath(DataRoot, "opensearch"));
}

void PrepareRestore()
{
        FileDescriptor rootfd = OpenDataRoot();
        FileDescriptor fd = EnsureDir(rootfd.Get(), Blex::MergePath(DataRoot, "postgresql.restore"), "postgresql.restore", caller_uid, whdata_gid, 0700, true, UidSet());
        if (!fd.IsValid())
            Fail("Cannot prepare " + Blex::MergePath(DataRoot, "postgresql.restore"));
}

void FinishRestore()
{
        ServiceUser pg = LookupUser("postgres");
        FileDescriptor rootfd = OpenDataRoot();

        std::string const psroot = Blex::MergePath(DataRoot, "postgresql");
        std::string const restoreroot = Blex::MergePath(DataRoot, "postgresql.restore");

        if (!IsMissing(rootfd.Get(), "postgresql"))
            Fail(psroot + " already exists");

        FileDescriptor restorefd = OpenOwnedDir(rootfd.Get(), restoreroot, "postgresql.restore", caller_uid);
        OpenOwnedDir(restorefd.Get(), Blex::MergePath(restoreroot, "db"), "db", caller_uid);
        OpenOwnedDir(restorefd.Get(), Blex::MergePath(restoreroot, "blob"), "blob", caller_uid);

        FileDescriptor psfd = EnsureDir(rootfd.Get(), psroot, "postgresql", pg.uid, whdata_gid, 0710, true, UidSet());
        if (!psfd.IsValid())
            Fail("Cannot create " + psroot);

        // Move the database into place first so the caller can no longer add anything to it, then hand it to postgres
        if (!Blex::MovePathAt(restorefd.Get(), "db", psfd.Get(), "db"))
            FailOS("Cannot move the restored database into place");

        std::string const dbpath = Blex::MergePath(psroot, "db");
        FileDescriptor dbfd = OpenOwnedDir(psfd.Get(), dbpath, "db", caller_uid);
        ClaimContents(dbfd.Get(), dbpath, pg.uid, whdata_gid, UidSet{ caller_uid });
        if (!Blex::SetOwner(dbfd.Get(), pg.uid, whdata_gid) || !Blex::SetUNIXPermissions(dbfd.Get(), AccessFlags(0700)))
            FailOS("Cannot hand " + dbpath + " to postgres");

        if (!Blex::MovePathAt(restorefd.Get(), "blob", psfd.Get(), "blob"))
            FailOS("Cannot move the restored blobs into place");
        PreparePostgreSQLUserDirs(psfd.Get(), pg.uid);

        restorefd.Reset();
        if (!Blex::RemoveDirAt(rootfd.Get(), "postgresql.restore"))
            Warn("Cannot remove " + restoreroot + ": " + Blex::GetLastOSError());
}

void ClearRestoreMode()
{
        FileDescriptor rootfd = OpenDataRoot();
        RemoveFile(rootfd.Get(), "webhare.restoremode");
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
        if (!Blex::SetSupplementaryGroups(groups))
            FailOS("setgroups");
        if (!Blex::SetProcessGroupIds(user.gid, user.gid))
            FailOS("setresgid");

        /* We can't simply exec the program: the caller (eg. the WebHare service manager) wouldn't be allowed to signal it to
           stop it. So we stay around as a parent that forwards signals. Block them until we're ready to forward them
           (WaitForProcessForwardingSignals unblocks them) */
        sigset_t all, old;
        sigfillset(&all);
        sigprocmask(SIG_BLOCK, &all, &old);

        pid_t parent_pid = getpid();
        pid_t pid = fork();
        if (pid < 0)
            FailOS("fork");

        if (pid > 0)
        {
                /* The parent keeps the caller as real uid so the caller can signal us, and the target user as effective uid so we
                   can signal the child. Changing credentials also makes us non-dumpable so the caller can't ptrace us */
                if (!Blex::SetProcessUserIds(caller_uid, user.uid))
                {
                        kill(pid, SIGKILL);
                        FailOS("setresuid");
                }
                /* We don't need any of the caller's file descriptors except stdin/out/err (for puppeteer, its pipe should close
                   when the browser exits) */
                Blex::CloseFileHandlesFrom(3);

                int status = Blex::WaitForProcessForwardingSignals(pid);
                if (status == -1)
                    FailOS("waitpid");
                Blex::ExitWithWaitStatus(status);
        }

        /* Child. Only use async-signal-safe functions from here on: ChildFail writes a fixed message and _exits */
        // Drop the uid (real, effective and saved)
        if (!Blex::SetProcessUserIds(user.uid, user.uid))
            ChildFail("whprivileged: setresuid failed\n");

        // Paranoia: verify we can't get root back
        if (setuid(0) == 0 || seteuid(0) == 0)
            ChildFail("whprivileged: still able to regain root after dropping privileges\n");

        // None of these services need setuid helpers (chrome is started with --no-sandbox). Make sure they can't use any
        if (!Blex::DisallowNewPrivileges())
            ChildFail("whprivileged: prctl(PR_SET_NO_NEW_PRIVS) failed\n");
        // If our parent is killed (eg. SIGKILL from the service manager), take the child down too
        if (!Blex::SetParentDeathSignal(SIGKILL))
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

        if (!Blex::LookupGroup(AllowedGroup, &whdata_gid))
            Fail(std::string("Group '") + AllowedGroup + "' does not exist");

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
