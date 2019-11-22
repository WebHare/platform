//---------------------------------------------------------------------------
#include <ap/libwebhare/allincludes.h>


//ADDME: Test other modes than ,ShowNormal
#include <blex/testing.h>
#include <ap/dbserver/dbase_trans.h>

using namespace Database;
extern bool deep_testing;

struct MyTrans
{
        MyTrans(Database::TransId _id, bool _commit)
        : id(_id), commit(_commit)
        {
        }

        Database::TransId id;
        bool commit;
};

const std::unique_ptr<Database::TransStateMgr> trans_mgr;

void OpenTransLog()
{
        try
        {
                trans_mgr.reset(new Database::TransStateMgr(Blex::Test::GetTempDir(), true, false));
        }
        catch (Exception &)
        {
                // Opening a new translog failed, try to open existing
                trans_mgr.reset(new Database::TransStateMgr(Blex::Test::GetTempDir(), false, false));
        }
}
void CloseTransLog()
{
        trans_mgr.reset(NULL);
}

void Trans_SimpleStatusTest()
{
        const std::unique_ptr<IdentifiedTrans> trans;
        TransId id[4];

        // 0: test rollback, never written, transaction
        trans.reset(new IdentifiedTrans(*trans_mgr));
        id[0]=trans->GetTransId();
        trans.reset(NULL);

        // 1: test rollback, written transaction
        trans.reset(new IdentifiedTrans(*trans_mgr));
        id[1]=trans->GetTransId();
        trans->PrepareForWrite();
        trans.reset(NULL);

        // 2: test committed, never written transaction
        trans.reset(new IdentifiedTrans(*trans_mgr));
        id[2]=trans->GetTransId();
        trans->MarkTransactionCommitted();
        trans.reset(NULL);

        // 3: test committed, written transaction
        trans.reset(new IdentifiedTrans(*trans_mgr));
        id[3]=trans->GetTransId();
        trans->PrepareForWrite();
        trans->MarkTransactionCommitted();
        trans.reset(NULL);

        BLEX_TEST_CHECK(id[0] != TransStateMgr::NeverCommitted);
        BLEX_TEST_CHECK(id[0] != TransStateMgr::AlwaysCommitted);

        BLEX_TEST_CHECK(trans_mgr->GetStatus(id[0], 0) == TransStateMgr::GlobalRolledBack);
        BLEX_TEST_CHECK(trans_mgr->GetStatus(id[1], 0) == TransStateMgr::GlobalRolledBack);
        BLEX_TEST_CHECK(trans_mgr->GetStatus(id[2], 0) == TransStateMgr::GlobalRolledBack);
        BLEX_TEST_CHECK(trans_mgr->GetStatus(id[3], 0) == TransStateMgr::GlobalCommitted);
/*
        // No permanent answers yet
        BLEX_TEST_CHECK(trans_mgr->GetStatus(id[0], 0) == TransStateMgr::LocalRolledBack);
        BLEX_TEST_CHECK(trans_mgr->GetStatus(id[1], 0) == TransStateMgr::LocalRolledBack);
        BLEX_TEST_CHECK(trans_mgr->GetStatus(id[2], 0) == TransStateMgr::LocalRolledBack);
        BLEX_TEST_CHECK(trans_mgr->GetStatus(id[3], 0) == TransStateMgr::LocalCommitted);
*/
        trans_mgr->SwitchToNextTransactionRange();
        // Now permanent answers!
/*        BLEX_TEST_CHECK(trans_mgr->GetStatus(id[0], 0) == TransStateMgr::PermanentlyRolledBack);
        BLEX_TEST_CHECK(trans_mgr->GetStatus(id[1], 0) == TransStateMgr::PermanentlyRolledBack);
        BLEX_TEST_CHECK(trans_mgr->GetStatus(id[2], 0) == TransStateMgr::PermanentlyRolledBack);
        BLEX_TEST_CHECK(trans_mgr->GetStatus(id[3], 0) == TransStateMgr::PermanentlyCommitted);*/
        BLEX_TEST_CHECK(trans_mgr->GetStatus(id[0], 0) == TransStateMgr::GlobalRolledBack);
        BLEX_TEST_CHECK(trans_mgr->GetStatus(id[1], 0) == TransStateMgr::GlobalRolledBack);
        BLEX_TEST_CHECK(trans_mgr->GetStatus(id[2], 0) == TransStateMgr::GlobalRolledBack);
        BLEX_TEST_CHECK(trans_mgr->GetStatus(id[3], 0) == TransStateMgr::GlobalCommitted);

        CloseTransLog();
        OpenTransLog();

        BLEX_TEST_CHECK(id[0] != TransStateMgr::NeverCommitted);
        BLEX_TEST_CHECK(id[0] != TransStateMgr::AlwaysCommitted);
/*        BLEX_TEST_CHECK(trans_mgr->GetStatus(id[0], 0) == TransStateMgr::PermanentlyRolledBack);
        BLEX_TEST_CHECK(trans_mgr->GetStatus(id[1], 0) == TransStateMgr::PermanentlyRolledBack);
        BLEX_TEST_CHECK(trans_mgr->GetStatus(id[2], 0) == TransStateMgr::PermanentlyRolledBack);
        BLEX_TEST_CHECK(trans_mgr->GetStatus(id[3], 0) == TransStateMgr::PermanentlyCommitted);*/
        BLEX_TEST_CHECK(trans_mgr->GetStatus(id[0], 0) == TransStateMgr::GlobalRolledBack);
        BLEX_TEST_CHECK(trans_mgr->GetStatus(id[1], 0) == TransStateMgr::GlobalRolledBack);
        BLEX_TEST_CHECK(trans_mgr->GetStatus(id[2], 0) == TransStateMgr::GlobalRolledBack);
        BLEX_TEST_CHECK(trans_mgr->GetStatus(id[3], 0) == TransStateMgr::GlobalCommitted);

        //4 test retention of 'current' range
        BLEX_TEST_CHECK(!trans_mgr->IsRangeUsed(0));
        BLEX_TEST_CHECK(trans_mgr->IsRangeUsed(1));
        BLEX_TEST_CHECK(!trans_mgr->IsRangeUsed(2));
        BLEX_TEST_CHECK(!trans_mgr->IsRangeUsed(3));
        //move to 'upper' range
        trans_mgr->SwitchToNextTransactionRange();
        //clear the lower range
        trans_mgr->ClearRange(false);
        //ensure only upper range is used now
        BLEX_TEST_CHECK(!trans_mgr->IsRangeUsed(0));
        BLEX_TEST_CHECK(!trans_mgr->IsRangeUsed(1));
        BLEX_TEST_CHECK(trans_mgr->IsRangeUsed(2));
        BLEX_TEST_CHECK(!trans_mgr->IsRangeUsed(3));
        //reopen transaction log
        CloseTransLog();
        OpenTransLog();
        //ensure only upper range is used now
        BLEX_TEST_CHECK(!trans_mgr->IsRangeUsed(0));
        BLEX_TEST_CHECK(!trans_mgr->IsRangeUsed(1));
        BLEX_TEST_CHECK(trans_mgr->IsRangeUsed(2));
        BLEX_TEST_CHECK(!trans_mgr->IsRangeUsed(3));
}

