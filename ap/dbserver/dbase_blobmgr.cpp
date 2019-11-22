#include <ap/libwebhare/allincludes.h>

#include <blex/logfile.h>
#include "dbase_blobmgr.h"

//#define SHOWBLOBUSER

#ifdef SHOWBLOBUSER
 #define BU_PRINT(x) DEBUGPRINT(x)
#else
 #define BU_PRINT(x) (void)0
#endif


namespace Database
{

//-----------------------------------------------------------------------------
//
// Blob manager
//
//-----------------------------------------------------------------------------
const unsigned BlobPageSize = 8192;
const unsigned SpeedIdAllocs = 1000; // Nr of increasing allocations of blob ids before scanning from start

BlobUser::BlobUser(BlobManager &blobmgr)
: blobmgr(blobmgr)
{
        BU_PRINT("BlobUser " << this << " - created");
}

BlobUser::~BlobUser()
{
        BU_PRINT("BlobUser " << this << " - destroyed");

        // Decrease usecounters
        BlobManager::LockedBlobData::WriteRef bloblock(blobmgr.blobdata);
        for (std::multimap< BlobId, void * >::iterator it = blobs_in_use.begin(), end = blobs_in_use.end(); it != end; ++it)
        {
                std::map< BlobId, unsigned >::iterator uit = bloblock->usecounters.find(it->first);
                assert(uit != bloblock->usecounters.end());

                BU_PRINT("BlobUser " << this << " - blob " << it->first << " user gone, context " << it->second << " (cnt: " << (uit->second - 1) << ")");

                if (--uit->second == 0)
                    bloblock->usecounters.erase(uit);
        }
}

void BlobUser::Reset()
{
        BU_PRINT("BlobUser " << this << " - reset");

        // Decrease usecounters
        BlobManager::LockedBlobData::WriteRef bloblock(blobmgr.blobdata);
        for (std::multimap< BlobId, void * >::iterator it = blobs_in_use.begin(), end = blobs_in_use.end(); it != end; ++it)
        {
                std::map< BlobId, unsigned >::iterator uit = bloblock->usecounters.find(it->first);
                assert(uit != bloblock->usecounters.end());

                BU_PRINT("BlobUser " << this << " - blob " << it->first << " reset, context " << it->second << " (cnt: " << (uit->second - 1) << ")");

                if (--uit->second == 0)
                    bloblock->usecounters.erase(uit);
        }
        blobs_in_use.clear();
}

BlobId BlobUser::StoreBlob(Blex::FileOffset numbytes, Blex::Stream &infile, BlobId restoreblobid)
{
        if (numbytes==0)
            return BlobId(0); //Just an empty file

        std::unique_ptr<Blex::Stream> outfile;
        BlobId blobid = StartUploadBlob(&outfile, restoreblobid);

        Blex::FileOffset byteswritten = infile.LimitedSendTo(numbytes,*outfile);

        //ADDME: Flush files, but only if a new blob manager allows us to do multiple flushes at once (flushing per file is tooo slow)
        if (byteswritten!=numbytes)
            throw Exception(ErrorIO,"Cannot store output file (database blob) - disk full on server?");

        return blobid;
}

BlobId BlobUser::StartUploadBlob(std::unique_ptr<Blex::Stream> *outfile, BlobId restoreblobid)
{
        outfile->reset();
        while (true)
        {
                /* Allocate a blobID by updating the blobcounter in the metadata */
                BlobId newblob_id = BlobManager::LockedBlobData::WriteRef(blobmgr.blobdata)->AllocateBlobId(restoreblobid);

                /* ADDME: Destroy all files we created if the transaction happens to be
                          rolled-back */
                std::string blobfile = blobmgr.GetBlobFilename(newblob_id,true);
                if(blobfile.empty())
                    throw Exception(ErrorIO,"StoreBlob cannot generate output file name");

                outfile->reset ( Blex::FileStream::OpenWrite(blobfile,true,true,Blex::FilePermissions::PrivateRead) );
                if (outfile->get())
                    return BlobId(newblob_id);

                if (Blex::PathStatus(blobfile).Exists())
                {
                    if (!restoreblobid)
                        Blex::ErrStream() << "Output blob file " << blobfile << " unexpectedly exists";
                    else
                        throw Exception(ErrorIO, "Output blob file " + blobfile + " unexpectedly exists during restore");
                }
                else
                    throw Exception(ErrorIO,"StoreBlob cannot open output file " + blobfile);
        }
}

BlobId BlobUser::RestoreBlobFile(std::string const &filename, bool hardlink, BlobId restoreblobid)
{
        BlobId newblob_id = BlobManager::LockedBlobData::WriteRef(blobmgr.blobdata)->AllocateBlobId(restoreblobid);

        std::string blobfile = blobmgr.GetBlobFilename(newblob_id,true);
        if(blobfile.empty())
            throw Exception(ErrorIO,"StoreBlob cannot generate output file name");

        BU_PRINT("Create hard link to " << filename << " on " << blobfile);
        bool res = hardlink
            ? Blex::CreateNewHardLink(blobfile, filename)
            : Blex::CreateNewSoftLink(blobfile, filename);

        BU_PRINT(" result: " << res);
        if (!res)
            throw Exception(ErrorIO,"StoreBlob cannot create link to output file " + filename + ": " + Blex::GetLastOSError());

        return BlobId(newblob_id);
}


void BlobUser::MarkAsInuse(BlobId blob, void *context)
{
        // ADDME: Mark it only once
        blobs_in_use.insert(std::make_pair(blob, context));

        BlobManager::LockedBlobData::WriteRef bloblock(blobmgr.blobdata);
        ++bloblock->usecounters[blob];

        BU_PRINT("BlobUser " << this << " - blob " << blob << " in use, context " << context << " (cnt: " << bloblock->usecounters[blob] << ")");
}

void BlobUser::MarkAsUnused(BlobId blob, void *context)
{
        BlobManager::LockedBlobData::WriteRef bloblock(blobmgr.blobdata);

#ifdef DEBUG
        bool found = false;
#endif

        std::pair< std::multimap< BlobId, void * >::iterator, std::multimap< BlobId, void * >::iterator > range = blobs_in_use.equal_range(blob);
        for (std::multimap< BlobId, void * >::iterator it = range.first; it != range.second; )
            if (it->second == context)
            {
                    std::map< BlobId, unsigned >::iterator uit = bloblock->usecounters.find(blob);
                    assert(uit != bloblock->usecounters.end());

#ifdef DEBUG
                    found = true;
#endif
                    BU_PRINT("BlobUser " << this << " - blob " << blob << " is dismissed, context " << context << " (cnt: " << (bloblock->usecounters[blob]-1) << ")");

                    if (--uit->second == 0)
                        bloblock->usecounters.erase(uit);

                    blobs_in_use.erase(it++);
            }
            else
                ++it;

#ifdef DEBUG
        if (!found)
            BU_PRINT("BlobUser " << this << " - blob " << blob << " is dismissed, context " << context << " NOT FOUND!");
#endif
}


bool BlobUser::IsInuse(BlobId blob) const
{
        std::multimap< BlobId, void * >::const_iterator it = blobs_in_use.lower_bound(blob);

        return (it != blobs_in_use.end() && it->first == blob);
}

void BlobUser::DestroyContext(void *context)
{
        BU_PRINT("BlobUser " << this << " - destroy destroyed context " << context);

        BlobManager::LockedBlobData::WriteRef bloblock(blobmgr.blobdata);

        for (std::multimap< BlobId, void * >::iterator it = blobs_in_use.begin(), end = blobs_in_use.end(); it != end;)
        {
                if (it->second == context)
                {
                        std::map< BlobId, unsigned >::iterator uit = bloblock->usecounters.find(it->first);
                        assert(uit != bloblock->usecounters.end());

                        BU_PRINT("BlobUser " << this << " - blob " << it->first << " is context-destroyed , context " << context << " (cnt: " << (uit->second - 1) << ")");

                        if (--uit->second == 0)
                            bloblock->usecounters.erase(uit);

                        blobs_in_use.erase(it++);
                }
                else
                     ++it;
        }
}


BlobManager::BlobManager(const std::string &_basefolder, const std::string &_recordfolder, bool _save_deleted_blobs, bool sync_enabled)
: basefolder(_basefolder)
, recordfolder(_recordfolder)
, save_deleted_blobs(_save_deleted_blobs)
, sync_enabled(sync_enabled)
{
        DEBUGONLY(blobdata.SetupDebugging("RawDatabase::blobdata"));

        //Open blob file
        LockedBlobData::WriteRef bloblock(blobdata);
        bloblock->file.reset(Blex::MmapFile::OpenRW(Blex::MergePath(recordfolder,"blobmap.whdb"),true,false,Blex::FilePermissions::PrivateRead,false,false,sync_enabled));
        if (!bloblock->file.get())
            throw Exception(ErrorIO,"Cannot open the blob map file: blobmap.whdb");

        //How many pages are in the file?
        unsigned numpages = (bloblock->file->GetFilelength() + BlobPageSize-1) / BlobPageSize;
        if (numpages==0)
        {
                if (Blex::PathStatus(basefolder+ "/blob").IsDir())
                    throw Exception(ErrorIO,"The blob map file has disappeared: blobmap.whdb");
                else
                    ++numpages;
        }

        //Set it to a proper size
        if (bloblock->file->GetFilelength() != numpages * BlobPageSize)
            bloblock->file->ExtendTo(numpages * BlobPageSize);

        //Cache the file size
        bloblock->filesize = bloblock->file->GetFilelength();

        //Map it!
        bloblock->blobmap = static_cast<Blex::IndependentBitmapType*>(bloblock->file->MapRW(0, bloblock->filesize));
        if (!bloblock->blobmap)
            throw Exception(ErrorIO,"Cannot open the blob map file: blobmap.whdb");
}

BlobManager::~BlobManager()
{
        LockedBlobData::WriteRef bloblock(blobdata);

        if (bloblock->blobmap)
            bloblock->file->Unmap(bloblock->blobmap, bloblock->filesize);
}

Blex::FileOffset BlobManager::GetBlobLength(BlobId blobid) const
{
        std::string name = GetBlobFilename(blobid, false);
        Blex::PathStatus status(name);
        if (!status.IsFile())
        {
                Blex::ErrStream() <<"I/O error: blobfile for blob " << blobid << " cannot be opened";
                return 0;
        }
        else
        {
                return status.FileLength();
        }

}

std::string BlobManager::GetBlobFilename(BlobId blobid, bool create_dir) const
{
        return GetBlobDiskpath(basefolder, blobid, create_dir);
}

BlobManager::BlobData::BlobData()
{
        speed_allocs_left = 0;
        last_allocated = 0;
}

BlobId BlobManager::BlobData::FindAvailableBlob()
{
        BlobId start = 1;
        if (speed_allocs_left != 0)
        {
                --speed_allocs_left;
                start = last_allocated + 1;
        }
        else
            speed_allocs_left = SpeedIdAllocs;

        BlobId maximum = HighestBlobID();

        for (BlobId i=start; i<=maximum; ++i) //blob 0 is reserved
        if (Blex::GetBit(blobmap,i) == false)
        {
                last_allocated = i;
                return i;
        }
        last_allocated = maximum+1;
        return maximum+1;
}

BlobId BlobManager::BlobData::HighestBlobID() const
{
        return filesize * 8 - 1;
}

BlobId BlobManager::BlobData::AllocateBlobId(BlobId import_blobid)
{
        /* ADDME: Ensure the blob ID increase is committed! */

        BlobId blobid;
        if (import_blobid == 0)
            blobid = FindAvailableBlob();
        else
        {
                // This code is only run when restoring a backup
                BlobId maximum = HighestBlobID();
                if (import_blobid <= maximum && Blex::GetBit(blobmap, import_blobid) == true)
                {
                        Blex::ErrStream() << "Cannot restore blob to its original location during restore";
                        Blex::FatalAbort();
                }
                blobid = import_blobid;
        }

        if (blobid > HighestBlobID())
        {
                // Round new blobid to bytes, then to blocks
                Blex::FileOffset newfilesize = blobid;
                newfilesize = Blex::RoundUpToMultipleOf< Blex::FileOffset >(newfilesize + 1, 8); // nr of bytes needed for this bit. Need 1 byte for bit 0.
                newfilesize = Blex::RoundUpToMultipleOf< Blex::FileOffset >(newfilesize, BlobPageSize);

                //expand the blob file!
                file->Unmap(blobmap,filesize);
                if (!file->ExtendTo(newfilesize))
                {
                        Blex::ErrStream() << "Unable to expand the database blob file - extend failed";
                        Blex::FatalAbort();
                }
                if (file->GetFilelength() < newfilesize)
                {
                        Blex::ErrStream() << "Unable to expand the database blob file - file did not grow in size";
                        Blex::FatalAbort();
                }
                filesize = file->GetFilelength();
                blobmap = static_cast<Blex::IndependentBitmapType*>(file->MapRW(0, filesize));
                if (!blobmap)
                {
                        Blex::ErrStream() << "Unable to expand the database blob file - file could not be mapped again";
                        Blex::FatalAbort();
                }
        }

        Blex::SetBit(blobmap,blobid,true);
        return blobid;
}

void BlobManager::GetBlobSnapshot(std::vector<Blex::IndependentBitmapType> &receive_blobdata)
{
        LockedBlobData::WriteRef bloblock(blobdata);
        receive_blobdata.assign(bloblock->blobmap, bloblock->blobmap + static_cast<uint32_t>(bloblock->filesize));

}

void BlobManager::ClearBlobs(std::vector<Blex::IndependentBitmapType> const &delete_blobdata)
{
        typedef std::vector< std::pair< BlobId, std::string > > DeleteList;
        DeleteList to_delete;

        {
                LockedBlobData::WriteRef bloblock(blobdata);
                BlobId maximum = std::min<BlobId>(bloblock->HighestBlobID(), delete_blobdata.size()*8);
                for (BlobId i=1;i<maximum;++i)
                {
                        if (Blex::GetBit(&delete_blobdata[0],i) == true)
                        {
                                // Check if the blob is crrently in use
                                std::map< BlobId, unsigned >::iterator uit = bloblock->usecounters.find(i);
                                if (uit != bloblock->usecounters.end())
                                {
                                        BU_PRINT("Skipping deleting blob " << i << ", it is still in use");
                                        continue;
                                }

                                to_delete.push_back(std::make_pair(i, GetBlobFilename(i,false)));
                        }
                }
        }

        for (DeleteList::const_iterator it = to_delete.begin(); it != to_delete.end(); ++it)
        {
                BU_PRINT("Delete blob " << it->first);

                if (save_deleted_blobs)
                {
                        std::string deleted_blobs_folder = basefolder + "/deleted_blobs";
                        if (!Blex::PathStatus(deleted_blobs_folder).IsDir() && !Blex::CreateDir(deleted_blobs_folder,true))
                            throw Exception(ErrorIO,"Cannot create the deleted blobs folder");

                        Blex::MovePath(it->second, deleted_blobs_folder + "/blob-" + Blex::AnyToString(it->first) + "-" + Blex::AnyToString(Blex::DateTime::Now().GetMsecs()));
                }
                else
                {
                        if(!Blex::RemoveFile(it->second))
                            Blex::ErrStream() << "Unable to delete unreferenced blob " << it->second;
                }
        }

        {
                LockedBlobData::WriteRef bloblock(blobdata);
                for (DeleteList::const_iterator it = to_delete.begin(); it != to_delete.end(); ++it)
                    Blex::SetBit(bloblock->blobmap,it->first,false);
        }
}

void BlobManager::UpdateAndSync()
{
        BlobManager::LockedBlobData::WriteRef bloblock(blobdata);
        bloblock->file->SetModificationDate(Blex::DateTime::Now());
}

void BlobManager::ExportUsedBlobs(Blex::PodVector< BlobId > *ids) const
{
        BlobManager::LockedBlobData::ReadRef bloblock(blobdata);

        for (auto &itr: bloblock->usecounters)
            ids->push_back(itr.first);
}

} //end namespace Database
