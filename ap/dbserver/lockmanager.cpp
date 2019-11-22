#include <ap/libwebhare/allincludes.h>


#include "lockmanager.h"
#include "dbase_rpcserver.h"
#include "dbase_transaction.h"

//#define VERBOSE_LOGGING

#if defined(DEBUG) && defined(VERBOSE_LOGGING)
 #define VLDEBUG(x) DEBUGPRINT("Locking: " << x)
#else
 #define VLDEBUG(x) BLEX_NOOP_STATEMENT
#endif

namespace Database
{

/* Multithreading problems/race conditions:

   The following functions are part of the public interface.
   1. RegisterTransaction(BackendTransaction *trans);
   2. SetTransactionConnection(BackendTransaction *trans, Connection *conn);
   3. IndicateWait(TransId trans, TransId waiting_for, bool must_signal);
   4. UnregisterTransaction(BackendTransaction *trans);

   SetTransactionConnection and IndicateWait must be called within the Register/
   Unregister pair, within the same thread and thus there are no problems with
   administration of the data of a specific transaction.

   The only problem arises in the interaction of IndicateWait of transaction B
   and UnregisterTransaction of that transaction. IndicateWait is called after
   the id of transaction B has been found. It is possible transaction B has
   finished between gfinding out the id and giving notice to the lockmanager.

   IndicateWait checks if the transaction it waits for still exists, if not it
   immediately signals the transaction that is waiting (if it has permision, that
   is) */

LockManager::Trans::Trans(BackendTransaction *_trans)
: trans_id(_trans->GetTransId())
, trans(_trans)
, conn(0)
, waiting_for(0)
, must_signal(false)
{
}

void LockManager::RegisterTransaction(BackendTransaction *trans)
{
        LockedData::WriteRef(lockeddata)->active_list.insert(Trans(trans));
        VLDEBUG("Register transaction " << trans->GetTransId());
}

void LockManager::SetTransactionConnection(BackendTransaction *trans, Connection *conn)
{
        LockedData::WriteRef data(lockeddata);

        Trans &trans_data = Find(*data, trans);
        trans_data.conn = conn;
}


void LockManager::UnregisterTransaction(BackendTransaction *trans)
{
        LockedData::WriteRef data(lockeddata);

        std::set< Trans >::iterator it = data->active_list.find(Trans(trans));

        // We don't mind double unregistration (ADDME: Why not? if a double deregister happened, the other trnansactions were informed too soon?)
        if (it == data->active_list.end())
            return;

        VLDEBUG("Unregister transaction " << trans->GetTransId());

        // Signal all transactions that are waiting for this one
        for (std::set< Trans >::iterator wit = data->active_list.begin(); wit != data->active_list.end(); ++wit)
            if (wit != it && wit->waiting_for == &*it)
            {
                    // Always set waiting_for to 0, to make sure no stale transid are left
                    const_cast<Trans&>(*wit).waiting_for = 0;

                    //FIXME: Must use a map if data must be changed (and not use incomplete less operators, which let these bugs slip through)
                    if (wit->conn && wit->must_signal)
                    {
                            VLDEBUG(" Signalling transaction " << wit->trans_id);
                            wit->conn->AsyncSignal();
                    }
            }

        data->active_list.erase(it);
}

LockManager::Trans * LockManager::Find(Data &data, TransId trans_id)
{
        std::set< Trans >::iterator it = data.active_list.find(Trans(trans_id));
        if (it != data.active_list.end())
            return const_cast<LockManager::Trans*>(&*it); //FIXME!
        return 0;
}

LockManager::Trans & LockManager::Find(Data &data, BackendTransaction *trans)
{
        LockManager::Trans *transdata = Find(data, trans->GetTransId());
        if (!transdata)
            throw Exception(ErrorInternal, "Found unregistered transaction " + Blex::AnyToString(trans->GetTransId()) + " in lockmanager");
        return *transdata;
}

void LockManager::IndicateWait(TransId trans, TransId waiting_for, bool must_signal, TableId tableid, RecordId recordid)
{
        LockedData::WriteRef data(lockeddata);

        VLDEBUG("Transaction " << trans << " waiting for " << waiting_for);

        Trans *my_data = Find(*data, trans);
        if (!my_data)
            throw Exception(ErrorInternal, "Indicating wait for unregistered transaction " + Blex::AnyToString(trans) + " in lockmanager");

        // Search for transaction we're going to wait for
        Trans *waiting_for_trans = Find(*data, waiting_for);
        if (!waiting_for_trans)
        {
                // Transaction trans waits for is already gone. Do for immediate signal.
                if (my_data->conn && must_signal)
                {
                        VLDEBUG("Transaction " << trans << " signalling self, transaction " << waiting_for << " has vanished");
                        my_data->waiting_for = 0;
                        my_data->conn->AsyncSignal();
                }
                return;
        }

        // Check if trans is already waiting; may be waiting on noone, or the one we are already waiting for
        if (my_data->waiting_for != 0 && my_data->waiting_for != waiting_for_trans)
            throw Exception(ErrorInternal, "Double wait detected in lock manager");

        // Administer waiting stuff
        my_data->waiting_for = waiting_for_trans;
        my_data->must_signal = must_signal;

        /* Recurse through waiting_fors, if we find ourselves we have found a
           cycle, and thus a deadlock */
        Trans *current = waiting_for_trans;
        while (current != 0 && current != my_data)
            current = current->waiting_for;

        if (current == my_data)
        {
                // This wait causes a deadlock, reverse it.
                VLDEBUG("Wait causes deadlock, aborting transaction");
                my_data->waiting_for = 0;
                throw Exception(ErrorDeadlock, "Requested lock would cause deadlock (" + Blex::AnyToString(tableid) + " " + Blex::AnyToString(recordid) + ", trans=" + Blex::AnyToString(trans) + " origtrans=" + Blex::AnyToString(waiting_for) + ")");
        }
}

void LockManager::IndicateWaitEnd(TransId trans)
{
        LockedData::WriteRef data(lockeddata);

        Trans *my_data = Find(*data, trans);
        if (!my_data)
            throw Exception(ErrorInternal, "Indicating wait end for unregistered transaction " + Blex::AnyToString(trans) + " in lockmanager");

        if (my_data->waiting_for)
            VLDEBUG("Transaction " << trans << " not waiting anymore");

        // We don't have to be waiting, because the transaction we were waiting for has probably vanished. Setting to zero is still a good idea.
        my_data->waiting_for = 0;
}

TransId LockManager::IsTransactionWaiting(TransId trans)
{
        LockedData::WriteRef data(lockeddata);

        Trans *my_data = Find(*data, trans);
        if (!my_data)
            return 0;
        if (my_data->waiting_for)
            return my_data->waiting_for->trans_id;
        return 0;
}




} // End of namespace Database



