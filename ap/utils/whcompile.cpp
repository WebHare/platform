#include <ap/libwebhare/allincludes.h>

#include <blex/path.h>
#include <blex/getopt.h>
#include <blex/logfile.h>
#include <iostream>
#include <harescript/compiler/engine.h>
#include <harescript/vm/errors.h>
#include <harescript/compiler/compilecontrol.h>
#include "../libwebhare/wh_filesystem.h"
#include <ap/libwebhare/webserve.h>
#include <ap/libwebhare/webscon.h>
#include <ap/libwebhare/whcore_hs3.h>

#include <signal.h>

using namespace HareScript;
using namespace Compiler;

DebugOptions dopts;
bool batch_mode = false;
bool quiet = false;
bool only_errors = false;
bool forcedrecompile = false;
bool parseable = false;

struct ContextData
{
        WHFileSystem *filesystemptr;
};
typedef Blex::Context<ContextData, 1, void> Context;

/** Tries to parse input from the std input, updates todo list
    @return FALSE if error whie parsing input */
std::string GetNextFileToCompile(bool *force)
{
        std::string nextline;

        if (!Blex::ReadConsoleLine(&nextline) || nextline.empty())
            return std::string(); //abort request

        if (nextline[0] == 'C' || nextline[0] == 'F')
        {
                if (force)
                    *force = nextline[0] == 'F';
                return std::string(nextline.begin() + 1, nextline.end());
        }

        throw std::runtime_error("Unrecognized input '" + nextline + "'");
}

std::string publisher_root;

void DisplayMessage(Blex::ContextKeeper *keeper, Message const &m)
{
        if (!parseable) //human readable errors
        {
                // Textpad regular expression: ^At \([^#]*\)(\([0-9]+\),\([0-9]+\)) (\([^)]*\))
                // Registers: Line 2, Column 3, File 4
                // Keep synchronized with configuration instructions and whrun!
                std::string msg = "At " + m.filename + "(" + Blex::AnyToString(m.position.line) + "," + Blex::AnyToString(m.position.column) + ")";
                if (keeper)
                {
                        Context context(*keeper);
                        std::string orgname;

                        if (m.filename.substr(0, 6) == "site::" && !publisher_root.empty())
                        {
                                orgname = publisher_root + m.filename.substr(6, m.filename.size());
                        }
                        else
                        {
                                try
                                {
                                        orgname = context->filesystemptr->ReturnPath(*keeper, m.filename);
                                }
                                catch (VMRuntimeError &)
                                {
                                        // Don't care about exceptions here
                                }
                        }

                        msg += " (" + orgname + ")";
                }
                msg = msg + "\n" + (m.iserror ? "Error" : "Warning") + ": " + HareScript::GetMessageString(m) + "\n\n";
                std::cerr << msg;
                std::cerr << std::flush;
        }
        else
        {
                if (m.iserror)
                    std::cout << 'E';
                else
                    std::cout << 'W';

                std::cout << "\t" << m.position.line << "\t" << m.position.column << "\t" << m.filename << "\t";
                std::cout << m.code << "\t" << m.msg1 << "\t" << m.msg2 << std::endl;
        }
}

void DisplayWebMessage(Blex::ContextKeeper *, Message const &m, WebServer::Connection *webcon)
{
        std::string message;
        message += m.iserror ? 'E' : 'W';
        message += '\t';
        Blex::EncodeNumber(m.position.line, 10, std::back_inserter(message));
        message += '\t';
        Blex::EncodeNumber(m.position.column, 10, std::back_inserter(message));
        message += '\t';
        message += m.filename;
        message += '\t';
        Blex::EncodeNumber(m.code, 10, std::back_inserter(message));
        message += '\t';
        Blex::EncodeValue(m.msg1.begin(), m.msg1.end(), std::back_inserter(message));
        message += '\t';
        Blex::EncodeValue(m.msg2.begin(), m.msg2.end(), std::back_inserter(message));
        message += "\n";

        webcon->GetAsyncInterface()->StoreData(message.data(), message.size());
}