void Trans_NestedTransactionTest()
{
        const std::unique_ptr<IdentifiedTrans> outer_trans(new IdentifiedTrans(*trans_mgr));
        TransId outer_id=outer_trans->GetTransId();

        const std::unique_ptr<IdentifiedTrans> middle_trans(new IdentifiedTrans(*trans_mgr));
        TransId middle_id=middle_trans->GetTransId();

        //Now commit outer..
        outer_trans->PrepareForWrite();
        outer_trans->MarkTransactionCommitted();
        outer_trans.reset(NULL);

        const std::unique_ptr<IdentifiedTrans> inner_trans(new IdentifiedTrans(*trans_mgr));
        TransId inner_id=inner_trans->GetTransId();

        //Test that they were all created properly, and do general visibility tests..
        BLEX_TEST_CHECK(trans_mgr->GetStatus(outer_id, 0) == TransStateMgr::LocalCommitted);
        BLEX_TEST_CHECK(trans_mgr->GetStatus(middle_id, 0) == TransStateMgr::Busy);
        BLEX_TEST_CHECK(trans_mgr->GetStatus(inner_id, 0) == TransStateMgr::Busy);

        BLEX_TEST_CHECK(inner_trans->GetTransVisibility(TransStateMgr::AlwaysCommitted,ShowNormal) == TransStateMgr::GlobalCommitted);
        BLEX_TEST_CHECK(middle_trans->GetTransVisibility(TransStateMgr::NeverCommitted,ShowNormal) == TransStateMgr::GlobalRolledBack);
        BLEX_TEST_CHECK(inner_trans->GetTransVisibility(TransStateMgr::NeverCommitted,ShowNormal) == TransStateMgr::GlobalRolledBack);

        //Start testing their visiblity to themselves and each other
        BLEX_TEST_CHECK(middle_trans->GetTransVisibility(outer_id,ShowNormal) == TransStateMgr::LocalRolledBack);
        BLEX_TEST_CHECK(middle_trans->GetTransVisibility(middle_id,ShowNormal) == TransStateMgr::LocalCommitted);
        BLEX_TEST_CHECK(middle_trans->GetTransVisibility(inner_id,ShowNormal) == TransStateMgr::LocalRolledBack);

        //Roll back the inner transaction, and check the other visibilites
        inner_trans.reset(NULL);

        BLEX_TEST_CHECK(middle_trans->GetTransVisibility(outer_id,ShowNormal) == TransStateMgr::LocalRolledBack);
        BLEX_TEST_CHECK(middle_trans->GetTransVisibility(middle_id,ShowNormal) == TransStateMgr::LocalCommitted);
        BLEX_TEST_CHECK(middle_trans->GetTransVisibility(inner_id,ShowNormal) == TransStateMgr::LocalRolledBack);

        //Open a new inner transaction.
        const std::unique_ptr<IdentifiedTrans> new_inner_trans(new IdentifiedTrans(*trans_mgr));
        TransId new_inner_id=new_inner_trans->GetTransId();

        //Check the relationship between the existing transaction and the new dude
        BLEX_TEST_CHECK(middle_trans->GetTransVisibility(new_inner_id,ShowNormal) == TransStateMgr::LocalRolledBack);
        //outer_id should be NOW committed, because it still has referrers
        BLEX_TEST_CHECK(new_inner_trans->GetTransVisibility(outer_id,ShowNormal) == TransStateMgr::LocalCommitted);
        BLEX_TEST_CHECK(new_inner_trans->GetTransVisibility(middle_id,ShowNormal) == TransStateMgr::LocalRolledBack);
        //inner_id should be global rolled back, because noone ever can see it as committed
        BLEX_TEST_CHECK(new_inner_trans->GetTransVisibility(inner_id,ShowNormal) == TransStateMgr::GlobalRolledBack);

        //Let's now commit middle trans and see what happens...
        middle_trans->PrepareForWrite();
        middle_trans->MarkTransactionCommitted();
        middle_trans.reset(NULL);

        BLEX_TEST_CHECK(new_inner_trans->GetTransVisibility(outer_id,ShowNormal) == TransStateMgr::GlobalCommitted);
        BLEX_TEST_CHECK(new_inner_trans->GetTransVisibility(middle_id,ShowNormal) == TransStateMgr::LocalRolledBack);
        //This transaction will be _NOW_ rolled back, because no transaction with id inner_id,
        //or higher than inner_id, will have called PrepareForWrite().
        BLEX_TEST_CHECK(new_inner_trans->GetTransVisibility(inner_id,ShowNormal) == TransStateMgr::GlobalRolledBack);

        // Switch to next transaction range
        trans_mgr->SwitchToNextTransactionRange();
        BLEX_TEST_CHECK(new_inner_trans->GetTransVisibility(outer_id,ShowNormal) == TransStateMgr::GlobalCommitted);
        BLEX_TEST_CHECK(new_inner_trans->GetTransVisibility(middle_id,ShowNormal) == TransStateMgr::LocalRolledBack);
        BLEX_TEST_CHECK(new_inner_trans->GetTransVisibility(inner_id,ShowNormal) == TransStateMgr::GlobalRolledBack);
}

