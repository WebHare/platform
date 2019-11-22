#ifndef blex_webhare_harescript_hsvm_blobmanager
#define blex_webhare_harescript_hsvm_blobmanager
//---------------------------------------------------------------------------

#include <blex/mmapfile.h>
#include "hsvm_constants.h"
#include "filesystem.h"
#include <blex/complexfs.h>
#include <cstddef>

//#include "hsvm_idmapstorage.h"

namespace HareScript
{

class BlobRefPtr;
class OpenedEmptyBlob;
class GlobalBlobManager;
template< class A > class InternalOpenedBlobBase;

class BLEXLIB_PUBLIC OpenedBlob
{
   private:
       OpenedBlob();
   public:
       virtual ~OpenedBlob();
       virtual std::size_t DirectRead(Blex::FileOffset startoffset, std::size_t numbytes, void *buffer) = 0;
       template< class A > friend class InternalOpenedBlobBase;
       friend class OpenedEmptyBlob;
};

// Derive from this for the OpenBlobBase from this class
template< class A >
    class InternalOpenedBlobBase: public OpenedBlob
{
    protected:
        A &blob;
    public:
        typedef A BlobType;

        InternalOpenedBlobBase(A &_blob) : blob(_blob){ blob.InternalAddReference(); }
        virtual ~InternalOpenedBlobBase() { blob.InternalRemoveReference(); }
};


class BLEXLIB_PUBLIC OpenedEmptyBlob: public OpenedBlob
{
        ~OpenedEmptyBlob();
        virtual std::size_t DirectRead(Blex::FileOffset startoffset, std::size_t numbytes, void *buffer);
};

class BLEXLIB_PUBLIC BlobBase : public VarMemRefCounted
{
    protected:
        VirtualMachine *vm;

        template< class A >
         using OpenedBlobBase = InternalOpenedBlobBase< A >;

    private:
        Blex::FileOffset cachedlength;

    public:
        /** Constructor */
        explicit BlobBase(VirtualMachine *vm, Blex::FileOffset cachedlength = std::numeric_limits< Blex::FileOffset >::max());

        virtual ~BlobBase();

        /** Open the blob for reading */
        virtual std::unique_ptr< OpenedBlob > OpenBlob() = 0;

        virtual Blex::FileOffset GetCacheableLength() = 0;

        /** Returns the blob modtime */
        virtual Blex::DateTime GetModTime() = 0;

        /** Returns a description for this blob */
        virtual std::string GetDescription() = 0;

        /** Returns the blob length, and caches it */
        Blex::FileOffset GetLength();

        /// Context keeper
        Blex::ContextKeeper keeper;

        friend class BlobRefPtr;
        template< class A > friend class InternalOpenedBlobBase;

        friend class BlobRefPtr;
        friend class VarMemory;
};

/** Reference counting pointer for blob objects. A BlobRefPtr is only
    valid while the VM in which it was creates is still alive! */
class BLEXLIB_PUBLIC BlobRefPtr
{
    private:
        BlobBase *ptr;

    public:
        explicit BlobRefPtr(BlobBase *ptr);
        BlobRefPtr(BlobRefPtr const &rhs);
        ~BlobRefPtr();

        void reset(BlobBase *newptr)
        {
                if (newptr)
                    newptr->InternalAddReference();
                std::swap(ptr, newptr);
                if (newptr)
                    newptr->InternalRemoveReference();
        }
        BlobRefPtr & operator =(const BlobRefPtr &rhs)
        {
                reset(rhs.ptr);
                return *this;
        }

        /** Open the blob */
        std::unique_ptr< OpenedBlob > OpenBlob() { return ptr ? ptr->OpenBlob() : std::unique_ptr< OpenedBlob >(new OpenedEmptyBlob); }

        /** Get data from the blob */
//        std::size_t DirectRead(Blex::FileOffset startoffset, std::size_t numbytes, void *buffer)
//        { return ptr ? ptr->DirectRead(startoffset, numbytes, buffer) : 0; }

        /** Returns the blob length, requesting and caching if necessary */
        Blex::FileOffset GetLength()
        { return ptr ? ptr->GetLength() : 0; }

        /** Returns the blob modification date */
        Blex::DateTime GetModTime()
        { return ptr ? ptr->GetModTime() : Blex::DateTime::Invalid(); }

