#include <ap/libwebhare/allincludes.h>

#include <iostream>
#include <blex/getopt.h>
#include <blex/utils.h>
#include "../libwebhare/dbase.h"
#include "../libwebhare/whcore.h"
#include "../libwebhare/webserve.h"
#include <ap/libwebhare/webharedbprovider.h>
#include "../libwebhare/eventserver.h"
#include "server_init.h"
#include <csignal>
#include <memory>
#include "shtml.h"


/// Maximum reported requestttime in access log (in microseconds)
static const uint64_t max_reported_requesttime = 3600ull * 10000000ull; // 1 hour

void WebHareServer::FlushLogFiles()
{
        accesslog.Flush();
        errorlog.Flush();
        pxllog.Flush();
}

template < class A >
 char *CopySafeString(A copyptr, A copylimit, char *pos, char *loglinelimit)
{
        for(;copyptr < copylimit && pos < loglinelimit; ++copyptr)
        {
                if(*copyptr=='"' || *copyptr == '\n' || *copyptr == '\r') //escape double quotes & line endings as they mess up parsing a quoted string
                {
                        // "=22 \n=10 \r=13
                        *pos++ = '%';
                        if (pos == loglinelimit)
                            return pos - 1;
                        *pos++ = '0' + (*copyptr / 10);
                        if (pos == loglinelimit)
                            return pos - 2;
                        *pos++ = '0' + (*copyptr % 10);
                }
                else
                {
                        *pos++ = *copyptr;
                }
        }
        return pos;
}

char *CopySafeString(std::string const &url, char *pos, char *loglinelimit)
{
        return CopySafeString(url.begin(), url.end(), pos, loglinelimit);
}

/** Class to help building a log line
*/
struct LogLineBuilder
{
        /// Log data. 16384 is chosen as a reasonable size that most log lines won't cross
        Blex::SemiStaticPodVector< char, 16384 > data;

        /// Append a whole string
        void Append(std::string const &str)
        {
                if (!str.empty())
                    data.insert(data.end(), &str[0], &str[0] + str.size());
        }

        /// Append a string constant
        template < size_t size > void Append(const char (&str)[size])
        {
                data.insert(data.end(), str, str + size - 1);
        }

        /// Append a number
        template < class T > void AppendNumber(T value)
        {
                char buffer[1024]; // No c++ number type will reach 1K chars
                char *bufferend = Blex::EncodeNumber(value, 10, buffer);

                data.insert(data.end(), buffer, bufferend);
        }

        /// Append a string, url-encoding '"', '\r' and '\n'
        void AppendSafeString(std::string const &value, unsigned maxlen)
        {
                AppendSafeStringInternal(value.begin(), value.end(), maxlen, false);
        }

        void AppendSafeString(std::string::const_iterator begin, std::string::const_iterator end, unsigned maxlen)
        {
                AppendSafeStringInternal(begin, end, maxlen, false);
        }

        void AppendUnquotedSafeString(std::string const &value, unsigned maxlen)
        {
                AppendSafeStringInternal(value.begin(), value.end(), maxlen, true);
        }

        /// Append a string range, url-encoding '"', '\r' and '\n'
        void AppendSafeStringInternal(std::string::const_iterator begin, std::string::const_iterator end, unsigned maxlen, bool encodespace)
        {
                unsigned sizenow = data.size();
                data.resize(sizenow + maxlen);

                char *writeitr = data.begin() + sizenow;

                for (std::string::const_iterator it = begin; it != end && maxlen; ++it)
                {
                        if (*it=='"' || *it == '\n' || *it == '\r' || (*it == ' ' && encodespace)) //escape double quotes & line endings as they mess up parsing a quoted string
                        {
                                if (maxlen < 3)
                                    break;

                                *writeitr++ = '%';
                                *writeitr++ = '0' + (unsigned(*it) / 10);
                                *writeitr++ = '0' + (unsigned(*it) % 10);
                                maxlen -= 3;
                        }
                        else
                        {
                                *writeitr++ = *it;
                                --maxlen;
                        }
                }

                data.resize(data.size() - maxlen);
        }

        /// Append a date
        void AppendLogDate(Blex::DateTime datetime)
        {
                // Log date is max 30 bytes, just give 1K of room for safety
                char buffer[1024];
                char *bufferend = Blex::InsertLogDate(datetime, false, buffer);
                data.insert(data.end(), buffer, bufferend);
        }
};


