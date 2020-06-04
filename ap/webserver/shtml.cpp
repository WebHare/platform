#include <ap/libwebhare/allincludes.h>

#include "shtml.h"
#include "server_init.h"

#include <ap/libwebhare/dbase_client.h>
#include <blex/path.h>
#include "../libwebhare/webscon.h"
#include "../libwebhare/webserve.h"
#include "session_users.h"
#include <ap/libwebhare/whcore.h>
#include <ap/libwebhare/whcore_hs3.h>
#include <ap/libwebhare/webharedbprovider.h>
#include <iostream>
#include <sstream>
#include <blex/logfile.h>
#include <rapidjson/document.h>
#include <rapidjson/error/en.h>

#define SHTML_DEBUG    //Define to enable debugging

#if defined(SHTML_DEBUG) && defined(DEBUG)
 #define SHTML_PRINT(x) DEBUGPRINT(x)
 #define SHTML_ONLY(x) x
 #define SHTML_PARAMONLY(x) x
#else
 #define SHTML_PRINT(x)
 #define SHTML_ONLY(x) x
 #define SHTML_PARAMONLY(x)
#endif


//FIXME configurable limits. Kill by considering Pushsessions (eg, kill everything for a client) - don't kill half a user's applications. Perhaps let the jobmanager handle this, and do nice logoffs
const unsigned MaxSleepingSRH = 800;
const unsigned SRHErrorKeep = 10*60; // Number of seconds SRH error information is kept

int ShtmlOutputFunc(void *vm, int len, void const *data, int /*allow_partial*/, int *error_code)
{
        WHCore::ScriptGroupContextData *scriptcontext=static_cast<WHCore::ScriptGroupContextData*>(HSVM_GetGroupContext(static_cast<HSVM*>(vm), WHCore::ScriptGroupContextId,true));
        ShtmlContextData *shtmlcontext = static_cast<ShtmlContextData*>(scriptcontext->shtml.get());
        shtmlcontext->webcon_async_itf->StoreData(data, len);

        if(shtmlcontext->shtml->debugmode)
        {
                std::cout.write(static_cast<const char*>(data), len);
                std::cout.flush();
        }
        *error_code = 0;
        return len;
}

ShtmlWebserverContextData::ShtmlWebserverContextData(Shtml *shtml)
: shtml(shtml)
{

}
ShtmlWebserverContextData::~ShtmlWebserverContextData()
{

}

ShtmlContextData::ShtmlContextData(Shtml *shtml)
: shtml(shtml)
, request(0)
, accessruleid(0)
, sync_script(false)
{
}

ShtmlContextData::~ShtmlContextData()
{
        if(!referred_sessions.empty())
        {
                Blex::DateTime now = Blex::DateTime::Now();

                LockedSUCache::WriteRef lock(shtml->sucache);
                for(ReferredSessions::const_iterator itr = referred_sessions.begin(); itr != referred_sessions.end(); ++itr)
                {
                        lock->DeleteSessionRef(*itr, now);
                }
        }
}

ShtmlWebContextData::ShtmlWebContextData(Shtml *_shtml)
: shtml(_shtml)
, userid(0)
, userentityid(0)
, errorstate(NoError)
{
}

ShtmlWebContextData::~ShtmlWebContextData()
{
}

std::size_t Shtml_TransmittableFile::Read(void *buf,std::size_t maxbufsize)
{
        return stream_to_send->Read(buf,maxbufsize);
}
std::size_t Shtml_TransmittableFile::Write(void const *, std::size_t )
{
        throw std::runtime_error("Shtml_TransmittableFile does not allow Writes");
}
bool Shtml_TransmittableFile::EndOfStream()
{
        return stream_to_send->EndOfStream();
}

Shtml::Shtml(WebHareServer &_whserver, bool _debugmode)
  : debugmode   (_debugmode)
  , environment (_whserver.GetWHConn(), CompilationPriority::ClassInteractive, false, false)
  , webhare     (_whserver.GetWHConn())
  , webserver   (_whserver.GetWebServer())
  , whserver    (_whserver)
{
        ShtmlWebContext::Register(webserver.GetRequestRegistrator(),this);
}

Shtml::~Shtml()
{
}

void Shtml::ExternalContentHandler(WebServer::Connection *webcon, std::string const &path, bool websocket)
{
        // Special case skoda_tourdusofa, max 500 rpcs concurrently
        std::string const &url = webcon->GetRequestParser().GetReceivedUrl();
        std::string const &mask = "/wh_services/*skoda_tourdusofa*";
        unsigned cat = Blex::StrLike(url.begin(), url.end(), mask.begin(), mask.end()) ? 2 : 1;

        DEBUGPRINT("Start in cat " << cat << " for URL " << url);

        if (!webcon->GetCategoryRunPermission(cat))
            return;

        ShtmlWebContext webcontext(webcon->GetRequestKeeper());
        webcontext->shtml->ContentHandler(webcon, path, true, NULL, "", websocket);
}

bool HandleRedirectSendfile(WebServer::Connection *webcon, HSVM *vm)
{
        WHCore::ScriptGroupContextData *scriptcontext=static_cast<WHCore::ScriptGroupContextData*>(HSVM_GetGroupContext(vm, WHCore::ScriptGroupContextId,true));
        if(!scriptcontext->shtml.get())
            return false;

        ShtmlContextData *shtmlcontext = static_cast<ShtmlContextData*>(scriptcontext->shtml.get());

        if(shtmlcontext->blob_to_send.get())
        {
                ShtmlWebContext webcontext(shtmlcontext->request->requestkeeper);

                std::unique_ptr<Shtml_TransmittableFile> sendfile(new Shtml_TransmittableFile(shtmlcontext->blob_to_send));
                Blex::FileOffset length = shtmlcontext->blob_to_send->GetFileLength();
                sendfile->runningapp = webcontext->runningapp;
                webcontext->runningapp.reset();

                std::unique_ptr<Blex::Stream> to_send;
                to_send.reset(sendfile.release());
                webcon->SendStream(to_send, length);
                shtmlcontext->blob_to_send.reset(); //prevent crash due to evil defstructor ordering (ADDME: Clean up this whole mess :-( )
                return true;
        }
        return false;
}

