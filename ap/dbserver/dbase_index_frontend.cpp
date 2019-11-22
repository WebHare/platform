#include <ap/libwebhare/allincludes.h>


#include "dbase_index_frontend.h"

#include <iostream>
#include <blex/path.h>
#include <blex/logfile.h>
#include "dbase_diskio.h"
#include "dbase_types.h"

//#define EXTENSIVE_DEBUGMESSAGES
//#define DEBUGINDEXREFCOUNTS

#ifdef DEBUGINDEXREFCOUNTS
 #define INDEXREFDEBUGPRINT(x) DEBUGPRINT(x)
#else
 #define INDEXREFDEBUGPRINT(x) (void)0
#endif

namespace Database {

namespace Index {

/* *** Meta-data file *** */
namespace C_Metadatafile
{
 static const uint32_t Version = 14;                 //< Version of metadatafile of index.
 static const uint32_t MagicIndexValid = 0x69260000 + Version; //< Magic value indicating index is consistent
 static const uint32_t MagicIndexInvalid = 0;        //< Magic value indicating index is inconsistent
 static const uint32_t IndexStartCode = 0x01020304;  //< Magic value indicating start of single index config
}

/* ************************************************************************** */
/* ** Internal storage functions                                           ** */
/* ************************************************************************** */

unsigned ConstructEntry(Blex::Index::IndexBlockEntryContainer &container, Cell data[4], unsigned colcount, Index::Descriptor const &descriptor, unsigned last_cell_size_limit, bool &is_last_cell_imprecise)
{
        uint8_t datastore[Blex::Index::IndexBlockEntry::MaxDataSize];

        is_last_cell_imprecise = false;
        unsigned pos = 0;
        for (unsigned idx = 0; idx < colcount; ++idx)
        {
                switch (descriptor.storage[idx])
                {
                case StoreS32:
                        {
                                is_last_cell_imprecise = false;
                                assert(descriptor.storesize[idx] == 4);
                                assert(idx != colcount - 1 || last_cell_size_limit == 0);
                                Blex::puts32msb(datastore+pos, data[idx].Integer()+0x80000000);
                                pos += 4;
                                break;
                        }
                case StoreDateTime:
                        {
                                is_last_cell_imprecise = false;
                                assert(descriptor.storesize[idx] == 8);
                                assert(idx != colcount - 1 || last_cell_size_limit == 0);

                                Blex::DateTime dt = data[idx].DateTime();
                                Blex::PutMsb(datastore+pos, dt);
                                pos += 8;
                                break;
                        }
                case StoreRaw:
                case StoreUppercase:
                        {
                                //ADDME: Document the format :-)

                                bool is_final = idx == descriptor.num_indexed_columns - 1;
                                unsigned width = descriptor.storesize[idx];

                                unsigned datalen = IsCellNull(data[idx],descriptor.coltype[idx]) ? 0 : std::min(data[idx].Size(), width);

                                bool add_length = !is_final;
                                is_last_cell_imprecise = datalen == width;
                                if (idx == colcount - 1 && last_cell_size_limit)
                                {
                                        datalen = std::min(datalen, last_cell_size_limit);
                                        if (last_cell_size_limit < width)
                                            is_last_cell_imprecise = datalen == last_cell_size_limit;
                                        add_length = false;
                                }

                                unsigned padding = is_final ? 0 : width - datalen;

                                if (datalen)
                                    std::copy(data[idx].Begin(), data[idx].Begin() + datalen, datastore + pos);

                                if (descriptor.storage[idx] == StoreUppercase)
                                    Blex::ToUppercase(datastore + pos, datastore + pos + datalen);

                                pos += datalen;
                                if (add_length)
                                {
                                        std::fill(datastore + pos, datastore + pos + padding, 0);
                                        pos += padding;
                                        datastore[pos++] = (uint8_t)datalen;
                                }
                        } break;
                }
        }
        container.ConstructDataEntry(datastore, pos, 0);

        return pos;
}

void PadEntryWithFF(Blex::Index::IndexBlockEntryContainer &container)
{
        uint8_t datastore[Blex::Index::IndexBlockEntry::MaxDataSize];
        unsigned oldlen = container.GetDataLength();
        std::copy(container.GetData(), container.GetData() + oldlen, datastore);

        std::fill(datastore + oldlen, datastore + Blex::Index::IndexBlockEntry::MaxDataSize, 255);
        container.ConstructDataEntry(datastore, Blex::Index::IndexBlockEntry::MaxDataSize, 0);
}

namespace
{
unsigned GetLengthKnownLikePrefix(Blex::StringPair pair)
{
        char const *ptr = pair.begin;
        while (ptr != pair.end && *ptr != '?' && *ptr != '*')
            ++ptr;
        return std::distance(pair.begin, ptr);
}

} // End of anonymous namespace

bool ContructLimits(Blex::Index::IndexBlockEntryContainer &begin, Blex::Index::IndexBlockEntryContainer &end, Cell data[4], unsigned colcount, Index::Descriptor const &descriptor, SearchRelationType type)
{
        //Note: type is always the compare type of the 'last' column. When matching multpiple columns, all previous columns are always SearchEqual

        if (type == SearchUnEqual || type == SearchIn)
            return false;

        /* If the last column must be used with a LIKE operator, but has no prefix (starts with '*' or '?') we simply
           discard that column and just do an equal search on the remaining columns. */
        unsigned last_limit_len;
        if (type == SearchLike)
        {
                assert(colcount);
                last_limit_len = GetLengthKnownLikePrefix(data[colcount - 1].StringPair());
                if (last_limit_len == 0)
                {
                        --colcount;
                        type = SearchEqual;
                }
        }
        else
            last_limit_len = 0;

        if (colcount && descriptor.storage[colcount - 1] == StoreUppercase)
        {
                if (type == SearchSmaller)
                    type = SearchSmallerEqual;
                else if (type == SearchBigger)
                    type = SearchBiggerEqual;
        }

        bool begin_last_cell_imprecise = false;
        bool end_last_cell_imprecise;

        if (type == SearchSmaller || type == SearchSmallerEqual)
            begin.ConstructNULLEntry(0);
        else
            ConstructEntry(begin, data, colcount, descriptor, last_limit_len, begin_last_cell_imprecise);
        begin.SetRecordID(type == SearchBigger && !begin_last_cell_imprecise ? LimitHighestRecordId : LimitLowestRecordId);

        if (type == SearchBigger || type == SearchBiggerEqual )
            end.ConstructEOBEntry();
        else
        {
                ConstructEntry(end, data, colcount, descriptor, last_limit_len, end_last_cell_imprecise);
                end_last_cell_imprecise |= colcount != descriptor.num_indexed_columns;
                if (end_last_cell_imprecise)
                    PadEntryWithFF(end);
                end.SetRecordID(type == SearchSmaller  && !end_last_cell_imprecise ? LimitLowestRecordId : LimitHighestRecordId);
        }
        return true;
}

/* ************************************************************************** */
/* ** IndexData                                                            ** */
/* ************************************************************************** */

IndexData::IndexData(System &system)
: ready(false)
, refcount(0)
, system(system)
{
}

std::shared_ptr< Blex::Index::BtreeIndex::Query > IndexData::MakeMultiQuery(Cell celldata[], unsigned cellcount, SearchRelationType type, bool survive_if_unavailable)
{
        //Check if this index is ready!
        if (!system.IsIndexReady(*this))
        {
                if (survive_if_unavailable)
                    return std::shared_ptr<Blex::Index::BtreeIndex::Query>();
                throw Exception(ErrorInternal,"Index needed to solve query is not available");
        }

        Blex::Index::IndexBlockEntryContainer begin;
        Blex::Index::IndexBlockEntryContainer end;

        if (!ContructLimits(begin, end, celldata, cellcount, descriptor, type))
        {
                if (survive_if_unavailable)
                    return std::shared_ptr< Blex::Index::BtreeIndex::Query >();
                throw Exception(ErrorInternal,"Index cannot solve the type of query passed to it");
        }

        //Create the requested query
        std::shared_ptr< Blex::Index::BtreeIndex::Query > retval(new Blex::Index::BtreeIndex::Query(*index));
        retval->ResetNewQuery(begin, end);
        return retval;
}

bool IndexData::GetStatistics(Blex::Index::Statistics *stats)
{
        //Check if this index is ready!
        if (!system.IsIndexReady(*this))
            return false;

        index->GetStatistics(*stats);
        return true;
}

IndexData::Ref::Ref(Ref const &src) : indexdata(src.indexdata)
{
        if (src.indexdata)
            src.indexdata->system.CloneIndexRef(indexdata);
}
IndexData::Ref& IndexData::Ref::operator=(Ref const & src) //Self-assignment safe assignment operator
{
        if (src.indexdata)
            src.indexdata->system.CloneIndexRef(indexdata);
        if (indexdata)
            indexdata->system.FreeIndexRef(indexdata);
        indexdata=src.indexdata;
        return *this;
}
IndexData::Ref::~Ref()
{
        if (indexdata)
            indexdata->system.FreeIndexRef(indexdata);
}

/* ************************************************************************** */
/* ** System                                                               ** */
/* ************************************************************************** */

System::System(const std::string &folder, bool new_database, bool sync_enabled)
: configfilename(Blex::MergePath(folder,"indexmetadata.whdb"))
, indexfilename(Blex::MergePath(folder,"indexdata.whdb"))
, filler(std::bind(&System::FillerThread, this))
, filler_database(NULL)
, sync_enabled(sync_enabled)
{
#ifdef DEBUG_RESOURCEMANAGER
        DEBUGONLY(data.SetupDebugging("Index-system index-list"));
#endif
        LockedSystemData::WriteRef(systemdata)->metadata_is_live = false;
        LockedSystemData::WriteRef(systemdata)->first_live_fill_done = false;
        LockedSystemData::WriteRef(systemdata)->within_first_live_fill = false;
        LockedSystemData::WriteRef(systemdata)->abort = false;
        LockedSystemData::WriteRef(systemdata)->flush_on_idle = false;

        bool open_success = false;
        try
        {
                if (!new_database)
                    open_success = OpenExistingIndexSystem();
        }
        catch(Database::Exception &e)
        {
                Blex::ErrStream() << "Cannot open existing index, indexes will be regenerated (" << e.what() << ")";
                //Dismiss the exception.. we cannot risk generating ANOTHER exception in catch(..)
        }
        catch(Blex::Index::IndexException &e)
        {
                Blex::ErrStream() << "Cannot open existing index, indexes will be regenerated (" << e.what() << ")";
                //Dismiss the exception.. we cannot risk generating ANOTHER exception in catch(..)
        }
        if (!open_success)
            CreateNewIndexSystem();

//        filler_started = true;
//        filler.Start();
}

System::~System()
{
        //Make sure the filler is down (exceptions may cause Close() to be evaded)
        LockedSystemData::WriteRef (systemdata)->abort=true;
        systemdata.SignalAll();
        filler.WaitFinish();
}

void System::Close()
{
        try
        {
                // Now, no more changes to index will take place
                // Write configuration of indexes away to config
                CloseIndexSystem();
        }
        catch(std::exception&e)
        {
                Blex::Index::FailIndex(e.what());
        }
        catch(...)
        {
                Blex::Index::FailIndex("Unknown exception");
        }
}


void System::StartFiller(RawDatabase &db) //ADDME: Could be moved to
{
        if (!filler_database)
        {
                filler_database = &db;
                filler.Start();
        }
}


void System::DestroyUnreferencedIndexes()
{
        //Delete unreferenced indexes when going live
        IndexList deletables;

        {
                LockedSystemData::WriteRef lock(systemdata);
                if (lock->metadata_is_live == false)
                    return; //NOT permitted to clean up indexes now!

                for (IndexList::iterator it = lock->indexes.begin(); it != lock->indexes.end(); )
                {
                        Blex::Mutex::AutoLock refcountlock(refcount_mutex);
                        if ((*it)->refcount==0)
                        {
                              DEBUGPRINT("Index " << (*it)->index->indexname << " must be destroyed");
                              deletables.push_back(*it);
                              it = lock->indexes.erase(it);
                        }
                        else
                        {
                              ++it;
                        }
                }
        }
        for (IndexList::iterator it = deletables.begin(); it != deletables.end(); ++it)
            (*it)->index->DestroyIndex();
}

bool System::IsFirstLiveFillDone() const
{
        System::LockedSystemData::ReadRef systemdatalock(systemdata);
        return systemdatalock->first_live_fill_done;
}

bool System::IsIndexReady(IndexData const &index) const
{
        System::LockedSystemData::ReadRef systemdatalock(systemdata);
        return index.ready;
}

bool System::GetDescriptorOfIndexByNr(unsigned nr, Descriptor *descriptor) const
{
        System::LockedSystemData::ReadRef systemdatalock(systemdata);

        if (nr >= systemdatalock->indexes.size())
            return false;

        *descriptor = systemdatalock->indexes[nr]->GetDescriptor();
        return true;
}

void System::SetMetadataLiveStatus(bool now_live)
{
        // Set metadata live status
        LockedSystemData::WriteRef(systemdata)->metadata_is_live = now_live;

        if (now_live)
        {
                // Signal the filler (there may be indices that still need filling)
                systemdata.SignalAll();

                // Try to destroy unneeded indices (checks metadata_is_live itself within lock)
                DestroyUnreferencedIndexes();
        }
}

void System::SyncIndexFiles()
{
        if(filesystem.get())
            filesystem->FlushFile();
}

void System::ResetWholeSystem()
{
        CreateNewIndexSystem();
}

void System::CreateNewIndexSystem()
{
        //Destroy any existing indexes
        LockedSystemData::WriteRef lockeddata(systemdata);
        lockeddata->indexes.clear();

        //Destroy existing filesystem
        filesystem.reset(NULL);

        //Try to backup the existing index, if possible
        Blex::RemoveFile(configfilename + ".bak");
        Blex::RemoveFile(indexfilename + ".bak");
        if (Blex::PathStatus(configfilename).Exists() && !Blex::MovePath(configfilename, configfilename+".bak"))
            throw Exception(ErrorIO,"Cannot backup existing metadata file");
        if (Blex::PathStatus(indexfilename).Exists() && !Blex::MovePath(indexfilename, indexfilename+".bak"))
            throw Exception(ErrorIO,"Cannot backup existing metadata file");

        //Open a new, fresh index system
        filesystem.reset(new Blex::Index::DBIndexFileSystem(indexfilename, NULL, /*new_system=*/true, sync_enabled));
}

bool System::OpenExistingIndexSystem()
{
        if (!Blex::PathStatus(configfilename).IsFile())
            return false; //normal: no index exists yet!

        LockedSystemData::WriteRef lockeddata(systemdata);

        //Try to open the configuration file
        const std::unique_ptr<Blex::FileStream> uncached_configfile(Blex::FileStream::OpenRW(configfilename,true,false,Blex::FilePermissions::PrivateRead));

        if (!uncached_configfile.get())
            throw Exception(ErrorIO,"Cannot open index metadata file");

        std::vector< uint8_t > configfile_data;
        Blex::ReadStreamIntoVector(*uncached_configfile, &configfile_data);
        std::unique_ptr< Blex::MemoryReadStream > configfile;
        configfile.reset(new Blex::MemoryReadStream(&configfile_data[0], configfile_data.size()));

        //Check its validity
        if (configfile->GetFileLength() == 0)
            throw Exception (ErrorIO, "Index metadata file did not exist");
        if (configfile->ReadLsb<uint32_t>() != C_Metadatafile::Version)
            throw Exception (ErrorIO, "Wrong header version");
        if (configfile->ReadLsb<uint32_t>() != C_Metadatafile::MagicIndexValid)
            throw Exception (ErrorIO, "Indexfiles were not shutdown correctly");

        //Mark the index as invalid (so if we fail later on somewhere, we won't ever try to re-read it)
        uncached_configfile->SetOffset(4);
        if (uncached_configfile->WriteLsb<uint32_t>(C_Metadatafile::MagicIndexInvalid) != sizeof(uint32_t)
            || !uncached_configfile->OSFlush())
            throw Exception (ErrorIO, "Unable to invalidate indexes");

        //Initialize the filesystem, and let it read its settings
        filesystem.reset(new Blex::Index::DBIndexFileSystem(indexfilename, configfile.get(), /*new_system=*/false, sync_enabled));

        //Read our indexes
        unsigned num_indexes = configfile->ReadLsb<uint32_t>();
        for (unsigned i=0; i<num_indexes;++i)
        {
                if (configfile->ReadLsb<uint32_t>() != C_Metadatafile::IndexStartCode)
                    throw Exception (ErrorIO, "Index configuration was corrupted");

                std::shared_ptr<IndexData> newindex(new IndexData(*this));
                newindex->descriptor.ReadFromStream(*configfile);
                newindex->ready = true;
                newindex->index.reset(new Blex::Index::BtreeIndex(*filesystem, *configfile));
                lockeddata->indexes.push_back(newindex);
        }

        //And a terminator magic to indicate end-of-metadata
        if (configfile->ReadLsb<uint32_t>() != C_Metadatafile::MagicIndexValid)
            throw Exception (ErrorIO, "Index metadatafile contains garbage at end of file");
        return true;
}

void System::CloseIndexSystem()
{
        //Shut down filler thread
        if (filler_database)
        {
                LockedSystemData::WriteRef (systemdata)->abort=true;
                systemdata.SignalAll();
                filler.WaitFinish();
        }

        LockedSystemData::WriteRef lockeddata(systemdata);

        //Remove any 'Filling' indexes from the index list
        for (IndexList::iterator itr=lockeddata->indexes.begin();itr!=lockeddata->indexes.end();)
        {
                if ((*itr)->ready)
                    ++itr;
                else
                    itr=lockeddata->indexes.erase(itr);
        }

        //Try to open the configuration file
        const std::unique_ptr<Blex::FileStream> uncached_configfile(Blex::FileStream::OpenRW(configfilename,true,false,Blex::FilePermissions::PrivateRead));

        if (!uncached_configfile.get())
            throw Exception(ErrorIO,"Cannot open index metadata file");

        std::unique_ptr< Blex::MemoryRWStream > configfile;
        configfile.reset(new Blex::MemoryRWStream);

        //Check its validity
        if (configfile->GetFileLength() != 0)
        {
                if (uncached_configfile->ReadLsb<uint32_t>() != C_Metadatafile::Version)
                    throw Exception (ErrorIO, "Wrong header version");
                if (uncached_configfile->ReadLsb<uint32_t>() != C_Metadatafile::MagicIndexInvalid)
                    throw Exception (ErrorIO, "We're NOT the owner of the index metadata file");
                uncached_configfile->SetOffset(0);
        }

        configfile->WriteLsb<uint32_t>(C_Metadatafile::Version);
        configfile->WriteLsb<uint32_t>(C_Metadatafile::MagicIndexInvalid);

        //Write the filesystem's data
        filesystem->SaveFSState(*configfile);

        //Flush the filesystem, update the modtime and then destroy the filesystem
        filesystem->FlushFile();
        filesystem->SetModificationDate(Blex::DateTime::Now());
        filesystem.reset();
#ifdef DEBUG
        for (IndexList::iterator itr=lockeddata->indexes.begin();itr!=lockeddata->indexes.end();++itr)
            INDEXREFDEBUGPRINT("Index " << (*itr)->index->indexname << " refcount " << (*itr)->refcount);
#endif

        //Write out the data about all indexes
        configfile->WriteLsb<uint32_t>(lockeddata->indexes.size());
        for (IndexList::iterator itr=lockeddata->indexes.begin();itr!=lockeddata->indexes.end();++itr)
        {
                if (! (*itr)->ready)
                    throw Exception (ErrorIO, "Cannot commit an incomplete index");

                if ((*itr)->refcount > 0)
                    throw Exception (ErrorInternal, "Still multiple references to index " + (*itr)->index->indexname + " - improper shutdown ordering");

                configfile->WriteLsb<uint32_t>(C_Metadatafile::IndexStartCode);
                (*itr)->descriptor.WriteToStream(*configfile);
                (*itr)->index->SaveState(*configfile);
        }

        //Add terminator magic to indicate end-of-metadata
        if (configfile->WriteLsb<uint32_t>(C_Metadatafile::MagicIndexValid) != sizeof(uint32_t))
            throw Exception (ErrorIO, "Unable to revalidate indexes");

        // Copy memory stream to file stream, and test
        uncached_configfile->SetOffset(0);
        uncached_configfile->SetFileLength(0);
        configfile->SetOffset(0);
        configfile->SendAllTo(*uncached_configfile);
        if (!uncached_configfile->OSFlush())
            throw Exception (ErrorIO, "Unable to revalidate indexes");

        //Add valid bit to the front to indicate safe use of index
        uncached_configfile->SetOffset(4);
        if (uncached_configfile->WriteLsb<uint32_t>(C_Metadatafile::MagicIndexValid) != sizeof(uint32_t)
            || !uncached_configfile->OSFlush())
            throw Exception (ErrorIO, "Unable to revalidate indexes");
}

void System::UpdateIndex(IndexData const &index, RecordId recid, Record rec, bool insertion)
{
        //Where the data goes!
        Cell cells[4];
        Blex::Index::IndexBlockEntryContainer container;

        //Add all requested columns
        for (unsigned curcol=0;curcol<index.descriptor.num_indexed_columns;++curcol)
        {
                cells[curcol] = rec.GetCell(index.descriptor.columns[curcol]);
                if (index.descriptor.nonullstores && !cells[curcol].Exists())
                {
                        //DEBUGPRINT("Not inserting rec " << recid << " in index " << index.descriptor.GetName() << ", found null cell");
                        return;
                }
        }

        bool dummy;
        ConstructEntry(container, cells, index.descriptor.num_indexed_columns, index.descriptor, 0, dummy);
        container.SetRecordID(recid);

        if (insertion)
        {
#ifdef EXTENSIVE_DEBUGMESSAGES
                //DEBUGPRINT("Inserting entry into index for column " << it->descriptor.descriptor.singlecolumn.column);
#endif
                index.index->InsertData2(container);
        }
        else
        {
#ifdef EXTENSIVE_DEBUGMESSAGES
                //DEBUGPRINT("Deleting entry from index for column " << it->descriptor.descriptor.singlecolumn.column);
#endif
                if (!index.index->DeleteData2(container) && index.ready)
                {
                        Blex::ErrStream() << "Index files corrupt (DeleteData tried to delete a non-existing element)";
                        Blex::FatalAbort();
                }
        }
}

void System::TableUpdate(TableId table, RecordId recid, const Record &record, bool insertion)
{
#ifdef EXTENSIVE_DEBUGMESSAGES
        DEBUGPRINT("Indexing System: Update in table " << table);
#endif
        LockedSystemData::ReadRef lockeddata(systemdata);
        for (IndexList::const_iterator it = lockeddata->indexes.begin();
             it != lockeddata->indexes.end();
             ++it)
        {
                if ((*it)->descriptor.table == table)
                {
                        UpdateIndex(**it, recid, record, insertion);
                }
        }
}

IndexData::Ref System::CreateIndexRef(IndexData *currentref)
{
        CloneIndexRef(currentref);
        return IndexData::Ref(currentref);
}

/** Request an index */
IndexData::Ref System::GetIndexRef(const Descriptor &descriptor)
{
        IndexData *indexptr;
        bool must_signal;
        {
                LockedSystemData::WriteRef lockeddata(systemdata);

                for (IndexList::iterator it = lockeddata->indexes.begin(); it != lockeddata->indexes.end(); ++it)
                {
                        if ((*it)->descriptor == descriptor)
                            return CreateIndexRef(it->get());
                }

                std::shared_ptr<IndexData> newindex ( new IndexData(*this) );
                newindex->descriptor = descriptor;
                newindex->refcount = 1;
                newindex->index.reset(new Blex::Index::BtreeIndex(*filesystem, descriptor.GetName()));
                INDEXREFDEBUGPRINT("Creating index " << newindex->index->indexname);

                lockeddata->indexes.push_back(newindex);
                indexptr=newindex.get();

                // We now determine if a signal is needed at this point. Don't do this before the new index is registered!
                must_signal = lockeddata->metadata_is_live;
        }

        if (must_signal)
            systemdata.SignalAll(); //tells the Filler to regenerate this index, but only when metadata is live. If not, wait until it is live

        return IndexData::Ref(indexptr);
}

/** Clone an index reference */
void System::CloneIndexRef(IndexData *currentref)
{
        Blex::Mutex::AutoLock refcountlock(refcount_mutex); //ADDME: Replace refcount_mutex with atomic increments
        ++currentref->refcount;
        INDEXREFDEBUGPRINT("Cloning index " << currentref->index->indexname << " updated refcount to " << currentref->refcount);
}
/** Free an index reference */
void System::FreeIndexRef(IndexData *currentref)
{
        {
                Blex::Mutex::AutoLock refcountlock(refcount_mutex);
                INDEXREFDEBUGPRINT("Freeing index " << currentref->index->indexname << " dropped refcount to " << (currentref->refcount-1));
                if (--currentref->refcount > 0) //still references left
                    return; //don't do a thing
        }
        INDEXREFDEBUGPRINT("Freed last reference to index " << currentref->index->indexname);
        DestroyUnreferencedIndexes();
}

/** Wait for all indexes to finish filling */
void System::WaitForFillComplete()
{
        LockedSystemData::WriteRef lock(systemdata);
        while (true)
        {
                unsigned i=0;
                for (;i<lock->indexes.size();++i)
                  if (!lock->indexes[i]->ready)
                    break;

                if (i==lock->indexes.size()) //all indexes where ready
                    return;

                lock.Wait();
        }
}

bool System::GetWorkForFiller(std::vector<IndexData::Ref> *to_fill)
{
        to_fill->clear();

        bool need_flush = false;

        while (true)
        {
                if (need_flush)
                {
                        DEBUGPRINT("Filler: flushing index file");
                        filesystem->FlushFile();
                        need_flush = false;
                }

                LockedSystemData::WriteRef lock(systemdata);
                if (lock->abort)
                    return false; //abort descriptor

                //Get a list of fillable indexes from the main thread
                for (IndexList::iterator itr=lock->indexes.begin(); itr!=lock->indexes.end(); ++itr)
                {
                        if ((*itr)->ready)
                            continue; //index doesn't need creation

                        //If we already picked up one index for filling, only pick up more from the same table
                        if (!to_fill->empty() && (*to_fill)[0]->GetDescriptor().table != (*itr)->GetDescriptor().table)
                            continue; //index from wrong table

                        //This is a fillable index, add it to our work list
                        to_fill->push_back(CreateIndexRef(itr->get()));
                }

                if (!to_fill->empty())
                {
                        // If the metadata is live and in the first check an index needed to be filled, show messages
                        if (lock->metadata_is_live && !lock->first_live_fill_done && !lock->within_first_live_fill)
                        {
                                lock->within_first_live_fill = true;
                                Blex::ErrStream() << "Regenerating index - the database server will be unavailable until this is done";
                        }

                        lock->flush_on_idle = true;
                        return true; //got something to fill!
                }
                else if (lock->metadata_is_live && !lock->first_live_fill_done)
                {
                        // Send a message if an indexed needed to be filled inside the first live fill
                        if (lock->within_first_live_fill)
                            Blex::ErrStream() << "Index regeneration complete";

                        lock->first_live_fill_done = true;
                }

                if (lock->flush_on_idle)
                {
                        lock->flush_on_idle = false;
                        need_flush = true;
                        continue;
                }

                DEBUGPRINT("Filler: waiting for work");
                lock.Wait(); //wait for an index
        }
}

bool System::FillIndexes(std::vector<IndexData::Ref> const &to_fill)
{
#ifdef DEBUG
        std::string fillist;
        for (unsigned i=0;i<to_fill.size();++i)
            fillist += ", " + to_fill[i]->index->indexname;
        DEBUGPRINT("Filler: has work " << fillist);
#endif

        RawDatabase::SectionViewer viewer(*filler_database,to_fill[0]->descriptor.table);
        if (!viewer.MoveToFirstSection())
             return true; //hmm, no data?!

        //ADDME: A 'prettier' SectionViewer interface might allow a plain while or do-while loop?
        //ADDME: Block-sized insertions into the various indexes?
        DEBUGPRINT("Filler: " << fillist << " section " << viewer.GetCurrentSection());
        while (true)
        {
                for (RawDatabase::SectionViewer::DiskRecord const *rit = viewer.view_begin(); rit != viewer.view_end(); ++rit)
                {
#ifdef EXTENSIVE_DEBUGMESSAGES
                        DEBUGPRINT("Record " << rit->recordid);
#endif

                        for (unsigned i=0;i<to_fill.size();++i)
                            UpdateIndex(*to_fill[i].Get(), rit->recordid, rit->record, true);
                }
                if (!viewer.NextViewInSection())
                {
                        if(!viewer.MoveToNextSection())
                                break;
                        DEBUGPRINT("Filler: " << fillist << " section " << viewer.GetCurrentSection());
                }

                if (LockedSystemData::WriteRef(systemdata)->abort)
                   return false;
        }

        return true;
}

void System::MarkIndexesReady(std::vector<IndexData::Ref> const &to_fill)
{
        {
                LockedSystemData::WriteRef lock(systemdata);
                for (unsigned i=0;i<to_fill.size();++i)
                    to_fill[i]->ready=true;
        }
        systemdata.SignalAll();
}

void System::FillerThread()
{
        try
        {
                std::vector<IndexData::Ref> to_fill;

                while(true)
                {
                        if (!GetWorkForFiller(&to_fill))
                            return;//got an abort

                        if (!FillIndexes(to_fill))
                            break;//got an abort
                        MarkIndexesReady(to_fill);
                }
        }
        catch (std::exception &e)
        {
                Blex::Index::FailIndex(std::string("Filler terminated: ") + e.what());
        }
        catch (...)
        {
                Blex::Index::FailIndex("Filler terminated due to an uncaught exception");
        }
}

void System::GenerationalCleanupUnusedSections(volatile uint32_t *abortflag)
{
        filesystem->GenerationalCleanupUnusedSections(abortflag);
}



} //end namespace Index
} //end namespace Database
