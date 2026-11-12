//---------------------------------------------------------------------------
#include <blex/blexlib.h>
#include <iostream>
#include <string>
#include <vector>
#include "../testing.h"

//---------------------------------------------------------------------------

#include "../threads.h"
#include "../path.h"
#include "../pipestream.h"
#include "../context.h"

extern std::string self_app;

void TestArgumentList(std::vector<std::string> const &arguments)
{
        Blex::PipeSet input;

        Blex::Process testecho;
        testecho.RedirectOutput(input.GetWriteEnd(),false);

        BLEX_TEST_CHECK(testecho.Start(self_app,arguments,"",false));

        /* Now, start splitting the results into a vector */
        std::vector<std::string> received_arguments(1);
        std::string *current=&received_arguments.back();

        uint8_t byte;
        while (input.GetReadEnd().Read(&byte,1))
        {
                if (byte=='\n') //end of line!
                {
                        received_arguments.push_back(std::string());
                        current = &received_arguments.back();
                }
                else if (byte != '\r')
                {
                        current->push_back(byte);
                }
        }
        received_arguments.resize(received_arguments.size()-1);

        //We got all the arguments, so verify them
        for (unsigned i=0;i<std::min(arguments.size(),received_arguments.size());++i)
            BLEX_TEST_CHECKEQUAL(arguments[i],received_arguments[i]);

        /* We have all the arguments back via the batch file. Verify them! */
        BLEX_TEST_CHECKEQUAL(arguments.size(),received_arguments.size());

        testecho.WaitFinish();
        BLEX_TEST_CHECKEQUAL(arguments.size(), testecho.GetReturnValue());
}

/*
·       Arguments are delimited by white space, which is either a space or a tab.
·       A string surrounded by double quotation marks is interpreted as a
single argument, regardless of white space contained within. A quoted
string can be embedded in an argument. Note that the caret (^) is not
recognized as an escape character or delimiter.
·       A double quotation mark preceded by a backslash, \", is interpreted as
a literal double quotation mark (").
·       Backslashes are interpreted literally, unless they immediately precede
a double quotation mark.
·       If an even number of backslashes is followed by a double quotation
mark, then one backslash (\) is placed in the argv array for every pair
of backslashes (\\), and the double quotation mark (") is interpreted as
a string delimiter.
·       If an odd number of backslashes is followed by a double quotation
mark, then one backslash (\) is placed in the argv array for every pair
of backslashes (\\) and the double quotation mark is interpreted as an
escape sequence by the remaining backslash, causing a literal double
quotation mark (") to be placed in argv.
*/

BLEX_TEST_FUNCTION(TestArguments)
{
        std::vector<std::string> arguments;

        /*  1: "echo" */
        arguments.push_back("echo");
        TestArgumentList(arguments);

        /*  2 */
        arguments.push_back("first arg");
        TestArgumentList(arguments);

        /*  3 */
        arguments.push_back(""); //empty...
        TestArgumentList(arguments);

        /*  4 */
        arguments.push_back("\"quoted \"\"argument\"");
        TestArgumentList(arguments);

        /*  5 */
        arguments.push_back("arg\\with back\\slashes");
        TestArgumentList(arguments);

        /*  6 */
        arguments.push_back("end2slash\\\\");
        TestArgumentList(arguments);

        /*  7    end3slashquote\\\"    */
        arguments.push_back("end3slashquote\\\\\\\"");
        TestArgumentList(arguments);

        /*  8   mid\"slash    */
        arguments.push_back("mid\\\"slash");
        TestArgumentList(arguments);

        /*  9   pleuros */
        arguments.push_back("€uro çedille héééé!");
        TestArgumentList(arguments);
}