/* The magic webserver signature, which we still wantd to be readable! 32 bytes long
   8:  'WBHRWS::' = WebHare Webserver followed by two colons because, well we had room for 2 to get to 32.
   22: v0dmzc5chW4AxhbiSdDpJQ = the 128bit uid we selected
   2:  \r\n - a CRLF to be nice to text readers
   */
static const unsigned MagicSignatureLen = 32;
static const char MagicSignature[MagicSignatureLen+1] = "WBHRWS::v0dmzc5chW4AxhbiSdDpJQ\r\n";

struct MagicHeader
{
        MagicHeader() : iswhfsexecute(false)
        {
        }

        bool iswhfsexecute;
        int32_t fileid;
};

MagicHeader ReadMagicHeader(std::string const &path)
{
        /* NOTE: Any error we get here we can't FailRequest because we'd break
                 possible existing error handler paths. Additionally, the stuff
                 we would find here is WebHare-core-level bad, so the develoeper
                 probably can't fix it anyway. So we use ErrStream */
        MagicHeader retval;

        // Open the SHTML file to see if it's a magic header.
        std::unique_ptr<Blex::FileStream> infile(Blex::FileStream::OpenRead(path));
        if(!infile.get())
        {
                //This is a very weird race? But it could happen. We can't fail it because we might break an active error path
                Blex::ErrStream() << "shtml file '" << path << "' disappeared just when we wanted to read it";
                return retval;
        }

        // Read the header (TODO webserver could consider passing us an open handle, so we don't race to open. even better if the webserver did the reading for us and allowed us to peaK)
        char fileheader[1024];
        std::size_t bytesread = infile->Read(fileheader, sizeof fileheader);
        if(bytesread < MagicSignatureLen || memcmp(fileheader, MagicSignature, MagicSignatureLen) != 0)
            return retval; //no header

        // Find the linefeed. We only read one line after the signature and expect all the JSON data to fit int here
        char* start_json_data = fileheader + MagicSignatureLen;
        char* end_json_data = std::find(start_json_data, fileheader + bytesread, '\r');
        if(end_json_data >= fileheader + bytesread)
        {
                Blex::ErrStream() << "Magic signature found in file '" << path << "' but incorrect or too large header";
                return retval;
        }

        //Might be a rapidjson::Parse that accepts iterators? but it's no problem for us to null terminate it
        *end_json_data = 0;
        rapidjson::Document indoc;
        indoc.ParseInsitu(start_json_data);

        if (indoc.HasParseError())
        {
                Blex::ErrStream() << "JSON parse error in file '" << path << "' at offset " <<indoc.GetErrorOffset() << ": " << rapidjson::GetParseError_En(indoc.GetParseError());
                return retval;
        }

        if(indoc.IsObject() && indoc.HasMember("whfsexecute") && indoc["whfsexecute"].IsInt())
        {
                retval.iswhfsexecute = true;
                retval.fileid = indoc["whfsexecute"].GetInt();
        }
        return retval;
}

