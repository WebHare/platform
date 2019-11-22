#include <harescript/vm/allincludes.h>

#include <iostream>
#include <blex/path.h>
#include <blex/branding.h>
#include <blex/getopt.h>
#include <harescript/compiler/diskfilesystem.h>
#include <harescript/vm/hsvm_context.h>

int StandardErrorWriter(void * /*opaque_ptr*/, int numbytes, void const *data, int /*allow_partial*/, int *errorcode)
{
        std::cerr.write(static_cast<const char*>(data),numbytes);
        *errorcode = 0;
        return numbytes; //ADDME: Report # of bytes really writen
}

std::string FriendlyFileName(std::string str)
{
        if (str.size() <= 8)
            return str;
        if (str.substr(0,8) != "direct::")
            return str;
        str.erase(0, 8);
        return str;
}

void DisplayMessage(HareScript::DiskFileSystem const &filesystem, HareScript::Message const &m, bool showpath)
{
        // Textpad regular expression: ^At \([^#]*\)#\([0-9]+\)#\([0-9]+\) (\([^)]*\))
        // Registers: Line 2, Column 3, File 4
        // Keep synchronized with configuration instructions and whrun!
        std::string msg = "At " + FriendlyFileName(m.filename) + "(" + Blex::AnyToString(m.position.line) + "," + Blex::AnyToString(m.position.column) + ")";

        if (showpath && !m.filename.empty())
            msg += " (" + filesystem.ResolveLibraryName(m.filename) + ")";

        msg = msg + "\n" + (m.iserror ? "Error" : "Warning") + ": " + HareScript::GetMessageString(m) + "\n\n";
        std::cerr << msg;
        std::cerr << std::flush;
}

void DisplayStackLocation(HareScript::DiskFileSystem const &filesystem, HareScript::StackTraceElement const &elt, bool showpath)
{
        std::string msg = "At " + FriendlyFileName(elt.filename) + "(" + Blex::AnyToString(elt.position.line) + "," + Blex::AnyToString(elt.position.column) + ")";

        if (showpath && !elt.filename.empty())
            msg += " (" + filesystem.ResolveLibraryName(elt.filename) + ")";

        msg += " (" + elt.func + ")\n";
        std::cerr << msg;
        std::cerr << std::flush;
}

bool HandleInterrupt(HareScript::VMGroup *target, int sig)
{
        if(target->fd_signal_pipe >= 0)
        {
                write(target->fd_signal_pipe, &sig, sizeof(sig));
                return true;
        }
        if(!*target->GetAbortFlag())
        {
                *target->GetAbortFlag()=1;
                return true;
        }
        return false;
}

int ExecuteLibrary(HareScript::JobManager &jobmgr, HareScript::DiskFileSystem &filesystem, const std::string &path, std::vector<std::string> const &args, bool showpath)
{
        //std::unique_ptr<HareScript::VMGroup> cif;
//        cif.reset (environment.ConstructVMGroup());
        HareScript::VMGroup *cif = jobmgr.CreateVMGroup(true);
        Blex::SetInterruptHandler(std::bind(HandleInterrupt, cif, std::placeholders::_1), true);

        HSVM *myvm = cif->CreateVirtualMachine();
        HSVM_SetErrorCallback(myvm, 0, &StandardErrorWriter);
        cif->SetupConsole(myvm, args);

        bool any_errors = !HSVM_LoadScript(myvm, path.c_str());

        if (!any_errors)
        {
                jobmgr.StartVMGroup(cif);
                jobmgr.WaitFinished(cif);

                any_errors = cif->GetErrorHandler().AnyErrors();
        }

        if (any_errors)
        {
                // There were errors, obviously
                HareScript::ErrorHandler const &errorhandler = cif->GetErrorHandler();

                for (std::list<HareScript::Message>::const_iterator it = errorhandler.GetWarnings().begin(); it != errorhandler.GetWarnings().end(); ++it)
                    DisplayMessage(filesystem, *it, showpath);

                for (std::list<HareScript::Message>::const_iterator it = errorhandler.GetErrors().begin(); it != errorhandler.GetErrors().end(); ++it)
                    DisplayMessage(filesystem, *it, showpath);

                for (HareScript::ErrorHandler::StackTrace::const_iterator itr=errorhandler.GetStackTrace().begin(); itr!=errorhandler.GetStackTrace().end();++itr)
                    DisplayStackLocation(filesystem,*itr, showpath);

                return EXIT_FAILURE;
        }
        int exitcode = cif->GetConsoleExitCode(myvm);
        jobmgr.AbortVMGroup(cif);
        jobmgr.ReleaseVMGroup(cif);

        return exitcode;
}

Blex::OptionParser::Option optionlist[] =
{
        Blex::OptionParser::Option::Switch("f", false),
        Blex::OptionParser::Option::StringOpt("config"),
        Blex::OptionParser::Option::Switch("debug_control", false),
        Blex::OptionParser::Option::Switch("nohsmodunload", false),
        Blex::OptionParser::Option::Switch("showpath", false),
        Blex::OptionParser::Option::Switch("t", false),
        Blex::OptionParser::Option::StringOpt("c"),
        Blex::OptionParser::Option::StringOpt("d"),
        Blex::OptionParser::Option::StringOpt("p"),
        Blex::OptionParser::Option::StringOpt("r"),
        Blex::OptionParser::Option::StringList("n"),
        Blex::OptionParser::Option::StringOpt("workerthreads"),
        Blex::OptionParser::Option::Param("libfile", true),
        Blex::OptionParser::Option::ParamList("scriptargs"),
        Blex::OptionParser::Option::ListEnd()
};

