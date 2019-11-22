#include <ap/libwebhare/allincludes.h>


#include "dbase_init.h"
#include "dbase_meta.h"
#include "dbase_backend.h"
#include "dbase_trans.h"
#include "dbase_transaction.h"
#include "dbase_diskio.h"
#include <blex/logfile.h>

/* This file contains initialization and upgrade code.
   Currently supported:
   - Initialization of empty translog
   - Upgrade for translog v2 to translog v3 (from 2 to 4 ranges)
   - Initialization of empty database
   - Upgrade of database to support schemas and roles */

namespace Database
{

DatabaseInitializer::DatabaseUpgradeType DatabaseInitializer::GetNeededAction(BackendTransaction &trans)
{
        bool has_objects;
        bool has_tables;
        {
                Scanner scan(trans, ShowNormalSkipAccess, false);
                scan.AddTable(TableId_MetaObjects);
                has_objects = scan.NextRow();
        }
        {
                Scanner scan(trans, ShowNormalSkipAccess, false);
                scan.AddTable(TableId_MetaTables);
                has_tables = scan.NextRow();
        }
        if (has_objects)
             return None;
        else
            if (has_tables)
                return SchemaRoleUpgrade;
            else
                return NewInit;
}

void DatabaseInitializer::InitializeDatabase(Backend &backend, bool recovery_mode)
{
        MetadataManager &metamgr = backend.GetMetadataManager();

        MetadataManager::Ref meta(metamgr);

        // Open new transaction (system transaction, no need to login)
        BackendTransactionRef trans(
                backend.BeginTransaction("~internal","","database", "Database initialization"));

        if (!recovery_mode)
        {
                // Get type of upgrade that is needed
                DatabaseUpgradeType action = GetNeededAction(*trans);

                switch (action)
                {
                case None:      break;
                case NewInit:
                    {
                    } break;
                case SchemaRoleUpgrade:
                    {
                        Blex::ErrStream() << "Database needs to be upgraded to support schemas and roles. Install WebHare v2.33 or earlier first";
                        throw std::runtime_error("This version of WebHare cannot upgrade your database format");
                    } break;
                }
        }

        // Read metadata, all metadata (including privilege/owner info) should be consistent now
        metamgr.ReadMetadata(&*trans);

        // Finish the transaction, we're done
        backend.FinishTransaction(&*trans, true);
}

bool DatabaseInitializer::IsCommittedTrans(TransStateMgr &transmgr, TransId transid)
{
        if (transid == TransStateMgr::AlwaysCommitted)
            return true;
        else if (transid == TransStateMgr::NeverCommitted)
            return false;

        TransStateMgr::TransStatus status = transmgr.GetStatus(transid, 0);
        return (status == TransStateMgr::GlobalCommitted || status == TransStateMgr::LocalCommitted);
}


} // End of namespace Database
