// Eventserver

#include <ap/libwebhare/allincludes.h>

#include <blex/logfile.h>
#include <ap/libwebhare/webscon.h>
#include "eventserver.h"


namespace WHCore
{

namespace
{

const unsigned EventServerWebContextId = 258; // FIXME: register! but where?
//EventServer *global_eventserver = 0;

} // End of anonymous namespace

struct EventServerWebContextData //per-request eventserver data
{
        EventServerWebContextData(EventServer *eventserver);
        ~EventServerWebContextData();

        EventServer &eventserver;
        WebServer::Connection *conn;
};

EventServerWebContextData::EventServerWebContextData(EventServer *eventserver)
: eventserver(*eventserver)
{
}

EventServerWebContextData::~EventServerWebContextData()
{
        eventserver.UnregisterConnection(conn);
}

class CloseConnectionTask : public WebServer::ConnectionTask
{
        bool OnExecute(WebServer::Connection *webconn);
        void OnFinished(WebServer::ConnectionAsyncInterface*, bool);
};

class FlushConnectionTask : public WebServer::ConnectionTask
{
        bool OnExecute(WebServer::Connection *webconn);
        void OnFinished(WebServer::ConnectionAsyncInterface*, bool);
};


typedef Blex::Context<EventServerWebContextData,EventServerWebContextId,EventServer> EventServerWebContext;


EventServer::EventServer(WebServer::Server &_webserver, std::string const &_eventmask)
: webserver(_webserver)
, eventmask(_eventmask)
, localmapper(globalmapper)
, stackm(localmapper)
, marshaller(stackm, HareScript::MarshalMode::SimpleOnly)
, msgvar(stackm.NewHeapVariable())
{
        EventServerWebContext::Register(webserver.GetRequestRegistrator(),this);

        Blex::MD5 md5;
        std::string serverid_data = Blex::AnyToString(Blex::DateTime::Now()) + ':' + Blex::AnyToString(Blex::GetProcessId());
        md5.Process(serverid_data.c_str(), serverid_data.size());
        const uint8_t* md5res = md5.Finalize();
        Blex::EncodeUFS(md5res, md5res + 16, std::back_inserter(serverid));

}

class EventServer::MessageCompareId
{
    public:
        inline bool operator()(EventServer::Message const *lhs, EventServer::Message const *rhs) { return lhs->id < rhs->id; }
};

void EventServer::GatherMessages(LockedData::WriteRef &lock, std::vector< std::pair< std::string, uint64_t > > const &groupids, Blex::DateTime const &now, std::vector< Message const * > *messages)
{
        for (std::vector< std::pair< std::string, uint64_t > >::const_iterator it = groupids.begin(), end = groupids.end(); it != end; ++it)
        {
                std::map< std::string, Group >::iterator git = lock->groups.find(it->first);
                if (git == lock->groups.end())
                    continue;

                std::map< uint64_t, Message >::iterator mit = git->second.messages.upper_bound(it->second), mend = git->second.messages.end();

//                Blex::ErrStream() << "Looking at group " << it->first << ", last id: " << it->second;
//                if (mit != mend)
//                    Blex::ErrStream() << "First candidate: " << mit->first;

                while (mit != mend)
                {
                        if (mit->second.expires < now)
                        {
                                lock->expiries.erase(std::make_pair(mit->second.expires, std::make_pair(it->first, mit->first)));
                                git->second.messages.erase(mit++);
                        }
                        else
                        {
                              messages->push_back(&mit->second);
                              ++mit;
                        }
                }

                if (git->second.messages.empty() && git->second.listeners.empty())
                {
                        //DEBUGPRINT(" Erase group " << git->first << ", no more messages & listeners");
                        lock->groups.erase(git);
                }
        }

        std::sort(messages->begin(), messages->end(), MessageCompareId());
}

bool EventServer::RegisterConnection(WebServer::Connection *conn, std::vector< std::pair< std::string, uint64_t > > const &groupids, Blex::DateTime const &now, bool registeraslistener, bool iseventsource)
{
        //DEBUGPRINT("Register " << conn);
        std::vector< Message const * > messages;
        uint64_t lastid = 0;

        {
                LockedData::WriteRef lock(lockeddata);

                lastid = lock->counter;
                GatherMessages(lock, groupids, now, &messages);

                if (messages.empty() && registeraslistener)
                {
                        Connection regconn;
                        regconn.groupids = groupids;
                        regconn.iseventsource = iseventsource;

                        lock->connections.insert(std::make_pair(conn, regconn));

                        for (std::vector< std::pair< std::string, uint64_t > >::const_iterator it = groupids.begin(); it != groupids.end(); ++it)
                        {
                                Group &group = lock->groups[it->first];
                                group.listeners.insert(std::make_pair(conn, it->second));
                                //DEBUGPRINT(" Registered for group " << it->first << ", now has " << group.listeners.size() << " listeners");
                        }

                        if (iseventsource)
                        {
                                const char *data = "\n";
                                conn->GetAsyncInterface()->StoreData(data, 1);

                                conn->FlushResponse(std::function< void() >());
                        }

                        return true;
                }
        }

        SendMessages(conn, messages, 0, lastid, !iseventsource, iseventsource);

        if (iseventsource)
          conn->FlushResponse(std::function< void() >());

        return iseventsource;
}

bool EventServer::UnregisterConnection(WebServer::Connection *conn)
{
        LockedData::WriteRef lock(lockeddata);
        return LockedUnregisterConnection(lock, conn);
}

bool EventServer::LockedUnregisterConnection(LockedData::WriteRef &lock, WebServer::Connection *conn)
{
        std::map< WebServer::Connection *, Connection >::iterator cit = lock->connections.find(conn);
        if (cit == lock->connections.end())
            return false;

        for (std::vector< std::pair< std::string, uint64_t > >::const_iterator grit = cit->second.groupids.begin(), grend = cit->second.groupids.end(); grit < grend; ++grit)
        {
                std::map< std::string, Group >::iterator git = lock->groups.find(grit->first);
                if (git != lock->groups.end())
                {
                        git->second.listeners.erase(conn);
                        if (git->second.listeners.empty() && git->second.messages.empty())
                            lock->groups.erase(git);
                }
        }

        lock->connections.erase(cit);
        return true;
}

void EventServer::AccessLogFunction(WebServer::Connection &conn,unsigned responsecode,uint64_t bytessent)
{
        (void)conn;(void)responsecode;(void)bytessent;
/*        if (GetLogLevel() >= Log_Statistics)
        {
                Blex::ErrStream() << conn.GetRemoteAddress()
                              << ": "
                              << conn.GetRequestParser().GetRequestLine()
                              << " "
                              << responsecode
                              << " "
                              << bytessent;
        }*/
}
void EventServer::ErrorLogFunction(Blex::SocketAddress const &remoteaddr,std::string const&error)
{
        (void)remoteaddr;(void)error;
/*        if (GetLogLevel() >= Log_Statistics)
        {
                Blex::ErrStream() << remoteaddr
                              << ": "
                              << error;
        }*/
}


void EventServer::HandleBroadcast(std::string const &event, uint8_t const *hsvmdata, unsigned hsvmdatalen)
{
        if (Blex::StrLike< std::string::const_iterator >(event.begin(), event.end(), eventmask.begin(), eventmask.end()))
        {
//                Blex::ErrStream() << "Got event " << event;

                using namespace HareScript;

                marshaller.Read(msgvar, hsvmdata, hsvmdata + hsvmdatalen);

                Blex::DateTime now = Blex::DateTime::Now();
                std::string groupid;
                Message message;
                message.id = 0;
                message.expires = now + Blex::DateTime::Minutes(5);

                if (stackm.GetType(msgvar) == VariableTypes::Record)
                {
                        std::string encoded_data;

                        ColumnNameId col_data = localmapper.GetMapping("DATA");
                        VarId var_data = stackm.RecordCellGetByName(msgvar, col_data);
                        if (var_data && stackm.GetType(var_data) == VariableTypes::String)
                        {
                                std::string const &str = stackm.GetSTLString(var_data);
                                Blex::EncodeJSON(str.begin(), str.end(), std::back_inserter(encoded_data));
                        }

                        ColumnNameId col_groupid = localmapper.GetMapping("GROUPID");
                        VarId var_groupid = stackm.RecordCellGetByName(msgvar, col_groupid);
                        if (var_groupid && stackm.GetType(var_groupid) == VariableTypes::String)
                            groupid = stackm.GetSTLString(var_groupid);

                        ColumnNameId col_tag = localmapper.GetMapping("TAG");
                        VarId var_tag = stackm.RecordCellGetByName(msgvar, col_tag);
                        if (var_tag && stackm.GetType(var_tag) == VariableTypes::String)
                            message.tag = stackm.GetSTLString(var_tag);

                        ColumnNameId col_expires = localmapper.GetMapping("EXPIRES");
                        VarId var_expires = stackm.RecordCellGetByName(msgvar, col_expires);
                        if (var_expires && stackm.GetType(var_expires) == VariableTypes::DateTime)
                            message.expires = stackm.GetDateTime(var_expires);

//                        Blex::ErrStream() << "Distributing IPC message groupid:'" << groupid << "', tag:'" << message.tag << "' data: "<< encoded_data;
                        DistributeMessage(message, groupid, encoded_data, now);
                }
        }
        else
        {
                //DEBUGPRINT("Ignore event '" << event << "', not match for '" << eventmask << "'");
        }
}

void EventServer::SendMessages(WebServer::Connection *conn, std::vector< Message const * > const &messages, uint64_t sentid, uint64_t lastid, bool async_close, bool iseventsource)
{
        DEBUGONLY(
            std::stringstream str;
            for (std::vector< Message const * >::const_iterator it = messages.begin(); it != messages.end(); ++it)
              str << "," << (*it)->id;

            //DEBUGPRINT("Sending to conn " << conn << " " << messages.size() << " messages" << str.str());
        );

        std::string msg;

        EventServerWebContext context(conn->GetRequestKeeper());
        if (iseventsource)
        {
                conn->AddHeader("Content-Type",12,"application/json",16,false);
                msg = "event: messages\ndata: ";
        }
        else
        {
                conn->AddHeader("Content-Type",12,"application/json",16,false);
        }

        msg += "{\"srvid\":\"" + serverid + "\",\"msgs\":[";

        conn->GetAsyncInterface()->StoreData(msg.c_str(), msg.size());

        for (std::vector< Message const * >::const_iterator it = messages.begin(); it != messages.end(); ++it)
        {
                bool is_first = it == messages.begin();

                // Skip the ',' in the first message
                conn->GetAsyncInterface()->StoreData((*it)->encoded_data.c_str() + is_first, (*it)->encoded_data.size() - is_first);
        }

        msg = "],\"time\":";
        Blex::DateTime now = Blex::DateTime::Now();
        uint64_t time_msecs = now.GetTimeT() * 1000 + now.GetMsecs() % 1000;
        Blex::EncodeNumber(time_msecs, 10, std::back_inserter(msg));

        if (lastid)
        {
                msg += ",\"lid\":";
                Blex::EncodeNumber(lastid, 10, std::back_inserter(msg));
        }

        if (sentid)
        {
                msg += ",\"mid\":";
                Blex::EncodeNumber(sentid, 10, std::back_inserter(msg));
        }

        msg.push_back('}');
        if (iseventsource)
            msg += "\n\n";

        conn->GetAsyncInterface()->StoreData(msg.c_str(), msg.size());

        if (async_close)
        {
                std::unique_ptr< WebServer::ConnectionTask > c_task(new CloseConnectionTask);
                conn->GetAsyncInterface()->PushTask(c_task);

                // Disable timer, could wake up after sending
                conn->SetTimer(Blex::DateTime::Invalid());
        }
        else
        {
                std::unique_ptr< WebServer::ConnectionTask > c_task(new FlushConnectionTask);
                conn->GetAsyncInterface()->PushTask(c_task);
        }
}

void EventServer::DistributeMessage(Message &message, std::string const &groupid, std::string const &encoded_data, Blex::DateTime const &now)
{
        // Prepare array of message to send (ptr, so filling of messages later on is ok)
        std::vector< Message const * > messages;
        messages.push_back(&message);

        // Reserve needed room
        message.encoded_data.reserve(
              encoded_data.size() +
              groupid.size() +
              26 + /* string parts */
              20 + /* message id */
              10 // Some extra for JSON encoding for group-id
              );

        LockedData::WriteRef lock(lockeddata);

        Group &group = lock->groups[groupid];

        Blex::FastTimer timer;
        timer.Start();

        // Clear out messages with the same tag (before we bail out on expiry!)
        if (!message.tag.empty())
        {
                //DEBUGPRINT("** Got tag '" << message.tag << "', removing messages with same tag in this group");

                // Remove all messages with the same tag
                for (std::map< uint64_t, Message >::iterator it = group.messages.begin(); it != group.messages.end();)
                {
                        if (it->second.tag == message.tag)
                        {
                                lock->expiries.erase(std::make_pair(it->second.expires, std::make_pair(groupid, it->first)));
                                group.messages.erase(it++);
                        }
                        else
                            ++it;
                }
        }
        //else DEBUGPRINT("** no tag");

        // Bail out if already expired
        //DEBUGPRINT("Start distribution for group '" << groupid << "' message " << message.id << ", expires " << Blex::AnyToString(message.expires));
        if (message.expires <= now)
        {
                //DEBUGPRINT(" Already expired, now " << Blex::AnyToString(now));
                return;
        }

        // Construct message
        message.id = ++lock->counter;
        message.encoded_data = ",{\"id\":";
        Blex::EncodeNumber(message.id, 10, std::back_inserter(message.encoded_data));
        message.encoded_data += ",\"gid\":\"";
        Blex::EncodeJSON(groupid.begin(), groupid.end(), std::back_inserter(message.encoded_data));
        message.encoded_data += "\",\"msg\":\"" + encoded_data;
        message.encoded_data += "\"}";

        group.messages.insert(std::make_pair(message.id, message));
        lock->expiries.insert(std::make_pair(message.expires, std::make_pair(groupid, message.id)));

        // Remove all expired messages
        for (std::set< std::pair< Blex::DateTime, std::pair< std::string, uint64_t > > >::iterator it = lock->expiries.begin(); it->first < now;)
        {
                std::map< std::string, Group >::iterator git = lock->groups.find(it->second.first);
                if (git != lock->groups.end())
                {
                        git->second.messages.erase(it->second.second);

                        if (git->second.messages.empty() && git->second.listeners.empty())
                        {
                                //DEBUGPRINT(" Erase group " << git->first << ", no more messages & listeners");
                                lock->groups.erase(git);
                        }
                }

                lock->expiries.erase(it++);
        }

        std::vector< WebServer::Connection * > conns;

        for (std::map< WebServer::Connection *, uint64_t >::iterator it = group.listeners.begin(); it != group.listeners.end(); ++it)
            if (it->second <= message.id)
            {
                    it->second = message.id + 1;
                    conns.push_back(it->first);
            }

        for (std::vector< WebServer::Connection * >::iterator it = conns.begin(), end = conns.end(); it != end; ++it)
        {
                //DEBUGPRINT(" Found listener " << *it);
                bool iseventsource = false;
                std::map< WebServer::Connection *, Connection >::const_iterator cit = lock->connections.find(*it);
                if (cit != lock->connections.end())
                    iseventsource = cit->second.iseventsource;

                if (!iseventsource)
                    LockedUnregisterConnection(lock, *it);

                //DEBUGPRINT(" Unregistered");
                SendMessages(*it, messages, 0, message.id, !iseventsource, iseventsource);
                //DEBUGPRINT(" Send messages");
        }

        timer.Stop();
        //DEBUGPRINT("Finished distribution, timer: " << timer << ", for " << conns.size() << " recipients");
}

void EventServer::HandleTimeout(WebServer::Connection *webcon)
{
//        Blex::ErrStream() << "Handling timeout for webcon " << webcon;

        //DEBUGPRINT("X^ reset #4");
        webcon->SetTimer(Blex::DateTime::Invalid());

        bool iseventsource = false;
        {
                LockedData::WriteRef lock(lockeddata);
                std::map< WebServer::Connection *, Connection >::const_iterator cit = lock->connections.find(webcon);
                if (cit != lock->connections.end())
                    iseventsource = cit->second.iseventsource;

                if (!LockedUnregisterConnection(lock, webcon))
                    return;
        }

        std::vector< Message const * > messages;
        SendMessages(webcon, messages, 0, 0, false, iseventsource);

        webcon->AsyncResponseDone();
        UnregisterConnection(webcon);
}

void EventServer::HandleRequest(WebServer::Connection *webcon, std::string const &)
{
        WebServer::Methods method = webcon->GetRequestParser().GetProtocolMethod();
        //DEBUGPRINT("** Handle request " << method << " " << webcon->GetRequestParser().GetReceivedUrl());
        bool is_post = false;
        bool is_eventsource = false;

        std::string const &origin = webcon->GetRequestParser().GetHeaderValue("Origin");
        if (!origin.empty())
        {
                webcon->AddHeader("Access-Control-Allow-Origin", 27, origin.c_str(), origin.size(), false);
                webcon->AddHeader("Access-Control-Allow-Headers", 28, "Content-Type", 12, false);
                webcon->AddHeader("Access-Control-Expose-Headers", 29, "Date", 4, false);
        }

        switch (method)
        {
        case WebServer::Methods::Get:
            {
                    std::string const *var_method = webcon->GetRequestParser().GetVariable("method");
                    is_post = var_method && *var_method == "post";

                    std::string const *var_eventsource = webcon->GetRequestParser().GetVariable("eventsource");
                    is_eventsource = var_eventsource && *var_eventsource == "1";
            } break;
        case WebServer::Methods::Post:
            is_post = true; break;
        default:
            webcon->FailRequest(WebServer::StatusMethodNotAllowed, "Method now allowed");
            return;
        }

        EventServerWebContext context(webcon->GetRequestKeeper());
        context->conn = webcon;

        if (is_eventsource)
            webcon->AddHeader("Content-Type",12,"text/event-stream",17,false);
        else
        {
                webcon->AddHeader("Content-Type",12,"application/json",16,false);

                std::string const *var_query = webcon->GetRequestParser().GetVariable("query");
                if (var_query && !var_query->empty())
                {
                        std::string response;
                        if (*var_query == "online")
                        {
                                LockedData::ReadRef lock(lockeddata);
                                response = "{\"online\":" + Blex::AnyToString(lock->connections.size()) + "}";
                        }
                        if (!response.empty())
                        {
                                webcon->GetAsyncInterface()->StoreData(response.c_str(), response.size());
                        }
                        else
                            webcon->FailRequest(WebServer::StatusBadRequest, "Unrecognized request");
                        return;
                }
        }

        if (is_post)
        {
                std::string var_postgroup = webcon->GetRequestParser().GetVariableValue("postgroup");
                std::string var_token = webcon->GetRequestParser().GetVariableValue("token");

                uint64_t hashid = Blex::DecodeUnsignedNumber< uint64_t >(var_token.begin(), var_token.end(), 16).first;

                char write_buf[9] = "WRIT5245";
                char read_buf[9] = "READ1*32";
                char *buf = is_post ? write_buf : read_buf;

                for (unsigned i = 0, e = var_postgroup.size(); i != e; ++i)
                    buf[i&7] ^= var_postgroup[i];

                if (hashid != Blex::getu64msb(buf))
                {
                        //DEBUGPRINT("** Wanted hash " << std::hex << Blex::getu64msb(buf) << ", got " << hashid << std::dec);
                        webcon->FailRequest(WebServer::StatusBadRequest, "Illegal hash");
                        return;
                }

                Blex::DateTime now = Blex::DateTime::Now();

                Message message;
                message.id = 0;
                message.expires = now + Blex::DateTime::Minutes(5);

                std::string encoded_data;

                std::string const *var_expires = webcon->GetRequestParser().GetVariable("expires");
                if (var_expires)
                {
                        Blex::DateTime expires = Blex::DateTime::FromText(*var_expires);
                        if (expires != Blex::DateTime::Invalid())
                            message.expires = expires;
                }
                else
                {
                        std::string const *var_ttl = webcon->GetRequestParser().GetVariable("ttl");
                        if (var_ttl)
                        {
                                unsigned ttl = Blex::DecodeUnsignedNumber< uint64_t >(var_ttl->begin(), var_ttl->end(), 10).first;
                                Blex::DateTime expires = Blex::DateTime::Now() + Blex::DateTime::Msecs(ttl);
                                message.expires = expires;
                        }
                }

                std::string const *var_tag = webcon->GetRequestParser().GetVariable("tag");
                if (var_tag)
                    message.tag = *var_tag;

                std::string rawdata;
                if (method == WebServer::Methods::Post)
                {
                        uint64_t len = webcon->GetRequestParser().GetBodyBytesReceived();
                        std::unique_ptr< Blex::RandomStream > stream(webcon->GetRequestParser().OpenBody());

                        rawdata.resize(len);

                        unsigned pos = 0;
                        while (len)
                        {
                                std::size_t bytes_read = stream->Read(&rawdata[pos], len);
                                if (bytes_read <= 0)
                                {
                                        webcon->FailRequest(WebServer::StatusInternalError, "Could not read POST body");
                                        return;
                                }
                                pos += bytes_read;
                                len -= bytes_read;
                        }
                }
                else
                {
                        std::string const *var_data = webcon->GetRequestParser().GetVariable("data");
                        if (var_data)
                            rawdata = *var_data;
                }

//                Blex::ErrStream() << "Got valid POST, tag: '"<< message.tag << "', expires: " << Blex::AnyToString(message.expires);


                Blex::EncodeJSON(rawdata.begin(), rawdata.end(), std::back_inserter(encoded_data));

//                Blex::ErrStream() << "Distributing POST message, groupid:'" << var_postgroup << "', tag:'" << message.tag << "' data: "<< encoded_data;
                DistributeMessage(message, var_postgroup, encoded_data, now);

                std::vector< Message const * > messages;
                SendMessages(webcon, messages, message.id, 0, false, false);
                return;
        }

        std::string const *var_serverid = webcon->GetRequestParser().GetVariable("sid");

        bool server_ok = var_serverid && *var_serverid == serverid;

        // Always listen to the global group
        std::vector< std::string > raw_groupids;

        uint64_t timeout = 4 * 60;

        std::string const *var_groups = webcon->GetRequestParser().GetVariable("groups");
        if (var_groups)
            Blex::Tokenize(var_groups->begin(), var_groups->end(), ',', &raw_groupids);

        std::string const *var_timeout = webcon->GetRequestParser().GetVariable("timeout");
        if (var_timeout)
            timeout = Blex::DecodeUnsignedNumber< uint64_t >(var_timeout->begin(), var_timeout->end(), 10).first;
        if (timeout > 4 * 60)
            timeout = 4 * 60;

        // Sort, to better find dups
        std::sort(raw_groupids.begin(), raw_groupids.end());

        std::vector< std::pair< std::string, uint64_t > > groupids;

        uint64_t minmessageid = 0;
        std::string const *var_lasteventid = webcon->GetRequestParser().GetHeader("Last-Event-ID");
        if (var_lasteventid)
            minmessageid = Blex::DecodeUnsignedNumber< uint64_t >(var_lasteventid->begin(), var_lasteventid->end(), 10).first;

        //DEBUGPRINT("** Register for group ids: '" << (var_groups ? *var_groups : "") << "'");

        for (std::vector< std::string >::const_iterator it = raw_groupids.begin(), end = raw_groupids.end(); it != end; ++it)
        {
                std::string::const_iterator sit = std::find(it->begin(), it->end(), '/');

                std::string groupid(it->begin(), sit);

                uint64_t lastid = 0;
                if (sit != it->end() && server_ok)
                    lastid = Blex::DecodeUnsignedNumber< uint64_t >(sit + 1, it->end(), 10).first;

                if (groupids.empty() || groupids.back().first != groupid)
                {
                      groupids.push_back(std::make_pair(groupid, std::max< uint64_t >(lastid, minmessageid)));
                      //DEBUGPRINT(" Parsed group '" << groupid << "', lastid: " << lastid << ", server_ok: " << server_ok);
                }
        }

        if (groupids.empty())
        {
                //DEBUGPRINT("** No group ids found: '" << (var_groups ? *var_groups : "") << "'");
                webcon->FailRequest(WebServer::StatusBadRequest, "Illegal hash");
                return;
        }

        Blex::DateTime now = Blex::DateTime::Now();

        if (RegisterConnection(webcon, groupids, now, timeout != 0, is_eventsource))
        {
                // Set timeout
                webcon->SetTimer(Blex::DateTime::Now() + Blex::DateTime::Seconds(timeout));

                webcon->IndicateAsyncResponseGeneration();
                webcon->SetOnTimerElapsed(std::bind(&EventServer::HandleTimeout, this, webcon));
        }
}

void EventServer::GetListenerCounts(std::string const &groupmask, std::vector< std::pair< std::string, unsigned > > *results)
{
        LockedData::ReadRef lock(lockeddata);
        if (groupmask.empty())
        {
                results->push_back(std::make_pair("", lock->connections.size()));
        }
        else
        {
                for (std::map< std::string, Group >::const_iterator it = lock->groups.begin(), end = lock->groups.end(); it != end; ++it)
                    if (Blex::StrLike< std::string::const_iterator >(it->first.begin(), it->first.end(), groupmask.begin(), groupmask.end()))
                        results->push_back(std::make_pair(it->first, it->second.listeners.size()));
        }
}

void EventServer::ClearMessages(std::string const &groupmask)
{
        LockedData::WriteRef lock(lockeddata);
        bool clearall = groupmask.empty();

        // Clearing messages won't trigger sends, so no need to do anything more
        for (std::map< std::string, Group >::iterator it = lock->groups.begin(), end = lock->groups.end(); it != end; ++it)
            if (clearall || Blex::StrLike< std::string::const_iterator >(it->first.begin(), it->first.end(), groupmask.begin(), groupmask.end()))
                it->second.messages.clear();
}


bool CloseConnectionTask::OnExecute(WebServer::Connection *webconn)
{
        webconn->AsyncResponseDone();
        return true;
}

void CloseConnectionTask::OnFinished(WebServer::ConnectionAsyncInterface*, bool)
{
}

bool FlushConnectionTask::OnExecute(WebServer::Connection *webconn)
{
        webconn->FlushResponse(std::function< void() >());
        return true;
}

void FlushConnectionTask::OnFinished(WebServer::ConnectionAsyncInterface*, bool)
{
}


EventServerBroadcastListener::EventServerBroadcastListener(WHCore::Connection &conn, EventServer &_eventserver)
: NotificationEventReceiver(conn.GetNotificationEventMgr())
, eventserver(_eventserver)
{
        Register();
}

EventServerBroadcastListener::~EventServerBroadcastListener()
{
        Unregister();
}

void EventServerBroadcastListener::ReceiveNotificationEvent(std::string const &event, uint8_t const *hsvmdata, unsigned hsvmdatalen)
{
        //DEBUGPRINT("Got broadcast event " << event);
        eventserver.HandleBroadcast(event, hsvmdata, hsvmdatalen);
}

} // End of namespace WHCore
