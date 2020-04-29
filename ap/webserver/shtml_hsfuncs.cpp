#include <ap/libwebhare/allincludes.h>

//#include <ap/libwebhare/dbase_client.h>
#include <blex/path.h>
#include "shtml.h"
#include "server_init.h"
#include "../libwebhare/webserve.h"
#include "../libwebhare/webscon.h"
//#include "../libwebhare/whcore_hs3.h"
#include <harescript/vm/hsvm_context.h>
#include <harescript/vm/hsvm_dllinterface_blex.h>

// Debuginfo toggles
//#define SHOW_WEBSOCKET

// Toggle  implementation
#if defined(SHOW_WEBSOCKET) && defined(DEBUG)
 #define WS_PRINT(x) DEBUGPRINT(x)
 #define WS_ONLY(x) x
#else
 #define WS_PRINT(x)
 #define WS_ONLY(x)
#endif


//FIXME: Set up tracking for these blobs to prevent access to already destroyed webcons!
class VariableBlob : public HareScript::BlobBase
{
    private:
        WebServer::RequestRef request;
        std::string varname;

        class MyOpenedBlob: public OpenedBlobBase< VariableBlob >
        {
            private:
                std::unique_ptr< Blex::RandomStream > stream;

            public:
                MyOpenedBlob(VariableBlob &_blob);

                std::size_t DirectRead(Blex::FileOffset startoffset, std::size_t numbytes, void *buffer);
                Blex::FileOffset GetCacheableLength();
        };

    public:

        /** Constructor */
        VariableBlob(HareScript::VirtualMachine *_vm, WebServer::RequestRef request, std::string_view name);
        ~VariableBlob();

        void EnsureStream();

        std::unique_ptr< HareScript::OpenedBlob > OpenBlob();
        Blex::FileOffset GetCacheableLength();
        Blex::DateTime GetModTime();
        std::string GetDescription();
};

VariableBlob::VariableBlob(HareScript::VirtualMachine *vm, WebServer::RequestRef _request, std::string_view _varname)
: BlobBase(vm)
, request(_request)
, varname(_varname)
{
}

VariableBlob::~VariableBlob()
{
}

VariableBlob::MyOpenedBlob::MyOpenedBlob(VariableBlob &_blob)
: OpenedBlobBase< VariableBlob >(_blob)
{
        if (blob.varname.empty())
            stream.reset(blob.request->reqparser.OpenBody());
        else
            stream.reset(blob.request->reqparser.OpenFile(blob.varname));
}


std::size_t VariableBlob::MyOpenedBlob::DirectRead(Blex::FileOffset startoffset, std::size_t numbytes, void *buffer)
{
        return stream ? stream->DirectRead(startoffset, buffer, numbytes) : 0;
}

Blex::FileOffset VariableBlob::MyOpenedBlob::GetCacheableLength()
{
        return stream ? stream->GetFileLength() : 0;
}

std::unique_ptr< HareScript::OpenedBlob > VariableBlob::OpenBlob()
{
        return std::unique_ptr< HareScript::OpenedBlob >(new MyOpenedBlob(*this));
}

Blex::DateTime VariableBlob::GetModTime()
{
        return Blex::DateTime::Invalid();
}

Blex::FileOffset VariableBlob::GetCacheableLength()
{
        return MyOpenedBlob(*this).GetCacheableLength();
}

std::string VariableBlob::GetDescription()
{
        return "webvariable blob '" + varname + "'";
}


void ShtmlContextData::GetErrorInfo(HSVM *vm, HSVM_VariableId id_set)
{
        HSVM_ColumnId col_errors = HSVM_GetColumnId(vm, "ERRORS");
        HSVM_ColumnId col_groupid = HSVM_GetColumnId(vm, "GROUPID");
        HSVM_ColumnId col_resources = HSVM_GetColumnId(vm, "RESOURCES");
        HSVM_ColumnId col_statusheader = HSVM_GetColumnId(vm, "STATUSHEADER");

        HSVM_SetDefault(vm, id_set, HSVM_VAR_Record);

        GetMessageList(vm, HSVM_RecordCreate(vm, id_set, col_errors), hs_errors, true);
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, id_set, col_groupid), error_groupid);
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, id_set, col_statusheader), statusheader);
        HSVM_VariableId var_resources = HSVM_RecordCreate(vm, id_set, col_resources);
        HSVM_SetDefault(vm, var_resources, HSVM_VAR_StringArray);
        for (auto &resource: hs_errors.GetLoadedResources())
            HSVM_StringSetSTD(vm, HSVM_ArrayAppend(vm, var_resources), resource);
}

void ShtmlContextData::GetAuthenticatingSessionId(HSVM *vm, HSVM_VariableId id_set)
{

        if (!request.get())
        {
                HSVM_StringSet(vm, id_set, NULL, NULL);
                return;
        }

        ShtmlWebContext webcontext(request->requestkeeper);
        HSVM_StringSetSTD(vm, id_set, webcontext->authenticating_session_id);
}