bool Shtml::ContentHandler(WebServer::Connection *webcon, std::string const &path, bool path_is_direct, HareScript::ErrorHandler const *errors_for_errorpage, std::string const &errors_groupid, bool websocket)
{
        (void)websocket;

        ShtmlWebContext webcontext(webcon->GetRequestKeeper());

        /* In the new jobmanager setup, the shtml content handler will only be called once,
           so we can start a new script immediately
        */
        SHTML_PRINT("Webcon " << webcon << " starting new script for path " << path);

        MagicHeader magicinfo;
        if(path_is_direct) //it's actually something on disk (apparently we can also run for other things?)
            magicinfo = ReadMagicHeader(path);

        // Print incoming request in debugmode
        if (debugmode)
        {
                std::ostringstream str;
                str << "Incoming request headers:" << std::endl;
                str << " " << webcon->GetRequestParser().GetRequestLine() << std::endl;

                WebServer::WebHeaders const &headers = webcon->GetRequestParser().GetHeaders();
                for (WebServer::WebHeaders::const_iterator itr = headers.begin(); itr != headers.end(); ++itr)
                    str << " " << itr->first << ": " << itr->second << std::endl;

                std::cout << str.str();
                DEBUGPRINT(str.str());
        }

        std::shared_ptr< WebServer::ConnectionAsyncInterface > webcon_async_itf = webcon->GetAsyncInterface();
        if (!webcon_async_itf.get())
        {
                /* Connection already closed. MAY NEVER HAPPEN! this function should be called in the context of the webscon
                   threads; if NULL the webconnection::Resetconnection is running together with us! */
                throw std::logic_error("Could not find the async output interface, connection has been reset too early");
        }

        SRHRunningAppPtr app(new SRHRunningApp(this));
        // High priority request?
        bool highpriority = webcon->GetRequestParser().GetVariableValue("$tolliumhighpriority") == "true";

        // Create a new job.
        HareScript::VMGroup *group = webserver.GetJobManager().CreateVMGroup(highpriority);

        app->vmgroup.reset(group, false);

        group->SetAbortFlag(app->abortflag.get());
        group->AddAbortFlagReference(app->abortflag);

        webserver.GetJobManager().SetRunningTimeout(group, webcon->GetConnection().config->script_timeout);

        app->termination_callback_handle = 0;
        app->hsvm = group->CreateVirtualMachine();
        app->starttime = Blex::DateTime::Now();
        app->lastactive = Blex::DateTime::Now();
        app->remoteaddr = webcon->GetRequest().remoteaddress;
        app->username = webcon->GetRequest().verified_username;
        *app->abortflag = HSVM_ABORT_DONT_STOP;
        app->userid = webcontext->userid;
        app->userentityid = webcontext->userentityid;
        webcontext->runningapp = app;

        SHTML_PRINT("Created VM group " << group);

        // Load the needed script
        std::string runpath;
        if(magicinfo.iswhfsexecute)
        {
                runpath = "mod::system/scripts/internal/webserver/whfsexecute.whscr";
        }
        else
        {
                runpath = path;
                if (path_is_direct)
                    runpath = "direct::" + runpath;
        }

        SHTML_PRINT("Loading script " << runpath);
        if(!HSVM_LoadScript(app->hsvm, runpath.c_str()))
        {
                return SendErrors(
                        webcon,
                        webserver.GetJobManager().GetGroupId(group),
                        webserver.GetJobManager().GetGroupExternalSessionData(group),
                        webserver.GetJobManager().GetGroupErrorContextInfo(group),
                        app->vmgroup->GetErrorHandler(),
                        false);
        }

        HareScript::VMStats stats;
        HareScript::GetVirtualMachine(app->hsvm)->GetVMStats(&stats);

        HSVM_VariableId sessrec = HSVM_AllocateVariable(app->hsvm);
        HSVM_SetDefault(app->hsvm, sessrec, HSVM_VAR_Record);

        HSVM_ColumnId col_started = HSVM_GetColumnId(app->hsvm, "STARTED");
        HSVM_ColumnId col_remoteip = HSVM_GetColumnId(app->hsvm, "REMOTEIP");
        HSVM_ColumnId col_userid = HSVM_GetColumnId(app->hsvm, "USERID");
        HSVM_ColumnId col_username = HSVM_GetColumnId(app->hsvm, "USERNAME");
        HSVM_ColumnId col_userrealname = HSVM_GetColumnId(app->hsvm, "USERREALNAME");
        HSVM_ColumnId col_library = HSVM_GetColumnId(app->hsvm, "LIBRARY");
        HSVM_ColumnId col_application = HSVM_GetColumnId(app->hsvm, "APPLICATION");
        HSVM_ColumnId col_starturl = HSVM_GetColumnId(app->hsvm, "STARTURL");
        HSVM_ColumnId col_errors = HSVM_GetColumnId(app->hsvm, "ERRORS");
        HSVM_ColumnId col_webserverrequest = HSVM_GetColumnId(app->hsvm, "WEBSERVERREQUEST");
        HSVM_ColumnId col_secure = HSVM_GetColumnId(app->hsvm, "SECURE");
        HSVM_ColumnId col_ip = HSVM_GetColumnId(app->hsvm, "IP");
        HSVM_ColumnId col_port = HSVM_GetColumnId(app->hsvm, "PORT");
        HSVM_ColumnId col_host = HSVM_GetColumnId(app->hsvm, "HOST");
        HSVM_ColumnId col_url = HSVM_GetColumnId(app->hsvm, "URL");
        HSVM_ColumnId col_method = HSVM_GetColumnId(app->hsvm, "METHOD");

        HSVM_DateTimeSet (app->hsvm, HSVM_RecordCreate(app->hsvm, sessrec, col_started), app->starttime.GetDays(), app->starttime.GetMsecs());
        HSVM_StringSetSTD(app->hsvm, HSVM_RecordCreate(app->hsvm, sessrec, col_remoteip), app->remoteaddr.GetIPAddress());
        HSVM_StringSetSTD(app->hsvm, HSVM_RecordCreate(app->hsvm, sessrec, col_userid), "system:" + Blex::AnyToString(app->userid));
        HSVM_StringSetSTD(app->hsvm, HSVM_RecordCreate(app->hsvm, sessrec, col_username), app->username);
        HSVM_StringSetSTD(app->hsvm, HSVM_RecordCreate(app->hsvm, sessrec, col_userrealname), "");
        HSVM_StringSetSTD(app->hsvm, HSVM_RecordCreate(app->hsvm, sessrec, col_library), stats.executelibrary);
        HSVM_SetDefault  (app->hsvm, HSVM_RecordCreate(app->hsvm, sessrec, col_starturl), HSVM_VAR_String);
        HSVM_SetDefault  (app->hsvm, HSVM_RecordCreate(app->hsvm, sessrec, col_application), HSVM_VAR_String);
        HSVM_SetDefault  (app->hsvm, HSVM_RecordCreate(app->hsvm, sessrec, col_errors), HSVM_VAR_RecordArray);

        HSVM_VariableId cell_webserverrequest = HSVM_RecordCreate(app->hsvm, sessrec, col_webserverrequest);
        HSVM_SetDefault(app->hsvm, cell_webserverrequest, HSVM_VAR_Record);
        HSVM_BooleanSet(app->hsvm, HSVM_RecordCreate(app->hsvm, cell_webserverrequest, col_secure), webcon->GetRequest().is_secure);
        HSVM_StringSetSTD(app->hsvm, HSVM_RecordCreate(app->hsvm, cell_webserverrequest, col_ip), webcon->GetRequest().localaddress.GetIPAddress());
        HSVM_IntegerSet(app->hsvm, HSVM_RecordCreate(app->hsvm, cell_webserverrequest, col_port), webcon->GetRequest().localaddress.GetPort());
        HSVM_StringSetSTD(app->hsvm, HSVM_RecordCreate(app->hsvm, cell_webserverrequest, col_host), webcon->GetRequestParser().GetHeaderValue("HOST"));
        HSVM_StringSetSTD(app->hsvm, HSVM_RecordCreate(app->hsvm, cell_webserverrequest, col_url), webcon->GetRequestParser().GetReceivedUrl());
        HSVM_StringSetSTD(app->hsvm, HSVM_RecordCreate(app->hsvm, cell_webserverrequest, col_method), webcon->GetRequestParser().GetProtocolMethodString());

        WHCore::ScriptGroupContextData *scriptcontext=static_cast<WHCore::ScriptGroupContextData*>(HSVM_GetGroupContext(app->hsvm, WHCore::ScriptGroupContextId,true));
        ShtmlContextData *shtmlcontext = new ShtmlContextData(this);
        scriptcontext->shtml.reset(shtmlcontext);
        shtmlcontext->is_websocket = websocket;

        {
                //ADDME: Woudln't it be better to have per-session locks for manipulating them, and holding onto sucache only for locating sessions and fixing refcounts?
                LockedSUCache::WriteRef shtmllock(sucache);
                Session *srhsession = shtmllock->CreateSession(
                        SRHErrorKeep, // The SRH MUST reference this session
                        true,
                        webcon->GetRequest().website ? webcon->GetRequest().website->webserver_id : 0,
                        "" //passwd
                        );
                app->sessionid = srhsession->sessionid;

                //Make sure the session stays alive as long as this VM lives!
                srhsession->AddRef();
                shtmlcontext->referred_sessions.insert(srhsession->sessionid);

                HareScript::Marshaller marshaller(HareScript::GetVirtualMachine(app->hsvm), HareScript::MarshalMode::All);
                srhsession->sessdata.reset(marshaller.WriteToNewPacket(sessrec));
        }

        webserver.GetJobManager().SetGroupId(*group, app->sessionid);

        // Initialize the SHTML request context
        shtmlcontext->request = webcon->GetRequestRef();
        if (errors_for_errorpage)
        {
                shtmlcontext->hs_errors = *errors_for_errorpage;
                shtmlcontext->error_groupid = errors_groupid;
        }
        shtmlcontext->statusheader = webcon->GetProtocolInfo().status_additional_message;
        shtmlcontext->srhprogid = app->sessionid;
        shtmlcontext->webcon_async_itf = webcon_async_itf;

        SHTML_PRINT("VM group " << group << " has VM " << app->hsvm << " and SRHID " << app->sessionid << " on conn " << webcon);
        HareScript::SQLLib::WHDB::SetWHDBProviderDefaultClientName(app->hsvm,
                                                                   webcon->GetRequestParser().GetReceivedUrl() + " from " + webcon->GetRequest().remoteaddress.ToString());

        // Set the output callbacks
        HSVM_SetOutputBuffering(app->hsvm, true);
        HSVM_SetOutputCallback(app->hsvm, app->hsvm, ShtmlOutputFunc);

        // Don't allow webhare:webserver environments in jobs
        HSVM_VariableId authrec = HSVM_AllocateVariable(app->hsvm);
        HSVM_GetAuthenticationRecord(app->hsvm, authrec);

        HSVM_VariableId cell_allowedjobenvironments = HSVM_RecordCreate(app->hsvm, authrec, HSVM_GetColumnId(app->hsvm, "ALLOWEDJOBENVIRONMENTS"));
        HSVM_SetDefault(app->hsvm, cell_allowedjobenvironments, HSVM_VAR_StringArray);
        HSVM_StringSetSTD(app->hsvm, HSVM_ArrayAppend(app->hsvm, cell_allowedjobenvironments), "WEBHARE");

        HSVM_VariableId cell_whfsexecute = HSVM_RecordCreate(app->hsvm, authrec, HSVM_GetColumnId(app->hsvm, "WHFSEXECUTE"));
        HSVM_IntegerSet(app->hsvm, cell_whfsexecute, magicinfo.iswhfsexecute ? magicinfo.fileid : 0);

        HSVM_VariableId auth_cell_webserverrequest = HSVM_RecordCreate(app->hsvm, authrec, col_webserverrequest);
        HSVM_CopyFrom(app->hsvm, auth_cell_webserverrequest, cell_webserverrequest);
        HSVM_SetAuthenticationRecord(app->hsvm, authrec);

        HSVM_DeallocateVariable(app->hsvm, authrec);
        HSVM_DeallocateVariable(app->hsvm, sessrec);

        // Say to webconnection we will wait for a signal (sent when the script terminates or goes waiting for the next request)
//        webcon->WaitForSignal();

        // And start the VM! OnVMGroupTerminate will be called when the script terminates.
        app->termination_callback_handle =
                webserver.GetJobManager().AddTerminationCallback(group, std::bind(&Shtml::VMGroupTerminated, this, app->hsvm));
        webserver.GetJobManager().SetPreterminationCallback(group, std::bind(&Shtml::VMGroupPreterminate, this, app->hsvm));

        webcon->IndicateAsyncResponseGeneration();
        webserver.GetJobManager().StartVMGroup(group);

        return true;
}