void WebHareServer::AccessLogFunction(WebServer::Connection &conn, unsigned responsecode,uint64_t bytessent)
{
        Blex::DateTime now=Blex::DateTime::Now(); //ADDME: We could centralize this clock by only updating it in our sleep handler..
        WebServer::Request const &request=conn.GetRequest();
        WebServer::RequestParser const &reqparser=conn.GetRequestParser();
        /*
        127.0.0.1 - rabbit [10/Oct/2000:13:55:36 -0700] "GET /apache_pb.gif HTTP/1.0"
        200 2326 "http://www.example.com/start.html" "Mozilla/4.08 [en] (Win98; I ;Nav)"
        www.b-lex.com 80 0 trackingid "image/gif" 1435
        */

        LogLineBuilder builder;

        //Add IP address..
        conn.GetRequest().remoteaddress.AppendIPAddress(&builder.data);

        //Now, add the " - username " sequence.
        builder.Append(" - ");

        //Don't log the username, unless it's a 401 Authorization required page
        std::string const &proper_user_field = responsecode == 401 && !request.authentication.seen_username.empty()
                                                 ? request.authentication.seen_username : request.verified_username;
        if(!proper_user_field.empty())
            builder.AppendUnquotedSafeString(proper_user_field, 128);
        else
            builder.Append("-");

        //Add the [date time].
        builder.Append(" [");
        builder.AppendLogDate(now);
        builder.Append("] \"");

        //Add "url". Google allows 8192 characters, and we might url-encode some characters, so use 10000 chars as max-length
        builder.AppendSafeString(reqparser.GetRequestLine(), 10000);
        builder.Append("\" ");

        //Add response code.
        builder.AppendNumber(responsecode);
        builder.Append(" ");

        //Add bytes sent.
        if (bytessent)
            builder.AppendNumber(bytessent);
        else
            builder.Append("-");
        builder.Append(" \"");

        //Add referrer.
        if (request.referrer == NULL)
            builder.Append("-");
        else
            builder.AppendSafeString(*request.referrer, 600);
        builder.Append("\" \"");

        //Add user-agent.
        if (request.user_agent == NULL)
            builder.Append("-");
        else
            builder.AppendSafeString(*request.user_agent, 600);
        builder.Append("\" ");

        //Add hostname.
        if (request.website && !request.website->hostname.empty())
        {
                builder.AppendUnquotedSafeString(request.website->hostname, 100);
        }
        else
        {
                if (request.hostname.empty())
                    builder.Append("-");
                else
                {
                        std::string rawhost;
                        Blex::EncodeJava(request.hostname.begin(), request.hostname.end(), std::back_inserter(rawhost));
                        builder.AppendUnquotedSafeString(request.hostname, 100);
                }
        }
        builder.Append(" ");
        builder.AppendNumber(conn.GetLocalAddress().GetPort());
        builder.Append(" ");
        builder.AppendNumber(reqparser.GetBodyBytesReceived());
        builder.Append(" - \""); //this used to be the tracking stamp position. it's free now!

        // Encode request mime type.
        std::string const *ctype = conn.GetPreparedHeader("Content-Type", 12);
        if(ctype)
        {
                std::string::const_iterator mimetypestart = ctype->begin();
                std::string::const_iterator mimetypeend = std::min(std::find(ctype->begin(), ctype->end(), ';'), std::find(ctype->begin(), ctype->end(), ' '));
                if(mimetypeend != mimetypestart)
                    builder.AppendSafeString(mimetypestart, mimetypeend, 200);
        }
        builder.Append("\" ");

        // Encode request time.
        uint64_t requesttime = request.request_start ? (Blex::GetSystemCurrentTicks() - request.request_start)/ (Blex::GetSystemTickFrequency()/1000000) : 0;
        if (requesttime > max_reported_requesttime)
            builder.Append("-");
        else
            builder.AppendNumber(requesttime);

        DEBUGPRINT(std::string(builder.data.begin(), builder.data.end()));

        // Add end of line.
        builder.Append("\n");
        accesslog.RawLog(builder.data.begin(), builder.data.end(), now);

        //aww no c++20 yet
        //if(reqparser.GetReceivedUrl().starts_with("/.px/"))
        if(reqparser.GetReceivedUrl().compare(0, 5, "/.px/") == 0)
            pxllog.RawLog(builder.data.begin(), builder.data.end(), now);
}
void WebHareServer::ErrorLogFunction(Blex::SocketAddress const &remoteaddr, std::string const&error)
{
        std::string complete_error;
        complete_error.reserve(768);

        complete_error = "[client ";
        complete_error += remoteaddr.ToString();
        complete_error += + "] ";
        complete_error.insert(complete_error.end(), error.begin(), error.begin()+std::min<unsigned>(512,error.size()));

        ErrorLog(complete_error);
}

void WebHareServer::ErrorLog(std::string const &complete_error)
{
        DEBUGPRINT(complete_error);
        errorlog.StampedLog(complete_error);
}

WebHareServer::ToDo WebHareServer::GetTask()
{
        while (true) // synchronized waiter (lcok held)
        {
                {
                        LockedData::WriteRef lock(state);
                        if (lock->must_stop)
                            return Stop;

                        lock.TimedWait(Blex::DateTime::Now() + Blex::DateTime::Seconds(5));
                }

                /* flush and check log files */
                FlushLogFiles();
                /* flush any dead sessions and SRH apps (maybe this shouldn't be as frequent as flushing log files?) */
                shtml->ExpireSessions();
        }
}
void WebHareServer::MaintenanceThreadCode()
{
        while (true) //unsynchronized waiter (no lock held)
        {
                switch(GetTask())
                {
                case Stop:
                        return;
                }
        }
}

