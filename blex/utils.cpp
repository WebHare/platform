#include <blex/blexlib.h>

#include <dlfcn.h>
#include <iostream>
#include "threads.h"
#include "utils.h"
#include "crypto.h"
#include "context.h"
#include <sys/time.h>
#include <sys/utsname.h>
#include <unistd.h>
#include <time.h>
#include <stdexcept>
#include <dirent.h>
#include <iostream>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#include <errno.h>
#include <termios.h>
#include <sys/ioctl.h>

#include <signal.h>
#include <sys/resource.h>

#ifdef PLATFORM_DARWIN
    #include <mach-o/dyld.h>
    #include <crt_externs.h>
    #define environ (*_NSGetEnviron())
#endif

namespace Blex
{


void InitSSL();
void FinishSSL();


UserInterruptHandler user_interrupt_handler;
bool seen_abort=false;
bool allow_multiple_signals=false;
std::vector<std::string> initargs;
// Set when SetConsoleEcho has been called
bool console_echo_modified = false;
bool original_console_echo = false;
/// Startup time
Blex::DateTime startuptime;

void InitThreadContext(ContextKeeper *keeper);

std::vector<std::string> const & GetStartupArguments()
{
        return initargs;
}

Blex::DateTime GetProcessStartTime()
{
        return startuptime;
}

namespace
{
void TimeToText(char textbuffer[30], uint64_t seconds)
{
        if (seconds>=1000000)
            std::sprintf(textbuffer,"%u,%03u,%03u",unsigned(seconds/1000000),unsigned((seconds%1000000)/1000),unsigned(seconds%1000));
        else if (seconds>=1000)
            std::sprintf(textbuffer,"%u,%03u",unsigned(seconds/1000),unsigned(seconds%1000));
        else
            std::sprintf(textbuffer,"%u",unsigned(seconds));
}
}

std::ostream& operator << (std::ostream &str, FastTimer const &timer)
{
        char timenormal[30],timeoverhead[30];
        TimeToText(timenormal,timer.GetTotalTime());
        TimeToText(timeoverhead,timer.GetOverhead());

        str << timenormal << " uS, overhead " << timeoverhead << " uS";
        return str;
}

FastTimer::FastTimer()
{
        running=0;
        total=0;
        measurements=0;

        Start();
        Stop();

        overhead=total;
}

FastTimer::~FastTimer()
{
}

uint64_t FastTimer::GetOverhead() const
{
        return (measurements * overhead) / (GetSystemTickFrequency()/1000000);
}
void FastTimer::Start()
{
        //Increase starttime by the time that elapsed between 'Now' and 'Stop'
        measurements++;
        if (running++==0)
            start=GetSystemCurrentTicks(); //only start first clock
}

void FastTimer::Stop()
{
        //Just record the current point in time
        if (--running==0)
            total += GetSystemCurrentTicks()-start; //only record first clock
}

uint64_t FastTimer::GetTotalTime() const
{
        if (!running)
            return total / (GetSystemTickFrequency()/1000000);
        else
            return (GetSystemCurrentTicks() - start + total) / (GetSystemTickFrequency()/1000000);


}


ScopedFastTimer::ScopedFastTimer(std::string const &_timername) : timername(_timername)
{
        timer.Start();
}

ScopedFastTimer::~ScopedFastTimer()
{
        timer.Stop();
        std::clog << "Timer " << timername << ":" << timer << std::endl;
}

//ADDME: Thread safety?
bool console_eof = false;
bool console_buffered = true;

std::size_t ReadConsoleBytes(void *buf, unsigned numbytes)
{
        if(!console_buffered)
        {
                struct timeval timeout;
                timeout.tv_sec=0;
                timeout.tv_usec=0;

                fd_set readfs;
                FD_ZERO(&readfs);
                FD_SET(0, &readfs);
                if(select(1, &readfs, NULL, NULL, &timeout) == 0)//nothing to read
                    return 0;
        }

        int result = read(0,buf,numbytes);
        if(result==-1)
            return 0; //probably EAGAIN
        if(result==0)
            console_eof=true;
        return static_cast<std::size_t>(result);
}

bool GetConsoleLineBuffered()
{
        return console_buffered;
}
void SetConsoleLineBuffered(bool newstate)
{
        console_buffered = newstate;

        // Use termios to turn off line buffering
        termios term;
        tcgetattr(0, &term);
        if(newstate)
            term.c_lflag |= ICANON;
        else
            term.c_lflag &= ~ICANON;
        tcsetattr(0, TCSANOW, &term);
        setbuf(stdin, NULL);

/*        long curflags = fcntl(0,F_GETFL);
        if(newstate)
            curflags &= ~O_NONBLOCK;
        else
            curflags |= O_NONBLOCK;
        fcntl(0,F_SETFL, curflags);*/
}
bool GetConsoleEcho()
{
        termios term;
        tcgetattr(0, &term);
        return term.c_lflag & ECHO;
}
void SetConsoleEcho(bool newstate)
{
        if (!console_echo_modified)
        {
                original_console_echo = GetConsoleEcho();
                console_echo_modified = true;
        }
        termios term;
        tcgetattr(0, &term);
        if(newstate)
            term.c_lflag |= ECHO;
        else
            term.c_lflag &= ~ECHO;
        tcsetattr(0, newstate ? TCSANOW : TCSAFLUSH, &term); //TCSAFLUSH: flush all input when disabling echo
}
void RestoreConsoleEcho()
{
        if (console_echo_modified)
            SetConsoleEcho(original_console_echo);
}
bool IsConsoleClosed()
{
        return console_eof;
}
bool IsConsoleATerminal()
{
        return isatty(0) && isatty(1);
}
std::pair< unsigned, unsigned > GetConsoleSize()
{
        struct winsize size;
        if (ioctl(0, TIOCGWINSZ, &size) == 0)
            return std::make_pair(size.ws_row, size.ws_col);
        return std::make_pair(0, 0);
}
uint32_t GetProcessId()
{
        return getpid();
}

uint32_t GetPageFaults()
{
        return 0;
}

uint32_t GetVMSize()
{
        return 0;
}

uint64_t GetSystemCurrentTicks()
{
#if !defined(__APPLE__) && __LP64__
        struct timespec curtime;
        clock_gettime(CLOCK_MONOTONIC, &curtime);
        return static_cast<uint64_t>(curtime.tv_sec) * 1000000000 + curtime.tv_nsec;
#else
        struct timeval curtime;
        struct timezone curtz;
        gettimeofday(&curtime,&curtz);
        return static_cast<uint64_t>(curtime.tv_sec) * 1000000 + curtime.tv_usec;
#endif
}

uint64_t GetSystemTickFrequency()
{
#if !defined(__APPLE__) && __LP64__
        return 1000000000L;
#else
        return 1000000L;
#endif
}

std::string GetSystemDescription()
{
        std::string descr;

        utsname uts;
        if (uname(&uts) != 0)
            return "";

        descr += uts.sysname;
        descr += ' ';
        descr += uts.nodename;
        descr += ' ';
        descr += uts.release;
        descr += ' ';
        descr += uts.version;
        descr += ' ';
        descr += uts.machine;

        return descr;
}

unsigned GetSystemCPUs(bool /*physical_cpus_only*/) /*FIXME PHYSICAL COUNT*/
{
#if defined(_SC_NPROCESSORS_CONF)
        return sysconf(_SC_NPROCESSORS_CONF); /* Linux */
#else
        return 1; /*FIXME*/
#endif
}

//Parse the current environment (note, exported by processes.h because we don't have a common processes.cpp file)
void ParseEnvironment(Blex::Process::Environment *destenv)
{
        for (char **ptr=environ;*ptr;++ptr)
        {
                char *streof = *ptr + strlen(*ptr);
                char *assignment_op = static_cast<char*>(std::memchr(*ptr,'=',streof-*ptr));
                if (assignment_op)
                    destenv->insert(std::make_pair(std::string(*ptr,assignment_op),
                                                   std::string(assignment_op+1,streof)));
        }
}

std::string GetExecutablePath()
{
#ifdef __APPLE__
        uint32_t neededspace=0;
        if(_NSGetExecutablePath(NULL, &neededspace) == -1 && neededspace >= 1)
        {
                std::vector<char> pathstore(neededspace,0);
                if(_NSGetExecutablePath(&pathstore[0], &neededspace) == 0 && neededspace>=1)
                        return std::string(&pathstore[0], &pathstore[neededspace-1]);
        }
#endif
        //ADDME Cache it, but keep it thread safe?
        char linkout[1024];
        int retval = readlink("/proc/self/exe", linkout, sizeof(linkout));
        if(retval>0 && (unsigned)retval<sizeof(linkout)) //we apparently had success
        {
                return std::string(linkout, linkout+retval);
        }

        //Just return argv[0] :(
        if(!initargs.empty())
            return initargs[0];

        return std::string();
}

void BlexSignalHandler(int sig)
{
        using namespace std;

        if (!allow_multiple_signals)
        {
                signal(SIGINT,SIG_IGN);
                signal(SIGTERM,SIG_IGN);
                signal(SIGHUP,SIG_IGN);
        }

        if(seen_abort && !allow_multiple_signals)
            return;

        seen_abort=true;

        if (user_interrupt_handler && user_interrupt_handler(sig))
                return; //consider signal handled

        RestoreConsoleEcho();
        _exit(0);
}

int InvokeMyMain(int _argc, char *_argv[],int (*utf8main)(std::vector<std::string> const &args))
{
        InitSSL();

        bool inthandler = !std::getenv("BLEXLIB_NOINTHANDLER") || strcmp(std::getenv("BLEXLIB_NOINTHANDLER"),"1")!=0;

        signal(SIGPIPE,SIG_IGN);

        if(inthandler)
        {
                signal(SIGINT,BlexSignalHandler);
                signal(SIGTERM,BlexSignalHandler);
                signal(SIGHUP,BlexSignalHandler);
        }

        startuptime = Blex::DateTime::Now();

        //Make stdin blocking - ReadConsoleBytes(void *buf, unsigned numbytes) expects it that way
        fcntl(0,F_SETFL, fcntl(0,F_GETFL) & ~O_NONBLOCK);

        int result;
        try
        {
                ContextKeeper threadcontextkeeper(GetThreadContextRegistrator());
                InitThreadContext(&threadcontextkeeper);

                //ADDME: Add exception code / OS specific code as well!
                initargs.assign(_argv,_argv+_argc);
                result=(*utf8main)(initargs);
        }
        catch (std::exception &e)
        {
                std::cerr << "Fatal error: " << e.what() << "\n";
                result=EXIT_FAILURE;
        }
        catch (...)
        {
                std::cerr << "Fatal error: unexpected exception\n";
                result=EXIT_FAILURE;
        }

        RestoreConsoleEcho();

        if(inthandler)
        {
                signal(SIGINT,SIG_DFL);
                signal(SIGTERM,SIG_DFL);
                signal(SIGHUP,SIG_DFL);
        }
        FinishSSL();
        return result;
}

void SetInterruptHandler(UserInterruptHandler const &interrupthandler, bool _allow_multiple_signals)
{
        user_interrupt_handler = interrupthandler;
        allow_multiple_signals = _allow_multiple_signals;
}

bool InitiateShutdownWithInterrupt()
{
        if (!seen_abort)
        {
            BlexSignalHandler(SIGINT);
            return false;
        }
        return true;
}
bool ReadConsoleLine(std::string *line)
{
        std::cout.flush(); //make sure receiver is not waiting for us.....
        std::clog.flush();
        line->clear();
        while(true)
        {
                char inbuf;
                if (!ReadConsoleBytes(&inbuf, 1))
                    return false;
                if(inbuf=='\n')
                    return true;
                line->push_back(inbuf);
        }
}



/** Get the extension for dynamic libraries on this system
    (includes extension dot, eg ".dll" or ".so") */
const char *GetDynamicLibExtension()
{
#ifdef PLATFORM_DARWIN
        return ".dylib";
#else
        return ".so";
#endif
}

/** Load the specified library into memory. Libraries are reference counted,
    so multiple calls for the same library are permitted.
    @param path Absolute path to library
    @return NULL if the library can't be found or loaded */
void* LoadDynamicLib(std::string const &path, std::string *errormessage)
{
        void *handle = dlopen(path.c_str(), RTLD_NOW);
        if (handle)
            return handle;

        if (errormessage)
            errormessage->assign(dlerror());
        return NULL;
}

/** Decrease the reference count for the specified library, and if it drops
    to zero, unload it
    @param library Library pointer, as retunred by LoadDynamicLib */
void ReleaseDynamicLib(void *library)
{
        dlclose(library);
}


namespace
{
DynamicFunction DoFindDynFunc(void *library, const char *funcname)
{
        return FunctionPtrCast< void(*)() >(dlsym(library, funcname));
}
}

/** Look up a function in a dynamic library. It must have been declared as extern "C"
    @param library Library to look in
    @param funcname Function to look for
    @return The function, or NULL if the function was not found */
DynamicFunction FindDynamicFunction(void *library, const char *funcname)
{
        DynamicFunction func = DoFindDynFunc(library,funcname);
        if (!func) //try with an underscore..
        {
                std::string longfuncname = "_";
                longfuncname += funcname;
                return DoFindDynFunc(library,longfuncname.c_str());
        }
        return func;
}


} //end of namespace Blex