void Trans_RangeSwitchTest()
{
        /* Test whether the switching of ranges works! */

        //Create a transaction inside the old range
        const std::unique_ptr<IdentifiedTrans> oldrange_trans(new IdentifiedTrans(*trans_mgr));
        RangeId oldrange = TransStateMgr::GetRangeFromTransId(oldrange_trans->GetTransId());

        //We should be only using one range now
        BLEX_TEST_CHECKEQUAL(oldrange == 0, trans_mgr->IsRangeUsed(0));
        BLEX_TEST_CHECKEQUAL(oldrange == 1, trans_mgr->IsRangeUsed(1));
        BLEX_TEST_CHECKEQUAL(oldrange == 2, trans_mgr->IsRangeUsed(2));
        BLEX_TEST_CHECKEQUAL(oldrange == 3, trans_mgr->IsRangeUsed(3));
        TransId oldrange_id=oldrange_trans->GetTransId();
//      TransStateMgr::RangesInUse oldrange = trans_mgr->GetUsedRanges();
//      BLEX_TEST_CHECK (trans_mgr->GetUsedRanges() != TransStateMgr::BothRanges);

        //Switch to a new range!
        trans_mgr->SwitchToNextTransactionRange();

        //We should be using both ranges now!
//      BLEX_TEST_CHECK (trans_mgr->GetUsedRanges() == TransStateMgr::BothRanges );
        BLEX_TEST_CHECKEQUAL(oldrange == 0 || oldrange == 3, trans_mgr->IsRangeUsed(0));
        BLEX_TEST_CHECKEQUAL(oldrange == 1 || oldrange == 0, trans_mgr->IsRangeUsed(1));
        BLEX_TEST_CHECKEQUAL(oldrange == 2 || oldrange == 1, trans_mgr->IsRangeUsed(2));
        BLEX_TEST_CHECKEQUAL(oldrange == 3 || oldrange == 2, trans_mgr->IsRangeUsed(3));

        //Create a transaction inside the new range that refers to oldrange_trans
        const std::unique_ptr<IdentifiedTrans> referring_newrange_trans(new IdentifiedTrans(*trans_mgr));
        TransId referring_newrange_id=referring_newrange_trans->GetTransId();

        //Ensure that this transaction is inside a different range
        BLEX_TEST_CHECK(oldrange != TransStateMgr::GetRangeFromTransId(referring_newrange_id));
//        BLEX_TEST_CHECK( (oldrange_id < 0x80000000 && referring_newrange_id >= 0x8000000)
//              || (referring_newrange_id < 0x80000000 && oldrange_id >= 0x8000000));

        //We should be using both ranges now!
        BLEX_TEST_CHECKEQUAL(oldrange == 0 || oldrange == 3, trans_mgr->IsRangeUsed(0));
        BLEX_TEST_CHECKEQUAL(oldrange == 1 || oldrange == 0, trans_mgr->IsRangeUsed(1));
        BLEX_TEST_CHECKEQUAL(oldrange == 2 || oldrange == 1, trans_mgr->IsRangeUsed(2));
        BLEX_TEST_CHECKEQUAL(oldrange == 3 || oldrange == 2, trans_mgr->IsRangeUsed(3));
//      BLEX_TEST_CHECK (trans_mgr->GetUsedRanges() == TransStateMgr::BothRanges );

        //Close the transaction inside the old range
        oldrange_trans->PrepareForWrite();
        oldrange_trans->MarkTransactionCommitted();
        oldrange_trans.reset(NULL);

        //We should STILL be using both ranges, because newrange_trans is still
        //referring to oldrange_trans
//      BLEX_TEST_CHECK (trans_mgr->GetUsedRanges() == TransStateMgr::BothRanges );
        BLEX_TEST_CHECKEQUAL(oldrange == 0 || oldrange == 3, trans_mgr->IsRangeUsed(0));
        BLEX_TEST_CHECKEQUAL(oldrange == 1 || oldrange == 0, trans_mgr->IsRangeUsed(1));
        BLEX_TEST_CHECKEQUAL(oldrange == 2 || oldrange == 1, trans_mgr->IsRangeUsed(2));
        BLEX_TEST_CHECKEQUAL(oldrange == 3 || oldrange == 2, trans_mgr->IsRangeUsed(3));

        //Create a transaction inside the new range that does not refer to oldrange_trans
        const std::unique_ptr<IdentifiedTrans> nonreferring_newrange_trans(new IdentifiedTrans(*trans_mgr));
        //TransId nonreferring_newrange_id=nonreferring_newrange_trans->GetTransId();

        //Nothing changed, so we should STILL be using both rangess
//      BLEX_TEST_CHECK (trans_mgr->GetUsedRanges() == TransStateMgr::BothRanges );
        BLEX_TEST_CHECKEQUAL(oldrange == 0 || oldrange == 3, trans_mgr->IsRangeUsed(0));
        BLEX_TEST_CHECKEQUAL(oldrange == 1 || oldrange == 0, trans_mgr->IsRangeUsed(1));
        BLEX_TEST_CHECKEQUAL(oldrange == 2 || oldrange == 1, trans_mgr->IsRangeUsed(2));
        BLEX_TEST_CHECKEQUAL(oldrange == 3 || oldrange == 2, trans_mgr->IsRangeUsed(3));

        //Close the referring transaction
        referring_newrange_trans.reset(NULL);

        //We should now be using only one range
//      BLEX_TEST_CHECK (trans_mgr->GetUsedRanges() != TransStateMgr::BothRanges );
//      BLEX_TEST_CHECK (trans_mgr->GetUsedRanges() != oldrange );
        BLEX_TEST_CHECKEQUAL(oldrange == 3, trans_mgr->IsRangeUsed(0));
        BLEX_TEST_CHECKEQUAL(oldrange == 0, trans_mgr->IsRangeUsed(1));
        BLEX_TEST_CHECKEQUAL(oldrange == 1, trans_mgr->IsRangeUsed(2));
        BLEX_TEST_CHECKEQUAL(oldrange == 2, trans_mgr->IsRangeUsed(3));

//        bool new_range_high = trans_mgr->GetUsedRanges() == TransStateMgr::HighRange;
        RangeId newrange = trans_mgr->GetCurrentRange();

        //Okay.. assure that the transaction in the old range is now permanently committed
        BLEX_TEST_CHECK(trans_mgr->GetStatus(oldrange_id, 0) == TransStateMgr::GlobalCommitted);
        //Clear that transaction range!
        trans_mgr->ClearRange(oldrange);
        //The old transaction should now look 'NowRolledBack', because it should
        //be out-of-sight of the transaction counter (status not written). But it will
        BLEX_TEST_CHECK(trans_mgr->GetStatus(oldrange_id, 0) == TransStateMgr::GlobalRolledBack);
        //Switch to the other page! (both pages will be in use now)
        trans_mgr->SwitchToNextTransactionRange();
//        BLEX_TEST_CHECK (trans_mgr->GetUsedRanges() == TransStateMgr::BothRanges );
        BLEX_TEST_CHECKEQUAL(oldrange == 3 || oldrange == 2, trans_mgr->IsRangeUsed(0));
        BLEX_TEST_CHECKEQUAL(oldrange == 0 || oldrange == 3, trans_mgr->IsRangeUsed(1));
        BLEX_TEST_CHECKEQUAL(oldrange == 1 || oldrange == 0, trans_mgr->IsRangeUsed(2));
        BLEX_TEST_CHECKEQUAL(oldrange == 2 || oldrange == 1, trans_mgr->IsRangeUsed(3));

        //Allocate a transaction on this range and ensure it got the First id!
        TransId new_trans = IdentifiedTrans(*trans_mgr).GetTransId();
        BLEX_TEST_CHECK (new_trans == TransStateMgr::GetFirstTransIdInRange(TransStateMgr::GetRangeFromTransId(new_trans)) + 1);
}

