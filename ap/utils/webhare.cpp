#include <ap/libwebhare/allincludes.h>

#include <sys/stat.h>
#include <sys/types.h>
#include <sys/resource.h>
#include <fcntl.h>
#include <pwd.h>
#include <grp.h>
#include <unistd.h>

#include <cstdio>
#include <csignal>
#include <ap/libwebhare/whcore.h>
#include <blex/threads.h>
#include <blex/path.h>
#include <blex/pipestream.h>
#include <blex/logfile.h>
#include <blex/crypto.h>
#include <blex/socket.h>
#include <iostream>
#include <cstdlib>
//---------------------------------------------------------------------------

//Database::DatabaseLocation dbaseloc("");
Blex::SocketAddress compileserverloc;

volatile std::sig_atomic_t abort_service = false;

std::unique_ptr<WHCore::Connection> whconn;

class WHService
{
        public:
        enum Stages
        {
                ///Booting dbserver and/or compileserver, waiting for them to come online
                Booting,
                ///Waiting for startup script to finish
                RunningStartupScripts,
                ///Launched all subprocesses, all is active
                Active,
                ///Shutting down
                ShuttingDown,
                ///Shutting down whmanager
                ShuttingDownWHManager,
                ///Killing processes
                Killing
        };

        enum SubServices
        {
                ServiceManager,
                CompileServer,
                Database,
                Webserver,
                StartupScript,
                AppRunner,
                WHManager,
                ClusterServices,
                NumberOfServices
        };

        WHService();

        ~WHService();

        int Main(std::vector<std::string> const &dontlaunch);

        void Abort();

        private:
        Stages stage;
        std::set<std::string> dontlaunch;
        void ReadKeyConfig();
        void BootToActive();
        void MainLoop();
        void StartShutdown();

        void TerminateAllProcesses();
        void TerminateWHManager();

        ///Called when a server process died
        void ServiceDied(SubServices service);

        ///Called when a server process logged an error
        void ServiceError(SubServices service);

        bool StartServer(SubServices service);

        bool SetWaitEvents(bool *only_whmanager);

        bool IsCompileServerOnline();

        Blex::PipeSet commandpipe;

        std::unique_ptr<Blex::Process> procs[NumberOfServices];
        bool is_killed[NumberOfServices];
        std::unique_ptr<Blex::PipeReadStream> errorlogs[NumberOfServices];
        std::string logbuffers[NumberOfServices];

        Blex::PipeWaiter waiter;

        bool start_dbserver;
        bool start_whcompiler;
        bool start_webserver;
        bool start_apprunner;
        bool start_whmanager;
        bool start_startupscript;
        unsigned dbserver_shutdowngrace;
};

WHService *volatile the_service = 0;

struct ServiceInfo
{
        const char *binary;
        const char *name;
        const char *args;
};

const ServiceInfo services[WHService::NumberOfServices]=
{ { nullptr,        "Service manager",    ""}
, { "whcompile",    "Compile server",     "--listen"}
, { "dbserver.sh",  "Database server",    ""}
, { "webserver",    "Webserver",          ""}
, { "runscript",    "Startup script",     "--workerthreads\t4\tmod::system/scripts/internal/webhareservice-startup.whscr" }
, { "runscript",    "Application runner", "mod::system/scripts/internal/apprunner.whscr"}
, { "whmanager",    "WebHare manager",    ""}
, { "runscript",    "Cluster services",   "--workerthreads\t4\tmod::system/scripts/internal/clusterservices.whscr"}
};

std::ostream & operator <<(std::ostream &out, WHService::Stages stage)
{
        switch (stage)
        {
        case WHService::Booting:                return out << "Booting";
        case WHService::RunningStartupScripts:  return out << "RunningStartupScripts";
        case WHService::Active:                 return out << "Active";
        case WHService::ShuttingDown:           return out << "ShuttingDown";
        case WHService::ShuttingDownWHManager:  return out << "ShuttingDownWHManager";
        case WHService::Killing:                return out << "Killing";
        default:                                return out << Blex::AnyToString(static_cast< int >(stage));
        };

}

std::ostream & operator <<(std::ostream &out, WHService::SubServices subservice)
{
        switch (subservice)
        {
        case WHService::ServiceManager:   return out << "ServiceManager";
        case WHService::CompileServer:    return out << "CompileServer";
        case WHService::Database:         return out << "Database";
        case WHService::Webserver:        return out << "Webserver";
        case WHService::StartupScript:    return out << "StartupScript";
        case WHService::AppRunner:        return out << "AppRunner";
        case WHService::WHManager:        return out << "WHManager";
        case WHService::ClusterServices:  return out << "ClusterServices";
        default:                          return out << Blex::AnyToString(static_cast< int >(subservice));
        };
}