void ShowSyntax()
{
        std::cout << BLEX_BRANDING_COPYRIGHT "\n\n";
        std::cout << "Syntax: hsrun [-c compilecachedir] [-n namespace...] <scriptname> [scriptargs..]\n";
        std::cout << " --config: Specify configuration file (default: /opt/hsengine/etc/hsengine.xml)\n";
        std::cout << " --showpath: Show file name in error messages\n";
        std::cout << " -t: Only compile, do not run" << std::endl;
        std::cout << " -f: deletes old version of library before compiling (default: off)" << std::endl;
        std::cout << " --workerthreads: Number of worker threads (default: 1)" << std::endl;
        std::cout << " --debug_control: Show actions of recursive compiler (default: off)" << std::endl;

// Purposely not documented
//        std::cout << " -c: Sets compile cache directory (default: system temp directory)\n";
//        std::cout << " -n: Set up a namespace (eg -nwh=/opt/harescript/syslibs)" << std::endl;
//        std::cout << " -d: Sets directory for loadable modules\n";
//        std::cout << " -p <dir>: Precompiled cache directory" << std::endl;
//        std::cout << " -r <dir>: Resources directory " << std::endl;
}

int UTF8Main(std::vector<std::string> const &args)
{
        Blex::OptionParser parser(optionlist);
        if (!parser.Parse(args))
            return ShowSyntax(),EXIT_FAILURE;

        unsigned worker_count = 4;
        if (parser.Exists("workerthreads"))
        {
                std::string val = parser.StringOpt("workerthreads");
                std::pair< int32_t, std::string::iterator > res = Blex::DecodeUnsignedNumber< int32_t >(val.begin(), val.end(), 10U);
                if (res.second != val.end() || res.first < 1)
                    return ShowSyntax(),EXIT_FAILURE;
                worker_count = res.first;
        }

#ifdef DEBUG
        Blex::ErrStream::SetTimestamping(true);
        Blex::ErrStream::SetThreadIds(true);
#endif

        std::string scriptname = parser.Param("libfile");
        scriptname = Blex::CollapsePathString(scriptname);

        if (scriptname.find(':') == std::string::npos || scriptname.find(':') == 1)
        {
                //the compile server won't understand a relative path
                if (!Blex::PathIsAbsolute(scriptname))
                    scriptname=Blex::MergePath(Blex::GetCurrentDir(),scriptname);

                scriptname = "direct::" + scriptname;
        }

        HareScript::DiskFileSystem filesystem(parser);

        HareScript::Compiler::DebugOptions opts;
        opts.show_compilecontrol = parser.Switch("debug_control");

        Blex::ContextRegistrator creg;
        filesystem.Register(creg);
        Blex::ContextKeeper keeper(creg);

        /* ADDME: A more useful implementation of s_force would be to
           enable a "rebuild-all" flag in the filesystem, which would
           recompile all files the first time it sees them */

        if (parser.Switch("f"))
        {
                HareScript::FileSystem::FilePtr file = filesystem.OpenLibrary(keeper, scriptname);
                if (file.get())
                    file->RemoveClib();
        }

        if (parser.Switch("t"))
        {
                HareScript::ErrorHandler errorhandler;
                filesystem.Recompile(keeper, scriptname, false, &errorhandler);

                for (std::list<HareScript::Message>::const_iterator it = errorhandler.GetWarnings().begin(); it != errorhandler.GetWarnings().end(); ++it)
                    DisplayMessage(filesystem, *it, parser.Switch("showpath"));

                for (std::list<HareScript::Message>::const_iterator it = errorhandler.GetErrors().begin(); it != errorhandler.GetErrors().end(); ++it)
                    DisplayMessage(filesystem, *it, parser.Switch("showpath"));

                for (HareScript::ErrorHandler::StackTrace::const_iterator itr=errorhandler.GetStackTrace().begin(); itr!=errorhandler.GetStackTrace().end();++itr)
                    DisplayStackLocation(filesystem,*itr, parser.Switch("showpath"));

                if (errorhandler.AnyErrors())
                    return EXIT_FAILURE;

                std::cerr << "No compile-time errors found" << std::endl;
                std::cerr << std::flush;

                return 0;
        }

        filesystem.compile_engine.SetDebugOptions(opts);

        Blex::NotificationEventManager eventmgr;
        HareScript::GlobalBlobManager blobmgr(Blex::GetSystemTempDir());
        HareScript::Environment environment(eventmgr, filesystem, blobmgr, true);
        HareScript::JobManager jobmgr(environment);
        jobmgr.Start(worker_count, 0);

        if(parser.Switch("nohsmodunload"))
            environment.NoHSModUnload();

        int res = ExecuteLibrary(jobmgr, filesystem, scriptname, parser.ParamList("scriptargs"), parser.Switch("showpath"));
        return res;
}

int main(int argc, char *argv[])
{
        return Blex::InvokeMyMain(argc,argv,&UTF8Main);
}