        std::string GetDescription()
        { return ptr ? ptr->GetDescription() : "empty"; }

        void *GetContext(unsigned id, bool autocreate)
        { return ptr ? ptr->keeper.GetContext(id, autocreate) : NULL; }

        // Get the pointer to the blob
        BlobBase *GetPtr() { return ptr; }

        friend class VarMemory;
};


/** Blob stored in the global blob manager.
*/
class BLEXLIB_PUBLIC GlobalBlob
{
    private:
        GlobalBlobManager &manager;

        std::unique_ptr< Blex::ComplexFileStream > stream;

        std::string name;

        GlobalBlob(GlobalBlobManager &_manager, std::unique_ptr< Blex::ComplexFileStream > _stream, std::string_view _name);

    public:
        ~GlobalBlob();

        /** Get data from the blob */
        std::size_t DirectRead(Blex::FileOffset startoffset, std::size_t numbytes, void *buffer);

        /** Returns the blob length, requesting and caching if necessary */
        Blex::FileOffset GetLength();

        /** Returns a blob description */
        std::string GetDescription();

        void AddUsage(VirtualMachine *vm);
        void RemoveUsage(VirtualMachine *vm);

        friend class GlobalBlobManager;
};


/** Blob manager for a entire webhare process
*/
class BLEXLIB_PUBLIC GlobalBlobManager
{
    private:
        /// File system for storage
        std::unique_ptr< Blex::ComplexFileSystem > fs;

        struct Data
        {
                /// Refcounts per blob
                std::map< std::string, unsigned > refcounts;

                /// Blob usage per VM
                std::map< VirtualMachine *, uint64_t > usages;
        };
        typedef Blex::InterlockedData< Data, Blex::Mutex > LockedData;

        LockedData data;

        /// Add a reference by name
        void AddReference(std::string const &name);

        /// Register a stream for a specific VM
        void AddUsage(VirtualMachine *vm, Blex::FileOffset length);

        /// Unregister a stream for a specific VM
        void RemoveUsage(VirtualMachine *vm, Blex::FileOffset length);

    public:
        explicit GlobalBlobManager(std::string const &tmpdir);
        ~GlobalBlobManager();

        /// Create a new stream
        std::unique_ptr< Blex::ComplexFileStream > CreateTempStream(std::string *name);

        // Convert an existing stream into a blob
        std::shared_ptr< GlobalBlob > BuildBlobFromTempStream(std::unique_ptr< Blex::ComplexFileStream > file, std::string const &name);

        // Create a blob reference ptr from a global blob
        BlobRefPtr BuildBlobFromGlobalBlob(VirtualMachine *vm, std::shared_ptr< GlobalBlob > const &globalblob);

        // Internalize a blob
        std::shared_ptr< GlobalBlob > ConvertToGlobalBlob(BlobRefPtr blob);

        /// Remove a reference by name
        void RemoveReference(std::string const &name);

        /** Return the total blob usage for a specific VM
        */
        uint64_t GetBlobUsage(VirtualMachine *vm);

        friend class GlobalBlob; // for AddUsage / RemoveUsage
};


/* Contains a blob, maintains a reference count, and deletes itself when not used anymore
   A blob object is only used within one specific VM - threadsafe when serialized! */
class BLEXLIB_PUBLIC ReferencedGlobalBlob : public BlobBase
{
    private:
        std::shared_ptr< GlobalBlob > globalblob;

        class MyOpenedBlob: public OpenedBlobBase< ReferencedGlobalBlob >
        {
            public:
                MyOpenedBlob(ReferencedGlobalBlob &blob) : OpenedBlobBase< ReferencedGlobalBlob >(blob) {}

                std::size_t DirectRead(Blex::FileOffset startoffset, std::size_t numbytes, void *buffer);
        };

    public:
        /** Constructor */
        ReferencedGlobalBlob(VirtualMachine *_vm, std::shared_ptr< GlobalBlob > _globalblob);

        virtual ~ReferencedGlobalBlob();

        virtual std::unique_ptr< OpenedBlob > OpenBlob();
        virtual Blex::FileOffset GetCacheableLength();
        virtual Blex::DateTime GetModTime();
        virtual std::string GetDescription();

    private:
        friend class OpenedBlob;
        friend class GlobalBlobManager;
};


} // End of namespace HareScript

//---------------------------------------------------------------------------
#endif