/* Test whether transaction states are correctly stored/retrieved */
void Trans_MassStatusTest()
{
        const unsigned NumTransactions = 1000;

        CloseTransLog();
        OpenTransLog();

        typedef std::vector<MyTrans> Vector;
        Vector trans_map;

        //Set half to commit, half to rollback
        trans_map.resize(NumTransactions/2,MyTrans(0,false));
        trans_map.resize(NumTransactions,MyTrans(0,true));

        //Shuffle it!
        std::random_shuffle(trans_map.begin(),trans_map.end());

        //Allocate transactions
        for (unsigned i=0;i<NumTransactions;++i)
        {
                IdentifiedTrans new_trans(*trans_mgr);
                trans_map[i].id=new_trans.GetTransId();
                new_trans.PrepareForWrite();

                if (trans_map[i].commit)
                    new_trans.MarkTransactionCommitted();
        }

        CloseTransLog();
        OpenTransLog();
        trans_mgr->SwitchToNextTransactionRange();

/*        for (unsigned i=0;i<NumTransactions;++i)
        {
                std::cout << "Transaction #" << trans_map[i].id << ", committed: " << (trans_map[i].commit ? "yes " : "no  ");
                TransStateMgr::TransStatus status = trans_mgr->GetStatus(trans_map[i].id);
                switch (status)
                {
                case TransStateMgr::NowBusy:                    std::cout << "NowBusy"; break;
                case TransStateMgr::NowCommitted:               std::cout << "NowCommitted"; break;
                case TransStateMgr::NowRolledBack:              std::cout << "NowRolledBack"; break;
                case TransStateMgr::PermanentlyCommitted:       std::cout << "PermanentlyCommitted"; break;
                case TransStateMgr::PermanentlyRolledBack:      std::cout << "PermanentlyRolledback"; break;
                }
                std::cout << std::endl;
        }
        std::cout << std::endl;*/

        //Now test the transactions
        for (unsigned i=0;i<NumTransactions;++i)
        {
                if (trans_map[i].commit)
                    BLEX_TEST_CHECK(trans_mgr->GetStatus(trans_map[i].id, 0) == TransStateMgr::GlobalCommitted);
                else
                    BLEX_TEST_CHECK(trans_mgr->GetStatus(trans_map[i].id, 0) == TransStateMgr::GlobalRolledBack);
        }
}

BLEX_TEST_FUNCTION(TransTest)
{
        try
        {
                OpenTransLog();

                Trans_SimpleStatusTest();
                Trans_NestedTransactionTest();
                Trans_RangeSwitchTest();
                Trans_RangeSwitchTest();

                if (deep_testing)
                {
                        for (unsigned i=0; i < 100; ++i)
                        {
                                Trans_MassStatusTest();
                        }
                }
        }
        catch (std::exception &)
        {
                CloseTransLog();
                throw;
        }
        CloseTransLog();
}

//---------------------------------------------------------------------------


