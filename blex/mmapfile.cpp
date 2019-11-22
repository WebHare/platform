#include <blex/blexlib.h>


#include <unistd.h>
#include <sys/mman.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>

#include "mmapfile.h"
#include "threads.h"
#include "path.h"
#include "logfile.h"
#include <sstream>
#include <iostream>
#include <cerrno>

//#define DEBUG_SECTIONFILE
//#define DEBUG_SECTIONFILECLEANUP


namespace Blex {

namespace
{

void MmapDoUnmap(void const *mappingstart, std::size_t length, bool autosync)
{
        //msync just in case. this is an attempt to see if this fixes OSX, but shouldn't hurt that much to enable it everywhere ?
        //see eg https://groups.google.com/forum/#!msg/leveldb/GXhx8YvFiig/MlV4v9gvfZ4J and https://github.com/rescrv/StockLevelDB/commit/2a7e84a4bef118be3c3e8253ffbc6279b9ab54da
        //does forced invalidation help?
        if (autosync)
            msync(const_cast<void*>(mappingstart), length, MS_SYNC);//|MS_INVALIDATE);

        //munmap wants a void*, not sure why
        if (munmap(const_cast<void*>(mappingstart),length)!=0)
            throw std::runtime_error("munmap failed");
}

}

template <typename T, typename W > bool inline IsIn(T value, W start, W rangelimit)
{
        return value >= start && value < rangelimit;
}

void MmapFile::CheckOverlaps(FileOffset start,std::size_t length) //throw()
{
        LockedData::ReadRef lock(data);
        Mappings const &mappings(lock->mappings);

        for (unsigned i=0;i<mappings.size();++i)
          if (IsIn (start,mappings[i].startoffset,mappings[i].startoffset+mappings[i].length)
              || IsIn (start+length-1,mappings[i].startoffset,mappings[i].startoffset+mappings[i].length) )
        {
                DEBUGPRINT("\aWARNING! New mapping " << start
                          << " len " << length
                          << " overlaps with mapping " << mappings[i].startoffset
                          << " len " << mappings[i].length);
        }
}

bool MmapFile::IsAreaMapped(const void *ptr, std::size_t numbytes) const
{
        LockedData::ReadRef lock(data);
        Mappings const &mappings(lock->mappings);

        const uint8_t *start = static_cast<const uint8_t*>(ptr);

        for (unsigned i=0;i<mappings.size();++i)
          if (IsIn(start, mappings[i].ptr, mappings[i].ptr + mappings[i].length)
              || IsIn(start+numbytes-1, mappings[i].ptr, mappings[i].ptr+mappings[i].length) )
            return true;

        return false;
}

bool MmapFile::AnyMappings() const
{
        LockedData::ReadRef lock(data);
        Mappings const &mappings(lock->mappings);

        return mappings.empty() == false;
}

MmapFile::MmapFile() //throw()
: filehandle(0)
, enable_autosync(true)
{
}

/** Destroy a memory-mapped file */
MmapFile::~MmapFile() //throw()
{
#ifdef DEBUG
        {
            // Lock within own scope, UnmapAll also locks.
            LockedData::ReadRef lock(data);
            Mappings const &mappings(lock->mappings);

            for (unsigned i=0;i<mappings.size();++i)
            {
                    DEBUGPRINT("\aWarning! Leftover mapping: pointer " << (void*)mappings[i].ptr
                               << " start " << mappings[i].startoffset
                               << " len " << mappings[i].length);
            }
        }
#endif

        UnmapAll();

        close(filehandle);
}

bool MmapFile::InternalOpen(const std::string &filename,
                                     bool _writeaccess,
                                          bool create_file,
                                          bool exclusive_create,
                                          FilePermissions::AccessFlags accessmode,
                                     bool shareable,
                                     bool delete_after_close,
                                     bool _enable_autosync)
                                     //throw()

{
        DEBUGONLY(data.SetupDebugging("MmapFile mappings lock"));
        writeaccess=_writeaccess;
        path=filename;
        enable_autosync=_enable_autosync;
        int openflags = O_NOCTTY
                        | (writeaccess ? O_RDWR : O_RDONLY)
                        | (create_file ? O_CREAT : 0)
                        | (exclusive_create ? O_EXCL : 0);
#ifdef PLATFORM_LINUX
        openflags |= O_CLOEXEC;
#endif
        filehandle = open(filename.c_str(),openflags,accessmode);
        if (filehandle==-1)
            return false;
#ifndef PLATFORM_LINUX
        fcntl(filehandle, F_SETFD, 1);//set close-on-exc
#endif
        if (delete_after_close) //On Unix, it's OK to delete open files (ADDME: is that true on all filesystems?)
            unlink(filename.c_str());

        if (!shareable)
        {
                //Lock the entire file
                struct flock lock_file;
                lock_file.l_type=writeaccess ? F_WRLCK : F_RDLCK;
                lock_file.l_whence=SEEK_SET;
                lock_file.l_start=0;
                lock_file.l_len=std::numeric_limits<off_t>::max();
                if (fcntl(filehandle, F_SETLK, &lock_file) != 0) //lock error
                {
                        //ADDME: If we created the file, we should probably delete it?
                        close(filehandle);
                        return false;
                }
        }
        return true;
}

/** Open a mmap for read access */
MmapFile* MmapFile::OpenRO(const std::string &filename, bool shareable) //throw (std::bad_alloc)
{
        std::unique_ptr<MmapFile> mmap (new MmapFile);
        if (mmap->InternalOpen(filename,false,false,false,FilePermissions::PublicRead,shareable,false,true))
            return mmap.release();

        DEBUGPRINT("MmapFile::OpenRO() failed to open file " << filename);
        return NULL;
}

/** Open a mmap for read/write access */
MmapFile* MmapFile::OpenRW(const std::string &filename,bool create, bool exclusive, FilePermissions::AccessFlags access, bool shareable, bool delete_on_close, bool enable_autosync) //throw (std::bad_alloc)
{
        std::unique_ptr<MmapFile> mmap (new MmapFile);
        if (mmap->InternalOpen(filename,true,create,exclusive,access,shareable,delete_on_close,enable_autosync))
            return mmap.release();

        DEBUGPRINT("MmapFile::OpenRW() failed to open file " << filename);
        return NULL;
}

bool MmapFile::ExtendTo(FileOffset numbytes) //throw()
{
        if (numbytes <= GetFilelength())
            return true; //already done!

        //Move to the end of the new file
        lseek(filehandle,numbytes-1,SEEK_SET);
        //Write a single byte to extend the file
        uint8_t byte=0;
        return write(filehandle,&byte,1)==1;
}


bool MmapFile::RegisterMapping(FileOffset start,std::size_t length, void *ptr, bool write_access) //throw()
{
        try //if push_back fails, noone has the mapping!
        {
                LockedData::WriteRef lock(data);
                Mappings &mappings(lock->mappings);
                mappings.push_back(Mapping(ptr,start,length,write_access));
        }
        catch(std::bad_alloc &)
        {
                return false;
        }
        return true;
}


void *MmapFile::DoMap(FileOffset start,std::size_t length, bool readonly) //throw()
{
        DEBUGONLY(CheckOverlaps(start,length));

        void *map = mmap(0,length, readonly ? PROT_READ : (PROT_READ|PROT_WRITE), MAP_SHARED,filehandle,start);
        if (map == reinterpret_cast<void*>(-1))
            return NULL;

        if (!RegisterMapping(start,length,map,!readonly)) //registration fialed?
        {
                MmapDoUnmap(map, length, enable_autosync);
                return NULL;
        }
        return map;
}

bool MmapFile::UnregisterMapping(const void *ptr,std::size_t length)
{
        LockedData::WriteRef lock(data);
        Mappings &mappings(lock->mappings);

        for (unsigned i=0;i<mappings.size();++i)
          if (mappings[i].ptr==ptr && mappings[i].length==length)
        {
                mappings.erase(mappings.begin() + i);
                return true;
        }
        return false;
}


void const *MmapFile::MapRO(FileOffset start,std::size_t length)
{
        return DoMap(start, length, true);
}

/** Open a mapping
    @return Mapped data, or 0 upon error */
void *MmapFile::MapRW(FileOffset start,std::size_t length)
{
        return DoMap(start, length, false);
}

/** Close and flush a mapping
    @param mappingstart Start of the mapping, which must be the return value of a previous MapRW call
    @return false upon unmap failure */
void MmapFile::Unmap(void const *mappingstart, std::size_t length) //throw()
{
        if (!UnregisterMapping(mappingstart,length))
        {
                Blex::ErrStream() << "Attempting to unmap a mmap'ed region that was never mapped into memory";
                Blex::FatalAbort();
        }

        MmapDoUnmap(mappingstart, length, enable_autosync);
}

FileOffset MmapFile::GetFilelength() //throw()
{
        struct stat buf;
        if(fstat(filehandle,&buf) != 0 || !S_ISREG(buf.st_mode))
                return 0;
        return buf.st_size;
}

/** Closes and flushes all mappings
    @return false upon unmap failure */
void MmapFile::UnmapAll() // throw()
{
        Mappings copy;
        {
                LockedData::WriteRef lock(data);
                copy = lock->mappings;
        }
        for (unsigned i=0;i<copy.size();++i)
          Unmap(copy[i].ptr, copy[i].length);
}

/** Synchronize a mapping to disk
    @param start Start of the range to flush
    @param numbytes Number of bytes to flush
    @return false upon sync failure */
bool MmapFile::Sync(void *start, std::size_t numbytes, bool ignore_unmapped) const //throw()
{
        // Check if the area is mapped. If not, return false (MT issues can cause this)
        if (!IsAreaMapped(start,numbytes))
        {
                if(!ignore_unmapped)
                        ErrStream() << "Tried to sync " << path << " from " << numbytes << " len " << start << " but not mapped";
                return ignore_unmapped; // throw std::runtime_error("Sync: Trying to synchronize a non-mapped area");
        }

        bool allok=true, fatal=false;
        if(msync(start,numbytes,MS_SYNC)!=0)
        {
                allok = false;
                fatal = errno != ENOMEM;
        }

#ifdef PLATFORM_DARWIN
        if(allok && fcntl(filehandle, F_FULLFSYNC, 0) == -1)
            allok = false;
#endif
        if(allok)
                return true;

        ErrStream() << "Tried to sync " << path << " from " << numbytes << " len " << start << " but failed with errno #" << errno;
        return !fatal;
}

bool MmapFile::SyncAll() const
{
        // Make a copy
        Mappings copy;
        {
                LockedData::ReadRef lock(data);
                copy = lock->mappings;
        }

        bool success=true;
        for (unsigned i=0;i<copy.size();++i)
          if (!Sync(copy[i].ptr, copy[i].length, true))
            success=false;

#if defined(PLATFORM_LINUX)
        if(fdatasync(filehandle)!=0)
        {
                ErrStream() << "Tried to fdatasync " << path << " but failed with errno #" << errno;
                success = false;
        }
#else
        if(fsync(filehandle)!=0)
        {
                ErrStream() << "Tried to fsync " << path << " but failed with errno #" << errno;
                success = false;
        }
#if defined(PLATFORM_DARWIN)
        if(fcntl(filehandle, F_FULLFSYNC, 0) == -1)
        {
                success = false;
                ErrStream() << "Tried to F_FULLSYNC " << path << " but failed with errno #" << errno;
        }
#endif
#endif
        return success;
}

bool MmapFile::SetModificationDate(Blex::DateTime newtime)
{
        return SetFileModificationDate(path, newtime);
}

PathStatus MmapFile::GetStatus() const //throw()
{
        return PathStatus(filehandle);
}

// -----------------------------------------------------------------------------
//
// SectionFile
//

/// Helpers
namespace
{

// Returns true if lhs < rhs (with wrapping support)
bool IsSmallerWrap(uint32_t lhs, uint32_t rhs)
{
        uint32_t diff = lhs - rhs;
        return diff > std::numeric_limits< uint32_t >::max() / 2;
}

// Returns true if lhs <= rhs (with wrapping support)
bool IsSmallerEqualWrap(uint32_t lhs, uint32_t rhs)
{
        uint32_t diff = rhs - lhs;
        return diff < std::numeric_limits< uint32_t >::max() / 2;
}

} // End of anonymous namespace


SectionFile* SectionFile::Open(unsigned sectionsize, std::string const &path, unsigned max_free_sections, bool share_sections, bool create_exclusive, bool delete_on_close, bool sync)
{
        std::unique_ptr<SectionFile> newfile (new SectionFile(max_free_sections,share_sections, sync && !delete_on_close)); //no need to sync delete-on-close sectionfiles..
        if (newfile->Init(sectionsize, path, create_exclusive, delete_on_close))
        {
#ifdef DEBUG_SECTIONFILE
                ErrStream() << "Section file " << path << " now open!\n";
#endif
                return newfile.release();
        }
        else
        {
                return NULL;
        }
}


SectionFile::SectionFile(unsigned _max_free_sections, bool _share_sections, bool sync_enabled)// throw(Exception, std::bad_alloc)
: max_free_sections(_max_free_sections)
, share_sections(_share_sections)
, sync_enabled(sync_enabled)
{
}

SectionFile::SFData::SFData()
 : lockfreesections(0)
 , lastfreepoint(0)
{
}

bool SectionFile::Init(unsigned _sectionsize, const std::string &_filename, bool create_exclusive, bool delete_on_close)
{
        filename=_filename;
        sectionsize=_sectionsize;
        recordsfile.reset(Blex::MmapFile::OpenRW(filename,true,create_exclusive/*exclusive*/,FilePermissions::PrivateRead,false/*shareable*/,delete_on_close,sync_enabled));

        if (!recordsfile.get())
            return false;

        // Create an empty section data structure
        SectionData empty_section_data;
        empty_section_data.Reset();

        SF::WriteRef(sf)->sections.resize(static_cast<std::size_t>(recordsfile->GetFilelength()/sectionsize), empty_section_data);

        return true;
}

SectionFile::~SectionFile()
{
        SF::WriteRef sflock(sf);

        for (std::vector<SectionData>::iterator section=sflock->sections.begin();
             section!=sflock->sections.end();
             ++section)
        {
                if (section->mapptr)
                {
                        if (sync_enabled && section->IsDirty())
                            recordsfile->Sync(section->mapptr,sectionsize, false);
                        recordsfile->Unmap(section->mapptr,sectionsize);
                }
        }
        sflock->sections.clear();
        recordsfile.reset(0);
}

bool SectionFile::TryAppendSectionPage()
{
        SF::WriteRef sflock(sf);
#ifdef DEBUG_SECTIONFILE
        std::ostringstream data;
        data << "Section file " << filename << " must append sections\n";
        ErrStream() << data.str();
#endif
        //Ensure that we can safely add the SectionData for the new section
        unsigned curr_section_count = sflock->sections.size();
        sflock->sections.reserve(curr_section_count + 1);

        //Do the resize
        Blex::FileOffset newoffset=sflock->sections.size()*sectionsize;
        if (!recordsfile->ExtendTo(newoffset + sectionsize))
            return false;

        //Update our own data (this cannot throw: we did a reserve above)
        sflock->sections.resize(curr_section_count + 1);
        sflock->sections[curr_section_count].Reset(0, 0);
        return true;
}

bool SectionFile::TryAppendSectionPages(unsigned count)
{
        SF::WriteRef sflock(sf);
#ifdef DEBUG_SECTIONFILE
        std::ostringstream data;
        data << "Section file " << filename << " must append " << count << " sections\n";
        ErrStream() << data.str();
#endif
        //Ensure that we can safely add the SectionData for the new section
        unsigned curr_section_count = sflock->sections.size();
        sflock->sections.reserve(curr_section_count + count);

        //Do the resize
        Blex::FileOffset newoffset=sflock->sections.size()*sectionsize;
        if (!recordsfile->ExtendTo(newoffset + sectionsize * count))
            return false;

        //Update our own data (this cannot throw: we did a reserve above)
        sflock->sections.resize(curr_section_count + count);
        for (unsigned i = 0; i < count; ++i)
            sflock->sections[curr_section_count + i].Reset(0, 0);
        return true;
}

uint8_t* SectionFile::LockSection (unsigned sectionnum)
{
        DeferredUnlocker deferunlock(this);
        uint8_t *newmapping(0);

        {
                SF::WriteRef sflock(sf);

                if (sectionnum >= sflock->sections.size())
                    throw std::runtime_error("Section " + Blex::AnyToString(sectionnum) + " does not exist");

                SectionData *sectiondata=&sflock->sections[sectionnum];
                if (share_sections)
                {
                        if (sectiondata->numlocks==0) //No locks yet
                        {
                                if (sectiondata->mapptr == NULL)
                                {
                                        if (sflock->lockfreesections > max_free_sections) //too many lock free sections!
                                            FlushLockfreeSections(sflock, &deferunlock);

                                        //map section for the first time
                                        uint8_t *mapptr = static_cast<uint8_t*>(recordsfile->MapRW(sectionnum*sectionsize,sectionsize));
                                        if (!mapptr)
                                            throw std::bad_alloc();

                                        sectiondata->Reset(mapptr);
                                }
                                else
                                {
                                        --sflock->lockfreesections;
                                }
                        }

                        //Prepare return value, and increase reference count on the section
                        ++sectiondata->numlocks;
                        sectiondata->free_age = 0;
                        newmapping = sectiondata->mapptr;
                }
                else
                {
                        newmapping = static_cast<uint8_t*>(recordsfile->MapRW(sectionnum*sectionsize,sectionsize));
                        if (!newmapping)
                            throw std::bad_alloc();

                        try
                        {
                                if (!sflock->sectionmappings.insert(Mapping(sectionnum,newmapping)).second)
                                     throw std::runtime_error("Duplicate address locking " + Blex::AnyToString(sectionnum));
                        }
                        catch(...)
                        {
                                recordsfile->Unmap(newmapping,sectionsize);
                                throw;
                        }
                        return newmapping;
                }
      }
      deferunlock.Flush();
      return newmapping;
}

void SectionFile::UnlockSection(unsigned sectionnum, uint8_t const *sectionptr)
{
        bool should_sync;
        unsigned save_section_size;
        {
                SF::WriteRef sflock(sf);

                //Obtain the section
                if (sectionnum >= sflock->sections.size())
                    throw std::runtime_error("Section " + Blex::AnyToString(sectionnum) + " does not exist");

                SectionData *sectiondata=&sflock->sections[sectionnum];
                if(share_sections)
                {
                        if (sectiondata->numlocks==0)
                            throw std::runtime_error("Attempt to unlock section " + Blex::AnyToString(sectionnum) + " that is not locked");

                        //Release lockcount and mapping, if necessary
                        --sectiondata->numlocks;

                        if (sectiondata->numlocks==0)
                            ++sflock->lockfreesections;

                        return; //no need to physically unmap
                }

                SectionMappings::iterator itr = sflock->sectionmappings.find(Mapping(sectionnum, sectionptr));
                if (itr == sflock->sectionmappings.end())
                    throw std::runtime_error("Attempt to unlock section " + Blex::AnyToString(sectionnum) + " that is not locked");

                sflock->sectionmappings.erase(itr);

                //Unregister the mapping (sectiondata->Unmap would have normally done that)
                if (!recordsfile->UnregisterMapping(sectionptr, sectionsize))
                {
                        Blex::ErrStream() << "Attempting to unmap a sectionfile mmap'ed region that was never mapped into memory";
                        Blex::FatalAbort();
                }

                //Save sync status & sectionsize to allow SectionFile destruction during sync
                should_sync = sectiondata->IsDirty();
                save_section_size = sectionsize;

        } //end lock on section file metadata

        if(should_sync)
        {
                if(!recordsfile->Sync(const_cast< uint8_t * >(sectionptr), save_section_size, true))
                    throw std::runtime_error("Flushing data to disk failed");
        }
        MmapDoUnmap(sectionptr, save_section_size, sync_enabled);
}

uint32_t SectionFile::MarkSectionDirty(unsigned sectionnum)
{
        SF::WriteRef sflock(sf);
        SectionData &sd = sflock->sections[sectionnum];


#ifdef DEBUG_SECTIONFILE
        unsigned old_update_gen = sd.update_gen;
#endif

        if (sd.update_gen == sd.syncing_gen)
            ++sd.update_gen;

#ifdef DEBUG_SECTIONFILE
        std::ostringstream data;
        data << "Section file " << filename << " marks dirty: " << sectionnum <<
                " (" << old_update_gen << "," << sd.syncing_gen << "," << sd.sync_gen << ") ->" <<
                " (" << sd.update_gen << "," << sd.syncing_gen << "," << sd.sync_gen << "): " << sd.update_gen << "\n";
        ErrStream() << data.str();
#endif

        return sd.update_gen;
}

bool SectionFile::EnsureSectionFlushed(unsigned sectionnum, uint32_t updatecount)
{
        if(!sync_enabled)
            return true;

#ifdef DEBUG_SECTIONFILE
        std::ostringstream l1data;
#endif

        uint8_t *mapptr;
        // Get start of section we need to sync inside of lock
        {
                SF::WriteRef sflock(sf);
                SectionData &sd = sflock->sections[sectionnum];

                // Check if this generation is already on disk
                if (sd.IsOnDisk(updatecount))
                    return true;

                // Administer start of sync
                sd.StartSync(updatecount);

#ifdef DEBUG_SECTIONFILE
                l1data << "Section file " << filename << " starting " << " flush of section " << sectionnum <<
                        " (" << sd.update_gen << "," << sd.syncing_gen << "," << sd.sync_gen << ")\n";
#endif

                mapptr = sd.mapptr;
        }

#ifdef DEBUG_SECTIONFILE
        ErrStream() << l1data.str();
#endif

        // Flush outside of lock
#ifdef DEBUG_SECTIONFILE
        std::ostringstream l2data;
#endif
        // Do the sync
        bool sync_success = recordsfile->Sync(mapptr,sectionsize, false);

        // Administer sync in sectiondata
        {
                SF::WriteRef sflock(sf);
                SectionData &sd = sflock->sections[sectionnum];

                // Administer funish of sync
                sd.FinishSync(updatecount, sync_success);

#ifdef DEBUG_SECTIONFILE
                l2data << "Section file " << filename << " at " << (void*)mapptr << (sync_success ? " has flushed " : " FAILED flushing ") << " flush of section " << sectionnum <<
                        " (" << sd.update_gen << "," << sd.syncing_gen << "," << sd.sync_gen << ")\n";
#endif
        }

#ifdef DEBUG_SECTIONFILE
        ErrStream() << l2data.str();
#endif

        return sync_success;
}

unsigned SectionFile::GetNumSections()
{
        return SF::ReadRef(sf)->sections.size();
}

bool SectionFile::SetModificationDate(Blex::DateTime newtime)
{
        return recordsfile->SetModificationDate(newtime);
}

void SectionFile::FlushLockfreeSections(SectionFile::SF::WriteRef &sflock, DeferredUnlocker *deferunlock)
{
        // No need to go cleaning when we are below the limit of free (unused) sections
        if (sflock->lockfreesections <= max_free_sections)
            return;

        unsigned whichsection = sflock->lastfreepoint;
        unsigned section_count = sflock->sections.size();
        unsigned run_length = 0;
        unsigned added_sections = 0;

        // Loop through all sections, but stop when having sweeped all but not having found an empty one (avoid spinning)
        while (added_sections < DeferredUnlocker::MaxDeferredUnlocks && run_length < section_count)
        {
                ++whichsection;
                if (whichsection >= sflock->sections.size())
                    whichsection=0;

                SectionData &sd = sflock->sections[whichsection];
                if (sd.numlocks == 0 && sd.mapptr && sd.syncer_count == 0)
                {
                        // Let the deferred unlocker take the section data
                        if (deferunlock->AddDeferredUnlock(sflock, &sd, whichsection))
                        {
                                run_length = 0;
                                ++added_sections;
                        }
                        else
                            ++run_length;
                }
                else
                    ++run_length;
        }

        sflock->lastfreepoint = whichsection;
}

bool SectionFile::FlushUnlock(SectionData &sd)
{
        assert(sd.mapptr != 0 && sd.numlocks == 0 && sd.syncer_count == 0);

        if (sync_enabled && sd.IsDirty())
        {
#ifdef DEBUG_SECTIONFILE
                std::ostringstream data;
                data << "Section file " << filename << " flush " << ((void *)sd.mapptr) << " (lockfree)\n";
                ErrStream() << data.str();
#endif
                if (!recordsfile->Sync(sd.mapptr,sectionsize, false))
                    return false;
        }
        recordsfile->Unmap(sd.mapptr,sectionsize);
        sd.Reset();
        return true;
}


bool SectionFile::FlushAll()
{
        return recordsfile->SyncAll();
}

void SectionFile::GenerationalCleanupUnusedSections(volatile uint32_t *abortflag)
{
        const unsigned gen_sync_flush = 4;
        const unsigned gen_unmap = 6;

#ifdef DEBUG_SECTIONFILECLEANUP
        unsigned gcsu_counts[gen_unmap + 2] = { 0 };
        unsigned gcsu_stats[3] = { 0 };
#endif

        unsigned idx = 0;
//        SectionData current;
        unsigned sync_gen = 0; // Dummy init to keep compiler happy
        unsigned free_age = 0;
        while (!abortflag || !*abortflag)
        {
                {
                        // Loop over all sections until we find one we need to do an os-call for
                        SF::WriteRef sflock(sf);
                        unsigned section_count = sflock->sections.size();

                        for (; idx < section_count; ++idx)
                        {
                                SectionData &sd = sflock->sections[idx];

                                // Skip sections that are unmapped or still locked
                                if (sd.numlocks != 0 || !sd.mapptr || sd.syncer_count != 0) //in use?
                                {
#ifdef DEBUG_SECTIONFILECLEANUP
                                        if (sd.mapptr == 0)
                                            ++gcsu_counts[0];
                                        else
                                            ++gcsu_counts[1];
#endif
                                        continue;
                                }

                                free_age = ++sd.free_age;

#ifdef DEBUG_SECTIONFILECLEANUP
                                assert(free_age <= gen_unmap);
                                ++gcsu_counts[free_age + 1];
#endif

                                if ((free_age == gen_sync_flush) && sd.IsDirty())
                                {
                                        // Generation gen_sync_flush, flush if dirty
                                        sync_gen = sd.update_gen;

                                        // Take extra syncer lock, so the section won't be thrown out
                                        ++sd.syncer_count;
                                        break;
                                }
                                if (free_age == gen_unmap)
                                {
                                        if (FlushUnlock(sd))
                                        {
                                                --sflock->lockfreesections;
                                                sflock->lastfreepoint = idx;
#ifdef DEBUG_SECTIONFILECLEANUP
                                                ++gcsu_stats[2];
#endif
                                        }
                                        else
                                        {
                                                // Try and run the section through all generations again, starting with a sync flush
                                                sd.free_age = gen_sync_flush - 1;
                                        }
                                }
                        }

                        // Finished run?
                        if (idx == section_count)
                            break;
                }

                // Inv: idx < sflock->sections.size()
                // Inv: current contains old section data
                // Inv: free_age and sync_gen have been properly initialized

                // We need to do an action, without holding the sflock.
                switch (free_age)
                {
                case gen_sync_flush:
                    {
#ifdef DEBUG_SECTIONFILECLEANUP
#endif
                            EnsureSectionFlushed(idx, sync_gen);

                            {
                                    SF::WriteRef sflock(sf);
                                    SectionData &sd = sflock->sections[idx];
                                    --sd.syncer_count;
                            }

                            // Sleep a little to avoid I/O overload
                            SleepThread(100);
#ifdef DEBUG_SECTIONFILECLEANUP
                            ++gcsu_stats[1];
#endif
                    } break;
                default: ;
                }
                ++idx;
        }
#ifdef DEBUG_SECTIONFILECLEANUP
        Blex::ErrStream() << "SectionFile::GCUS " << filename << " stats: free: " << gcsu_counts[0] << " locked: " << gcsu_counts[1] << ", gen counts: "
                << gcsu_counts[2] << " " << gcsu_counts[3] << " " << gcsu_counts[4] << " "
                << gcsu_counts[5] << " " << gcsu_counts[6] << " " << gcsu_counts[7];
        Blex::ErrStream() << "SectionFile::GCUS " << filename << " actions: async: " << gcsu_stats[0] << ", sync: " << gcsu_stats[1] << ", unmap: " << gcsu_stats[2];
#endif
}

// -----------------------------------------------------------------------------
//
// SectionData
//


void SectionFile::SectionData::Reset(uint8_t *_mapptr, unsigned _numlocks)
{
        numlocks = _numlocks;
        mapptr = _mapptr;

        // Set all gen counters at 0: IsDirty interprets this as not dirty.
        update_gen = 0;
        syncing_gen = 0;
        sync_gen = 0;

        syncer_count = 0;
        free_age = 0;
}

bool SectionFile::SectionData::IsOnDisk(unsigned my_update_gen) const
{
        // Sectionfile makes sure every section is flushed before it is mapped out.
        if (mapptr == 0)
            return true;

        return IsSmallerEqualWrap(my_update_gen, sync_gen);
}

bool SectionFile::SectionData::IsDirty() const
{
        // Is dirty when current update_gen is not on disk
        return !IsOnDisk(update_gen);
}

void SectionFile::SectionData::StartSync(unsigned my_updatecount)
{
        // Someone is syncing this section
        ++syncer_count;

        // Indicate that we someone is currently syncing this generation.
        if (IsSmallerWrap(syncing_gen, my_updatecount))
                syncing_gen = my_updatecount;
}

void SectionFile::SectionData::FinishSync(unsigned my_updatecount, bool success)
{
        // Always decrease the syncer count.
        --syncer_count;

        if (success)
        {
                // Administer successfull sync of this generation
                if (IsSmallerWrap(sync_gen, my_updatecount))
                    sync_gen = my_updatecount;
        }
}

const unsigned SectionFile::DeferredUnlocker::MaxDeferredUnlocks;

SectionFile::DeferredUnlocker::~DeferredUnlocker()
{
        SF::WriteRef sflock(sectionfile->sf);
        for (unsigned i = 0; i < count; ++i)
        {
                Data &mydata = sections[i];
                SectionData &data = sflock->sections[mydata.sectionnr];

                if (mydata.must_flush)
                    data.FinishSync(mydata.update_gen, false);
        }
}

void SectionFile::DeferredUnlocker::Flush()
{
        for (unsigned i = 0; i < count; ++i)
        {
                Data &mydata = sections[i];

                // Do the sync
                bool sync_success = true;
                if (sectionfile->sync_enabled && mydata.must_flush)
                    sync_success = sectionfile->recordsfile->Sync(mydata.mapptr, sectionfile->sectionsize, false);

                SF::WriteRef sflock(sectionfile->sf);
                SectionData &data = sflock->sections[mydata.sectionnr];

                if (mydata.must_flush)
                    data.FinishSync(mydata.update_gen, sync_success);

#ifdef DEBUG_SECTIONFILE
                std::ostringstream ostr;
                ostr << "Section file " << sectionfile->filename << " deferred unlocking section " << mydata.sectionnr <<
                        " (" << data.update_gen << "," << data.syncing_gen << "," << data.sync_gen << ")"
                        " flushed: " << (mydata.must_flush?"yes":"no") << " success: " << (sync_success?"yes":"no") << "\n";
                ErrStream() << ostr.str();
#endif
                // Unlock sections. Don't care if it fails right now, the dirtyness data is safe.
                // ADDME: can we take this outside the lock, and still be correct?
                if (data.mapptr != 0
                    && data.numlocks == 0
                    && data.syncer_count == 0
                    && data.update_gen == mydata.update_gen
                    && data.sync_gen == data.update_gen)
                {
                        if (sectionfile->FlushUnlock(data))
                            --sflock->lockfreesections;
                }
        }
        count = 0;
}

bool SectionFile::DeferredUnlocker::AddDeferredUnlock(SF::WriteRef &sflock, SectionData *data, unsigned sectionnum)
{
        assert(data->mapptr != 0 && data->numlocks == 0 && data->syncer_count == 0);

        // Already in list?
        for (unsigned i = 0; i < count; ++i)
            if (sections[i].sectionnr == sectionnum)
                return false;

#ifdef DEBUG_SECTIONFILE
        std::ostringstream ostr;
        ostr << "Section file " << sectionfile->filename << " unlock " << (count == MaxDeferredUnlocks ? "imm.":"defer") << " unlock section " << sectionnum <<
                " (" << data->update_gen << "," << data->syncing_gen << "," << data->sync_gen << ")\n";
        ErrStream() << ostr.str();
#endif

        if (count == MaxDeferredUnlocks)
        {
                if (!sectionfile->FlushUnlock(*data))
                    return false;

                --sflock->lockfreesections;
        }
        else
        {
                Data &mydata = sections[count];
                mydata.sectionnr = sectionnum;
                mydata.update_gen = data->update_gen;
                mydata.mapptr = data->mapptr;
                mydata.must_flush = data->IsDirty();
                ++count;
        }
        return true;
}

bool SectionUpdateHistory::ForceSyncAll()
{
        for (CommitMap::const_iterator itr=commitmap.begin(); itr!=commitmap.end(); ++itr)
          if (!itr->first.table->EnsureSectionFlushed(itr->first.section,itr->second))
            return false;

        return true;
}


} // End of namespace Blex

