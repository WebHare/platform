//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------

#include "hsvm_dllinterface_blex.h"
#include "hsvm_blobinterface.h"
#include "hsvm_context.h"
#include <blex/path.h>
#include <blex/logfile.h>
/*
ADDME: Try to set a limit on the amount of mapped-in memory
ADDME: Map in smaller-sized blocks to limit VM fragmentation
*/

//#define SHOW_BLOBMANAGER

#ifdef SHOW_BLOBMANAGER
 #define BLOB_PRINT(x) DEBUGPRINT(x)
#else
 #define BLOB_PRINT(x) (void)0
#endif

namespace HareScript
{

//---------------------------------------------------------------------------
//
// OpenedBlob
//
//---------------------------------------------------------------------------

OpenedBlob::OpenedBlob()
{
}

OpenedBlob::~OpenedBlob()
{
}

//---------------------------------------------------------------------------
//
// OpenedEmptyBlob
//
//---------------------------------------------------------------------------

OpenedEmptyBlob::~OpenedEmptyBlob()
{
}

std::size_t OpenedEmptyBlob::DirectRead(Blex::FileOffset, std::size_t, void *)
{
        return 0;
}

//---------------------------------------------------------------------------
//
// BlobBase
//
//---------------------------------------------------------------------------

BlobBase::BlobBase(VirtualMachine *_vm, Blex::FileOffset _cachedlength)
: vm(_vm)
, cachedlength(_cachedlength)
, keeper(vm->GetEnvironment().GetContextReg())
{
        DEBUGPRINT("Create blob " << this);
}

BlobBase::~BlobBase()
{
        DEBUGPRINT("Destroy blob " << this);
}

Blex::FileOffset BlobBase::GetLength()
{
        DEBUGPRINT("GetLength for " << this->GetDescription() << ", cached: " << cachedlength);
        if (cachedlength == std::numeric_limits< Blex::FileOffset >::max())
            cachedlength = GetCacheableLength();
        return cachedlength;
}

//---------------------------------------------------------------------------
//
// GlobalBlobManager
//
//---------------------------------------------------------------------------

GlobalBlobManager::GlobalBlobManager(std::string const &tmpdir)
{
        std::string str = Blex::CreateTempName(Blex::MergePath(tmpdir, "blobs-"));
        fs.reset(new Blex::ComplexFileSystem(str, true));
}

GlobalBlobManager::~GlobalBlobManager()
{
}

std::unique_ptr< Blex::ComplexFileStream > GlobalBlobManager::CreateTempStream(std::string *name)
{
        LockedData::WriteRef lock(data);
        std::unique_ptr< Blex::ComplexFileStream > file(fs->CreateTempFile(name));
        if(!file)
            return std::unique_ptr< Blex::ComplexFileStream >();

        unsigned &ref = lock->refcounts[*name];
        ++ref;

        BLOB_PRINT("Creating temp stream " << *name);
        return file;
}

std::shared_ptr< GlobalBlob > GlobalBlobManager::BuildBlobFromTempStream(std::unique_ptr< Blex::ComplexFileStream > file, std::string const &name)
{
        {
                LockedData::WriteRef lock(data);
                ++lock->refcounts[name];
        }

        return std::shared_ptr< GlobalBlob >(new GlobalBlob(*this, std::move(file), name));
}

void GlobalBlobManager::AddReference(std::string const &name)
{
        LockedData::WriteRef lock(data);
        unsigned &ref = lock->refcounts[name];
        ++ref;

        BLOB_PRINT("Adding reference for " << name << " refcount: " << ref);
}

void GlobalBlobManager::RemoveReference(std::string const &name)
{
        bool need_delete = false;
        {
                LockedData::WriteRef lock(data);
                auto itr = lock->refcounts.find(name);
                if (itr != lock->refcounts.end()) // shouldn't happen, but still
                {
                        need_delete = --itr->second == 0;
                        BLOB_PRINT("Removed reference for " << name << " refcount: " << *itr);
                        if (need_delete)
                            lock->refcounts.erase(itr);
                }
        }
        if (need_delete)
            fs->DeletePath(name);
}

void GlobalBlobManager::AddUsage(VirtualMachine *vm, Blex::FileOffset length)
{
        if (length)
        {
                LockedData::WriteRef lock(data);
                lock->usages[vm]+=length;

                BLOB_PRINT("Adding length " << length << " for VM " << vm << ", now registered length: " << lock->usages[vm]);
        }
}

void GlobalBlobManager::RemoveUsage(VirtualMachine *vm, Blex::FileOffset length)
{
        if (length)
        {
                LockedData::WriteRef lock(data);
                lock->usages[vm]-=length;

                BLOB_PRINT("Removing length " << length << " for VM " << vm << ", now registered length: " << lock->usages[vm]);
        }
}

uint64_t GlobalBlobManager::GetBlobUsage(VirtualMachine *vm)
{
        LockedData::WriteRef lock(data);
        auto it = lock->usages.find(vm);
        if (it != lock->usages.end())
           return it->second;
        return 0;
}

BlobRefPtr GlobalBlobManager::BuildBlobFromGlobalBlob(VirtualMachine *vm, std::shared_ptr< GlobalBlob > const &globalblob)
{
        return BlobRefPtr(new ReferencedGlobalBlob(vm, globalblob));
}

std::shared_ptr< GlobalBlob > GlobalBlobManager::ConvertToGlobalBlob(BlobRefPtr blob)
{
        ReferencedGlobalBlob *vmglobalblob = dynamic_cast< ReferencedGlobalBlob * >(blob.GetPtr());
        if (vmglobalblob)
            return vmglobalblob->globalblob;

        std::string blobcopyname;
        auto file = CreateTempStream(&blobcopyname);

        {
                std::unique_ptr< OpenedBlob > openblob(blob.OpenBlob());
                Blex::FileOffset len = blob.GetLength(), ofs = 0;

                uint8_t buffer[16384];
                while (ofs != len)
                {
                        size_t toread = std::min< Blex::FileOffset >(len - ofs, sizeof(buffer));
                        std::size_t bytesread = openblob->DirectRead(ofs, toread, buffer);
                        if (!bytesread)
                            break;
                        if (file->Write(buffer, bytesread) != bytesread)
                           break;
                        ofs += bytesread;
                }
        }

        return BuildBlobFromTempStream(std::move(file), blobcopyname);
}

//---------------------------------------------------------------------------
//
// BlobRefPtr
//
//---------------------------------------------------------------------------

BlobRefPtr::BlobRefPtr(BlobBase *ptr)
: ptr(ptr)
{
        if (ptr)
            ptr->InternalAddReference();
}

BlobRefPtr::BlobRefPtr(BlobRefPtr const &rhs)
: ptr(rhs.ptr)
{
        if (ptr)
            ptr->InternalAddReference();
}
BlobRefPtr::~BlobRefPtr()
{
        if (ptr)
            ptr->InternalRemoveReference();
}

//---------------------------------------------------------------------------
//
// GlobalBlob
//
//---------------------------------------------------------------------------

GlobalBlob::GlobalBlob(GlobalBlobManager &_manager, std::unique_ptr< Blex::ComplexFileStream > _stream, std::string_view _name)
: manager(_manager)
, stream(std::move(_stream))
, name(_name)
{
}

GlobalBlob::~GlobalBlob()
{
        manager.RemoveReference(name);
}

std::size_t GlobalBlob::DirectRead(Blex::FileOffset startoffset, std::size_t numbytes, void *buffer)
{
        return stream->DirectRead(startoffset, buffer, numbytes);
}

Blex::FileOffset GlobalBlob::GetLength()
{
        return stream->GetFileLength();
}

void GlobalBlob::AddUsage(VirtualMachine *vm)
{
        manager.AddUsage(vm, stream->GetFileLength());
}

void GlobalBlob::RemoveUsage(VirtualMachine *vm)
{
        manager.RemoveUsage(vm, stream->GetFileLength());
}

std::string GlobalBlob::GetDescription()
{
        return "local blob " + name;
}

//---------------------------------------------------------------------------
//
// ReferencedGlobalBlob
//
//---------------------------------------------------------------------------

std::size_t ReferencedGlobalBlob::MyOpenedBlob::DirectRead(Blex::FileOffset startoffset, std::size_t numbytes, void *buffer)
{
        return blob.globalblob->DirectRead(startoffset, numbytes, buffer);
}

ReferencedGlobalBlob::ReferencedGlobalBlob(VirtualMachine *vm, std::shared_ptr< GlobalBlob > _globalblob)
: BlobBase(vm)
, globalblob(std::move(_globalblob))
{
        globalblob->AddUsage(vm);
}

ReferencedGlobalBlob::~ReferencedGlobalBlob()
{
        globalblob->RemoveUsage(vm);
}

std::unique_ptr< OpenedBlob > ReferencedGlobalBlob::OpenBlob()
{
        return std::unique_ptr< OpenedBlob >(new MyOpenedBlob(*this));
}

Blex::FileOffset ReferencedGlobalBlob::GetCacheableLength()
{
        return globalblob->GetLength();
}

Blex::DateTime ReferencedGlobalBlob::GetModTime()
{
        return Blex::DateTime::Invalid();
}

std::string ReferencedGlobalBlob::GetDescription()
{
        return globalblob->GetDescription();
}


} // End of namespace HareScript
