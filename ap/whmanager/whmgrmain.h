#ifndef blex_webhare_whmanager_whmgrmain
#define blex_webhare_whmanager_whmgrmain

#include <blex/dispat.h>

class Connection;
class WHManager;

#include <ap/libwebhare/whcore.h>

class NamedPort
{
    public:
        NamedPort(Connection *conn, std::string const &name);
        ~NamedPort();

        Connection *conn;
        std::string name;
};

class Link
{
    public:
        Connection *init;
        Connection *target;

        uint64_t locallinkid;

        uint32_t init_linkid;
        uint32_t target_linkid;

        std::pair< Connection *, uint32_t > GetOther(Connection *me, uint32_t mylinkid);
};

class Connection : public Database::RPCConnection
{
    public:
        Connection(WHManager *manager, void*data);
        ~Connection();

        WHManager *manager;

        inline uint32_t GetNewLinkId() { return ++linkcounter; }
        inline void RegisterLink(uint32_t targetid, uint64_t localid) { remotetolocalid.insert(std::make_pair(targetid, localid)); }
        inline void UnregisterLink(uint32_t targetid) { remotetolocalid.erase(targetid); }

    private:
        void CleanUpConnection();
        void BroadcastSystemConfig();

        void HookIncomingConnection();
        void HookPrepareForUse();
        void HookDisconnectReceived(Blex::Dispatcher::Signals::SignalType signal);
        Database::RPCResponse::Type HookSignalled(Database::IOBuffer *iobuf);
        Database::RPCResponse::Type HookTimeOut(Database::IOBuffer *iobuf, bool fatal);
        Database::RPCResponse::Type HookHandleMessage(Database::IOBuffer *iobuf);

        Database::RPCResponse::Type RemoteSendEvent(Database::IOBuffer *iobuf);
        Database::RPCResponse::Type RemoteRegisterPort(Database::IOBuffer *iobuf);
        Database::RPCResponse::Type RemoteUnregisterPort(Database::IOBuffer *iobuf);
        Database::RPCResponse::Type RemoteConnectLink(Database::IOBuffer *iobuf);
        Database::RPCResponse::Type RemoteDisconnectLink(Database::IOBuffer *iobuf);
        Database::RPCResponse::Type RemoteSendMessageOverLink(Database::IOBuffer *iobuf);
        Database::RPCResponse::Type RemoteOpenLinkResult(Database::IOBuffer *iobuf);
        Database::RPCResponse::Type RemoteRegisterProcess(Database::IOBuffer *iobuf);
        Database::RPCResponse::Type RemoteGetProcessList(Database::IOBuffer *iobuf);
        Database::RPCResponse::Type RemoteConfigureLogs(Database::IOBuffer *iobuf);
        Database::RPCResponse::Type RemoteLog(Database::IOBuffer *iobuf);
        Database::RPCResponse::Type RemoteDisconnect(Database::IOBuffer *iobuf);
        Database::RPCResponse::Type RemoteFlushLog(Database::IOBuffer *iobuf);
        Database::RPCResponse::Type RemoteSetSystemConfig(Database::IOBuffer *iobuf);

        std::string GetRequestOpcodeName(uint8_t code);
        std::string GetResponseOpcodeName(uint8_t code);

        std::map< std::string, std::shared_ptr< NamedPort > > ports;
        std::map< uint32_t, uint64_t > remotetolocalid;
        uint32_t linkcounter;
        uint64_t processcode;

    public:
        void DumpRemoteToLocalId(std::string const &comment);
};

class EventTask : public Database::RPCTask
{
    public:
        inline EventTask(Connection *_target) : target(_target) { }
        Connection *target;
        std::string eventname;
        Blex::PodVector< uint8_t > msg;

        Database::RPCResponse::Type HookExecuteTask(Database::IOBuffer *iobuf, bool *is_finished);
        Database::RPCResponse::Type HookTaskFinished(Database::IOBuffer *iobuf, bool success);
};

class LinkOpenedTask : public Database::RPCTask
{
    public:
        inline LinkOpenedTask(Connection *_target) : target(_target) { }

