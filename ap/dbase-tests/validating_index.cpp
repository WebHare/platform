//---------------------------------------------------------------------------
#include <ap/libwebhare/allincludes.h>

#include "validating_index.h"
#include "indexdumping.h"
#include <iostream>
//---------------------------------------------------------------------------
using namespace Blex::Index;

std::ostream& operator <<(std::ostream &out, const Statistics &s)
{
        out << "entries: " << s.totalentries;
        out << " blocks: " << s.totalblocks;
        out << " dups: " << s.duplicates;
        out << " total entry-size: " << s.totalentrysize;

        return out;
}

template <typename X> std::ostream& operator <<(std::ostream &out, const std::set<X> &v)
{
        out << "[";
        for (typename std::set<X>::const_iterator it = v.begin(); it != v.end(); ++it)
        {
                out << *it;
                typename std::set<X>::const_iterator it2 = it;
                ++it2;
                if (it2 != v.end())
                        out << ",";
        }
        return out << "]";
}

template <typename TestType> struct EntryDataWrapper
{
        EntryDataWrapper(const IndexBlockEntry & _entry) : entry(_entry) { }
        const IndexBlockEntry &entry;
};

template <typename TestType> std::ostream& operator <<(std::ostream &out, const EntryDataWrapper<TestType> &e)
{
        IndexEntry<TestType> temp (*reinterpret_cast<const TestType *>(e.entry.GetData()),0);
        return out << temp;
}
template <> std::ostream& operator << <std::string>(std::ostream &out, const EntryDataWrapper<std::string> &e)
{
        IndexEntry<std::string> temp(std::string(reinterpret_cast<char const*>(e.entry.GetData()),e.entry.GetDataLength()),0);
        return out << temp;
}



///////////////////////////////////////////////////////////////////////////////
//
//  INDEX validation functions
//  specializations per datatype
//
//
template <typename TestType> void FullAnalyseTreeIterate(BtreeIndex::ReadSession &session, typename std::set< IndexEntry <TestType> > &data, typename std::set< IndexEntry <TestType> >::iterator &it, BlockId blockno, uint32_t depth, uint32_t parententriecount, Statistics &stats, IndexBlockEntryContainer &lastitem)
{
        // Open block to test
        SmartBlockPtr blockptr(session.filesession, blockno);
        IndexBlock::iterator bit = blockptr->begin();

        ++stats.totalblocks;

        // Check fillsize integrity, and update statistics
        uint32_t count = 1;
        while (!bit->IsEOB())
        {
                stats.totalentrysize += bit->GetEntryLength();
                ++stats.totalentries;

                ++count;
                ++bit;
        }
        if (bit != blockptr->eob())
        {
                DEBUGPRINT("Actual size of entries in block "<<blockptr.GetBlockId()<<"do not match reported fillsize");
                DisplayTreeAndInsertsAbort(session, data);
        }
        // check size constraints
        if (blockptr->FillSize() > C_Block::MaxData)
        {
                DEBUGPRINT("Fillsize of block ("<<blockptr->FillSize()<<") bigger then maximum ("<<C_Block::MaxData<<")");
                DisplayTreeAndInsertsAbort(session, data);
        }
        if ((depth > 2) || (parententriecount > 2))
                if (blockptr->FillSize() < C_Block::MaxData / 2)
                {
                        DEBUGPRINT("Fillsize of block "<<blockptr.GetBlockId()<<" (="<<blockptr->FillSize()<<") less then guarantee ("<<C_Block::MaxData / 2<<")");
                        DisplayTreeAndInsertsAbort(session, data);
                }

        bit = blockptr->begin();

        while (!bit->IsEOB())
        {
                if (depth != session.admin->treedepth)
                    FullAnalyseTreeIterate(session, data, it, bit->GetChildBlockId(), depth + 1, count, stats, lastitem);

                // Check with lastitem (only if this was not the very first item!)
                if (it != data.begin())
                {
                        // Set recordid of lastitem to match that one pointed to by bit, to
                        // make compare on data only possible
                        lastitem.SetRecordID(bit->GetRecordId());

                        if (lastitem == *bit)
                                ++stats.duplicates;

                        if (lastitem > *bit)
                        {
                                DEBUGPRINT("Index ordering is broken, " << EntryDataWrapper<TestType>(lastitem) << " precedes " << EntryDataWrapper<TestType>(*bit));
                                DisplayTreeAndInsertsAbort(session, data);
                        }
                }
                lastitem.CopyFrom(*bit);

                if ((depth == session.admin->treedepth) && (bit->GetChildBlockId() != BlockId(-1)))
                {
                        DEBUGPRINT("Non-(-1) childblockid detected in leaf");
                        DisplayTreeAndInsertsAbort(session, data);
                }

                if (it == data.end())
                {
                        DEBUGPRINT("Tree contains too much data, got (" << EntryDataWrapper<TestType>(*bit) << ", " << (bit->GetRecordId()) << ")");
                        DisplayTreeAndInsertsAbort(session, data);
                }

                if (bit->GetRecordId() != it->GetRecordId()
                    || bit->GetDataLength() != it->GetDataSize()
                    || memcmp(bit->GetData(), it->GetDataPtr(), bit->GetDataLength()) != 0)
                {
                        DEBUGPRINT("Tree does not match inserted data, got (" << EntryDataWrapper<TestType>(*bit) << ", " << (bit->GetRecordId()) << "), wanted: " << *it);
                        DisplayTreeAndInsertsAbort(session, data);
                }

                ++bit;
                if (it == data.end())
                {
                        DEBUGPRINT("");
                        DEBUGPRINT("Tree does not match inserted data, extra record: (" << Blex::getu32lsb(bit->GetData()) << ", " << bit->GetRecordId() << ")");
                        DisplayTreeAndInsertsAbort(session, data);
                }
                ++it;
        }

        if (depth != session.admin->treedepth)
                FullAnalyseTreeIterate(session, data, it, bit->GetChildBlockId(), depth + 1, count, stats, lastitem);
}