WebHareServer::WebHareServer()
: maintenancethread(std::bind(&WebHareServer::MaintenanceThreadCode, this))
{
        LockedData::WriteRef lock(state);
        lock->must_stop=0;
}

WebHareServer::~WebHareServer()
{
        Shutdown();
}

void WebHareServer::FlushCache()
{
        //ADDME: After reconnecting, we should verify the session list that none of the known webhare users got deleted in the mean-time
        shtml->FlushCache();
}

void WebHareServer::Shutdown()
{
        LockedData::WriteRef (state)->must_stop=1;
        state.SignalOne();

        // Remove all running scripts & su caches from shtml before shutting down jobmanager
        if (shtml.get())
            shtml->Shutdown();

        if(jobmgr.get())
            jobmgr->Shutdown();

        // Repeat to clear su entries that may have been created by running scripts
        if (shtml.get())
            shtml->Shutdown();

        maintenancethread.WaitFinish();

        servernotify.reset(NULL);
}

void WebHareServer::LogManagementScriptErrors(HareScript::VMGroup *group)
{
        HareScript::ErrorHandler const &errors = group->GetErrorHandler();

        ErrorLog("Errors loading webserver management script");
        for (HareScript::ErrorHandler::MessageList::const_iterator itr=errors.GetErrors().begin();
             itr!=errors.GetErrors().end();
             ++itr)
        {
                std::ostringstream loggable_error;
                loggable_error << itr->filename << "(" << itr->position.line << "," << itr->position.column << "): " << GetMessageString(*itr);
                ErrorLog(loggable_error.str());
        }

        for (HareScript::ErrorHandler::StackTrace::const_iterator itr=errors.GetStackTrace().begin();
                itr != errors.GetStackTrace().end(); ++itr)
        {
                std::ostringstream entry;
                entry << "At " << itr->filename << "(" << itr->position.line << "," << itr->position.column << "): " << itr->func;
                ErrorLog(entry.str());
        }
}

void WebHareServer::ManagementScriptTerminated(HareScript::VMGroup *group)
{
        if (jobmgr->IsRunning())
        {
                LogManagementScriptErrors(group);
                Blex::SleepThread(1000);
                StartManagementScript();
        }
}

bool WebHareServer::StartManagementScript()
{
        // Start mgmt scripts with high priority
        HareScript::VMGroup *group = jobmgr->CreateVMGroup(true);

        HareScript::VMGroupRef vmgroup;
        vmgroup.reset(group, false);

        HSVM *hsvm = group->CreateVirtualMachine();
        HareScript::SQLLib::WHDB::SetWHDBProviderDefaultClientName(hsvm, "web server management");
        HSVM_SetOutputCallback(hsvm, 0, &WHCore::StandardErrorWriter);
        HSVM_SetErrorCallback(hsvm, 0, &WHCore::StandardErrorWriter);

        // FIXME: set current script name (setcurrentfile on errorhandler)
        if (!HSVM_LoadScript(hsvm, "mod::system/scripts/internal/webserver/manager.whscr"))
        {
                LogManagementScriptErrors(group);
                Blex::SafeErrorPrint("Could not load webserver management script, terminating webserver\n");
                return false;
        }

        // Ignore the callback handle result, don't need to revoke it
        jobmgr->AddTerminationCallback(group, std::bind(&WebHareServer::ManagementScriptTerminated, this, group));
        jobmgr->StartVMGroup(group);
        return true;
}