void ShtmlContextData::GetClientUsername(HSVM *vm, HSVM_VariableId id_set)
{

        if (!request.get())
        {
                HSVM_StringSet(vm, id_set, NULL, NULL);
                return;
        }

        HSVM_StringSetSTD(vm, id_set, request->verified_username);
}
void ShtmlContextData::AllVariables(HSVM *vm, HSVM_VariableId id_set)
{

        /* ADDME: A custom blob handler for all web variables would probably
                  be a lot more efficient and help to delay memory allocation
           ADDME: Requestparser could combine all data related to a single webvar
                 for efficiency (and even proper handling of multiple file upload
                 with the same form name) */

        //Create the table and columns
        HSVM_ColumnId nameid = HSVM_GetColumnId(vm, "NAME");
        HSVM_ColumnId valueid = HSVM_GetColumnId(vm, "VALUE");
        HSVM_ColumnId dataid = HSVM_GetColumnId(vm, "DATA");
        HSVM_ColumnId filenameid = HSVM_GetColumnId(vm, "FILENAME");
        HSVM_ColumnId ispostid = HSVM_GetColumnId(vm, "ISPOST");

        HSVM_SetDefault(vm, id_set, HSVM_VAR_RecordArray);

        if (!request.get())
            return;

        HareScript::VirtualMachine *myvm = HareScript::GetVirtualMachine(vm);

        WebServer::RequestParser const &reqparser = request->reqparser;
        for (WebServer::WebVars::const_iterator itr=reqparser.GetVariables().begin();
             itr!=reqparser.GetVariables().end();
             ++itr)
        {
                HSVM_VariableId newrecord = HSVM_ArrayAppend(vm, id_set);
                HSVM_StringSet(vm, HSVM_RecordCreate(vm, newrecord, nameid), &itr->first[0], &itr->first[itr->first.size()]);
                HSVM_StringSet(vm, HSVM_RecordCreate(vm, newrecord, valueid), &itr->second.contents[0], &itr->second.contents[itr->second.contents.size()]);
                HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, newrecord, ispostid), itr->second.ispost);

                HSVM_VariableId data = HSVM_RecordCreate(vm, newrecord, dataid);

                if (!itr->second.contents.empty())
                {
                        //FIXME take reference to the RequestParser's variable store
                        myvm->GetStackMachine().SetBlob(data, HareScript::BlobRefPtr(new VariableBlob(myvm, request, itr->first)));
                }
                else
                {
                        HSVM_SetDefault(vm, data, HSVM_VAR_Blob);
                }
                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, newrecord, filenameid), itr->second.filename);
        }
}

void ShtmlContextData::AllHeaders(HSVM *vm, HSVM_VariableId id_set)
{
        HSVM_ColumnId fieldid = HSVM_GetColumnId(vm, "FIELD");
        HSVM_ColumnId valueid = HSVM_GetColumnId(vm, "VALUE");
        const char *xwhproxy = "X-WH-Proxy";

        HSVM_SetDefault(vm, id_set, HSVM_VAR_RecordArray);

        if (!request.get())
            return;

        WebServer::RequestParser const &reqparser = request->reqparser;
        for (WebServer::WebHeaders::const_iterator itr=reqparser.GetHeaders().begin();
             itr!=reqparser.GetHeaders().end();
             ++itr)
        {
                // Skip x-wh-proxy header
                if (Blex::StrCaseCompare(&itr->first[0], &itr->first[itr->first.size()], xwhproxy, xwhproxy+sizeof xwhproxy-1)==0)
                    continue;

                HSVM_VariableId newrecord = HSVM_ArrayAppend(vm, id_set);
                HSVM_StringSet(vm, HSVM_RecordCreate(vm, newrecord, fieldid), &itr->first[0], &itr->first[itr->first.size()]);
                HSVM_StringSet(vm, HSVM_RecordCreate(vm, newrecord, valueid), &itr->second[0], &itr->second[itr->second.size()]);

        }
}

void ShtmlContextData::Header(HSVM *vm, HSVM_VariableId id_set)
{

//        WebServer::Connection *webcon=webcon;

        if (!request.get())
        {
                HSVM_StringSet(vm, id_set, NULL, NULL);
                return;
        }

        Blex::StringPair searchstring;
        HSVM_StringGet(vm, HSVM_Arg(0), &searchstring.begin, &searchstring.end);

        //ADDME: Optimize string search
        WebServer::RequestParser const &reqparser = request->reqparser;
        WebServer::WebHeaders::const_iterator var=reqparser.GetHeaders().find(searchstring.stl_str());

        if (var!=reqparser.GetHeaders().end())
           HSVM_StringSet(vm, id_set,&*var->second.begin(),&*var->second.end());
        else
           HSVM_StringSet(vm, id_set,NULL,NULL);
}

void ShtmlContextData::Variable(HSVM *vm, HSVM_VariableId id_set)
{

//        WebServer::Connection *webcon=webcon;

        if (!request.get())
        {
                HSVM_StringSet(vm, id_set, NULL, NULL);
                return;
        }

        Blex::StringPair searchstring;
        HSVM_StringGet(vm, HSVM_Arg(0), &searchstring.begin, &searchstring.end);

        //ADDME: Optimize string search
        WebServer::RequestParser const &reqparser = request->reqparser;
        WebServer::WebVars::const_iterator var=reqparser.GetVariables().find(searchstring.stl_str());

        if (var!=reqparser.GetVariables().end())
           HSVM_StringSet(vm,id_set,&*var->second.contents.begin(),&*var->second.contents.end());
        else
           HSVM_StringSet(vm,id_set,NULL,NULL);
}

void ShtmlContextData::Sendfile(HSVM *vm)
{
        blob_to_send.reset(new HareScript::Interface::InputStream(vm, HSVM_Arg(0)));
        HSVM_SilentTerminate(vm);
}

void ShtmlContextData::RequestUrl(HSVM *vm, HSVM_VariableId id_set)
{

        if (!request.get())
        {
                HSVM_StringSet(vm, id_set, NULL, NULL);
                return;
        }
        HSVM_StringSetSTD(vm, id_set, request->GetRequestURL(WebServer::RequestURLType::ForServer));
}
void ShtmlContextData::ClientRequestUrl(HSVM *vm, HSVM_VariableId id_set)
{

        if (!request.get())
        {
                HSVM_StringSet(vm, id_set, NULL, NULL);
                return;
        }
        HSVM_StringSetSTD(vm, id_set, request->GetRequestURL(WebServer::RequestURLType::ForClient));
}
void ShtmlContextData::RequestMethod(HSVM *vm, HSVM_VariableId id_set)
{

        if (!request.get())
        {
                HSVM_StringSet(vm, id_set, NULL, NULL);
                return;
        }

        WebServer::RequestParser const &reqparser = request->reqparser;
        HSVM_StringSetSTD(vm,id_set, reqparser.GetProtocolMethodString());
}