void DisplayException(std::exception const &e)
{
        if (batch_mode)
            std::cerr << "Exception occurred: " << e.what() << "\n";
        else
            std::cout << "E\t1\t1\t\t0\t" << e.what() << "\t\n";
}

unsigned ExecuteCompile(std::string const &lib, WHFileSystem &filesystem, Blex::ContextKeeper &keeper, bool force)
{
        unsigned retval = 0;
        try
        {
                if (force)
                {
                        HareScript::FileSystem::FilePtr file = filesystem.OpenLibrary(keeper, lib);
                        if (file.get())
                            file->RemoveClib();
                }

                Engine compile_engine(filesystem, "mod::system/lib/internal/harescript/preload.whlib");

                std::vector< std::shared_ptr<Blex::FileStream> > files;

                compile_engine.SetDebugOptions(dopts);
                CompileControl control(compile_engine, filesystem);

                control.CompileLibrary(keeper, lib);

                ErrorHandler::MessageList const &warnlist = compile_engine.GetErrorHandler().GetWarnings();
                ErrorHandler::MessageList const &errorlist = compile_engine.GetErrorHandler().GetErrors();

                if(!only_errors)
                  for (ErrorHandler::MessageList::const_iterator it = warnlist.begin(); it != warnlist.end(); ++it)
                      DisplayMessage(&keeper, *it);

                for (ErrorHandler::MessageList::const_iterator it = errorlist.begin(); it != errorlist.end(); ++it)
                    DisplayMessage(&keeper, *it);

                if (compile_engine.GetErrorHandler().AnyErrors())
                    retval = 1;
        }
        catch (Message &m)
        {
                DisplayMessage(&keeper, m);
                retval = 1;
        }
        catch (const std::exception &e)
        {
                DisplayException(e);
                retval = 1;
        }
        return retval;
}

bool BatchSingleFile(std::string const &libname, WHFileSystem &filesystem, Blex::ContextKeeper &keeper)
{
        if (!quiet)
            std::cout << libname << "\n";
        std::string name = libname;
        if (!Blex::StrLike(name,"*::*")) //it has no namespace
            name = "direct::" + name;

        unsigned retval = ExecuteCompile(name, filesystem, keeper, forcedrecompile);
        return retval==0;
}

bool BatchRecursiveMode(std::string const &curdir,WHFileSystem &filesystem, Blex::ContextKeeper &keeper)
{
        bool success=true;
        for (Blex::Directory dir(curdir,"*");dir;++dir)
        {
                if (Blex::StrLike(dir.CurrentFile(), ".*"))
                    continue;
                if (dir.GetStatus().IsDir())
                {
                        if (!BatchRecursiveMode(dir.CurrentPath(),filesystem,keeper))
                            success=false;
                }
                else if (dir.GetStatus().IsFile())
                {
                        //Any of the known harescript types?
                        if (Blex::StrCaseLike(dir.CurrentFile(),"*.whscr")
                            || Blex::StrCaseLike(dir.CurrentFile(),"*.whlib")
                            || Blex::StrCaseLike(dir.CurrentFile(),"*.shtml")
                            || Blex::StrCaseLike(dir.CurrentFile(),"*.whsock"))
                        {
                                if (!BatchSingleFile(dir.CurrentPath(),filesystem,keeper))
                                    success=false;
                        }
                }
        }
        return success;
}

bool BatchMode(std::vector<std::string> const &libs, WHFileSystem &filesystem, Blex::ContextKeeper &keeper)
{
        bool success=true;

        for (std::vector<std::string>::const_iterator it = libs.begin(); it != libs.end(); ++it)
        {
                std::string name = *it;

                if (!Blex::StrLike(name,"*::*")) //it has no namespace
                {
                        if (!Blex::PathIsAbsolute(name))
                            name=Blex::MergePath(Blex::GetCurrentDir(),name);

                        /* Is this a directory compile? */
                        if (Blex::PathStatus(name).IsDir())
                        {
                                if (!BatchRecursiveMode(name,filesystem,keeper))
                                    success=false;
                                continue;
                        }
                        else
                        {
                                name = "direct::" + name; //local, just add NS declaration
                        }
                }
                if (!BatchSingleFile(name,filesystem,keeper))
                    success=false;
        }
        return success;
}

