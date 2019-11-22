#include <atomic>
#include <ap/libwebhare/allincludes.h>

#include <blex/path.h>
#include <blex/getopt.h>
#include <blex/logfile.h>
#include <harescript/vm/errors.h>
#include <harescript/compiler/engine.h>
#include <harescript/vm/hsvm_dllinterface_blex.h>
#include <ap/libwebhare/whcore.h>
#include <ap/libwebhare/whcore_hs3.h>
#include <ap/libwebhare/wh_filesystem.h>
#include <ap/libwebhare/webharedbprovider.h>
#include <iostream>
#include <signal.h>

// Default number of workers
#define DEFAULT_WORKER_COUNT 1


using namespace HareScript;

namespace
{
/// Nr of running signal handlers
std::atomic< unsigned > activehandlers;

/// Whether we're shutting down
std::atomic< bool > shuttingdown;

// Current jobmgr
std::atomic< HareScript::JobManager * > jobmgr_ptr;

} // End of anonymous namespace

//FIXME: SQL uses a real ugly solution, with hacking FileSysetm pointers et al.. :-(
static FileSystem *filesystemptr;

/** Compile a script, return the file in a blob */
void CompileScript(VarId id_set, VirtualMachine *vm)
{
        StackMachine &varmem = vm->GetStackMachine();

        // Get arguments
        HareScript::Interface::InputStream in_str(*vm, HSVM_Arg(0));

        Compiler::Engine engine(*filesystemptr, "mod::system/lib/internal/harescript/preload.whlib");
        ErrorHandler &handler = engine.GetErrorHandler();

        Blex::MemoryRWStream temp;
        try
        {
                engine.Compile(vm->GetContextKeeper(), "", Blex::DateTime::Invalid(), in_str, temp);
        }
        catch (VMRuntimeError &e)
        {
                handler.AddMessage(e);
        }

        std::vector<uint8_t> data(temp.GetFileLength());
        temp.DirectRead(0, &data[0], data.size());

        varmem.RecordInitializeEmpty(id_set);

        bool has_errors = handler.AnyErrors();
        varmem.SetBoolean(varmem.RecordCellCreate(id_set, vm->columnnamemapper.GetMapping("ALL_OK")), !has_errors);
        if (has_errors)
        {
                VarId error_list = varmem.RecordCellCreate(id_set, vm->columnnamemapper.GetMapping("ERRORS"));
                varmem.InitVariable(error_list, VariableTypes::StringArray);
                for (ErrorHandler::MessageList::const_iterator it = handler.GetErrors().begin(); it != handler.GetErrors().end(); ++it)
                {
                        std::string msg = Blex::AnyToString(it->position.line) + ", " + Blex::AnyToString(it->position.column);
                        varmem.SetSTLString(varmem.ArrayElementAppend(error_list), msg + ": " + GetMessageString(*it));
                }
        }
        else
        {
                int32_t streamid = HSVM_CreateStream(*vm);
                HareScript::Interface::OutputStream out_str(*vm, streamid);

                temp.SetOffset(0);
                temp.SendAllTo(out_str);

                HSVM_MakeBlobFromStream(*vm, HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "SCRIPT")), streamid);
        }
}

/** Runs the script in a blob */
void RunSQLClientScript(VirtualMachine *vm)
{
        //FIXME: Use separate VM so that sql code failures don't crash us
        // Get arguments (ADDME: might be cleaner to do compilation & running inside a memory-based file system? )
        std::string tempfilename = Blex::CreateTempName(Blex::MergePath(filesystemptr->GetTempDir(), "sqlscript"));

        std::unique_ptr<Blex::FileStream> file;
        file.reset(Blex::FileStream::OpenWrite(tempfilename, true,true, Blex::FilePermissions::PrivateRead));
        if (!file.get())
            throw std::runtime_error("Cannot write temp sql file");

        HareScript::Interface::InputStream in_str(*vm, HSVM_Arg(0));
        in_str.SendAllTo(*file);
        file.reset();

        HSVM_OpenFunctionCall(*vm, 1);
        HSVM_CopyFrom(*vm, HSVM_CallParam(*vm, 0), HSVM_Arg(1));
        static const HSVM_VariableType funcargs[1]={HSVM_VAR_Record};
        HSVM_CallFunction(*vm, ("directclib::" + tempfilename).c_str(), "SQLHOOK", HSVM_VAR_Record, 1, funcargs);
        Blex::RemoveFile(tempfilename);
}