BLEX_TEST_FUNCTION(TestBreak)
{
        Blex::PipeSet output;
        output.GetReadEnd().SetBlocking(false);
        output.GetWriteEnd().SetBlocking(true);

        Blex::Process testbreak;
        testbreak.RedirectOutput(output.GetWriteEnd(),false);

        //Launch the loopback process
        std::vector <std::string> args;
        args.push_back("breaktest");
        BLEX_TEST_CHECK(testbreak.Start(self_app,args,"",false));

        Blex::PipeWaiter waiter;
        waiter.AddReadPipe(output.GetReadEnd()); //listen for readability

        while (waiter.Wait(Blex::DateTime::Max()) == false || !waiter.GotRead(output.GetReadEnd()))
            /**/;
        //Now send a break signal
        testbreak.SendTerminate();

        while(true)
        {
                waiter.Wait(Blex::DateTime::Max());
                uint8_t temp;
                if(waiter.GotRead(output.GetReadEnd()))
                {
                        output.GetReadEnd().Read(&temp,1);
                }
                if (output.GetReadEnd().EndOfStream())
                   break;
        }
        //And wait for process to come back to us
        testbreak.WaitFinish();
}

Blex::ConditionMutex cm;
bool shared_bool_1 = false;
bool shared_bool_2 = false;

void TestPipesAndCVs_Thread(Blex::PipeSet *)
{
        Blex::ConditionMutex::AutoLock lock(cm);
        while(!shared_bool_2)
            lock.Wait();

        shared_bool_1=true;
        cm.SignalOne();

        while(shared_bool_2)
            lock.Wait();

        shared_bool_1=false;
        cm.SignalAll();
}

BLEX_TEST_FUNCTION(TestPipesAndCVs)
{
        Blex::PipeSet output;
        output.GetReadEnd().SetBlocking(false);
        output.GetWriteEnd().SetBlocking(true);

        Blex::Thread subthread(std::bind(&TestPipesAndCVs_Thread, &output));
        subthread.Start();
        Blex::SleepThread(50);

        Blex::PipeWaiter waiter;
        waiter.AddReadPipe(output.GetReadEnd()); //listen for readability

        {
                Blex::ConditionMutex::AutoLock lock(cm);
                shared_bool_2 = true;
                cm.SignalOne();
                while(!shared_bool_1) //may not timeout!
                    BLEX_TEST_CHECKEQUAL(true, waiter.ConditionMutexWait(lock, Blex::DateTime::Now() + Blex::DateTime::Seconds(300)));

                shared_bool_2 = false;
                cm.SignalAll();
                while(shared_bool_1)
                    BLEX_TEST_CHECKEQUAL(true, waiter.ConditionMutexWait(lock, Blex::DateTime::Now() + Blex::DateTime::Seconds(300)));
        }
}

BLEX_TEST_FUNCTION(TestDeadLockDetection)
{
        Blex::Detail::SetThrowOnDeadlock(true);

        try
        {
                Blex::DebugMutex mutex;
                mutex.SetupDebugging("a");

                Blex::DebugMutex::AutoLock lock1(mutex);
                Blex::DebugMutex::AutoLock lock2(mutex);

                BLEX_TEST_CHECKEQUAL(true, false);
        }
        catch (std::logic_error &e)
        {
        }

        Blex::Detail::SetThrowOnDeadlock(false);
}

struct TestContextData
{
        inline TestContextData() : data(0) { }

        unsigned data;
};

typedef Blex::Context< TestContextData, 1, void > TestContext;

Blex::ConditionMutex co_cm;
unsigned co_shared_pg = 0;

void TextContextSubThread()
{
        Blex::ConditionMutex::AutoLock lock(co_cm);

        TestContext context(Blex::CurrentThreadContext());
        BLEX_TEST_CHECKEQUAL(0, context->data);

        context->data = 7;

        co_shared_pg = 1;
        co_cm.SignalAll();

        while (co_shared_pg != 2)
            BLEX_TEST_CHECKEQUAL(true, lock.TimedWait(Blex::DateTime::Now() + Blex::DateTime::Seconds(30)));

        BLEX_TEST_CHECKEQUAL(7, context->data);

        co_shared_pg = 3;
        co_cm.SignalAll();
}