void ShowSyntax(std::string const &error)
{
        std::cerr << "Syntax: whcompile [options] [filename...]\n\n";

        WHCore::Connection::PrintGlobalOptions();
        //            --xxxxxxxxxxxxxxxxxxxxxxxxx  ddddddddddddddddddddddddddddddddddddddddddddddd\n
        std::cerr << "-f                           Force compilation\n";
        std::cerr << "-q / --quiet                 Less verbose compilation\n";
        std::cerr << "--parseable                  Format errors for easier machine parsing\n";
        std::cerr << "--onlyerrors                 Show only error messages\n";
        std::cerr << "--listen                     Run in compilation server mode\n";
        std::cerr << "--listenip <ip>              IP address to listen on\n";
        std::cerr << "--listenport <port>          Port number to listen on\n";
        std::cerr << "-d <path>                    Output directory for dot files\n";
        std::cerr << "\n" << error << "\n";
}

/////////////////////////////////////////////////////////////////////
//
// The new HTTP compile server
//
void AccessLogFunction(WebServer::Connection &DEBUGONLYARG(conn),unsigned DEBUGONLYARG(responsecode),uint64_t DEBUGONLYARG(bytessent))
{
        DEBUGPRINT(conn.GetRemoteAddress() << ": " << conn.GetRequestParser().GetRequestLine() << " " << responsecode << " " << bytessent);
}
void ErrorLogFunction(Blex::SocketAddress const &remoteaddr,std::string const&error)
{
        Blex::ErrStream() << remoteaddr << ": " << error;
}
void GlobalHandleCompileRequest(WebServer::Connection *webcon, std::string const &path);

class CompileServer
{
        WHCore::Connection &conn;
        WebServer::Server webserver;
        WHFileSystem &filesystem;
        Blex::ContextKeeper &keeper;

        public:
        CompileServer(WHCore::Connection &conn, WHFileSystem &filesystem, Blex::ContextKeeper &keeper);
        bool Setup(std::string const &listenaddress, uint16_t listenport);
        void HandleCompileRequest(WebServer::Connection *webcon, std::string const &path);
        void Run();
};
        CompileServer *compileserver = NULL;

CompileServer::CompileServer(WHCore::Connection &conn, WHFileSystem &filesystem, Blex::ContextKeeper &keeper)
: conn(conn)
, webserver(conn.GetTmpRoot(),std::bind(&AccessLogFunction, std::placeholders::_1, std::placeholders::_2, std::placeholders::_3), std::bind(&ErrorLogFunction, std::placeholders::_1, std::placeholders::_2))
, filesystem(filesystem)
, keeper(keeper)
{
}

