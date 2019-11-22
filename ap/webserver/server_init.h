#ifndef blex_webhare_server_server_init
#define blex_webhare_server_server_init

class Shtml;
class WebHareServer;

#include <blex/logfile.h>
#include <blex/threads.h>
#include <ap/libwebhare/whcore.h>
#include "shtml.h"
#include <ap/libwebhare/eventserver.h>

class WebHareServer
{
        public:
        WebHareServer();
        ~WebHareServer();

        void FlushCache();

        /** Scan the configuration databases and configure the webserver.
            Callback for the notify thread */
        void ScanConfig(bool reconnected);

        int Execute(std::vector<std::string> const &args);

        ///Get the wh connection
        WHCore::Connection &GetWHConn() { return *webhare; }

        ///Get the web server dispatcher
        WebServer::Server& GetWebServer() { return *webserver; }

        /// Get the event server
        WHCore::EventServer & GetEventServer() { return *eventserver; }

        ///Shut down subthreads
        void Shutdown();

        void LoadConfig(HSVM *vm, HSVM_VariableId retval, HSVM_VariableId config);

        private:
        void TryScanConfig(bool reconnected);

        void FlushLogFiles();
        void MaintenanceThreadCode();

        void AccessLogFunction(WebServer::Connection&,unsigned,uint64_t);
        void ErrorLogFunction(Blex::SocketAddress const &remoteaddr, std::string const&);
        void ErrorLog(std::string const &error);

        bool StartManagementScript();
        void ManagementScriptTerminated(HareScript::VMGroup *group);
        void LogManagementScriptErrors(HareScript::VMGroup *group);

        class ServerNotify : public Database::AsyncThread
        {
                public:
                ServerNotify(WebHareServer *_server,
                             Database::TCPFrontend &dbase)
                : Database::AsyncThread(Database::NotificationRequests(), "webserver", dbase)
                , server(_server)
                {
                        StartConnecting();
                }

                void ReceiveTell(Database::Record data);
                void NotifyConnected();
                void NotifyDisconnected();

                private:
                WebHareServer *server;
        };

        std::unique_ptr<WHCore::Connection> webhare;
        std::unique_ptr<WebServer::Server> webserver;
        std::unique_ptr<WHCore::EventServer> eventserver;
        std::unique_ptr< WHCore::EventServerBroadcastListener > eventserverlistener;
        std::unique_ptr<Shtml> shtml;
        std::unique_ptr<ServerNotify> servernotify;
        std::unique_ptr< HareScript::JobManager > jobmgr;
        std::unique_ptr< WHCore::JobManagerIntegrator > jobmgrintegrator;

        Blex::Logfile accesslog;

        Blex::Logfile errorlog;

        enum ToDo
        {
                Stop
        };

        struct SharedData
        {
                bool must_stop;
                std::string indexpages;
        };

        typedef Blex::InterlockedData<SharedData, Blex::ConditionMutex> LockedData;
        LockedData state;

        ToDo GetTask();
        friend class ServerNotify;
        Blex::Thread maintenancethread;
        uint16_t onlyinterfaceport;

        unsigned config_notifyid;
        unsigned users_notify_id;
};

//---------------------------------------------------------------------------
#endif