BLEX_TEST_FUNCTION(TestThreadContext)
{
        TestContext::Register(Blex::GetThreadContextRegistrator());

        TestContext context(Blex::CurrentThreadContext());

        BLEX_TEST_CHECKEQUAL(0, context->data);
        ++context->data;
        TestContext context2(Blex::CurrentThreadContext());
        BLEX_TEST_CHECKEQUAL(1, context2->data);

        Blex::Thread subthread(&TextContextSubThread);
        subthread.Start();
        Blex::ConditionMutex::AutoLock lock(co_cm);

        while (co_shared_pg != 1)
            BLEX_TEST_CHECKEQUAL(true, lock.TimedWait(Blex::DateTime::Now() + Blex::DateTime::Seconds(30)));

        TestContext context3(Blex::CurrentThreadContext());
        BLEX_TEST_CHECKEQUAL(1, context3->data);

        context3->data = 5;

        co_shared_pg = 2;
        co_cm.SignalAll();

        while (co_shared_pg != 3)
            BLEX_TEST_CHECKEQUAL(true, lock.TimedWait(Blex::DateTime::Now() + Blex::DateTime::Seconds(30)));

        TestContext context4(Blex::CurrentThreadContext());
        BLEX_TEST_CHECKEQUAL(5, context4->data);
}

BLEX_TEST_FUNCTION(TestSignalHandling)
{
        // test that the process signal handler returns 'killed by signal' even when intercepting the signal
        Blex::PipeSet input;
        Blex::PipeSet output;

        input.GetReadEnd().SetBlocking(true);
        input.GetWriteEnd().SetBlocking(true);
        output.GetReadEnd().SetBlocking(true);
        output.GetWriteEnd().SetBlocking(true);

        Blex::Process testloopback;
        testloopback.RedirectInput(input.GetReadEnd());
        testloopback.RedirectOutput(output.GetWriteEnd(),false);

        std::vector <std::string> args;
        args.push_back("loopback");
        BLEX_TEST_CHECK(testloopback.Start(self_app,args,"",false));

        // Roundtrip a byte to make sure the signal handlers are installed
        char byte = 0;
        BLEX_TEST_CHECKEQUAL(1u, input.GetWriteEnd().Write(&byte,1));
        BLEX_TEST_CHECKEQUAL(1u, output.GetReadEnd().Read(&byte,1));

        // send a terminate signal
        testloopback.SendTerminate();

        testloopback.WaitFinish();

        // should be 256 + 15(SIGTERM)
        BLEX_TEST_CHECKEQUAL(271, testloopback.GetReturnValue());
}

#include <fcntl.h>
#include <grp.h>
#include <pwd.h>
#include <signal.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>
#include <functional>
#if defined(PLATFORM_LINUX)
#include <sys/prctl.h>
#endif

namespace
{

/** Run a function in a forked child process (so it can change process wide state)
    @return The wait status of the child. The exit code of the child is the return value of the function */
int RunInChild(std::function< int() > const &func)
{
        std::cout << std::flush;
        pid_t pid = fork();
        if (pid == 0)
        {
                int retval = 99;
                try
                {
                        retval = func();
                }
                catch (...)
                {
                }
                _exit(retval);
        }
        BLEX_TEST_CHECK(pid > 0);

        int status = -1;
        while (waitpid(pid, &status, 0) < 0)
            BLEX_TEST_CHECKEQUAL(EINTR, errno);
        return status;
}

/// Run a function in a child process, and verify it exits with code 0. The function returns a nonzero code to indicate which step failed
void CheckChildSucceeds(std::function< int() > const &func)
{
        int status = RunInChild(func);
        BLEX_TEST_CHECKEQUAL(true, WIFEXITED(status));
        BLEX_TEST_CHECKEQUAL(0, WEXITSTATUS(status));
}

} // End of anonymous namespace

BLEX_TEST_FUNCTION(TestUserLookup)
{
        uid_t uid = 12345;
        gid_t gid = 12345;
        BLEX_TEST_CHECKEQUAL(true, Blex::LookupUser("root", &uid, &gid));
        BLEX_TEST_CHECKEQUAL(0u, uid);
        BLEX_TEST_CHECKEQUAL(0u, gid);
        BLEX_TEST_CHECKEQUAL(true, Blex::LookupUser("root", nullptr, nullptr));

        BLEX_TEST_CHECKEQUAL(false, Blex::LookupUser("blex-nonexisting-user", &uid, &gid));
        BLEX_TEST_CHECKEQUAL(false, Blex::LookupUser("", &uid, &gid));

        if (struct passwd *pw = getpwuid(getuid())) //the current user may not have a name, eg. in a container
        {
                std::string name = pw->pw_name;
                BLEX_TEST_CHECKEQUAL(true, Blex::LookupUser(name, &uid, &gid));
                BLEX_TEST_CHECKEQUAL(getuid(), uid);
        }

        // Group 0 is 'root' on Linux and 'wheel' on macOS
        struct group *gr = getgrgid(0);
        BLEX_TEST_CHECK(gr != nullptr);
        std::string rootgroup = gr->gr_name;
        gid = 12345;
        BLEX_TEST_CHECKEQUAL(true, Blex::LookupGroup(rootgroup, &gid));
        BLEX_TEST_CHECKEQUAL(0u, gid);
        BLEX_TEST_CHECKEQUAL(true, Blex::LookupGroup(rootgroup, nullptr));
        BLEX_TEST_CHECKEQUAL(false, Blex::LookupGroup("blex-nonexisting-group", &gid));
}

