#ifndef blex_webhare_dbase_init
#define blex_webhare_dbase_init

#include <blex/mmapfile.h>
#include <blex/bitmanip.h>
#include "../libwebhare/dbase.h"

namespace Database
{

typedef uint32_t TransId;

class BackendTransaction;
class Backend;
class RawDatabase;
class TransStateMgr;

/** The DatabaseInitializer takes a database (fresh, old-format) and does
    the initialization needed to mount the database.

    Fresh databases get the system records inserted (system schemas and roles).
    Old databases get upgraded to the schemas and roles system. */
class DatabaseInitializer
{
        /** List of action types that the initializer must execute */
        enum DatabaseUpgradeType
        {
        None,                   ///< Nothing to do
        NewInit,                ///< Initialisation of new database
        SchemaRoleUpgrade       ///< Upgrade of old type db to schemas and roles
        };

        /** Determines which type of initialization is needed
            @return Type of needed action */
        DatabaseUpgradeType GetNeededAction(BackendTransaction &trans);

        void InitializeEmptyTranslog(std::unique_ptr< Blex::MmapFile > &logfile);

        bool IsCommittedTrans(TransStateMgr &transmgr, TransId transid);

    public:
        /** Executes initialisation of the database, and reads initial metadata. Also performs upgrades when needed.
            @param backend Backend
            @param recovery_mode Are we in recovery mode (if so, no upgrades may be done. */
        void InitializeDatabase(Backend &backend, bool recovery_mode);

        /** Executes intitialisation of the transaction log file
            @return Memory mapped file with the transaction log. */
        std::unique_ptr<Blex::MmapFile> InitializeTranslog(std::string const &logfilename, bool new_database, bool sync_enabled);
};


} // End of namespace Database

#endif