int WebHareServer::Execute (std::vector<std::string> const &args)
{
        Blex::OptionParser::Option optionlist[] =
        {
                Blex::OptionParser::Option::Switch("d", false),
                Blex::OptionParser::Option::Switch("singledispatcher", false),
/*                Blex::OptionParser::Option::StringOpt("webhareinterface"),  --currently broken with new manage script. worth the trouble to restore? */
                Blex::OptionParser::Option::ListEnd()
        };

        Blex::OptionParser optparse(optionlist);
        WHCore::Connection::AddOptions(optparse);

        if (!optparse.Parse(args) )
        {
                Blex::ErrStream() << optparse.GetErrorDescription();
                return EXIT_FAILURE;
        }

        webhare.reset(new WHCore::Connection(optparse, "webserver", WHCore::WHManagerConnectionType::RequireConnected));

        onlyinterfaceport = 0; /* ADDME currently broken, see above optparse.Exists("webhareinterface") ? uint16_t(std::atol(optparse.StringOpt("webhareinterface").c_str())) : 0; */

        // ADDME: make this configurable (run-time, or in webhare configuration)
        bool is_enterprise = true; // (now stored in DB: webhare->GetKey().GetKey("webhare") != NULL)
        unsigned numdispatchers = is_enterprise ? 50 : 20; //number of workers
        if (optparse.Switch("singledispatcher"))
            numdispatchers=1;

        if(webhare->GetLogRoot().empty())
            throw std::runtime_error("WebHare not properly configured or environment variables not set");

        Blex::CreateDir(webhare->GetLogRoot(),true);

        // We start with safe history days (99999) until we receive our actual configuration
        accesslog.OpenLogfile(webhare->GetLogRoot(), "access", ".log",false, 99999, false);
        errorlog.OpenLogfile(webhare->GetLogRoot(), "errors", ".log",true, 99999, false);
        pxllog.OpenLogfile(webhare->GetLogRoot(), "pxl", ".log",true, 99999, false);

        webserver.reset(new WebServer::Server(webhare->GetTmpRoot(),
                                              std::bind(&WebHareServer::AccessLogFunction,this,std::placeholders::_1,std::placeholders::_2,std::placeholders::_3),
                                              std::bind(&WebHareServer::ErrorLogFunction,this,std::placeholders::_1,std::placeholders::_2) ));


        Blex::SetInterruptHandler(std::bind(&WebServer::Server::InterruptHandler,webserver.get(), std::placeholders::_1), false);

        DEBUGPRINT("Plugging in eventserver");
        eventserver.reset(new WHCore::EventServer(*webserver, "wh:eventserver"));
        eventserverlistener.reset(new WHCore::EventServerBroadcastListener(*webhare, *eventserver));

        DEBUGPRINT("Plugging in webhare extensions and harescript interpreter");
        shtml.reset(new Shtml(*this, optparse.Switch("d")));
        webhare->shtmlcallbacks.reset(new ShtmlWebserverContextData(shtml.get()));
        maintenancethread.Start();

        //ADDME: Clean this whole config stuff up a LOT. Just agree with the WebInterface to send us a signal when we must refresh our config. Would claer up spurious reloads on config change too

        DEBUGPRINT("Starting the notification thread");
        servernotify.reset (new ServerNotify(this,webhare->GetDbase()));

        // Create the script running job manager, start with (numdispatchers / 2) threads of execution
        jobmgr.reset(new HareScript::JobManager(shtml->environment.GetEnvironment()));

        unsigned numworkers = std::max<unsigned>(1, numdispatchers / 2);
        unsigned numreservedhighpriority = std::min(numworkers / 5, 3u);
        jobmgr->Start(std::max<unsigned>(1, numdispatchers / 2), numreservedhighpriority);

        webserver->SetJobManager(jobmgr.get());
        jobmgrintegrator.reset(new WHCore::JobManagerIntegrator(shtml->environment, *webhare, jobmgr.get()));

        if(StartManagementScript())
        {

                webserver->RegisterConnectionCategory(1, 5000); //FIXME remove entirely, move responsibility complete to jobmgr
                webserver->RegisterConnectionCategory(2, 500); // Category for RPCs
                webserver->MainLoop(numdispatchers);
        }

        webhare->FlushManagerQueue();
        Blex::ResetInterruptHandler();

        //Shutdown the async loop
        Shutdown();
        return 0;
}

void WebHareServer::ServerNotify::ReceiveTell(Database::Record data)
{
        if(data.GetCell(1).Integer()==65534) //instruction ADDME: add enumeration
        {
                std::vector <std::string> toks;
                Blex::TokenizeString(data.GetCell(2).String(), ' ', &toks);
                if (std::count(toks.begin(), toks.end(), "MODULES"))
                    server->webhare->ReloadPluginConfig();

                DEBUGPRINT("Got remote config flush");
        }
        else
        {
                DEBUGPRINT("asyncthread: got unknown message type");
        }
}

void WebHareServer::ServerNotify::NotifyConnected()
{
        assert(server);
        server->webhare->ReloadPluginConfig();
}

void WebHareServer::ServerNotify::NotifyDisconnected()
{
        // Expire all sessions, requiring reauthentication through the authentication script
        server->shtml->FlushCache();
}

template <typename T> void HSVM_LoadIn(T&dest, HSVM *hsvm, HSVM_VariableId toload);
template <typename T> T HSVM_Load(HSVM *hsvm, HSVM_VariableId toload)
{
        T temp;
        HSVM_LoadIn(temp, hsvm, toload);
        return temp;
}

template <> void HSVM_LoadIn<int32_t> (int32_t &dest, HSVM *hsvm, HSVM_VariableId toload)
{
        if(HSVM_GetType(hsvm, toload) != HSVM_VAR_Integer)
            throw std::runtime_error("Variable is not of expected type INTEGER");
        dest = HSVM_IntegerGet(hsvm, toload);
}
template <> void HSVM_LoadIn<bool> (bool &dest, HSVM *hsvm, HSVM_VariableId toload)
{
        if(HSVM_GetType(hsvm, toload) != HSVM_VAR_Boolean)
            throw std::runtime_error("Variable is not of expected type BOOLEAN");
        dest = HSVM_BooleanGet(hsvm, toload);
}
template <> void HSVM_LoadIn<std::string> (std::string &dest, HSVM *hsvm, HSVM_VariableId toload)
{
        if(HSVM_GetType(hsvm, toload) != HSVM_VAR_String)
            throw std::runtime_error("Variable is not of expected type STRING");
        dest = HSVM_StringGetSTD(hsvm, toload);
}
template <> void HSVM_LoadIn<std::vector<std::string> > (std::vector<std::string> &dest, HSVM *hsvm, HSVM_VariableId toload)
{
        if(HSVM_GetType(hsvm, toload) != HSVM_VAR_StringArray)
            throw std::runtime_error("Variable is not of expected type STRING ARRAY");
        dest.resize(HSVM_ArrayLength(hsvm, toload));
        for(unsigned i=0;i<dest.size(); ++i)
            HSVM_LoadIn(dest[i], hsvm, HSVM_ArrayGetRef(hsvm, toload, i));
}