Blex::Logfile logfile;

void Log(WHService::SubServices subservice, std::string const &what)
{
        std::string logline(services[subservice].name);
        logline.push_back(':');
        logline += what;

        logfile.StampedLog(&logline[0],&logline[logline.size()]);

        std::cout << logline << std::endl;
}

void WHService::TerminateAllProcesses()
{
        for (unsigned i=SubServices(NumberOfServices);i>0;--i)
          if (i-1 != WHManager && i-1 != ClusterServices && procs[i-1].get() && !procs[i-1]->IsFinished())
        {
            //PostgreSQL terminates faster with SIGINT and other WH processes don't distinguish between INT and TERM
            //https://www.postgresql.org/docs/11/server-shutdown.html
            procs[i-1]->SendInterrupt();
        }
}

void WHService::TerminateWHManager()
{
        if (procs[WHManager].get() && !procs[WHManager]->IsFinished())
        {
                procs[WHManager]->SendInterrupt();
        }
        if (procs[ClusterServices].get() && !procs[ClusterServices]->IsFinished())
        {
                procs[ClusterServices]->SendInterrupt();
        }
}

void WHService::Abort()
{
        commandpipe.GetWriteEnd().WriteLsb<uint8_t>(0);
        abort_service=true;
}

bool BreakSignal(int /*sig*/)
{
        the_service->Abort();
        return true;
}

WHService::WHService()
: stage(Booting)
{
        the_service = this;

        Blex::SetInterruptHandler(&BreakSignal,false);

        commandpipe.GetReadEnd().SetBlocking(false);
        commandpipe.GetWriteEnd().SetBlocking(false);
}

void WHService::ReadKeyConfig()
{
        //TODO allow env vars to override these again
        start_dbserver = dontlaunch.count("dbserver")==0;
        start_whcompiler = dontlaunch.count("whcompile")==0;
        start_webserver = dontlaunch.count("webserver")==0;
        start_apprunner = dontlaunch.count("apprunner")==0;
        start_whmanager = dontlaunch.count("whmanager")==0;
        start_startupscript = dontlaunch.count("startupscript")==0;

        dbserver_shutdowngrace = 600;
}

WHService::~WHService()
{
        the_service = NULL;
}

bool WHService::SetWaitEvents(bool *only_whmanager)
{
        bool anywaits=false;
        waiter.Reset();
        *only_whmanager = true;
        if (stage < ShuttingDown)
        {
                waiter.AddReadPipe(commandpipe.GetReadEnd());
        }

        for (unsigned i=0;i<NumberOfServices;++i)
          if (procs[i].get())
          {
                waiter.AddReadPipe(*errorlogs[i]);
                anywaits=true;
                if (i != WHManager && i != ClusterServices)
                    *only_whmanager = false;
          }

        return anywaits;
}

bool WHService::StartServer(SubServices service)
{
        logbuffers[service].clear();

        //Setup our pipes, so that we can listen to the reported errors
        Blex::PipeSet errors;

        errors.GetReadEnd().SetBlocking(false);
        errors.GetWriteEnd().SetBlocking(true);

        errorlogs[service].reset(errors.ReleaseReadEnd());
        procs[service].reset(new Blex::Process);
        is_killed[service] = false;
        procs[service]->RedirectOutput(errors.GetWriteEnd(), true);

        std::vector<std::string> arguments;
        whconn->AddStandardArguments(&arguments);

        std::string app = Blex::MergePath(whconn->GetBinRoot(), services[service].binary);
        if(services[service].args[0])
                Blex::TokenizeString(std::string(services[service].args), '\t', &arguments);

        procs[service]->separate_processgroup = true;

        // if(whconn->LogProcessStarts())
        //     Log(service, "Process starting");

        if (procs[service]->Start(app,arguments,"",false))
            return true;

        procs[service].reset(NULL);
        errorlogs[service].reset(NULL);
        Log(service, "Could not execute the process binary");
        return false;
}