BLEX_TEST_FUNCTION(TestProcessGroups)
{
        BLEX_TEST_CHECKEQUAL(true, Blex::IsProcessInGroup(getgid()));

        std::vector< gid_t > groups(getgroups(0, nullptr));
        groups.resize(getgroups(groups.size(), groups.data()));
        for (gid_t gid : groups)
            BLEX_TEST_CHECKEQUAL(true, Blex::IsProcessInGroup(gid));

        gid_t notmember = 0x7FFF0000;
        while (notmember == getgid() || std::find(groups.begin(), groups.end(), notmember) != groups.end())
            ++notmember;
        BLEX_TEST_CHECKEQUAL(false, Blex::IsProcessInGroup(notmember));
}

BLEX_TEST_FUNCTION(TestProcessCredentials)
{
        // Setting our current credentials is always allowed
        CheckChildSucceeds([]()
        {
                uid_t uid = getuid();
                gid_t gid = getgid();
                if (!Blex::SetProcessGroupIds(gid, gid))
                    return 1;
                if (!Blex::SetProcessUserIds(uid, uid))
                    return 2;
                if (getuid() != uid || geteuid() != uid || getgid() != gid || getegid() != gid)
                    return 3;
                return 0;
        });

        if (geteuid() != 0)
        {
                // Unprivileged processes can't change their supplementary groups
                CheckChildSucceeds([]()
                {
                        std::vector< gid_t > groups{ getgid() };
                        return !Blex::SetSupplementaryGroups(groups) && errno == EPERM ? 0 : 1;
                });
                return;
        }

        // Running as root: actually drop privileges
        uid_t const nobody_uid = 65534;
        gid_t const nobody_gid = 65534;
        gid_t const other_gid = 65533;

        // Keep a real user id, run with the effective (and saved) user id of another user
        CheckChildSucceeds([&]()
        {
                if (!Blex::SetSupplementaryGroups({ nobody_gid, other_gid }))
                    return 1;
                std::vector< gid_t > groups(getgroups(0, nullptr));
                groups.resize(getgroups(groups.size(), groups.data()));
                std::sort(groups.begin(), groups.end());
                if (groups != std::vector< gid_t >{ other_gid, nobody_gid })
                    return 2;

                if (!Blex::SetProcessGroupIds(other_gid, nobody_gid) || getgid() != other_gid || getegid() != nobody_gid)
                    return 3;
                if (!Blex::SetProcessUserIds(0, nobody_uid) || getuid() != 0 || geteuid() != nobody_uid)
                    return 4;
#if defined(PLATFORM_LINUX)
                uid_t ruid, euid, suid;
                if (getresuid(&ruid, &euid, &suid) != 0 || ruid != 0 || euid != nobody_uid || suid != nobody_uid)
                    return 5;
                gid_t rgid, egid, sgid;
                if (getresgid(&rgid, &egid, &sgid) != 0 || rgid != other_gid || egid != nobody_gid || sgid != nobody_gid)
                    return 6;
#endif
                return 0;
        });

        // Drop root completely, it can't be regained
        CheckChildSucceeds([&]()
        {
                if (!Blex::SetSupplementaryGroups({ nobody_gid }))
                    return 1;
                if (!Blex::SetProcessGroupIds(nobody_gid, nobody_gid))
                    return 2;
                if (!Blex::SetProcessUserIds(nobody_uid, nobody_uid))
                    return 3;
                if (getuid() != nobody_uid || geteuid() != nobody_uid || getgid() != nobody_gid || getegid() != nobody_gid)
                    return 4;
                if (setuid(0) == 0 || seteuid(0) == 0 || setgid(0) == 0)
                    return 5;
                if (Blex::SetProcessUserIds(0, 0))
                    return 6;
                return 0;
        });
}