template <typename T> void HSVM_LoadCellIn(T&dest, HSVM *hsvm, HSVM_VariableId record, const char *cellname)
{
        HSVM_VariableId cell = HSVM_RecordGetRef(hsvm, record, HSVM_GetColumnId(hsvm, cellname));
        if(!cell)
            throw std::runtime_error(std::string("Missing cell '") + cellname + "'");

        try
        {
                HSVM_LoadIn<T>(dest, hsvm, cell);
        }
        catch(std::exception &e)
        {
                throw std::runtime_error(std::string(cellname) + ": " + e.what());
        }
}
template <typename T> T HSVM_LoadCell(HSVM *hsvm, HSVM_VariableId record, const char *cellname)
{
        T temp;
        HSVM_LoadCellIn(temp, hsvm, record, cellname);
        return temp;
}

void LoadConfigPorts(HSVM *hsvm, HSVM_VariableId ports, WebServer::ServerConfig *newconfig)
{
        if(!ports)
            return;

        unsigned numports = HSVM_ArrayLength(hsvm, ports);
        for(unsigned i=0; i < numports; ++i)
        {
                HSVM_VariableId thisport = HSVM_ArrayGetRef(hsvm, ports, i);
                WebServer::Listener newport;

                HSVM_LoadCellIn(newport.id, hsvm, thisport, "ID");
                HSVM_LoadCellIn(newport.listener.privatekey, hsvm, thisport, "PRIVATEKEY");
                HSVM_LoadCellIn(newport.listener.certificatechain, hsvm, thisport, "CERTIFICATECHAIN");
                HSVM_LoadCellIn(newport.virtualhosting, hsvm, thisport, "VIRTUALHOST");
                HSVM_LoadCellIn(newport.listener.ciphersuite, hsvm, thisport, "CIPHERSUITE");
                HSVM_LoadCellIn(newport.istrustedport, hsvm, thisport, "ISTRUSTEDPORT");

                std::string ip;
                HSVM_LoadCellIn(ip, hsvm, thisport, "IP");
                newport.listener.sockaddr.SetIPAddress(ip);
                newport.listener.sockaddr.SetPort(HSVM_LoadCell<int32_t>(hsvm, thisport, "PORT"));

                newconfig->listeners.push_back(newport);
        }
}

void LoadConfigHosts(HSVM *hsvm, HSVM_VariableId hosts, WebServer::ServerConfig *newconfig)
{
        if(!hosts)
            return;

        unsigned numhosts = HSVM_ArrayLength(hsvm, hosts);
        for(unsigned i=0; i < numhosts; ++i)
        {
                HSVM_VariableId thishost = HSVM_ArrayGetRef(hsvm, hosts, i);

                std::string folder = HSVM_LoadCell<std::string>(hsvm, thishost, "OUTPUTFOLDER");
                if(!folder.empty() && folder[folder.size()-1]!='/')
                    folder += '/';

                newconfig->sites.push_back(WebServer::WebSite(folder));
                WebServer::WebSite *newsite=&newconfig->sites.back();

                HSVM_VariableId hostnames = HSVM_RecordGetRef(hsvm, thishost, HSVM_GetColumnId(hsvm, "LISTENHOSTS"));
                if(hostnames)
                {
                        for (unsigned j=0;j<HSVM_ArrayLength(hsvm, hostnames);++j)
                            newconfig->SetupVirtualName(HSVM_StringGetSTD(hsvm, HSVM_ArrayGetRef(hsvm, hostnames, j)), newconfig->sites.size()-1);
                }

                HSVM_LoadCellIn(newsite->hostname, hsvm, thishost, "HOSTNAME");
                HSVM_LoadCellIn(newsite->webserver_id, hsvm, thishost, "ID");
                HSVM_LoadCellIn(newsite->defaultpages, hsvm, thishost, "DEFAULTPAGES");
                HSVM_LoadCellIn(newsite->lowercasemode, hsvm, thishost, "LOWERCASEMODE");
                HSVM_LoadCellIn(newsite->forcehttps, hsvm, thishost, "FORCEHTTPS");
                HSVM_LoadCellIn(newsite->forcehttpsport, hsvm, thishost, "FORCEHTTPSPORT");

                int32_t port = HSVM_LoadCell<int32_t>(hsvm, thishost, "PORT");
                if(port)
                {
                        WebServer::Listener *listener=0;

                        //Find the port on which we are listening
                        for (unsigned i=0;i<newconfig->listeners.size();++i)
                          if (newconfig->listeners[i].id==port)
                        {
                                listener=&newconfig->listeners[i];
                                break;
                        }

                        if (listener)
                            listener->sitenum=newconfig->sites.size();
                }
        }
}