template <typename TestType> void DisplayTreeAndInsertsAbort(BtreeIndex::ReadSession &session, typename std::set< IndexEntry <TestType> > &data)
{
        DisplayTree(session);
        typename std::set< IndexEntry <TestType> >::iterator it = data.begin();
        for (uint32_t i=0; i<data.size(); ++i)
        {
                std::cout << "("<<*it<<","<<it->GetRecordId()<<") ";
                ++it;
        }
        std::cout << std::endl;
        throw Database::Exception(Database::ErrorInternal, "Error detected");
}

template <typename TestType> void FullAnalyseTree(BtreeIndex::ReadSession &session, typename std::set< IndexEntry <TestType> > &data)
{
        Statistics stats;
        IndexBlockEntryContainer lastitem;

        typename std::set< IndexEntry <TestType> >::iterator it = data.begin();
        FullAnalyseTreeIterate(session, data, it, session.admin->superblockno, 1, 1, stats, lastitem);
        // Test if all entries have been found in tree

        if (it != data.end())
        {
                DEBUGPRINT("Less entries in tree present than inserted, " << *it << " is missing");
                DisplayTreeAndInsertsAbort(session, data);
        }

//        DEBUGPRINT("stats: " << stats);
        if (stats != session.admin->statistics)
        {
                DEBUGPRINT("Statistics in index do not match real values!");
                DEBUGPRINT("Index says: " << session.admin->statistics);
                DEBUGPRINT("Real values: " << stats);
                DisplayTreeAndInsertsAbort(session, data);
        }
}



template<typename DataType> void ValidatingIndex<DataType>::Validate()
{
        Blex::Index::BtreeIndex::ReadSession session(index);
        FullAnalyseTree(session, shadow_index);
}