void ShtmlContextData::ClientLocalPort(HSVM *vm, HSVM_VariableId id_set)
{

        if (!request.get())
        {
                HSVM_IntegerSet(vm,id_set, 0);
                return;
        }

        HSVM_IntegerSet(vm, id_set, request->localaddress.GetPort());
}

void ShtmlContextData::ClientLocalWebserver(HSVM *vm, HSVM_VariableId id_set)
{

        if (!request.get())
        {
                HSVM_IntegerSet(vm,id_set, 0);
                return;
        }

        HSVM_IntegerSet(vm, id_set, request->website ? request->website->webserver_id : 0);
}

void ShtmlContextData::ClientLocalBinding(HSVM *vm, HSVM_VariableId id_set)
{

        if (!request.get())
        {
                HSVM_IntegerSet(vm,id_set, 0);
                return;
        }

        HSVM_IntegerSet(vm, id_set, request->binding && request->binding->id > 0 ? request->binding->id : 0);
}

void ShtmlContextData::ClientLocalIp(HSVM *vm, HSVM_VariableId id_set)
{

        if (!request.get())
        {
                HSVM_StringSet(vm, id_set, NULL, NULL);
                return;
        }

        HSVM_StringSetSTD(vm, id_set, request->localaddress.GetIPAddress());
}

void ShtmlContextData::ClientLocalAddress(HSVM *vm, HSVM_VariableId id_set)
{

        if (!request.get())
        {
                HSVM_StringSet(vm, id_set, NULL, NULL);
                return;
        }

        if (request->is_virtual_host && request->website)
            HSVM_StringSetSTD(vm, id_set, request->website->hostname);
        else
            ClientLocalIp(vm, id_set);
}

void ShtmlContextData::ClientRemotePort(HSVM *vm, HSVM_VariableId id_set)
{

        if (!request.get())
        {
                HSVM_IntegerSet(vm,id_set, 0);
                return;
        }

        HSVM_IntegerSet(vm, id_set, request->remoteaddress.GetPort());
}

void ShtmlContextData::ClientRemoteIp(HSVM *vm, HSVM_VariableId id_set)
{
        if (!request.get())
        {
                HSVM_StringSet(vm, id_set, NULL, NULL);
                return;
        }

        HSVM_StringSetSTD(vm, id_set, request->remoteaddress.GetIPAddress());
}

void ShtmlContextData::AddHeader(HSVM *vm)
{
//        WebServer::Connection *_webcon=_webcon;
        static const char status[] = "Status";
        Blex::StringPair headerline;
        HSVM_StringGet(vm, HSVM_Arg(0), &headerline.begin, &headerline.end);

        Blex::StringPair data;
        HSVM_StringGet(vm, HSVM_Arg(1), &data.begin, &data.end);

        if(Blex::StrCaseCompare(headerline.begin, headerline.end, status, status + sizeof status - 1) == 0)
                statusheader.assign(data.begin, data.end);

        bool always_add = HSVM_BooleanGet(vm, HSVM_Arg(2));

        std::unique_ptr< ConnectionWorkTask > task;
        task.reset(new ConnectionWorkTask(shtml));
        task->type = ConnectionWorkTask::AddHeader;
        task->value1.assign(headerline.begin, headerline.end);
        task->value2.assign(data.begin, data.end);
        task->always_add = always_add;

        std::pair< bool, bool > res = shtml->AsyncRunTask(task, vm, true);
        if (res.first && !res.second) //ADDME No real need for this check if rewrite works fine, let hsvm do the reporting
            HSVM_ReportCustomError(vm, "Cannot AddHeader after flushing the response");
/*
        if(!_webcon->CanSetHeaders())
            HSVM_ReportCustomError(vm, "Cannot AddHeader after flushing the response");
        else
            _webcon->AddHeader(headerline.begin,headerline.size(),data.begin,data.size(),always_add);
*/
}

