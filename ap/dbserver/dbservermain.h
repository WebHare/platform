#ifndef blex_webhare_dbase_dbservermain
#define blex_webhare_dbase_dbservermain

#include <blex/threads.h>
#include <blex/socket.h>
#include <blex/dispat.h>
#include "dbase_backend.h"
#include "dbase_rpcserver.h"

class DBServer;
class RemoteConnection;
class MainDatabase;

/** The DBServer is the main application class itself. */
class DBServer
{
        public:
        DBServer();
        ~DBServer();

        int Execute(std::vector< std::string > const &args);

        Database::Plugins plugins;

        std::unique_ptr< Database::Backend > backend;
        std::unique_ptr< Database::ConnectionManager > connmgr;

        Blex::Dispatcher::Dispatcher dispatcher;

        private:
        bool RunServer(bool recovery_mode);

        Blex::Dispatcher::Connection* CreateConnection(void *disp);

        Blex::SocketAddress dbaseaddr;
        std::string basedbasefolder;
        std::string recordfolder;
        std::string indexfolder;
        unsigned janitor_maxwait;
        bool nojanitor;
        bool savedeletedblobs;
        bool logtrans;
        bool noindex;
        bool sync;

};

//---------------------------------------------------------------------------
#endif