void WHService::ServiceDied(SubServices service)
{
        procs[service]->WaitFinish();
        unsigned errorcode = procs[service]->GetReturnValue();
        procs[service].reset(NULL);

        if (stage < ShuttingDown)
        {
                if (stage != RunningStartupScripts || service != StartupScript)
                    Log(service, "Unexpected termination, errorcode " + Blex::AnyToString(errorcode));

                if (stage <= RunningStartupScripts)
                {
                        if(errorcode != 0 || service != StartupScript)
                            throw std::runtime_error("Unexpected termination of a vital process during service startup");

                        BootToActive();
                        return;
                }
                //Reboot the offending service
                if (stage==Active && !StartServer(service))
                    throw std::runtime_error("Cannot restart the server process");
        }
        else
        {
                if(errorcode != 0 && !is_killed[service])
                    Log(service,"Service shutdown returned unexpected errorcode " + Blex::AnyToString(errorcode));

                // if(whconn->LogProcessStarts())
                //     Log(service, "Process ended");
        }
}

void WHService::ServiceError(SubServices service)
{
        while(true)
        {
                char localbuf[4096];
                unsigned bytesread = errorlogs[service]->Read(localbuf,sizeof localbuf);

                if (bytesread==0)
                {
                        bytesread = errorlogs[service]->Read(localbuf,sizeof localbuf);
                        if (bytesread==0)
                        {
                                if (errorlogs[service]->EndOfStream())
                                    ServiceDied(service);
                                return;
                        }
                }

                //add it to the logbuffer
                logbuffers[service].insert(logbuffers[service].end(),localbuf,localbuf+bytesread);

                //see if we can find complete lines
                while(true)
                {
                        std::string::iterator nextline = std::find(logbuffers[service].begin(),logbuffers[service].end(),'\n');
                        if (nextline == logbuffers[service].end())
                            break;

                        //Strip \r...
                        std::string::iterator endline = std::find(logbuffers[service].begin(),nextline,'\r');

                        Log(service, std::string(logbuffers[service].begin(),endline));
                        logbuffers[service].erase(logbuffers[service].begin(),nextline+1);
                }
        }
}

//ADDME: Timeout support on waits. Even better, merge this in the main loop, and use UDP online broadcasts
bool WHService::IsCompileServerOnline()
{
        //ADDME: Timeout support on wait
        Blex::Socket s(Blex::Socket::Stream);
        return s.Connect(compileserverloc)==Blex::SocketError::NoError;
}

void WHService::BootToActive()
{
        stage = Active;
        if (start_apprunner && !StartServer(AppRunner))
            throw std::runtime_error("Cannot launch the application runner");

        Log(ServiceManager, "Service started (online)");
}

void WHService::StartShutdown()
{
        stage = ShuttingDown;
        TerminateAllProcesses();
}