void ShowSyntax(std::string const &error)
{
        std::cerr << "Syntax: runscript [options] <scriptfile> [script args...]\n\n";

        WHCore::Connection::PrintGlobalOptions();
        //            --xxxxxxxxxxxxxxxxxxxxxxxxx  ddddddddddddddddddddddddddddddddddddddddddddddd\n
        std::cerr << "--interactive                Request maximum compilation priority\n";
        std::cerr << "--high                       Request high compilation priority\n";
        std::cerr << "--idle                       Request lowest compilation priority\n";
        std::cerr << "--workerthreads <num>        Launch the specified number of execution threads\n";
        std::cerr << "\n" << error << "\n";
}

bool HandleInterrupt(VMGroup *target, int sig)
{
        ++activehandlers;
        bool handled = false;

        // If the process is already shutting down, no need to signal the processes anymore
        if (!shuttingdown.load())
        {
                // Signal pipe?
                if(target->fd_signal_pipe >= 0)
                {
                        write(target->fd_signal_pipe, &sig, sizeof(sig));
                        handled = true;
                }
                else if(!*target->GetAbortFlag())
                {
                        *target->GetAbortFlag()=1;

                        HareScript::JobManager *jobmgr = jobmgr_ptr.load();
                        if (jobmgr)
                            jobmgr->HandleAsyncAbortBySignal();

                        handled = true;
                }
        }

        --activehandlers;
        return handled;
}

// Clears the signal handler data
class SignalJobMgrInteration
{
    public:
        SignalJobMgrInteration(HareScript::JobManager *jobmgr)
        {
                jobmgr_ptr = jobmgr;
        }
        ~SignalJobMgrInteration()
        {
                ShutDown();
        }
        void ShutDown()
        {
                shuttingdown = true;
                while (activehandlers.load()) {} // spin loop
                jobmgr_ptr = 0;
        }
};