void ShtmlContextData::SessionList (HSVM *vm, HSVM_VariableId id_set)
{
        // FIXME: this is copy-pasted to ShtmlContextData::SessionList
        LockedSUCache::WriteRef lock(shtml->sucache);

        int32_t webserverid = HSVM_IntegerGet(vm, HSVM_Arg(0));

        //Create the table and columns
        HSVM_ColumnId col_name = HSVM_GetColumnId(vm, "NAME");
        HSVM_ColumnId col_userid = HSVM_GetColumnId(vm, "USERID");
        HSVM_ColumnId col_userentityid = HSVM_GetColumnId(vm, "USERENTITYID");
        HSVM_ColumnId col_accessruleids = HSVM_GetColumnId(vm, "ACCESSRULEIDS");
        HSVM_ColumnId col_isuser= HSVM_GetColumnId(vm, "ISUSER");
        HSVM_ColumnId col_logintime = HSVM_GetColumnId(vm, "LOGINTIME");
        HSVM_ColumnId col_lastaccess = HSVM_GetColumnId(vm, "LASTACCESS");
        HSVM_ColumnId col_ipaddress = HSVM_GetColumnId(vm, "IPADDRESS");
        HSVM_ColumnId col_canclose = HSVM_GetColumnId(vm, "CANCLOSE");
        HSVM_ColumnId col_sessionid = HSVM_GetColumnId(vm, "SESSIONID");
        HSVM_ColumnId col_type = HSVM_GetColumnId(vm, "TYPE");
        HSVM_ColumnId col_scope = HSVM_GetColumnId(vm, "SCOPE");
        HSVM_SetDefault(vm, id_set, HSVM_VAR_RecordArray);

        SUCache::Sessions const &sessionlist = lock->GetSessions();
        for (SUCache::Sessions::const_iterator itr=sessionlist.begin();itr!=sessionlist.end();++itr)
        {
                if (webserverid != 0 && itr->webserverid != webserverid)
                    continue;

/*                if (itr->lastcacheuse < inactivity_cutoff //inactive for too long
                    || itr->displayname.empty())
                    continue;
  */
                HSVM_VariableId newrecord = HSVM_ArrayAppend(vm, id_set);

                HSVM_DateTimeSet (vm, HSVM_RecordCreate(vm, newrecord, col_logintime), itr->creationtime.GetDays(), itr->creationtime.GetMsecs());
                HSVM_DateTimeSet (vm, HSVM_RecordCreate(vm, newrecord, col_lastaccess), itr->lastcacheuse.GetDays(), itr->lastcacheuse.GetMsecs());
                HSVM_IntegerSet  (vm, HSVM_RecordCreate(vm, newrecord, col_type), itr->type);
                HSVM_BooleanSet  (vm, HSVM_RecordCreate(vm, newrecord, col_isuser), !itr->displayname.empty());

                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, newrecord, col_name), itr->displayname);
                HSVM_IntegerSet  (vm, HSVM_RecordCreate(vm, newrecord, col_userid), itr->userid);
                HSVM_IntegerSet  (vm, HSVM_RecordCreate(vm, newrecord, col_userentityid), itr->userentityid);
                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, newrecord, col_ipaddress), itr->ipaddr.GetIPAddress());
                HSVM_BooleanSet  (vm, HSVM_RecordCreate(vm, newrecord, col_canclose), itr->can_close);
                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, newrecord, col_sessionid), itr->sessionid);
                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, newrecord, col_scope), itr->scope);

                HSVM_VariableId accessruleids = HSVM_RecordCreate(vm, newrecord, col_accessruleids);
                HSVM_SetDefault(vm, accessruleids, HSVM_VAR_IntegerArray);
                for(unsigned i=0;i<itr->accessruleids.size();++i)
                    HSVM_IntegerSet(vm, HSVM_ArrayAppend(vm, accessruleids), itr->accessruleids[i]);
        }
}

void ShtmlContextData::CreateWebSession(HSVM *vm, HSVM_VariableId id_set)
{
        //Open contexts

        // Create the packet before taking the session lock
        HareScript::Marshaller marshaller(HareScript::GetVirtualMachine(vm), HareScript::MarshalMode::All);
        std::unique_ptr< HareScript::MarshalPacket > packet;
        packet.reset(marshaller.WriteToNewPacket(HSVM_Arg(1)));
        if (packet->AnyObjects())
        {
                HSVM_ThrowException(vm, "Objects cannot be stored in a websession");
                return;
        }

        //Read variables & clock
        int32_t auto_increment = HSVM_IntegerGet(vm, HSVM_Arg(2)) * 60;
        bool limit_to_webserver = HSVM_BooleanGet(vm, HSVM_Arg(3));
        int32_t limit_webserver_id = request.get() && request->website ? request->website->webserver_id : 0;
        std::string password = HSVM_StringGetSTD(vm, HSVM_Arg(0));

        LockedSUCache::WriteRef lock(shtml->sucache);

        //Create and initialize session
        Session *newsession = lock->CreateSession(auto_increment, limit_to_webserver, limit_webserver_id, password);
        newsession->sessdata.reset(packet.release());

        //Return session ID
        HSVM_StringSetSTD(vm, id_set, newsession->sessionid);

        referred_sessions.insert(newsession->sessionid);
        newsession->AddRef();
}

void ShtmlContextData::UpdateWebSession(HSVM *vm, HSVM_VariableId id_set)
{
        //Open contexts

        // Create the packet before taking the session lock
        HareScript::Marshaller marshaller(HareScript::GetVirtualMachine(vm), HareScript::MarshalMode::All);
        std::unique_ptr< HareScript::MarshalPacket > packet;
        packet.reset(marshaller.WriteToNewPacket(HSVM_Arg(2)));
        if (packet->AnyObjects())
        {
                HSVM_ThrowException(vm, "Objects cannot be stored in a websession");
                return;
        }

        //Read variables & clock
        int32_t auto_increment = HSVM_IntegerGet(vm, HSVM_Arg(4)) * 60;
        bool autocreate = HSVM_BooleanGet(vm, HSVM_Arg(3));
        std::string sessionid = HSVM_StringGetSTD(vm, HSVM_Arg(0));

        LockedSUCache::WriteRef lock(shtml->sucache);

        std::pair< Session *, bool > res;

        if (autocreate && !sessionid.empty())
        {
                std::string passwd = HSVM_StringGetSTD(vm, HSVM_Arg(1));
                res = lock->OpenOrCreateSession(sessionid, passwd, false);
                if (!res.second)
                    lock->SetSessionAutoIncrement(res.first, auto_increment);
        }
        else
        {
                res.first = OpenSession(vm, lock, true); //honor webserver restrictions
                res.second = static_cast< bool >(res.first);
        }

        if (res.first)
        {
                // Set new data
                res.first->sessdata.reset(packet.release());

                // Add reference
                referred_sessions.insert(res.first->sessionid);
                res.first->AddRef();
        }

        //Return whether the session existed (if autocreate was true, it will now exist)
        HSVM_BooleanSet(vm, id_set, res.second);
}