void LoadConfigRules(HSVM *hsvm, HSVM_VariableId rules, WebServer::ServerConfig *newconfig)
{
        if(!rules)
            return;

        unsigned numrules = HSVM_ArrayLength(hsvm, rules);
        newconfig->globalrules.reserve(numrules);
        for(unsigned i=0; i < numrules; ++i)
        {
                HSVM_VariableId thisrule = HSVM_ArrayGetRef(hsvm, rules, i);

                WebServer::AccessRule newrule;
                newrule.customhandler = &Shtml::WebHareAccessHandler;

                HSVM_LoadCellIn(newrule.id, hsvm, thisrule, "ID");
                HSVM_LoadCellIn(newrule.path, hsvm, thisrule, "PATH");
                HSVM_LoadCellIn(newrule.authrequired, hsvm, thisrule, "AUTHREQUIRED");
                HSVM_LoadCellIn(newrule.errorpath, hsvm, thisrule, "ERRORPATH");
                HSVM_LoadCellIn(newrule.finalerrorpath, hsvm, thisrule, "FINALERRORPATH");
                HSVM_LoadCellIn(newrule.extauthscript, hsvm, thisrule, "EXTAUTHSCRIPT");
                HSVM_LoadCellIn(newrule.redirecttarget, hsvm, thisrule, "REDIRECTTARGET");
                HSVM_LoadCellIn(newrule.redirecttarget_is_folder, hsvm, thisrule, "REDIRECTTARGET_IS_FOLDER");
                HSVM_LoadCellIn(newrule.redirect, hsvm, thisrule, "REDIRECT");
                HSVM_LoadCellIn(newrule.all_methods, hsvm, thisrule, "ALLOWALLMETHODS");
                HSVM_LoadCellIn(newrule.matchassubdir, hsvm, thisrule, "MATCHASSUBDIR");
                HSVM_LoadCellIn(newrule.fixcase, hsvm, thisrule, "FIXCASE");
                HSVM_LoadCellIn(newrule.cachecontrol, hsvm, thisrule, "CACHECONTROL");
                newrule.redirectcode = HSVM_LoadCell<int32_t>(hsvm, thisrule, "REDIRECTCODE");

                newrule.matchtype =  static_cast<WebServer::AccessRule::MatchType>(HSVM_LoadCell<int32_t>(hsvm, thisrule, "MATCHTYPE"));
                newrule.accepttype = static_cast<WebServer::AcceptType>(HSVM_LoadCell<int32_t>(hsvm, thisrule, "ACCEPTTYPE"));

                std::string force_content_type;
                HSVM_LoadCellIn(force_content_type, hsvm, thisrule, "FORCECONTENTTYPE");
                if (!force_content_type.empty())
                {
                        newrule.force_content_type = newconfig->GetContentTypeByContentType(force_content_type);
                }

                HSVM_VariableId iplist = HSVM_RecordGetRef(hsvm, thisrule, HSVM_GetColumnId(hsvm, "IPLIST"));
                if(iplist)
                  for (unsigned j=0;j<HSVM_ArrayLength(hsvm, iplist);++j)
                  {
                        HSVM_VariableId iprow = HSVM_ArrayGetRef(hsvm, iplist,j);
                        WebServer::IPRule newip(HSVM_LoadCell<std::string>(hsvm, iprow, "MASK")
                                               ,HSVM_LoadCell<bool>(hsvm, iprow, "IS_ALLOW")
                                               );

                        newrule.ip_masks.push_back(newip);
                  }

                HSVM_VariableId addheaderslist = HSVM_RecordGetRef(hsvm, thisrule, HSVM_GetColumnId(hsvm, "ADDHEADERS"));
                if(addheaderslist && HSVM_GetType(hsvm, addheaderslist) == HSVM_VAR_RecordArray)
                  for (unsigned j=0;j<HSVM_ArrayLength(hsvm, addheaderslist);++j)
                  {
                        HSVM_VariableId headersrow = HSVM_ArrayGetRef(hsvm, addheaderslist,j);
                        std::string headername = HSVM_LoadCell<std::string>(hsvm, headersrow, "NAME");
                        std::string content = HSVM_LoadCell<std::string>(hsvm, headersrow, "VALUE");
                        newrule.addheaders.push_back(std::make_pair(headername, content));
                  }

                HSVM_VariableId methods = HSVM_RecordGetRef(hsvm, thisrule, HSVM_GetColumnId(hsvm, "MATCHMETHODS"));
                if(methods)
                  for (unsigned j=0;j<HSVM_ArrayLength(hsvm, methods);++j)
                  {
                        HSVM_VariableId method = HSVM_ArrayGetRef(hsvm, methods,j);
                        if(HSVM_GetType(hsvm, method) == HSVM_VAR_String)
                                newrule.matchmethods.insert(HSVM_StringGetSTD(hsvm, method));
                  }

                HSVM_VariableId ignorepaths = HSVM_RecordGetRef(hsvm, thisrule, HSVM_GetColumnId(hsvm, "IGNOREPATHS"));
                if(ignorepaths && HSVM_GetType(hsvm, ignorepaths) == HSVM_VAR_StringArray)
                  for (unsigned j=0;j<HSVM_ArrayLength(hsvm, ignorepaths);++j)
                  {
                        HSVM_VariableId ignorepath = HSVM_ArrayGetRef(hsvm, ignorepaths, j);
                        newrule.ignorepaths.push_back(HSVM_StringGetSTD(hsvm, ignorepath));
                  }

                HSVM_VariableId data = HSVM_RecordGetRef(hsvm, thisrule, HSVM_GetColumnId(hsvm, "DATA"));
                if(data)
                {
                        HareScript::Marshaller marshaller(HareScript::GetVirtualMachine(hsvm), HareScript::MarshalMode::DataOnly);
                        marshaller.WriteToVector(data, &newrule.data);
                }

                HSVM_VariableId limitlist = HSVM_RecordGetRef(hsvm, thisrule, HSVM_GetColumnId(hsvm, "LIMITSERVERS"));
                if(limitlist && HSVM_ArrayLength(hsvm, limitlist) != 0)
                {
                        for (unsigned j=0;j<HSVM_ArrayLength(hsvm, limitlist);++j)
                        {
                                int32_t webserver = HSVM_IntegerGet(hsvm, HSVM_ArrayGetRef(hsvm, limitlist, j));
                                WebServer::WebSite *website = newconfig->FindWebSiteById(webserver);
                                if(!website)
                                {
                                        DEBUGPRINT("Skipping access rule " << newrule.id << " applied to irrelevant server #" << webserver);
                                        continue;
                                }
                                newrule.limitsites.insert(website);
                        }
                        if(newrule.limitsites.empty()) //nothing applied
                                continue;
                }

                HSVM_VariableId datastorages = HSVM_RecordGetRef(hsvm, thisrule, HSVM_GetColumnId(hsvm, "DATASTORAGE"));
                if(datastorages && HSVM_GetType(hsvm, datastorages) == HSVM_VAR_RecordArray)
                {
                        for (unsigned j=0;j<HSVM_ArrayLength(hsvm, datastorages);++j)
                        {
                                HSVM_VariableId var_location = HSVM_ArrayGetRef(hsvm, datastorages, j);

                                WebServer::DataStorage loc;
                                loc.resource = HSVM_LoadCell<std::string>(hsvm, var_location, "RESOURCE");
                                loc.is_folder = HSVM_LoadCell<bool>(hsvm, var_location, "ISFOLDER");
                                std::string lookupmethod = HSVM_LoadCell<std::string>(hsvm, var_location, "METHOD");
                                if (lookupmethod == "direct")
                                    loc.method = WebServer::DiskLookupMethod::Direct;
                                else if (lookupmethod == "sha256b16")
                                    loc.method = WebServer::DiskLookupMethod::SHA256B16;
                                else if (lookupmethod == "sha256b16_directory")
                                    loc.method = WebServer::DiskLookupMethod::SHA256B16_Directory;
                                else
                                {
                                        DEBUGPRINT("Skipping access rule " << newrule.id << " disk storage location with invalid method " << lookupmethod);
                                        continue;
                                }
                                newrule.datastorage.push_back(loc);
                        }
                }

                newconfig->globalrules.push_back(newrule);
        }
}