void WHService::MainLoop()
{
        Blex::SetEnvironVariable("WEBHARE_NOMANUALCOMPILE","1"); //Prevent manual compiles for processes started through us (WE'll manage whcompile)

        Blex::DateTime now = Blex::DateTime::Now();
        Blex::DateTime maxdeathtime = Blex::DateTime::Max();
        Blex::DateTime nextcompileservercheck = now + Blex::DateTime::Msecs(50);
        Blex::DateTime nextlogflush = now + Blex::DateTime::Seconds(3);

        Log(ServiceManager, "Starting service (" + Blex::GetEnvironVariable("WEBHARE_DISPLAYBUILDINFO") + ")");

        ReadKeyConfig();

        //whmanager, dbserver and whcompiler do not communicate with each other, so start these three first
        if (start_whmanager && !StartServer(WHManager))
            throw std::runtime_error("Cannot launch the whmanager");
        if (start_dbserver && !StartServer(Database))
            throw std::runtime_error("Cannot launch the database server");
        if (start_whcompiler && !StartServer(CompileServer))
            throw std::runtime_error("Cannot launch the compilation server");

        bool only_whmanager; // Indicates if the whmanager is the only running process
        while(SetWaitEvents(&only_whmanager)) //SetWaitEvents returns false if no running processes exist
        {
                try
                {
                        Blex::DateTime wait_until = std::min(nextcompileservercheck, nextlogflush);
                        if (stage == ShuttingDown || stage == Killing)
                            wait_until = std::min(wait_until, maxdeathtime);
                        if (stage >= ShuttingDown)
                            wait_until = std::min(wait_until, Blex::DateTime::Now()+Blex::DateTime::Msecs(50));

                        waiter.Wait(wait_until);

                        for (unsigned i=SubServices(0);i<NumberOfServices;++i)
                          if (procs[i].get() && waiter.GotRead(*errorlogs[i]))
                            ServiceError(static_cast<SubServices>(i));

                        now = Blex::DateTime::Now();

                        if (stage < ShuttingDown && waiter.GotRead(commandpipe.GetReadEnd()))
                        {
                                //Start a shutdown
                                Log(ServiceManager,"Shutdown request received");
                                maxdeathtime = Blex::DateTime::Now() + Blex::DateTime::Seconds(7);
                                StartShutdown();
                        }
                        else if (stage == ShuttingDown)
                        {
                                if(now >= maxdeathtime)
                                {
                                        //Destroy any process that didn't die out of free will
                                        for (unsigned i=SubServices(0);i<NumberOfServices;++i)
                                          if (i != Database && i != WHManager && i != ClusterServices && procs[i].get() && !procs[i]->IsFinished())
                                        {
                                                procs[i]->Kill();
                                                is_killed[i] = true;
                                                Log((WHService::SubServices)i,"Killed by the service manager because the process refused to terminate");
                                        }

                                        // Is the DB already finished?
                                        if ((procs[Database].get() && !procs[Database]->IsFinished()))
                                        {
                                                Log(ServiceManager,"Database not shutdown yet, still waiting");
                                                maxdeathtime = Blex::DateTime::Now() + Blex::DateTime::Seconds(60);
                                        }
                                        else
                                        {
                                                // Proceed to stop the whmanager
                                                only_whmanager = true;
                                        }
                                }

                                if (only_whmanager)
                                {
                                        // WHManager is last process standing, terminate it
                                        TerminateWHManager();
                                        stage = ShuttingDownWHManager;
                                        maxdeathtime = Blex::DateTime::Now() + Blex::DateTime::Seconds(2);
                                }
                        }
                        else if (stage == ShuttingDownWHManager)
                        {
                                if(now >= maxdeathtime)
                                {
                                        //Destroy whmanager if it didn't die out of free will
                                        if (procs[WHManager].get() && !procs[WHManager]->IsFinished())
                                        {
                                                procs[WHManager]->Kill();
                                                is_killed[WHManager] = true;
                                                Log(WHManager,"Killed by the service manager because the process refused to terminate");
                                        }
                                        if (procs[ClusterServices].get() && !procs[ClusterServices]->IsFinished())
                                        {
                                                procs[ClusterServices]->Kill();
                                                is_killed[ClusterServices] = true;
                                                Log(ClusterServices,"Killed by the service manager because the process refused to terminate");
                                        }
                                        stage = Killing;
                                        maxdeathtime = Blex::DateTime::Now() + Blex::DateTime::Seconds(2);
                                }
                        }
                        else if (stage == Killing)
                        {
                                if(now >= maxdeathtime)
                                    break;
                        }

                        if(now >= nextcompileservercheck && stage < ShuttingDown)
                        {
                                assert(stage == WHService::Booting);

                                if(!IsCompileServerOnline())
                                {
                                        nextcompileservercheck = now + Blex::DateTime::Msecs(50);
                                }
                                else
                                {       //We can move to the next stage
                                        nextcompileservercheck = Blex::DateTime::Max();
                                        if (start_webserver && !StartServer(Webserver))
                                            throw std::runtime_error("Cannot launch the web server process");

                                        stage = RunningStartupScripts;
                                        if (!StartServer(ClusterServices))
                                            throw std::runtime_error("Cannot launch the cluster scripts");
                                        if (start_startupscript && !StartServer(StartupScript))
                                            throw std::runtime_error("Cannot launch the startup scripts");
                                }
                        }

                        if(now >= nextlogflush)
                        {
                                logfile.Flush();
                                nextlogflush = now + Blex::DateTime::Seconds(3);
                        }
                }
                catch(std::exception &e)
                {
                        if(stage < ShuttingDown)
                        {
                                Log(ServiceManager,"Aborting: " + (std::string)e.what());
                                maxdeathtime = Blex::DateTime::Now() + Blex::DateTime::Seconds(7);
                                StartShutdown();
                        }
                        else
                        {
                                Log(ServiceManager,"Exception during shutdown: " + (std::string)e.what());
                        }
                }
        }
}

