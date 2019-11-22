#ifndef webhare_webserver_eventserver
#define webhare_webserver_eventserver

#include "webserve.h"

namespace WHCore
{

class BLEXLIB_PUBLIC EventServer
{
    private:
        EventServer(EventServer const &);
        EventServer & operator=(EventServer const &);

        WebServer::Server &webserver;

        std::string eventmask;
        std::string serverid;

        HareScript::ColumnNames::GlobalMapper globalmapper;
        HareScript::ColumnNames::LocalMapper localmapper;
        HareScript::StackMachine stackm;
        HareScript::Marshaller marshaller;
        HareScript::VarId msgvar;

        class MessageCompareId;

        struct Message
        {
                uint64_t id;
                std::string tag;
                std::string encoded_data; // Encoded as ",'(json-encoded message)'"
                Blex::DateTime expires;
        };

        struct Group
        {
                std::string groupid;

                std::map< WebServer::Connection *, uint64_t > listeners;

                std::map< uint64_t, Message > messages;
        };

        struct Connection
        {
                std::vector< std::pair< std::string, uint64_t > > groupids;
                bool iseventsource;
        };

        struct Data
        {
                Data() : counter(0) {}

                uint64_t counter;

                /// List of groups (group '' is for global messages)
                std::map< std::string, Group > groups;

                /// List of currently listening connections (erased when message is sent)
                std::map< WebServer::Connection *, Connection > connections;

                std::set< std::pair< Blex::DateTime, std::pair< std::string, uint64_t > > > expiries;
        };

        typedef Blex::InterlockedData<Data, Blex::ConditionMutex> LockedData;

        LockedData lockeddata;

        void HandleTimeout(WebServer::Connection *webcon);
        void DistributeMessage(Message &message, std::string const &groupid, std::string const &encoded_data, Blex::DateTime const &now);
        void SendMessages(WebServer::Connection *conn, std::vector< Message const * > const &messages, uint64_t sentid, uint64_t lastid, bool async_close, bool iseventsource);

        void GatherMessages(LockedData::WriteRef &lock, std::vector< std::pair< std::string, uint64_t > > const &groupids, Blex::DateTime const &now, std::vector< Message const * > *messages);
        Message * FindFirstMessage(LockedData::WriteRef &lock, std::string const &groupid, uint64_t minid, Blex::DateTime const &now);

    public:

        EventServer(WebServer::Server &webserver, std::string const &eventmask);

        void HandleBroadcast(std::string const &event, uint8_t const * /*hsvmdata*/, unsigned /*hsvmdatalen*/);
        void HandleRequest(WebServer::Connection *webcon, std::string const &path);

        bool RegisterConnection(WebServer::Connection *conn, std::vector< std::pair< std::string, uint64_t > > const &group, Blex::DateTime const &now, bool registeraslistener, bool iseventsource);
        bool UnregisterConnection(WebServer::Connection *conn);
        bool LockedUnregisterConnection(LockedData::WriteRef &lock, WebServer::Connection *conn);

        static void AccessLogFunction(WebServer::Connection &conn,unsigned responsecode,uint64_t bytessent);
        static void ErrorLogFunction(Blex::SocketAddress const &remoteaddr,std::string const&error);

        void GetListenerCounts(std::string const &groupmask, std::vector< std::pair< std::string, unsigned >  > *results);
        void ClearMessages(std::string const &groupmask);
};


class BLEXLIB_PUBLIC EventServerBroadcastListener : public Blex::NotificationEventReceiver
{
    public:
        EventServerBroadcastListener(WHCore::Connection &conn, EventServer &eventserver);
        ~EventServerBroadcastListener();

        void ReceiveNotificationEvent(std::string const &event, uint8_t const *hsvmdata, unsigned hsvmdatalen);

    private:
        /// IndexManager link
        EventServer &eventserver;
};


} //End of namespace WHCore

#endif