Session* ShtmlContextData::OpenSession(HSVM *vm,LockedSUCache::WriteRef &lock, bool honor_webserver_restrictions)
{
        std::string sessionid = HSVM_StringGetSTD(vm, HSVM_Arg(0));
        Session *sess = lock->OpenSessionNochecks(sessionid, false);
        if (!sess || sess->IsDeleted())
            return nullptr;

        if(honor_webserver_restrictions && sess->limited_to_webserver
           && request.get() && request->website && request->website->webserver_id != sess->webserverid)
        {
                HSVM_ThrowException(vm, "Session is restricted to a different webserver");
                return nullptr;
        }

        std::string scope = HSVM_StringGetSTD(vm, HSVM_Arg(1));
        if(sess->scope != scope)
        {
                if(scope.empty())
                    HSVM_ThrowException(vm, "No scope specified when opening the session");
                else if(sess->scope.empty())
                    HSVM_ThrowException(vm, "Specifying a scope when accessing the session, but no scope was provided when creating it");
                else
                    HSVM_ThrowException(vm, "Incorrect scope specified when opening the session");
                return nullptr;
        }

        if(!referred_sessions.count(sessionid))
        {
                referred_sessions.insert(sessionid);
                sess->AddRef();
        }
        return sess;
}

void ShtmlContextData::ResetWebResponse(HSVM *vm)
{
        HSVM_FlushOutputBuffer(vm);
        webcon_async_itf->ClearOutput();
}

void ShtmlContextData::FlushWebResponse(HSVM *vm, HSVM_VariableId id_set)
{
        HSVM_SetDefault(vm, id_set, HSVM_VAR_Record);
        HSVM_FlushOutputBuffer(vm);

        std::unique_ptr< ConnectionWorkTask > task;
        task.reset(new ConnectionWorkTask(shtml));
        task->type = ConnectionWorkTask::FlushResponse;

        shtml->AsyncRunTask(task, vm, true);
}

void ShtmlContextData::SetupWebsocketInput(HSVM *vm, HSVM_VariableId id_set)
{
        if (!is_websocket)
        {
                HSVM_ThrowException(vm, "This operation can only be performed on websocket connections");
                return;
        }

        if (!inputstream.get())
        {
                std::unique_ptr< ConnectionWorkTask > task;
                task.reset(new ConnectionWorkTask(shtml));
                task->type = ConnectionWorkTask::SwitchToWebsocket;

                shtml->AsyncRunTask(task, vm, true);

                inputstream.reset(new WebserverInputStream(vm, this));
        }
        HSVM_IntegerSet(vm, id_set, inputstream->GetId());
}


void ShtmlContextData::GetWebSessionData(HSVM *vm, HSVM_VariableId id_set)
{
        //Open contexts

        std::unique_ptr< HareScript::MarshalPacket > copy;
        {
                LockedSUCache::WriteRef lock(shtml->sucache);

                //Open session
                Session* sess = OpenSession(vm, lock, true); //honor webserver restrictions

                if (sess && sess->sessdata.get())
                {
                        sess->sessdata->TryClone(&copy);
                        if (!copy.get())
                        {
                                HSVM_SetDefault(vm, id_set, HSVM_VAR_Record);
                                return;
                        }
                }
                else
                {
                        HSVM_SetDefault(vm, id_set, HSVM_VAR_Record);
                        return;
                }
        }

        // Read the packet outside of the lock
        HareScript::Marshaller marshaller(HareScript::GetVirtualMachine(vm), HareScript::MarshalMode::All);
        marshaller.ReadMarshalPacket(id_set, &copy);
}

void ShtmlContextData::GetWebSessionUser(HSVM *vm, HSVM_VariableId id_set)
{
        //Open contexts

        LockedSUCache::WriteRef lock(shtml->sucache);

        //Open session
        if (Session* sess = OpenSession(vm, lock, false)) //always okay to look up the user
        {
                HSVM_IntegerSet(vm, id_set, sess->userid);
                return;
        }

        //Return 0 on error..
        HSVM_IntegerSet(vm, id_set, 0);
        return;
}

void ShtmlContextData::GetWebSessionType(HSVM *vm, HSVM_VariableId id_set)
{
        //Open contexts

        LockedSUCache::WriteRef lock(shtml->sucache);

        //Open session
        if (Session* sess = OpenSession(vm, lock, false)) //always okay to look up the type
        {
                HSVM_IntegerSet(vm, id_set, sess->type);
                return;
        }

        //Return -1 on error..
        HSVM_IntegerSet(vm, id_set, -1);
        return;
}

void ShtmlContextData::RevokeWebSessionAuthentication(HSVM *vm)
{
        //Open contexts

        LockedSUCache::WriteRef lock(shtml->sucache);

        //Destroy session, if available
        Session* sess = lock->OpenSessionNochecks(HSVM_StringGetSTD(vm, HSVM_Arg(0)), false);
        if (sess)
                lock->RevokeAuthentication(sess);
}