void Shtml::VMGroupPreterminate(HSVM *vm)
{
        WHCore::ScriptGroupContextData *scriptcontext=static_cast<WHCore::ScriptGroupContextData*>(HSVM_GetGroupContext(vm, WHCore::ScriptGroupContextId,true));
        ShtmlContextData *shtmlcontext = static_cast<ShtmlContextData*>(scriptcontext->shtml.get());

        SHTML_PRINT("Preterminate copying handler from " << shtmlcontext->srhprogid);

        LockedSRHCache::WriteRef lock(srhcache);
        SRHRunningAppMap::iterator itr = lock->apps.find(shtmlcontext->srhprogid);

        if (itr != lock->apps.end())
            itr->second->errorhandler = itr->second->vmgroup->GetErrorHandler();
}

void Shtml::VMGroupTerminated(HSVM *vm)
{
        // Lock the VM
        HareScript::VMGroup *group = HareScript::GetVirtualMachine(vm)->GetVMGroup();
        if (!webserver.GetJobManager().TryLockVMGroup(group, std::bind(&Shtml::VMGroupTerminated, this, vm)))
            return;

        // The VM is now locked
        WHCore::ScriptGroupContextData *scriptcontext=static_cast<WHCore::ScriptGroupContextData*>(HSVM_GetGroupContext(vm, WHCore::ScriptGroupContextId,true));
        ShtmlContextData *shtmlcontext = static_cast<ShtmlContextData*>(scriptcontext->shtml.get());

        SHTML_PRINT("Group " << group << " has finished, abortflag value: " << (group->GetAbortFlag() ? *group->GetAbortFlag() : -999) << ", errors: " << (group->GetErrorHandler().AnyErrors() ? "yes" : "no"));

        std::unique_ptr< ConnectionWorkTask > task;
        task.reset(new ConnectionWorkTask(shtmlcontext->shtml));
        task->type = ConnectionWorkTask::VMFinished;
        task->vm = vm;
        task->value1 = shtmlcontext->srhprogid;

        shtmlcontext->shtml->AsyncRunTask(task, vm, false);
}

void Shtml::LogErrors(std::string const &groupid, std::string const &externalsessiondata, std::string const &contextinfo, const HareScript::ErrorHandler &errors, WebServer::Request const &request)
{
        // With a single LogErrors site, we shouldn't need to repeat the URL here
        // request.ErrorLog("HareScript error for " + request.GetRequestURL(WebServer::RequestURLType::ForServer));

        /* Send the errors to the log file */
        for (HareScript::ErrorHandler::MessageList::const_iterator itr=errors.GetErrors().begin();
             itr!=errors.GetErrors().end();
             ++itr)
        {
                std::ostringstream loggable_error;
                loggable_error << itr->filename << " (" << itr->position.line << "," << itr->position.column << "): " << GetMessageString(*itr);
                request.ErrorLog(loggable_error.str());
        }

        for (HareScript::ErrorHandler::StackTrace::const_iterator itr=errors.GetStackTrace().begin();
                itr != errors.GetStackTrace().end(); ++itr)
        {
                std::ostringstream entry;
                entry << "#" << std::distance(errors.GetStackTrace().begin(), itr) << " " <<
                        itr->filename << " (" << itr->position.line << "," << itr->position.column << "): " << itr->func;
                request.ErrorLog(entry.str());
        }

        std::map< std::string, std::string > params;
        params["requesturl"] = Blex::AnyToJSON(request.GetRequestURL(WebServer::RequestURLType::ForServer));
        params["clientrequesturl"] = Blex::AnyToJSON(request.GetRequestURL(WebServer::RequestURLType::ForClient));
        //params["script"] = Blex::AnyToJSON(org_scriptname);
        params["contextinfo"] = Blex::AnyToJSON(contextinfo);
        LogHarescriptError(webhare, "webserver", groupid, externalsessiondata, errors, params);
}