void LoadConfigTypes(HSVM *hsvm, HSVM_VariableId types, WebServer::ServerConfig *newconfig, Shtml *shtml, WHCore::EventServer *eventserver)
{
        if(!types)
            return;

        unsigned numtypes = HSVM_ArrayLength(hsvm, types);
        for(unsigned i=0; i < numtypes; ++i)
        {
                HSVM_VariableId thistype = HSVM_ArrayGetRef(hsvm, types, i);

                //Read from dbase
                std::string mimetype = HSVM_LoadCell<std::string>(hsvm, thistype, "MIMETYPE");
                std::string extension = HSVM_LoadCell<std::string>(hsvm, thistype, "EXTENSION");
                int32_t parsetype = HSVM_LoadCell<int32_t>(hsvm, thistype, "PARSETYPE");

                //Create new mimetype
                std::shared_ptr< WebServer::ContentType > contenttype;
                switch(parsetype)
                {
                case 1: //HareScript
                        contenttype = newconfig->AddContentType(extension, mimetype, std::bind(&Shtml::ExternalContentHandler, shtml, std::placeholders::_1, std::placeholders::_2, false));
                        contenttype->parse_body = true;
                        break;
                case 4: //HareScript websocket
                        contenttype = newconfig->AddContentType(extension, mimetype, std::bind(&Shtml::ExternalContentHandler, shtml, std::placeholders::_1, std::placeholders::_2, true));
                        contenttype->parse_body = true;
                        contenttype->is_websocket = true;
                        break;
                case 5: //eventserver
                        contenttype = newconfig->AddContentType(extension, mimetype, std::bind(&WHCore::EventServer::HandleRequest, eventserver, std::placeholders::_1, std::placeholders::_2));
                        break;
                default:
                        contenttype = newconfig->AddContentType(extension, mimetype, &WebServer::HandleSendAsIs);
                        break;
                }

                HSVM_LoadCellIn(contenttype->force_disposition_attachment, hsvm, thistype, "FORCEDISPOSITIONATTACHMENT");
        }

        //Set the default content type to text/plain
        newconfig->AddContentType(".defaulttype", "text/plain", &WebServer::HandleSendAsIs);
        newconfig->SetDefaultContentType(".defaulttype");
}