void ShtmlContextData::StoreWebSessionData(HSVM *vm)
{
        // Create marshal packet outside of the lock
        HareScript::Marshaller marshaller(HareScript::GetVirtualMachine(vm), HareScript::MarshalMode::All);
        std::unique_ptr< HareScript::MarshalPacket > packet;
        packet.reset(marshaller.WriteToNewPacket(HSVM_Arg(2)));
        if (packet->AnyObjects())
        {
                HSVM_ThrowException(vm, "Objects cannot be stored in a websession");
                return;
        }

        //Open contexts

        LockedSUCache::WriteRef lock(shtml->sucache);

        //Open session
        Session* sess = OpenSession(vm, lock, true); //don't update sessions you don't own
        if (sess)
            sess->sessdata.reset(packet.release());
}
void ShtmlContextData::CloseWebSession(HSVM *vm)
{
        //Open contexts
        {

                LockedSUCache::WriteRef lock(shtml->sucache);

                //Open session
                Session* sess = OpenSession(vm, lock, false); //we don't mind closing sessions you know the id of
                if (sess)
                    lock->CloseSession(sess);
        }
}
void ShtmlContextData::AcceptBasicAuthCredentials(HSVM *vm)
{
        int32_t userid = HSVM_IntegerGet(vm, HSVM_Arg(1));
        int32_t userentityid = HSVM_IntegerGet(vm, HSVM_Arg(2));
        if (!sync_script || !request.get())
        {
                HSVM_ReportCustomError(vm, "AcceptBasicAuthCredentials may only be called from access handlers");
                return;
        }
        WebServer::Connection *webcon = webcon_async_itf->GetSyncWebcon();

        LockedSUCache::WriteRef lock(shtml->sucache);
        Session *newsess = lock->OpenBasicAuth(*webcon, true);
        std::string username = HSVM_StringGetSTD(vm, HSVM_Arg(0));
        lock->SetSessionAuth(newsess,
                             username,
                             false,
                             userid,
                             userentityid,
                             request->remoteaddress,
                             accessruleid);
        newsess->type = SessionType::Basic;

        ShtmlWebContext webcontext(request->requestkeeper);
        webcontext->userid = userid;
        webcontext->userentityid = userentityid;
        webcon->SetValidatedUsername(username);
}

void ShtmlContextData::SetRequestUserName(HSVM *vm)
{
        std::unique_ptr< ConnectionWorkTask > task;
        task.reset(new ConnectionWorkTask(shtml));
        task->type = ConnectionWorkTask::SetValidatedUsername;
        task->vm = vm;
        task->value1 = HSVM_StringGetSTD(vm, HSVM_Arg(0));

        shtml->AsyncRunTask(task, vm, true);
}

void ShtmlContextData::AuthenticateWebhareUser(HSVM *vm)
{
        if (!request.get())
        {
                HSVM_ReportCustomError(vm, "AuthenticateWebhareUser may only be called from within request pages");
                return;
        }

        ShtmlWebContext webcontext(request->requestkeeper);

        webcontext->userid = HSVM_IntegerGet(vm, HSVM_Arg(0));
        webcontext->userentityid = HSVM_IntegerGet(vm, HSVM_Arg(1));
        // FIXME: get username, so we can call webcon->SetValidatedUsername
}
void ShtmlContextData::GetAuthenticatedWebhareUser(HSVM *vm, HSVM_VariableId id_set)
{
        if (!request.get())
        {
                HSVM_IntegerSet(vm, id_set, 0);
                return;
        }

        ShtmlWebContext webcontext(request->requestkeeper);
        HSVM_IntegerSet(vm, id_set, webcontext->userid);
}

void ShtmlContextData::GetAuthenticatedWebhareUserEntityId(HSVM *vm, HSVM_VariableId id_set)
{
        if (!request.get())
        {
                HSVM_IntegerSet(vm, id_set, 0);
                return;
        }

        ShtmlWebContext webcontext(request->requestkeeper);
        HSVM_IntegerSet(vm, id_set, webcontext->userentityid);
}

void ShtmlContextData::AuthenticateWebSession(HSVM *vm)
{
        //Read new authentication parameters
        std::string username = HSVM_StringGetSTD(vm, HSVM_Arg(2));
        bool canclose = HSVM_BooleanGet(vm, HSVM_Arg(3));
        int32_t userid = HSVM_IntegerGet(vm, HSVM_Arg(4));
        int32_t userentityid = HSVM_IntegerGet(vm, HSVM_Arg(5));

        {
                LockedSUCache::WriteRef lock(shtml->sucache);

                //Open session, add reference, etc.
                Session* sess = OpenSession(vm, lock, true); //it seems only safe to authenticate in the proper context
                if (!sess)
                    return;
        }

        ShtmlWebContext webcontext(request->requestkeeper);
        webcontext->userid = userid;
        webcontext->userentityid = userentityid;

        // Send task to webcon, to set the authentication. Won't check the password no'mo.
        // FIXME: should we check the password? again??
        std::unique_ptr< ConnectionWorkTask > task;
        task.reset(new ConnectionWorkTask(shtml));
        task->type = ConnectionWorkTask::SetSessionAuth;
        task->vm = vm;
        task->value1 = HSVM_StringGetSTD(vm, HSVM_Arg(0));
        task->value2 = username;
        task->canclose = canclose;
        task->userid = userid;
        task->userentityid = userentityid;
        task->authaccesrule = HSVM_BooleanGet(vm, HSVM_Arg(6));

        shtml->AsyncRunTask(task, vm, true);
}

void ShtmlContextData::GetRequestBody(HSVM *vm, HSVM_VariableId id_set)
{
        //Open contexts

        if (!request.get())
        {
                HSVM_SetDefault(vm, id_set, HSVM_VAR_Blob);
                return;
        }

        HareScript::VirtualMachine *myvm = HareScript::GetVirtualMachine(vm);
        myvm->GetStackMachine().SetBlob(id_set, HareScript::BlobRefPtr(new VariableBlob(myvm, request, ""))); //empty string marks a Body request
}

void ShtmlWebserverContextData::ConfigureWebServer(HSVM *vm, HSVM_VariableId id_set)
{
        shtml->whserver.LoadConfig(vm, id_set, HSVM_Arg(0));
}

void ShtmlWebserverContextData::LogWebserverError(HSVM *vm)
{
        std::string message=HSVM_StringGetSTD(vm, HSVM_Arg(0));

        Blex::TokenIterator<std::string> tokenizer(message.begin(), message.end(), '\n');
        for (;tokenizer;++tokenizer)
          if (tokenizer.begin()!=tokenizer.end())
            shtml->webserver.errorlogfunction(Blex::SocketAddress(), std::string(tokenizer.begin(), tokenizer.end()));
}