BLEX_TEST_FUNCTION(TestProcessRestrictions)
{
        CheckChildSucceeds([]()
        {
#if defined(PLATFORM_LINUX)
                if (prctl(PR_GET_NO_NEW_PRIVS, 0, 0, 0, 0) != 0) //the test itself shouldn't be running restricted
                    return 1;
                if (!Blex::DisallowNewPrivileges() || prctl(PR_GET_NO_NEW_PRIVS, 0, 0, 0, 0) != 1)
                    return 2;

                int sig = -1;
                if (!Blex::SetParentDeathSignal(SIGKILL) || prctl(PR_GET_PDEATHSIG, &sig, 0, 0, 0) != 0 || sig != SIGKILL)
                    return 3;
                if (!Blex::SetParentDeathSignal(0) || prctl(PR_GET_PDEATHSIG, &sig, 0, 0, 0) != 0 || sig != 0)
                    return 4;
#else
                if (Blex::DisallowNewPrivileges() || errno != ENOSYS)
                    return 5;
                if (Blex::SetParentDeathSignal(SIGKILL) || errno != ENOSYS)
                    return 6;
#endif
                return 0;
        });

#if defined(PLATFORM_LINUX)
        // Verify the parent death signal actually arrives: a child starts a grandchild and dies
        int fds[2];
        BLEX_TEST_CHECKEQUAL(0, pipe(fds));
        int status = RunInChild([&]() -> int
        {
                pid_t pid = fork();
                if (pid == 0)
                {
                        Blex::SetParentDeathSignal(SIGKILL);
                        if (getppid() == 1)
                            _exit(1);
                        ssize_t written = write(fds[1], "x", 1); //tell we're ready
                        (void)written;
                        while (true)
                            pause();
                }
                // Wait for the grandchild to be ready before we exit
                char ch;
                return pid > 0 && read(fds[0], &ch, 1) == 1 ? 0 : 1;
        });
        close(fds[1]);
        BLEX_TEST_CHECKEQUAL(true, WIFEXITED(status));
        BLEX_TEST_CHECKEQUAL(0, WEXITSTATUS(status));

        // The grandchild should now be killed, closing the last copy of the write end of the pipe
        char buf[2];
        BLEX_TEST_CHECKEQUAL(0, read(fds[0], buf, 2));
        close(fds[0]);
#endif
}

BLEX_TEST_FUNCTION(TestCloseFileHandlesFrom)
{
        CheckChildSucceeds([]()
        {
                int fds[2];
                if (pipe(fds) != 0)
                    return 1;
                int high = 200;
                struct rlimit lim;
                if (getrlimit(RLIMIT_NOFILE, &lim) == 0 && lim.rlim_cur != RLIM_INFINITY && lim.rlim_cur <= rlim_t(high))
                    high = lim.rlim_cur - 1;
                if (dup2(fds[0], high) != high)
                    return 2;

                int keep = dup(0); // a descriptor below 'firstfd' that should stay open
                if (keep < 0)
                    keep = dup(fds[0]);
                int firstfd = std::max(std::max(fds[0], fds[1]), keep) + 1;
                if (dup2(fds[0], firstfd) != firstfd)
                    return 3;

                Blex::CloseFileHandlesFrom(firstfd);
                if (fcntl(firstfd, F_GETFD) != -1 || fcntl(high, F_GETFD) != -1)
                    return 4;
                if (fcntl(fds[0], F_GETFD) == -1 || fcntl(fds[1], F_GETFD) == -1 || fcntl(keep, F_GETFD) == -1)
                    return 5;

                Blex::CloseFileHandlesFrom(3);
                if (fcntl(fds[0], F_GETFD) != -1 || fcntl(fds[1], F_GETFD) != -1 || fcntl(keep, F_GETFD) != -1)
                    return 6;
                return 0;
        });
}