void LoadConfigXforwardTrust(HSVM *hsvm, HSVM_VariableId xforwardfor, WebServer::ServerConfig *newconfig)
{
        if(!xforwardfor)
            return;

        std::vector<std::string> xforward;
        HSVM_LoadIn(xforward, hsvm, xforwardfor);

        for(unsigned i=0;i<xforward.size();++i)
        {
                Blex::SocketAddress addy (xforward[i],0);
                if(!addy.IsAnyAddress())
                    newconfig->trust_xforwarded_for.push_back(addy);
        }
}

void WebHareServer::LoadConfig(HSVM *hsvm, HSVM_VariableId retval, HSVM_VariableId config)
{
        auto newconfig = std::make_shared<WebServer::ServerConfig>();

        try
        {
                LoadConfigPorts(hsvm, HSVM_RecordGetRef(hsvm, config, HSVM_GetColumnId(hsvm, "PORTS")), &*newconfig);
                LoadConfigHosts(hsvm, HSVM_RecordGetRef(hsvm, config, HSVM_GetColumnId(hsvm, "HOSTS")), &*newconfig);
                LoadConfigTypes(hsvm, HSVM_RecordGetRef(hsvm, config, HSVM_GetColumnId(hsvm, "TYPES")), &*newconfig, shtml.get(), eventserver.get());
                LoadConfigRules(hsvm, HSVM_RecordGetRef(hsvm, config, HSVM_GetColumnId(hsvm, "RULES")), &*newconfig);
                LoadConfigXforwardTrust(hsvm, HSVM_RecordGetRef(hsvm, config, HSVM_GetColumnId(hsvm, "TRUST_XFORWARDEDFOR")), &*newconfig);
                HSVM_LoadCellIn(newconfig->debugurlmasks, hsvm, config, "DEBUGURLMASKS");

                errorlog.SetRotates(HSVM_LoadCell<int32_t>(hsvm, config, "ERRORLOG"));
                accesslog.SetRotates(HSVM_LoadCell<int32_t>(hsvm, config, "ACCESSLOG"));
                pxllog.SetRotates(HSVM_LoadCell<int32_t>(hsvm, config, "PXLLOG"));
                newconfig->script_timeout = HSVM_LoadCell<int32_t>(hsvm, config, "SCRIPT_TIMEOUT");
                HSVM_LoadIn(newconfig->stripextensions, hsvm, HSVM_RecordGetRef(hsvm, config, HSVM_GetColumnId(hsvm, "STRIPEXTENSIONS")));
        }
        catch(std::exception &e)
        {
                DEBUGPRINT("Error processing configuration record: " << e.what());
                HSVM_ReportCustomError(hsvm, (std::string("Error processing configuration record: ") + e.what()).c_str());
                return;
        }

        //Commit the changes to the webserver
        HSVM_ColumnId brokenlisteners_name = HSVM_GetColumnId(hsvm, "BROKEN_LISTENERS");

        HSVM_SetDefault(hsvm, retval, HSVM_VAR_Record);
        HSVM_VariableId brokenlist = HSVM_RecordCreate(hsvm, retval, brokenlisteners_name);
        HSVM_SetDefault(hsvm, brokenlist, HSVM_VAR_RecordArray);

        std::vector<Blex::Dispatcher::ListenAddress> broken_listeners;
        if(!webserver->ApplyConfig(newconfig, &broken_listeners))
        {
                HSVM_ColumnId col_port = HSVM_GetColumnId(hsvm, "PORT");
                HSVM_ColumnId col_ip = HSVM_GetColumnId(hsvm, "IP");

                for(unsigned i=0;i<broken_listeners.size();++i)
                {
                        HSVM_VariableId brokenrec = HSVM_ArrayAppend(hsvm, brokenlist);
                        HSVM_IntegerSet(hsvm, HSVM_RecordCreate(hsvm, brokenrec, col_port), broken_listeners[i].sockaddr.GetPort());
                        HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, brokenrec, col_ip), broken_listeners[i].sockaddr.GetIPAddress());
                }
        }

        int32_t keep_process_history = HSVM_LoadCell<int32_t>(hsvm, config, "KEEP_PROCESS_HISTORY");
        jobmgr->SetKeepFinishHistory(keep_process_history < 0 ? 0 : keep_process_history);
}

int UTF8Main(std::vector<std::string> const &args)
{
        WebHareServer myserver;
        int ret=myserver.Execute(args);
        return ret;
}

int main(int argc, char *argv[])
{
        return Blex::InvokeMyMain(argc,argv,&UTF8Main);
}