///////////////////////////////////////////////////////////////////////////////
//
//  INDEX data generation functions. There is one generic filler, the rest are
//  specializations per datatype
//
//
template<typename DataType> void ValidatingIndex<DataType>::FillRecords(unsigned howmany, FillType fill_data, FillType fill_record)
{
        assert(fill_data>FillMinimum&&fill_data<FillMaximum);
        assert(fill_record>FillMinimum&&fill_record<FillMaximum);

        source_data.clear();

        SpecificFillRecords(howmany,fill_data,fill_record);

        std::sort(source_data.begin(), source_data.end());
        source_data.erase(std::unique(source_data.begin(), source_data.end()),
                          source_data.end());
}

template<typename DataType> void ValidatingIndex<DataType>::ShuffleRecords()
{
        std::random_shuffle(source_data.begin(), source_data.end());
}

template<> void ValidatingIndex<std::string>::SpecificFillRecords(unsigned howmany, FillType fill_data, FillType fill_record)
{
        EntryType d;
        source_data.clear();

        for (unsigned i=0; i<howmany; ++i)
        {
                if (fill_data==FillSequential)
                    d.data = Blex::AnyToString(i-(howmany/2));
                else if (fill_data==FillReversedSequential)
                    d.data = Blex::AnyToString((howmany/2)-i);
                else if (fill_data==FillEqual)
                    d.data = Blex::AnyToString(777);
                else if (fill_data==FillRandom)
                    d.data = Blex::AnyToString(rand()-(RAND_MAX/2));

                if (fill_record==FillSequential)
                    d.recordid = i+1;
                else if (fill_record==FillReversedSequential)
                    d.recordid = 1+howmany-i;
                else if (fill_record==FillEqual)
                    d.recordid = 777;
                else if (fill_record==FillRandom)
                    d.recordid = rand()+1;

                source_data.push_back(d);
        }
}

template<> void ValidatingIndex<int32_t>::SpecificFillRecords(unsigned howmany, FillType fill_data, FillType fill_record)
{
        EntryType d;

        for (unsigned i=0; i<howmany; ++i)
        {
                if (fill_data==FillSequential)
                    d.StoreData(i-(howmany/2));
                else if (fill_data==FillReversedSequential)
                    d.StoreData((howmany/2)-i);
                else if (fill_data==FillEqual)
                    d.StoreData(777);
                else if (fill_data==FillRandom)
                    d.StoreData(rand()-(RAND_MAX/2));

                if (fill_record==FillSequential)
                    d.recordid = i+1;
                else if (fill_record==FillReversedSequential)
                    d.recordid = 1+howmany-i;
                else if (fill_record==FillEqual)
                    d.recordid = 777;
                else if (fill_record==FillRandom)
                    d.recordid = rand()+1;

                source_data.push_back(d);
        }
}

template<> void ValidatingIndex<bool>::SpecificFillRecords(unsigned howmany, FillType fill_data, FillType fill_record)
{
        EntryType d;

        for (unsigned i=0; i<howmany; ++i)
        {
                if (fill_data==FillSequential)
                    d.data = i-(howmany/2);
                else if (fill_data==FillReversedSequential)
                    d.data = (howmany/2)-i;
                else if (fill_data==FillEqual)
                    d.data = 777;
                else if (fill_data==FillRandom)
                    d.data = rand()-(RAND_MAX/2);

                if (fill_record==FillSequential)
                    d.recordid = i+1;
                else if (fill_record==FillReversedSequential)
                    d.recordid = 1+howmany-i;
                else if (fill_record==FillEqual)
                    d.recordid = 777;
                else if (fill_record==FillRandom)
                    d.recordid = rand()+1;

                source_data.push_back(d);
        }
}

template<typename DataType> void ValidatingIndex<DataType>::SetDataSet(const DataVector& vector)
{
        for (typename DataVector::iterator it = source_data.begin(); it != source_data.end(); ++it)
        {
                if (it->is_in_index)
                        Delete(std::distance(source_data.begin(), it));
        }
        source_data = vector;
}

template class ValidatingIndex<std::string>;
template class ValidatingIndex<bool>;
template class ValidatingIndex<int32_t>;