        Connection *target;
        uint64_t locallinkid;
        std::string portname;
        uint64_t msgid;

        Database::RPCResponse::Type HookExecuteTask(Database::IOBuffer *iobuf, bool *is_finished);
        Database::RPCResponse::Type HookTaskFinished(Database::IOBuffer *iobuf, bool success);
};

class LinkClosedTask : public Database::RPCTask
{
    public:
        inline LinkClosedTask(Connection *_target) : target(_target) { }

        Connection *target;
        uint32_t targetlinkid;

        Database::RPCResponse::Type HookExecuteTask(Database::IOBuffer *iobuf, bool *is_finished);
        Database::RPCResponse::Type HookTaskFinished(Database::IOBuffer *iobuf, bool success);
};

class LinkEstablishedTask : public Database::RPCTask
{
    public:
        inline LinkEstablishedTask() : target(0) { }

        Connection *target;
        uint32_t targetlinkid;
        uint64_t replyto;
        bool success;

        Database::RPCResponse::Type HookExecuteTask(Database::IOBuffer *iobuf, bool *is_finished);
        Database::RPCResponse::Type HookTaskFinished(Database::IOBuffer *iobuf, bool success);
};



class MessageTask : public Database::RPCTask
{
    public:
        inline MessageTask() : target(0) { }

        Connection *target;
        uint32_t targetlinkid;
        uint64_t msgid;
        uint64_t replyto;
        bool lastpart;
        Blex::PodVector< uint8_t > msg;

        Database::RPCResponse::Type HookExecuteTask(Database::IOBuffer *iobuf, bool *is_finished);
        Database::RPCResponse::Type HookTaskFinished(Database::IOBuffer *iobuf, bool success);
};


class SystemConfigTask : public Database::RPCTask
{
    public:
        inline SystemConfigTask(Connection *_target, bool _have_debugger, std::shared_ptr< Blex::PodVector< uint8_t > > _config) : target(_target), have_debugger(_have_debugger), config(_config) { }
        Connection *target;
        bool have_debugger;
        std::shared_ptr< Blex::PodVector< uint8_t > > config;

        Database::RPCResponse::Type HookExecuteTask(Database::IOBuffer *iobuf, bool *is_finished);
        Database::RPCResponse::Type HookTaskFinished(Database::IOBuffer *iobuf, bool success);
};

class LogFlusher;

class WHManager
{
    public:
        WHManager();
        ~WHManager();

        int Execute (std::vector<std::string> const &args);

        void FLushLogs();

    private:
        Blex::Dispatcher::Connection *CreateConnection(void *data);
        void SetNewLogConfiguration(std::vector< WHCore::LogConfig > const &newconfig, std::vector< bool > *results);

        Blex::Dispatcher::Dispatcher dispatcher;

        class RegisteredProcess
        {
            public:
                uint64_t code;
                std::string name;
                std::map< std::string, std::string > parameters;
        };

        class LogFileData
        {
            public:
                WHCore::LogConfig config;
                std::shared_ptr< Blex::Logfile > logfile;
        };

        class Data
        {
            public:
                Data() : linkidcounter(0), processcodecounter(0) { }

                uint64_t linkidcounter;
                uint64_t processcodecounter;

                std::shared_ptr< Blex::PodVector< uint8_t > > systemconfig;

                std::set< Connection * > connections;

                std::map< std::string, NamedPort * > ports;

                std::map< uint64_t, std::shared_ptr< Link > > links;

                std::map< uint64_t, RegisteredProcess > processes;
        };

        class LogData
        {
            public:
                LogData() : abort_flushthread(false) { }

                bool abort_flushthread;
                std::map< std::string, LogFileData > logs;
        };

        typedef Blex::InterlockedData< Data, Blex::Mutex > LockedData;
        typedef Blex::InterlockedData< LogData, Blex::ConditionMutex > LockedLogData;

        LockedData data;
        LockedLogData logdata;

        friend class Connection;
        friend class LinkOpenedTask;
        friend class LinkClosedTask;
        friend class MessageTask;
        friend class LogFlusher;
};

#endif
