#ifndef blex_webhare_dbase_dbase_blobmgr
#define blex_webhare_dbase_dbase_blobmgr

#include <blex/bitmanip.h>
#include <ap/libwebhare/dbase.h>
#include "dbase_types.h"
#include <blex/mmapfile.h>

namespace Database
{

/** The blob manager class. When we move to more advanced blob handling, we'll
    probably split this off into a separate file */
class BlobManager
{
    public:
        BlobManager(const std::string &basefolder, const std::string &recordfolder, bool save_deleted_blobs, bool enable_sync);
        ~BlobManager();

        /** Get a snapshot of the current blob data */
        void GetBlobSnapshot(std::vector<Blex::IndependentBitmapType> &blobdata);

        /** Destroy blobs that are still set (except those that still have a non-zero usecounter   */
        void ClearBlobs(std::vector<Blex::IndependentBitmapType> const &blobdata);

        /** Get the filename associated with a blobid
            @param blobid Blob ID
            @param create_dirs Create the dirs needed to store the blob (necessary when creating new blobs)
            @return Path to the blob */
        std::string GetBlobFilename(BlobId blobid, bool create_dirs) const;

        Blex::FileOffset GetBlobLength(BlobId blobid) const;

        /** Update the modification time of the blobmap file, and speed up its contents sync */
        void UpdateAndSync();

        /** Export the ids of used blobs
        */
        void ExportUsedBlobs(Blex::PodVector< BlobId > *ids) const;

    private:
        struct BlobData
        {
                BlobData();

                ///Get the next available blob id
                BlobId FindAvailableBlob();
                ///Highest blob ID about which we have info
                BlobId HighestBlobID() const;
                /** Allocate a new blob id
                    @param importblobid Import blob id, only non-0 when importing during a backup restore
                */
                BlobId AllocateBlobId(BlobId importblobid = 0);
                ///The blob map
                std::shared_ptr<Blex::MmapFile> file;
                ///Cached size of the blob map
                Blex::FileOffset filesize;
                ///Pointer to the current blob map
                Blex::IndependentBitmapType *blobmap;
                ///Usecounters for blobs
                std::map< BlobId, unsigned > usecounters;
                ///Last last_allocated blob id
                BlobId last_allocated;
                ///Counter until next start at 0
                unsigned speed_allocs_left;
        };

#ifdef DEBUG
        typedef Blex::InterlockedData<BlobData, Blex::DebugMutex> LockedBlobData;
#else
        typedef Blex::InterlockedData<BlobData, Blex::Mutex> LockedBlobData;
#endif
        LockedBlobData blobdata;

        std::string const basefolder;
        std::string const recordfolder;

        bool const save_deleted_blobs;

                bool const sync_enabled;

        friend class BlobUser; //our per-transaction access class
};

/** A blob user class. Required to access database blobs */
class BlobUser
{
    public:
        ///Construct a blob user
        BlobUser(BlobManager &blobmgr);

        ///Destroy blob user, delete uncommited blobs
        ~BlobUser();

        /** Prepare to receive a blob
            @param outfile Stream to send the blob to
            @param restoreblobid Force using this blob id (for restoring a backup only, must be 0 otherwise)
            @return Returns id of the newly created blob
        */
        BlobId StartUploadBlob(std::unique_ptr<Blex::Stream> *outfile, BlobId restoreblobid);

        /** Store the contents of a Blob
            @param numbytes Length of the blob
            @param stream Stream containing the source for the blob
            @param restoreblobid Force using this blob id (for restoring a backup only, must be 0 otherwise)
            @return Returns id of the newly stored blob
        */
        BlobId StoreBlob(Blex::FileOffset numbytes, Blex::Stream &infile, BlobId restoreblobid);

        /** Restores a blob by making a link in the blob dir (for database restores only)
            @param filename Name of the file to import
            @param hardlink If true, make hard link, else soft link
            @param restoreblobid Use blob id
            @return Returns id of the newly created blob
        */
        BlobId RestoreBlobFile(std::string const &filename, bool hardlink, BlobId restoreblobid);

        /** Mark the blob as in-use, so it cannot be destroyed while this blobuser
            class exists
            @param blob Blob that is now inuse
        */
        void MarkAsInuse(BlobId blob, void *context);

        /** Mark the blob as unused, so it can be destroyed
            @param blob Blob that is now not used anymore
        */
        void MarkAsUnused(BlobId blob, void *context);

        /** Returns whether a blob has been marked as in use, in any context.
            @param blob Blob to query
            @return Return whether the blob has been marked as inuse
        */
        bool IsInuse(BlobId blob) const;

        /** Deletes all blob uses for a specific context
            @param context Context to clear all blob uses for
        */
        void DestroyContext(void *context);

        /** Get the filename associated with a blobid
            @param blobid Blob ID
            @return Path to the blob */
        std::string GetBlobFilename(BlobId blobid) const
        {
                return blobmgr.GetBlobFilename(blobid,false);
        }
        Blex::FileOffset GetBlobLength(BlobId blobid) const
        {
                return blobmgr.GetBlobLength(blobid);
        }

        /** Resets the blobuser for new uses (like destruction and then recreation) */
        void Reset();

    private:
        BlobManager &blobmgr;

        /// List of blobs that have been marked as in use
        std::multimap< BlobId, void * > blobs_in_use;
};


} //end namespace Database

#endif