int WHService::Main(std::vector<std::string> const &_dontlaunch)
{
        std::string statedir = Blex::MergePath(whconn->GetEphemeralRoot(), "system.servicestate");
        Blex::CreateDirRecursive(statedir, true);
        if(!Blex::RemoveMultiple(statedir, "*"))
        {
                Log(ServiceManager, "Unable to delete service.state files in '" + statedir + "'");
                return 1;
        }

        dontlaunch.insert(_dontlaunch.begin(), _dontlaunch.end());

        struct rlimit rlim;
        getrlimit(RLIMIT_NOFILE, &rlim);
        if(rlim.rlim_cur <= 1024)
                Log(ServiceManager, "The current filedescriptor limit is set to " + Blex::AnyToString(rlim.rlim_cur) + ", you should raise it above 1024 (but probably more)");

        MainLoop();

        //Remove service state
        Blex::RemoveMultiple(statedir, "*");

        Log(ServiceManager,"Service stopped");
        return 0;
}

void UpdatePidFile(std::string const &pidfilepath, bool set)
{
        //Write our PID to a file
        FILE *pidfile = fopen(pidfilepath.c_str(), "w");
        if (pidfile)
        {
                if(set)
                    fprintf(pidfile,"%u\n",getpid());
                fclose(pidfile);
        }
}

int UTF8Main(std::vector<std::string> const &args)
{
        DEBUGPRINT("Entered main");

        Blex::OptionParser::Option optionlist[] =
           { Blex::OptionParser::Option::StringList("dontlaunch")
           , Blex::OptionParser::Option::Param("mode", true)
           , Blex::OptionParser::Option::ListEnd()
           };

        Blex::OptionParser optparser(optionlist);
        WHCore::Connection::AddOptions(optparser);
        if (!optparser.Parse(args))
        {
                std::cerr << optparser.GetErrorDescription() << "\n";
                return EXIT_FAILURE;
        }

        whconn.reset(new WHCore::Connection(optparser, "webhare service manager", WHCore::WHManagerConnectionType::None));

        std::string pidfilepath = Blex::MergePath(whconn->GetBaseDataRoot(), ".webhare.pid");

        compileserverloc.SetIPAddress("127.0.0.1");
        compileserverloc.SetPort(whconn->GetDbaseAddr().GetPort()+1);

        if (optparser.Param("mode") == "printparameters")
        {
                char buffer[40];
                struct std::tm time = Blex::DateTime::Now().GetTM();
                std::sprintf(buffer, "%04d%02d%02d",time.tm_year+1900,time.tm_mon + 1,time.tm_mday);

                std::cout << "LOGFILEPATH=" << whconn->GetLogRoot() << "\n";
                std::cout << "LOGFILETODAY=" << buffer << "\n";
                std::cout << "WEBHARE_DATAROOT=" << whconn->GetBaseDataRoot() << "\n";
                std::cout << "WEBHARE_LOOPBACKPORT=" << (whconn->GetDbaseAddr().GetPort()+4) << "\n";
                std::cout << "WEBHARE_COMPILECACHE=" << (whconn->GetCompileCache()) << "\n";
                return EXIT_SUCCESS;
        }

        if (optparser.Param("mode") != "console")
        {
                Blex::ErrStream() << "Unrecognized mode " << optparser.Param("mode") << "\n";
                return EXIT_FAILURE;
        }

        //Make sure we have a logging directory
        if (!whconn->GetLogRoot().empty())
        {
                Blex::CreateDirRecursive(whconn->GetLogRoot(),true);
                logfile.OpenLogfile(whconn->GetLogRoot(),"servicemanager",".log",false,30, false);
        }

        if (optparser.Param("mode") == "console")
        {
                if (!pidfilepath.empty())
                    UpdatePidFile(pidfilepath, true);

                std::cout << "Installation directory: " << whconn->GetWebHareRoot() << "\n";
                std::cout << "Database location: " << whconn->GetDbaseAddr() << "\n\n";
                std::cout << "Data directory: " << whconn->GetBaseDataRoot() << "\n\n";

                Log(WHService::ServiceManager,"Starting in console mode");
                WHService().Main(optparser.StringList("dontlaunch"));

                if (!pidfilepath.empty())
                    UpdatePidFile(pidfilepath, false);
                return EXIT_SUCCESS;
        }

        std::cerr << "Unknown mode '" << optparser.Param("mode") << "'";
        return EXIT_FAILURE;
}

//////////////////////////////////////////////////////////////////////
// main()

int main(int argc, char *argv[])
{
        return Blex::InvokeMyMain(argc,argv,&UTF8Main);
}