void ShtmlWebserverContextData::GetHTTPEventListenerCounts(HSVM *vm, HSVM_VariableId id_set)
{
        WHCore::EventServer &eventserver = shtml->whserver.GetEventServer();

        std::string groupmask = HSVM_StringGetSTD(vm, HSVM_Arg(0));

        std::vector< std::pair< std::string, unsigned > > results;
        eventserver.GetListenerCounts(groupmask, &results);

        HSVM_ColumnId col_groupid = HSVM_GetColumnId(vm, "GROUPID");
        HSVM_ColumnId col_listeners = HSVM_GetColumnId(vm, "LISTENERS");

        HSVM_SetDefault(vm, id_set, HSVM_VAR_RecordArray);
        for (std::vector< std::pair< std::string, unsigned > >::iterator it = results.begin(); it != results.end(); ++it)
        {
                HSVM_VariableId newrecord = HSVM_ArrayAppend(vm, id_set);
                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, newrecord, col_groupid), it->first);
                HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, newrecord, col_listeners), it->second);
        }
}

void ShtmlWebserverContextData::ClearHTTPEventMessages(HSVM *vm)
{
        WHCore::EventServer &eventserver = shtml->whserver.GetEventServer();

        std::string groupmask = HSVM_StringGetSTD(vm, HSVM_Arg(0));

        eventserver.ClearMessages(groupmask);
}

void ShtmlWebserverContextData::FlushCache(HSVM *)
{
        shtml->FlushCache();
}

void ShtmlWebserverContextData::SessionList(HSVM *vm, HSVM_VariableId id_set)
{
        // FIXME: this is copy-pasted from ShtmlContextData::SessionList
        LockedSUCache::WriteRef lock(shtml->sucache);

        int32_t webserverid = HSVM_IntegerGet(vm, HSVM_Arg(0));

        //Create the table and columns
        HSVM_ColumnId col_name = HSVM_GetColumnId(vm, "NAME");
        HSVM_ColumnId col_userid = HSVM_GetColumnId(vm, "USERID");
        HSVM_ColumnId col_userentityid = HSVM_GetColumnId(vm, "USERENTITYID");
        HSVM_ColumnId col_accessruleids = HSVM_GetColumnId(vm, "ACCESSRULEIDS");
        HSVM_ColumnId col_isuser= HSVM_GetColumnId(vm, "ISUSER");
        HSVM_ColumnId col_logintime = HSVM_GetColumnId(vm, "LOGINTIME");
        HSVM_ColumnId col_lastaccess = HSVM_GetColumnId(vm, "LASTACCESS");
        HSVM_ColumnId col_ipaddress = HSVM_GetColumnId(vm, "IPADDRESS");
        HSVM_ColumnId col_canclose = HSVM_GetColumnId(vm, "CANCLOSE");
        HSVM_ColumnId col_sessionid = HSVM_GetColumnId(vm, "SESSIONID");
        HSVM_ColumnId col_type = HSVM_GetColumnId(vm, "TYPE");
        HSVM_SetDefault(vm, id_set, HSVM_VAR_RecordArray);

        SUCache::Sessions const &sessionlist = lock->GetSessions();
        for (SUCache::Sessions::const_iterator itr=sessionlist.begin();itr!=sessionlist.end();++itr)
        {
                if (webserverid != 0 && itr->webserverid != webserverid)
                    continue;

/*                if (itr->lastcacheuse < inactivity_cutoff //inactive for too long
                    || itr->displayname.empty())
                    continue;
  */
                HSVM_VariableId newrecord = HSVM_ArrayAppend(vm, id_set);

                HSVM_DateTimeSet (vm, HSVM_RecordCreate(vm, newrecord, col_logintime), itr->creationtime.GetDays(), itr->creationtime.GetMsecs());
                HSVM_DateTimeSet (vm, HSVM_RecordCreate(vm, newrecord, col_lastaccess), itr->lastcacheuse.GetDays(), itr->lastcacheuse.GetMsecs());
                HSVM_IntegerSet  (vm, HSVM_RecordCreate(vm, newrecord, col_type), itr->type);
                HSVM_BooleanSet  (vm, HSVM_RecordCreate(vm, newrecord, col_isuser), !itr->displayname.empty());

                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, newrecord, col_name), itr->displayname);
                HSVM_IntegerSet  (vm, HSVM_RecordCreate(vm, newrecord, col_userid), itr->userid);
                HSVM_IntegerSet  (vm, HSVM_RecordCreate(vm, newrecord, col_userentityid), itr->userentityid);
                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, newrecord, col_ipaddress), itr->ipaddr.GetIPAddress());
                HSVM_BooleanSet  (vm, HSVM_RecordCreate(vm, newrecord, col_canclose), itr->can_close);
                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, newrecord, col_sessionid), itr->sessionid);

                HSVM_VariableId accessruleids = HSVM_RecordCreate(vm, newrecord, col_accessruleids);
                HSVM_SetDefault(vm, accessruleids, HSVM_VAR_IntegerArray);
                for(unsigned i=0;i<itr->accessruleids.size();++i)
                    HSVM_IntegerSet(vm, HSVM_ArrayAppend(vm, accessruleids), itr->accessruleids[i]);
        }
}


void ShtmlContextData::LogWebserverError(HSVM *vm)
{
        std::string message=HSVM_StringGetSTD(vm, HSVM_Arg(0));

        std::string prefix = srhprogid;
        if (!prefix.empty())
            prefix += ": ";

        Blex::TokenIterator<std::string> tokenizer(message.begin(), message.end(), '\n');
        for (;tokenizer;++tokenizer)
          if (tokenizer.begin()!=tokenizer.end())
            request->ErrorLog(prefix + std::string(tokenizer.begin(), tokenizer.end()));
}