bool Shtml::SendErrors(WebServer::Connection *webcon, std::string const &groupid, std::string const &externalsessiondata, std::string const &contextinfo, const HareScript::ErrorHandler &errors, bool vm_running)
{
        ShtmlWebContext webcontext(webcon->GetRequestKeeper());
        SHTML_PRINT("Entering senderrors, vm_running " << vm_running << " errorstate" << (int)webcontext->errorstate);

        if (!groupid.empty())
            webcon->AddErrorID(groupid);

        if (webcontext->errorstate == ShtmlWebContextData::DoubleError)
            webcon->GetRequest().ErrorLog("DOUBLE HareScript error (errors while processing an error page that was processing an error) for " + webcon->GetRequest().GetRequestURL(WebServer::RequestURLType::ForServer));
        else if (webcontext->errorstate == ShtmlWebContextData::FirstError)
            webcon->GetRequest().ErrorLog("HareScript errors occured while handling an error for " + webcon->GetRequest().GetRequestURL(WebServer::RequestURLType::ForServer));
        else
            webcon->GetRequest().ErrorLog("Request failed due to errors for " + webcon->GetRequest().GetRequestURL(WebServer::RequestURLType::ForServer));

        webcon->FailRequest(WebServer::StatusInternalError,"Request failed, HareScript errors. ID: " + webcon->GetErrorID());

//        // Send the errors to the log file. ADDME: try to use the right request, instead of [client *:0].
        if (!vm_running)
        {
                // If VM was running, vmterminate handler will emit the errors.
                LogErrors(groupid, externalsessiondata, contextinfo, errors, webcon->GetRequest());
        }

        webcon->GetAsyncInterface()->ClearOutput(); //FIXME: Ugly, a PreparePage of some sort would be nicer?

        if (webcontext->errorstate == ShtmlWebContextData::DoubleError)
            return false;
        else if (webcontext->errorstate == ShtmlWebContextData::FirstError)
            webcontext->errorstate = ShtmlWebContextData::DoubleError;
        else
            webcontext->errorstate = ShtmlWebContextData::FirstError;

        std::string errorpage = webcon->GetErrorPagePath(webcontext->errorstate == ShtmlWebContextData::DoubleError ? "doubleerror.*" : "harescripterror.*");
        if(!errorpage.empty())
        {
                //Reset important headers (ADDME: Do re-handling of content type (and important header resets) through the webserver,so we can also invoke different content types for errors)
                webcon->AddHeader("Content-Type",12,"text/html",9,false);
                webcon->AddHeader("Content-Disposition",19,"",0,false);

                //Adopt failed HSVM (so we can keep it alive for the &errors reference)
                SRHRunningAppPtr saveapp = webcontext->runningapp;
                webcontext->runningapp.reset();
                return ContentHandler(webcon, errorpage, true, &errors, groupid, false);
        }
        return false;
}


void Shtml::ExpireSessions()
{
        {
                LockedSUCache::WriteRef lock(sucache);
                lock->ExpireSessions();
        }
        {
                LockedSRHCache::WriteRef lock(srhcache);
                lock->ExpireApps();
        }

        srhcache.SignalAll(); //people might be waiting for a SRH
}
void Shtml::FlushCache()
{
        LockedSUCache::WriteRef (sucache)->FlushUserCache();
}
void Shtml::ExecuteAccessScript(WebServer::Connection *webcon, std::string const &scriptpath, int32_t accessruleid)
{
        //FIXME: Code duplication!
        ShtmlWebContext webcontext(webcon->GetRequestKeeper());

        //ADDME: We don't want a real suspendable app, but need one for the sendfile handler
        SRHRunningAppPtr app(new SRHRunningApp(this));

        //This handler is called whenever a '.shtml' file is requested.
        HareScript::VMGroup *group = webserver.GetJobManager().CreateVMGroup(true);

        app->vmgroup.reset(group, false);
        app->termination_callback_handle = 0;
        app->hsvm = group->CreateVirtualMachine();
        app->lastactive = Blex::DateTime::Now();
        app->remoteaddr = webcon->GetRequest().remoteaddress;

        SHTML_PRINT("Loading access script " << scriptpath << " vmgroup=" << webserver.GetJobManager().GetGroupId(group));
        if(!HSVM_LoadScript(app->hsvm, scriptpath.c_str()))
        {
                if(!SendErrors(
                        webcon,
                        webserver.GetJobManager().GetGroupId(group),
                        webserver.GetJobManager().GetGroupExternalSessionData(group),
                        webserver.GetJobManager().GetGroupErrorContextInfo(group),
                        app->vmgroup->GetErrorHandler(),
                        false))
                    webcontext->runningapp.reset();
                return;
        }

        HSVM_SetOutputBuffering(app->hsvm, true);
        HSVM_SetOutputCallback(app->hsvm, app->hsvm, ShtmlOutputFunc);

        HareScript::SQLLib::WHDB::SetWHDBProviderDefaultClientName(app->hsvm, "authscript " + scriptpath + " for " + webcon->GetRequest().remoteaddress.ToString());

        WHCore::ScriptGroupContextData *scriptgroupcontext=static_cast<WHCore::ScriptGroupContextData*>(HSVM_GetGroupContext(app->hsvm, WHCore::ScriptGroupContextId,true));
        ShtmlContextData *shtmlcontext = new ShtmlContextData(this);
        scriptgroupcontext->shtml.reset(shtmlcontext);

        shtmlcontext->request = webcon->GetRequestRef();
        shtmlcontext->accessruleid=accessruleid;
        shtmlcontext->sync_script = true;
        shtmlcontext->webcon_async_itf = webcon->GetAsyncInterface();

        webcontext->runningapp = app;

        try
        {
                if(!HSVM_ExecuteScript(app->hsvm, 1, 0)) //not suspendable
                {
                        SHTML_PRINT("Access script: must run error handler");
                        if(!SendErrors(
                                webcon,
                                webserver.GetJobManager().GetGroupId(group),
                                webserver.GetJobManager().GetGroupExternalSessionData(group),
                                webserver.GetJobManager().GetGroupErrorContextInfo(group),
                                app->vmgroup->GetErrorHandler(),
                                false))
                        {
                                SHTML_PRINT("Access script: error handler did not launch");

                                // If an async script is started to display errors, wait until this is finished (ADDME: run make async, integrate with jobmgr)
                                //if (webcontext->runningapp.get())
                                  //  webserver.GetJobManager().WaitFinished(webcontext->runningapp->vmgroup.get());
                        }
                        else
                        {
                                SHTML_PRINT("Access script: error handler is running");
                                return; //avoid resetting the running app, so the error handler has a chance to actually run
                        }
                }
                else
                {
                        HandleRedirectSendfile(webcon, app->hsvm);
                }
        }
        catch (std::exception &)
        {
                throw;
        }
        webcontext->runningapp.reset();
}