void CompileServer::HandleCompileRequest(WebServer::Connection *webcon, std::string const &)
{
        std::string url = webcon->GetRequest().reqparser.GetReceivedUrl();
        DEBUGPRINT("Incoming request for " << url);

        //ADDME: Slimme queue algorithmes etcetera :)

        std::string tocompile;
        std::shared_ptr< Blex::RandomStream > source;

        if (!webcon->GetCategoryRunPermission(1))
        {
                DEBUGPRINT("Too busy to handle request " << url << ", we'll come around to that later!");
                return;
        }

        // Get path (FIXME: get the path in a way that leaves initial // intact for UNC coding)
        if (Blex::StrLike(url, "/compile/*"))
        {
                if (webcon->GetRequestParser().GetProtocolMethod() != WebServer::Methods::Get)
                {
                        webcon->FailRequest(WebServer::StatusMethodNotAllowed, "Only GET is supported for uri compiles");
                        return;
                }

                Blex::DecodeUrl(url.begin()+9, url.end(), std::back_inserter(tocompile));
        }
        else if (Blex::StrLike(url, "/compilesource/*"))
        {
                if (webcon->GetRequestParser().GetProtocolMethod() != WebServer::Methods::Post)
                {
                        webcon->FailRequest(WebServer::StatusMethodNotAllowed, "Only POST is supported for uri compiles");
                        return;
                }

                Blex::DecodeUrl(url.begin()+15, url.end(), std::back_inserter(tocompile));
                source.reset(webcon->GetRequestParser().OpenBody());
        }
        else
        {
                webcon->FailRequest(WebServer::StatusNotFound, "Illegal compile URL: '" + url + "'");
                return;
        }

        DEBUGPRINT("Will now compile " << url);

        std::string preload = conn.GetPreloadLibrary();
        if(preload.empty())
                preload = "mod::system/lib/internal/harescript/preload.whlib";

        Engine compile_engine(filesystem, preload);
        try
        {
                compile_engine.SetDebugOptions(dopts);
                CompileControl control(compile_engine, filesystem);

                if (!source.get())
                    control.CompileLibrary(keeper, tocompile);
                else
                    control.CompileLibraryFromSource(keeper, source, tocompile);
        }
        catch(Message &m)
        {
                compile_engine.GetErrorHandler().AddMessage(m);
        }
        catch (const std::exception &e)
        {
                compile_engine.GetErrorHandler().AddInternalError(e.what());
        }

        ErrorHandler::MessageList const &warnlist = compile_engine.GetErrorHandler().GetWarnings();
        ErrorHandler::MessageList const &errorlist = compile_engine.GetErrorHandler().GetErrors();


        for (ErrorHandler::MessageList::const_iterator it = warnlist.begin(); it != warnlist.end(); ++it)
            DisplayWebMessage(&keeper, *it, webcon);

        std::string error;
        for (ErrorHandler::MessageList::const_iterator it = errorlist.begin(); it != errorlist.end(); ++it)
        {
                DisplayWebMessage(&keeper, *it, webcon);
                if (error.empty() && it->code != 146) // (skip relevant function)
                    error = GetMessageString(*it);
        }

#ifdef DEBUG
        bool success = compile_engine.GetErrorHandler().AnyErrors();
#endif

//        if (!success)
//            webcon->FailRequest(WebServer::StatusForbidden,"Compilation failed due to errors: " + error);

        filesystem.ReleaseResources(keeper);
        DEBUGPRINT("Request handled, success: " << (success ? "yes" : "no"));
}

bool CompileServer::Setup(std::string const &listenaddress, uint16_t listenport)
{
        WebServer::Listener la;
        la.listener.sockaddr.SetIPAddress(listenaddress);
        la.listener.sockaddr.SetPort(listenport);
        la.sitenum = 1; //point to the first website
        la.virtualhosting = false;

        std::shared_ptr< WebServer::ContentType > indextype(new WebServer::ContentType("x-webhare-builtin/compiler", &GlobalHandleCompileRequest));
        indextype->parse_body = true;

        WebServer::AccessRule totalrule;
        totalrule.matchtype=WebServer::AccessRule::MatchInitial;
        totalrule.force_content_type=indextype;
        totalrule.all_methods=true;
        totalrule.path="/";

        WebServer::WebSite website(""); //we need 'a' website for the webserver to accept path resolving

        auto indexmgr_config = std::make_shared<WebServer::ServerConfig>();
        indexmgr_config->listeners.push_back(la);
        indexmgr_config->sites.push_back(website);
        indexmgr_config->globalrules.push_back(totalrule);

        if(!webserver.ApplyConfig(indexmgr_config, NULL))
        {
                Blex::ErrStream()<<"WHcompile is unable to bind to its port";
                return false;
        }

        webserver.RegisterConnectionCategory(1, 1); // Category 1, max 1 concurrent connection
        return true;
}

void CompileServer::Run()
{
        compileserver=this;
        DEBUGPRINT("Compile webserver starting");
        webserver.MainLoop(10); //ADDME: Configurable num of workers?
        compileserver=NULL;
        DEBUGPRINT("Compile webserver has terminated");
}