void ShtmlContextData::GetWebhareAccessRuleId(HSVM *hsvm, HSVM_VariableId id_set)
{
        HSVM_IntegerSet(hsvm, id_set, accessruleid);
}
void ShtmlContextData::GetWebhareAccessRules(HSVM *hsvm, HSVM_VariableId id_set)
{
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_RecordArray);
        if(!request.get())
                return;

        HSVM_ColumnId col_id = HSVM_GetColumnId(hsvm, "ID");
        HSVM_ColumnId col_data = HSVM_GetColumnId(hsvm, "DATA");
        HSVM_ColumnId col_hitdatatoragerule = HSVM_GetColumnId(hsvm, "HITDATATORAGERULE");

        for (auto &ruleinfo: request->rules_hit)
        {
                HSVM_VariableId newrow = HSVM_ArrayAppend(hsvm, id_set);
                HSVM_IntegerSet(hsvm, HSVM_RecordCreate(hsvm, newrow, col_id), ruleinfo.rule->id);
                HSVM_IntegerSet(hsvm, HSVM_RecordCreate(hsvm, newrow, col_hitdatatoragerule), ruleinfo.datastoragerule);

                HareScript::Marshaller marshaller(HareScript::GetVirtualMachine(hsvm), HareScript::MarshalMode::DataOnly);
                marshaller.ReadFromVector(HSVM_RecordCreate(hsvm, newrow, col_data), ruleinfo.rule->data);
        }
}

void ShtmlContextData::DetachScriptFromRequest(HSVM *hsvm)
{
        // Flush buffer, after detach output is discarded.
        HSVM_FlushOutputBuffer(hsvm);

        DEBUGPRINT("Detaching VMGroup " << HareScript::GetVirtualMachine(hsvm)->GetVMGroup() << " from current request");

        std::unique_ptr< ConnectionWorkTask > task;
        task.reset(new ConnectionWorkTask(shtml));
        task->type = ConnectionWorkTask::DetachScript;
        task->vm = hsvm;

        shtml->AsyncRunTask(task, hsvm, true);
}

void ShtmlContextData::GetSRHErrors(HSVM *vm, HSVM_VariableId id_set)
{
        std::string srh_id = HSVM_StringGetSTD(vm, HSVM_Arg(0));

        DEBUGPRINT("Getting errors from " << srh_id);

        HSVM_SetDefault(vm, id_set, HSVM_VAR_RecordArray);

        {
                Shtml::LockedSRHCache::WriteRef lock(shtml->srhcache);
                Shtml::SRHRunningAppMap::iterator itr=lock->apps.find(srh_id);
                if (itr != lock->apps.end())
                {
                        HareScript::ErrorHandler const &errorhandler = itr->second->errorhandler;
                        GetMessageList(vm, id_set, errorhandler, true);
                }
                else
                    return;
        }
}

struct RequestMarshalData
{
        RequestMarshalData(WebServer::RequestRef &ref)
        : request(ref)
        {
        }

        bool RestoreTo(struct HSVM *receiver, HSVM_VariableId received_var)
        {
                WHCore::ScriptGroupContextData *dest_scriptcontext=static_cast<WHCore::ScriptGroupContextData*>(HSVM_GetGroupContext(receiver, WHCore::ScriptGroupContextId,true));
                if (!dest_scriptcontext)
                    return false;
                ShtmlContextData *dest_shtmlcontext = static_cast<ShtmlContextData*>(dest_scriptcontext->shtml.get());
                if (!dest_shtmlcontext)
                    return false;

                dest_shtmlcontext->request = request;
                HSVM_SetDefault(receiver, received_var, HSVM_VAR_Object);
                return true;
        }

        RequestMarshalData *Clone()
        {
                return new RequestMarshalData(*this);
        }

        WebServer::RequestRef request;
};

std::pair< Blex::SocketError::Errors, unsigned > ShtmlContextData::WebserverInputStream::Read(unsigned numbytes, void *data)
{
        WS_PRINT("WebserverInputStream::Read start " << numbytes);
        unsigned read = contextdata->webcon_async_itf->ReadIncomingData((uint8_t *)data, numbytes);
        bool at_eof = read == 0 ? contextdata->webcon_async_itf->HasHangup() : false;
        WS_PRINT("WebserverInputStream::Read finish " << read << " " << at_eof);
        return std::make_pair(read == 0 && numbytes != 0
            ? at_eof
                  ? Blex::SocketError::Closed
                  : Blex::SocketError::WouldBlock
            : Blex::SocketError::NoError, read);
}

bool ShtmlContextData::WebserverInputStream::IsAtEOF()
{
        WS_PRINT("WebserverInputStream::IsAtEOF start");
        bool at_eof = contextdata->webcon_async_itf->HasHangup();
        WS_PRINT("WebserverInputStream::IsAtEOF finish " << at_eof);
        return at_eof;
}

bool ShtmlContextData::WebserverInputStream::AddToWaiterRead(Blex::PipeWaiter &waiter)
{
        Blex::Event &event = contextdata->webcon_async_itf->incomingdata_event;
        waiter.AddEvent(event);
        bool is_signalled = event.IsSignalled();
        return is_signalled;
}

HareScript::OutputObject::SignalledStatus ShtmlContextData::WebserverInputStream::IsReadSignalled(Blex::PipeWaiter * /*waiter*/)
{
        Blex::Event &event = contextdata->webcon_async_itf->incomingdata_event;
        return event.IsSignalled() ? Signalled : NotSignalled;
}