bool Shtml::TrySession(WebServer::Connection *webcon, Session &sess, WebServer::AccessRule const &rule)
{
        //If the script never saw this rule, ignore!
        if (std::find(sess.accessruleids.begin(), sess.accessruleids.end(), rule.id) == sess.accessruleids.end())
        {
                DEBUGPRINT("TrySession, never saw rule " << rule.id);
                return false;
        }

        DEBUGPRINT("TrySession, accepted for rule " << rule.id);

        ShtmlWebContext context(webcon->GetRequestKeeper());
        context->userid = sess.userid;
        context->userentityid = sess.userentityid;
        context->authenticating_session_id = sess.sessionid;
        webcon->SetValidatedUsername(sess.displayname);
        return true;
}

namespace
{

static const char webharelogin_prefix[] = "webharelogin";

inline bool StartsWithWebhareLoginPrefix(std::string const &str)
{
        if (str.size() < sizeof(webharelogin_prefix) - 1)
            return false;

        bool is_match = Blex::StrCompare(
                      str.c_str(),
                      str.c_str() + str.size(),
                      webharelogin_prefix,
                      webharelogin_prefix + sizeof(webharelogin_prefix) - 1,
                      sizeof(webharelogin_prefix) - 1) == 0;

        return is_match;
}

} // End of anonymous namespace

//ADDME: Split this function into pieces
void Shtml::WebHareAccessHandler(WebServer::Connection *webcon, WebServer::AccessRule const &rule,bool check_authorized,std::string const &)
{
        ShtmlWebContext context(webcon->GetRequestKeeper());

        if (!check_authorized /*we're not supposed to check*/ || rule.extauthscript.empty())
            return;

        //A script has been configured for this rule?

        //We should look for a session... (don't run access handler if we know the answer)
        {
                auto &cookies = webcon->GetRequest().reqparser.GetCookies();

                LockedSUCache::WriteRef lock(context->shtml->sucache);

                // Process all cookies that start with "webharelogin"
                auto itr = cookies.lower_bound(webharelogin_prefix);
                for (; itr != cookies.end() && StartsWithWebhareLoginPrefix(itr->first); ++itr)
                {
                        // see if the cookie matches (very rough filter, matches at least 'webharelogin' and 'webharelogin-<nr>_e')
                        auto sit = itr->first.begin() + sizeof(webharelogin_prefix) - 1;
                        while (sit != itr->first.end() && ((*sit >= '0' && *sit <= '9') || *sit == '-' || (*sit >= 'a' && *sit <= 'z')))
                            ++sit;
                        if(sit != itr->first.end() && sit[0]=='_' && sit+1 != itr->first.end() && sit[1]=='e')
                        {
                            ++sit;
                            ++sit;
                        }
                        if (sit != itr->first.end())
                             continue;

                        // Contents looks like "sessionid%20moredata" (url encoded). Cut at first encoded character.
                        auto cit = std::find(itr->second.begin(), itr->second.end(), '%');
                        std::string cleanedwebharelogin(itr->second.begin(), cit);

                        Session *sess = lock->OpenSessionNochecks(cleanedwebharelogin, true);
                        if (sess && context->shtml->TrySession(webcon, *sess, rule))
                            return;
                }

                // First, consider the access_token. Either as authentication: Bearer token, or from URL (as fallback)
                std::string const *access_token = nullptr;
                if (webcon->GetRequest().authentication.auth_type == WebServer::Authentication::Bearer)
                    access_token = &webcon->GetRequest().authentication.token;

                // No valid bearer token? Look on URL
                if (!access_token || !access_token->size())
                    access_token = webcon->GetRequest().reqparser.GetVariable("access_token");

                // Have a access_token? Try to authenticate with the session with as id the UFS encoded sha-256 hash of the access_token.
                Session *sess = 0;
                if (access_token && access_token->size())
                {
                        // Make UFS-encoded SHA-256 hash of the access token
                        Blex::SHA256 sha256;
                        sha256.Process(&*access_token->begin(), access_token->size());
                        Blex::StringPair hash = sha256.FinalizeHash();
                        std::string sessionid;
                        Blex::EncodeUFS(hash.begin, hash.end, std::back_inserter(sessionid));

                        // Try and open the session
                        sess = lock->OpenSessionNochecks(sessionid, true);
                }

                if (webcon->GetRequest().authentication.auth_type == WebServer::Authentication::Basic)
                {
                        // Basic authentication, try to reopen the session
                        sess = lock->OpenBasicAuth(*webcon, false);
                }

                if (sess && context->shtml->TrySession(webcon, *sess, rule))
                    return;
        }

        //No session found. We must execute the handler script, and see
        //if it can come up with anything
        context->shtml->ExecuteAccessScript(webcon, rule.extauthscript, rule.id);
        webcon->DecodeStatusHeader(rule.extauthscript);
}