void GlobalHandleCompileRequest(WebServer::Connection *webcon, std::string const &path)
{
        compileserver->HandleCompileRequest(webcon,path);
}

/////////////////////////////////////////////////////////////////////
//
// Main
//
int UTF8Main(std::vector<std::string> const &args)
{
        int retval = 0;

        Blex::OptionParser::Option optionlist[] =
                { Blex::OptionParser::Option::Switch("f", false)
                , Blex::OptionParser::Option::Switch("q", false)
                , Blex::OptionParser::Option::Switch("quiet", false)
                , Blex::OptionParser::Option::Switch("parseable", false)
                , Blex::OptionParser::Option::Switch("listen", false)
                , Blex::OptionParser::Option::Switch("onlyerrors", false)
                , Blex::OptionParser::Option::StringOpt("listenip")
                , Blex::OptionParser::Option::StringOpt("listenport")
                , Blex::OptionParser::Option::StringOpt("d")
                , Blex::OptionParser::Option::ParamList("libraries")
                , Blex::OptionParser::Option::ListEnd()
                };
        Blex::OptionParser options(optionlist);
        WHCore::Connection::AddOptions(options);

        if (!options.Parse(args))
            return ShowSyntax(options.GetErrorDescription()), EXIT_FAILURE;

        //--------------------------------------------------------------
        //
        // Parse options
        //
        std::vector< std::string > batchmode_libs;
        if (options.Exists("libraries"))
            batchmode_libs = options.ParamList("libraries");

        //Batch mode: compile & quit
        batch_mode = !batchmode_libs.empty();
        quiet = options.Switch("quiet") || options.Switch("q");
        parseable = options.Switch("parseable") || !batch_mode;
        forcedrecompile = options.Switch("f") || !batch_mode;
        only_errors = options.Switch("onlyerrors");

        //--------------------------------------------------------------
        //
        // Setup environment
        //

        dopts.show_timings = options.Exists("d");
#ifdef DEBUG
        dopts.show_files = options.Exists("d");
        dopts.show_compilecontrol = options.Exists("d");
        dopts.generate_dots = options.Exists("d");
        dopts.dots_dir = options.StringOpt("d");
#endif

        bool listen = options.Exists("listenport") || options.Switch("listen");

        // whmanager connection only when listening
        WHCore::WHManagerConnectionType::Type mgrconntype = listen || !batch_mode ? WHCore::WHManagerConnectionType::Connect : WHCore::WHManagerConnectionType::None;

        Blex::ContextRegistrator creg;
        WHCore::Connection conn(options, "whcompile", mgrconntype); // whmanager connection when listening

        // Ensure the compilecache exists...
        Blex::CreateDirRecursive(conn.GetCompileCache(),false);

        WHFileSystem filesystem(conn, CompilationPriority::ClassHighest, false); //If we ever decide to compile something ourself, we better hurry? :-)
        filesystem.Register(creg);
        Context::Register(creg);

        Blex::ContextKeeper keeper(creg);
        Context(keeper)->filesystemptr = &filesystem;

        if (listen)
        {
                CompileServer cs(conn, filesystem, keeper);

                uint16_t listenport;
                if (options.Exists("listenport"))
                    listenport = static_cast<uint16_t>(std::atol(options.StringOpt("listenport").c_str()));
                else
                    listenport = conn.GetDbaseAddr().GetPort()+1;

                std::string listenip;
                if(options.Exists("listenip"))
                    listenip = options.StringOpt("listenip");
                else
                    listenip = "127.0.0.1";

                if(!cs.Setup(listenip, listenport))
                    return EXIT_FAILURE;

                cs.Run();
                retval = EXIT_SUCCESS;
        }
        else if (batch_mode)
            retval = BatchMode(batchmode_libs,filesystem,keeper) ? EXIT_SUCCESS : EXIT_FAILURE;
        else
            return ShowSyntax("Specify either files to compile or listen options"), EXIT_FAILURE;

        return retval;
}

int main(int argc, char *argv[])
{
        return Blex::InvokeMyMain(argc,argv,&UTF8Main);
}