int UTF8Main(std::vector<std::string> const &args)
{
        unsigned retval = EXIT_FAILURE;

        Blex::OptionParser::Option optionlist[] = {
                Blex::OptionParser::Option::Switch("high", false),
                Blex::OptionParser::Option::Switch("interactive", false),
                Blex::OptionParser::Option::Switch("idle", false),
                Blex::OptionParser::Option::StringOpt("workerthreads"),
                Blex::OptionParser::Option::Param("scriptfile", true),
                Blex::OptionParser::Option::ParamList("scriptargs"),
                Blex::OptionParser::Option::ListEnd() };

        std::unique_ptr<WHCore::Connection> connection;
        std::unique_ptr<WHCore::ScriptEnvironment> scriptenv;
        std::unique_ptr<HareScript::JobManager> jobmgr;
        std::unique_ptr<Blex::ContextKeeper> dummy_keeper;
        HSVM *hsvm;

        std::unique_ptr< WHCore::JobManagerIntegrator > jobmgrintegrator;

        Blex::OptionParser options(optionlist);
        WHCore::Connection::AddOptions(options);

        Blex::ErrStream::SetTimestamping(true);
        Blex::ErrStream::SetThreadIds(true);

        bool any_error = !options.Parse(args);

        int32_t worker_count = DEFAULT_WORKER_COUNT;
        if (!any_error)
        {
                if (options.Exists("workerthreads"))
                {
                        std::string val = options.StringOpt("workerthreads");
                        std::pair< int32_t, std::string::iterator > res = Blex::DecodeUnsignedNumber< int32_t >(val.begin(), val.end(), 10U);
                        any_error = res.second != val.end();
                        worker_count = res.first;
                }
                if (worker_count < 1)
                    any_error = true;
        }
        if(any_error)
                return ShowSyntax(options.GetErrorDescription()), EXIT_FAILURE;

        try
        {

                CompilationPriority::Class pri = options.Switch("high") ? CompilationPriority::ClassHighest
                                               : options.Switch("interactive") ? CompilationPriority::ClassInteractive
                                               : options.Switch("idle") ? CompilationPriority::ClassIdle : CompilationPriority::ClassBackground;

                std::string scriptname = options.Param("scriptfile");
                std::string org_scriptname = scriptname;

                if (scriptname.find(':') == std::string::npos || scriptname.find(':') == 1)
                {
                        //the compile server won't understand a relative path
                        if (!Blex::PathIsAbsolute(scriptname))
                        {
                                scriptname = Blex::MergePath(Blex::GetCurrentDir(),scriptname);
                                org_scriptname = scriptname;
                        }

                        scriptname = "direct::" + scriptname;
                }

                connection.reset(new WHCore::Connection(options, "runscript " + scriptname, WHCore::WHManagerConnectionType::RequireConnected));
                connection->ConnectToWHManager();

                bool allow_direct_compilations = Blex::GetEnvironVariable("WEBHARE_NOMANUALCOMPILE") != "1";
                scriptenv.reset(new WHCore::ScriptEnvironment(*connection, pri, allow_direct_compilations, true));

                bool nohsmodunload = Blex::GetEnvironVariable("WEBHARE_NOHSMODUNLOAD") == "1";
                if (nohsmodunload)
                    scriptenv->GetEnvironment().NoHSModUnload();

                jobmgr.reset(new HareScript::JobManager(scriptenv->GetEnvironment()));
                jobmgr->Start(worker_count, 0); // Start with 2 worker threads

                jobmgrintegrator.reset(new WHCore::JobManagerIntegrator(*scriptenv, *connection, jobmgr.get()));

                // Wait for debugger (no waits if no debugger present)
                connection->InitDebugger();
                jobmgr->WaitForDebugConfiguration();

                dummy_keeper.reset(new Blex::ContextKeeper(scriptenv->GetEnvironment().GetContextReg()));

                BuiltinFunctionsRegistrator &bifreg = scriptenv->GetEnvironment().GetBifReg();
                bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__SYSTEM_SQLCLIENT_COMPILESCRIPT::R:X", CompileScript));
                bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__SYSTEM_SQLCLIENT_RUNSQLCLIENTSCRIPT:::XR", RunSQLClientScript));

                filesystemptr=&scriptenv->GetFileSystem();

                VMGroup *vmgroup = jobmgr->CreateVMGroup(true);
                hsvm = scriptenv->ConstructWHVM(vmgroup);
                HSVM_SetErrorCallback(hsvm, 0, &WHCore::StandardErrorWriter);
//                jobmgr->SetRunningTimeout(vmgroup, 30);

                // Store ptr to jobmgr for the signal handler
                SignalJobMgrInteration signalintegration(jobmgr.get());

                HareScript::SQLLib::WHDB::SetWHDBProviderDefaultClientName(hsvm, "runscript " + org_scriptname);
                Blex::SetInterruptHandler(std::bind(HandleInterrupt, vmgroup, std::placeholders::_1), true);
                vmgroup->SetupConsole(hsvm, options.ParamList("scriptargs"));
                any_error = !HSVM_LoadScript(hsvm, scriptname.c_str());

                if (!any_error)
                {
                        jobmgr->StartVMGroup(vmgroup);
                        jobmgr->WaitFinished(vmgroup);
                }

                Blex::ResetInterruptHandler();

                if (vmgroup->GetErrorHandler().AnyErrors())
                {
                        retval = EXIT_FAILURE;
                        HareScript::ErrorHandler const &errorhandler = vmgroup->GetErrorHandler();

                        for (std::list<HareScript::Message>::const_iterator it = errorhandler.GetWarnings().begin(); it != errorhandler.GetWarnings().end(); ++it)
                            DisplayMessage(scriptenv->GetFileSystem(), &HareScript::GetVirtualMachine(hsvm)->GetContextKeeper(), *it);

                        for (std::list<HareScript::Message>::const_iterator it = errorhandler.GetErrors().begin(); it != errorhandler.GetErrors().end(); ++it)
                            DisplayMessage(scriptenv->GetFileSystem(),& HareScript::GetVirtualMachine(hsvm)->GetContextKeeper(), *it);

                        if(!errorhandler.GetStackTrace().empty())
                        {
                                std::cerr << "\n";
                                for (ErrorHandler::StackTrace::const_iterator itr=errorhandler.GetStackTrace().begin(); itr!=errorhandler.GetStackTrace().end();++itr)
                                {
                                        DisplayStackLocation(scriptenv->GetFileSystem(), &HareScript::GetVirtualMachine(hsvm)->GetContextKeeper(),*itr);
                                }
                        }

                        std::map< std::string, std::string > params;
                        params["script"] = Blex::AnyToJSON(org_scriptname);
                        params["contextinfo"] = Blex::AnyToJSON(jobmgr->GetGroupErrorContextInfo(vmgroup));
                        LogHarescriptError(*connection, "runscript", jobmgr->GetGroupId(vmgroup), jobmgr->GetGroupExternalSessionData(vmgroup), errorhandler, params);
                }
                else
                {
                        if (*vmgroup->GetAbortFlag() == HSVM_ABORT_TIMEOUT)
                            std::cerr << "Script was terminated due to timeout" << std::endl;
                        else
                            retval=vmgroup->GetConsoleExitCode(hsvm);
                }

                // Before the vmgroup becomes invalid, reset the signal handler integration
                signalintegration.ShutDown();

                jobmgr->AbortVMGroup(vmgroup);
                jobmgr->ReleaseVMGroup(vmgroup);

                connection->FlushManagerQueue();
        }
        catch (std::exception const &e)
        {
                Blex::ResetInterruptHandler();
                std::cerr << "Runscript generated a fatal exception: " << e.what() << std::endl;
                return EXIT_FAILURE;
        }
        return retval;
}
//---------------------------------------------------------------------------
int main(int argc, char *argv[])
{
        return Blex::InvokeMyMain(argc,argv,&UTF8Main);
}