std::pair< bool, bool > Shtml::AsyncRunTask(std::unique_ptr< ConnectionWorkTask > &task, HSVM *vm, bool wait_finished)
{
        WHCore::ScriptGroupContextData *scriptcontext=static_cast<WHCore::ScriptGroupContextData*>(HSVM_GetGroupContext(vm, WHCore::ScriptGroupContextId,true));
        ShtmlContextData *shtmlcontext = static_cast<ShtmlContextData*>(scriptcontext->shtml.get());

        task->is_sync = shtmlcontext->sync_script;
        if (shtmlcontext->sync_script)
        {
                WebServer::Connection *webcon = shtmlcontext->webcon_async_itf->GetSyncWebcon();

                if (webcon)
                {
                         bool completed = task->OnExecute(webcon);
                         if (!completed)
                             throw std::runtime_error("Cannot call a blocking task from a access control script!");
                }
                task->OnFinished(shtmlcontext->webcon_async_itf.get(), true);
                return std::make_pair(true, task->success);
        }
        else
        {
                std::shared_ptr< ConnectionWorkTaskAsyncResult > resultobj;

                if (wait_finished)
                {
                        resultobj.reset(new ConnectionWorkTaskAsyncResult);
                        task->asyncresult = resultobj;
                }

                task->groupref.reset(HareScript::GetVirtualMachine(vm)->GetVMGroup(), true);

                std::unique_ptr< WebServer::ConnectionTask > c_task(task.release());
                shtmlcontext->webcon_async_itf->PushTask(c_task);

                if (wait_finished)
                {
                        SHTML_PRINT("Going to waiting for task");
                        resultobj->Wait();
                        std::pair< bool, bool > result = resultobj->GetResult();
                        SHTML_PRINT("Task done");
                        return result;
                }
                else
                {
                        SHTML_PRINT("Async run queued");
                        return std::make_pair(false, false);
                }
        }
}

void Shtml::DestroyVMOfFinishedSRH(std::string const &srhid)
{
        LockedSRHCache::WriteRef lock(srhcache);
        SRHRunningAppMap::iterator it = lock->apps.find(srhid);
        if (it != lock->apps.end())
        {
                it->second->hsvm = 0;
                it->second->vmgroup.reset();

                // Set the timeout to 10 seconds
                it->second->lastactive = Blex::DateTime::Now();
        }
}

void Shtml::Shutdown()
{
        LockedSRHCache::WriteRef(srhcache)->Clear();
        LockedSUCache::WriteRef(sucache)->Clear();
}

void Shtml::SRHCache::ExpireApps()
{
        std::map< Blex::DateTime, SRHRunningAppMap::iterator> sleepingapps;

        // Expire the longest inactive aps when there are too many

        for (SRHRunningAppMap::iterator itr = apps.begin(); itr != apps.end(); ++itr)
        {
                if (itr->second.get())
                    sleepingapps.insert( std::make_pair(itr->second->lastactive, itr) );
        }

        while(sleepingapps.size() > MaxSleepingSRH)
        {
                SHTML_PRINT("Expiring sleeping application " << sleepingapps.begin()->second->second->sessionid);

                apps.erase(sleepingapps.begin()->second);
                sleepingapps.erase(sleepingapps.begin());
        }
}

void Shtml::SRHCache::Clear()
{
        apps.clear();
}

bool ConnectionWorkTask::OnExecute(WebServer::Connection *webcon)
{
        SHTML_PRINT("Executing task for group " << groupref.get() << " on " << webcon << ": " << GetTaskDescription());

        success = true;
        switch (type)
        {
        case ConnectionWorkTask::VMFinished:
                {
                        HareScript::VMGroup *vmgroup = HareScript::GetVirtualMachine(vm)->GetVMGroup();

                        if (vmgroup->GetAbortFlag() && *vmgroup->GetAbortFlag() == HSVM_ABORT_TIMEOUT)
                        {
                                webcon->FailRequest(WebServer::StatusServiceUnavailable,"Generation of response took too long");
                                webcon->AsyncResponseDone();
                                break;
                        }

                        bool started_error_script = false;
                        if (vmgroup->GetErrorHandler().AnyErrors())
                        {
                                HareScript::JobManager *jobmgr = vmgroup->GetJobManager();

                                started_error_script = html->SendErrors(
                                        webcon,
                                        jobmgr ? jobmgr->GetGroupId(vmgroup) : "",
                                        jobmgr ? jobmgr->GetGroupExternalSessionData(vmgroup) : "",
                                        jobmgr ? jobmgr->GetGroupErrorContextInfo(vmgroup) : "",
                                        HareScript::GetVirtualMachine(vm)->GetVMGroup()->GetErrorHandler(),
                                        false); //NOTE - Set to 'false'... trying to get all LogErrors calls done from SendErrors
                        }
                        else
                        {
                                // VM is now locked, so we can execute HandleRedirectSendfile
                                HandleRedirectSendfile(webcon, vm);
                        }

                        if (!started_error_script)
                            webcon->AsyncResponseDone();
                } break;
        case ConnectionWorkTask::DetachScript:
                {
                        {
                                WHCore::ScriptGroupContextData *scriptcontext=static_cast<WHCore::ScriptGroupContextData*>(HSVM_GetGroupContext(vm, WHCore::ScriptGroupContextId,true));
                                ShtmlContextData *shtmlcontext = static_cast<ShtmlContextData*>(scriptcontext->shtml.get());
                                shtmlcontext->is_detached = true;

                                SRHRunningAppPtr appptr;
                                {
                                        ShtmlWebContext webcontext(shtmlcontext->request->requestkeeper);
                                        appptr = webcontext->runningapp;
                                }
                                appptr->is_detached = true;

                                Shtml::LockedSRHCache::WriteRef lock(html->srhcache);
                                lock->apps.insert(std::make_pair(shtmlcontext->srhprogid, appptr));
                        }

                        // FIXME: flush?
                        webcon->GetAsyncInterface()->ResetConnection();
                        webcon->AsyncResponseDone();
                } break;
        case ConnectionWorkTask::AddHeader:
                {
                        if (!webcon->CanSetHeaders())
                        {
                                success = false;
                                msg = "Cannot AddHeader after flushing the response";
                        }
                        else
                            webcon->AddHeader(value1.c_str(), value1.size(), value2.c_str(), value2.size(), always_add);
                } break;
        case ConnectionWorkTask::FlushResponse:
                {
                        std::function< void() > callback = std::bind(
                                &WebServer::ConnectionAsyncInterface::MarkCurrentTaskFinished,
                                webcon->GetAsyncInterface().get(),
                                true);

                        if (!webcon->FlushResponse(callback))
                        {
                                success = false;
                                break;
                        }

                        // Wait for flush to end
                        SHTML_PRINT("Suspending task for group " << groupref.get() << " on " << webcon << ", waiting for flush to finish");
                        return false;
                } break;
        case ConnectionWorkTask::SwitchToWebsocket:
                {
                        webcon->SwitchToWebsocket();
                } break;
        case ConnectionWorkTask::SetSessionAuth:
                {
                        WHCore::ScriptGroupContextData *scriptcontext=static_cast<WHCore::ScriptGroupContextData*>(HSVM_GetGroupContext(vm, WHCore::ScriptGroupContextId,true));
                        ShtmlContextData *shtmlcontext = static_cast<ShtmlContextData*>(scriptcontext->shtml.get());
                        // sessionid, (passwd validated before, not really needed?), username, canclose, userid

                        std::string const &sessionid = value1;
                        std::string const &username = value2;

                        LockedSUCache::WriteRef lock(html->sucache);
                        Session* sess = lock->OpenSessionNochecks(sessionid, false);
                        if (sess)
                        {
                                lock->SetSessionAuth(sess, username, canclose, userid, userentityid, shtmlcontext->request->remoteaddress, authaccesrule ? shtmlcontext->accessruleid : 0);
                                if (userid != 0 || userentityid != 0)
                                {
                                        ShtmlWebContext webcontext(shtmlcontext->request->requestkeeper);
                                        webcontext->userid = userid;
                                        webcon->SetValidatedUsername(username);
                                }
                        }
                } break;
        case ConnectionWorkTask::SetValidatedUsername:
                {
                        webcon->SetValidatedUsername(value1);

                } break;
        default: ;
            // FIXME throw
        }

        SHTML_PRINT("Finished task for group " << groupref.get() << " on " << webcon << ": " << GetTaskDescription() << ", success: " << success);

        if (asyncresult.get())
        {
                asyncresult->SetResult(success);
                asyncresult.reset();
        }

        return true;
}

// This function does the signalling when OnTaskExecute doesn't do the signalling itself
void ConnectionWorkTask::OnFinished(WebServer::ConnectionAsyncInterface *SHTML_PARAMONLY(asyncitf), bool has_run)
{
        SHTML_PRINT("OnFinished for task for group " << groupref.get() << " on " << asyncitf->GetSyncWebcon() << ": " << GetTaskDescription() << ", executed: " << has_run << ", success: " << success << ", " << (asyncresult.get()?"not yet signalled":"already signalled"));
        if (asyncresult.get())
        {
                if (has_run)
                    asyncresult->SetResult(success);
                else
                    asyncresult->SetTerminated();
                asyncresult.reset();
        }

        if (type == ConnectionWorkTask::VMFinished)
            html->DestroyVMOfFinishedSRH(value1); // value1 contains srhprogid
}

std::string ConnectionWorkTask::GetTaskDescription()
{
        switch (type)
        {
        case Invalid:           return "Invalid";
        case VMFinished:        return "VMFinished";
        case AddHeader:         return "AddHeader";
        case FlushResponse:     return "FlushResponse";
        case DetachScript:      return "DetachScript";
        case SetSessionAuth:    return "SetSessionAuth";
        case SwitchToWebsocket: return "SwitchToWebsocket";
        default:                return "Invalid";
        }
}

// -----------------------------------------------------------------------------
//
// SRHRunningApp
//

SRHRunningApp::SRHRunningApp(Shtml *_shtml)
: shtml(_shtml)
, is_detached(false)
{
        abortflag.reset(new unsigned);
}

SRHRunningApp::~SRHRunningApp()
{
        {
                LockedSUCache::WriteRef lock(shtml->sucache);

                Session *sess = lock->OpenSessionNochecks(sessionid, false);
                if (sess)
                {
                        if (is_detached)
                        {
                                // Keep info about a destroyed srh running app for 120 seconds
                                lock->SetSessionAutoIncrement(sess, 120);
                        }
                        else
                        {
                                // Don't need the session for a normal app no' mo'
                                lock->CloseSession(sess);
                        }
                }
                else if (!sessionid.empty())
                {
                        // As long as the vm group exists
                        //Blex::ErrStream() << "SRH Session " << sessionid << " disappeared"; //gives shutdown errors
                }
        }


//        void SetSessionAutoIncrement(Session *session, unsigned auto_increment);
        SHTML_PRINT("Destroying SRHRunningApp " << sessionid);
        *abortflag = HSVM_ABORT_DISCONNECT;

        vmgroup.reset();
}

void SRHRunningApp::SendTerminateSignal()
{
        SHTML_PRINT("Sending terminate signal to SRHRunningApp " << sessionid);
        *abortflag = HSVM_ABORT_MANUALLY;
}

// -----------------------------------------------------------------------------
//
// WorkTaskResult
//

ConnectionWorkTask::~ConnectionWorkTask()
{
        if (asyncresult.get())
            asyncresult->SetTerminated();
}

// -----------------------------------------------------------------------------
//
// ConnectionWorkTaskAsyncResult
//

void ConnectionWorkTaskAsyncResult::Wait()
{
        LockedData::ReadRef lock(data);
        while (!lock->signalled)
            lock.Wait();
}

void ConnectionWorkTaskAsyncResult::SetResult(bool result)
{
        {
                LockedData::WriteRef lock(data);
                lock->signalled = true;
                lock->executed = true;
                lock->result = result;
        }
        data.SignalAll();
}

std::pair< bool, bool > ConnectionWorkTaskAsyncResult::GetResult()
{
        LockedData::WriteRef lock(data);
        return std::make_pair(lock->executed, lock->result);
}

void ConnectionWorkTaskAsyncResult::SetTerminated()
{
        bool changed;
        {
                LockedData::WriteRef lock(data);
                changed = !lock->signalled;
                if (changed)
                {
                        lock->signalled = true;
                        lock->executed = false;
                        lock->result = false;
                }
        }
        if (changed)
            data.SignalAll();
}
