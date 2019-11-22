#include <blex/blexlib.h>

#include "threads.h"
#include "utils.h"
#include "crypto.h"

#include <fcntl.h>
#include <sys/mman.h>

#include <deque>

#include <sstream>
#include "path.h"
#include "stream.h"
#include <unistd.h>
#include <utime.h>
#include <dirent.h>
#include <fcntl.h>
#include <errno.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <functional>

namespace Blex
{

class PathRandom
{
        uint32_t tempseed;
        public:

        PathRandom()
        {
                std::srand(std::time(0));
                tempseed=std::time(0)*std::rand();
        }
        uint32_t GetVal(void)
        {
                tempseed+=(std::rand()%16) + 1;
                return tempseed;
        }
} pathrandom;

unsigned pagesize = sysconf(_SC_PAGESIZE);

struct Directory::Data
{
        DIR *dir;
        struct dirent buffer;
        struct dirent *dent;

        Data()
        {
                dir = NULL;
        }
        ~Data()
        {
                if (dir)
                    closedir(dir);
        }
};

Directory::Directory(std::string const &_searchpath,std::string const &_searchmask)
  : data(NULL)
  , searchpath(_searchpath)
  , searchmask(_searchmask)
{
        std::unique_ptr<Data> dataptr(new Data);

        data = dataptr.get();
        dataptr->dir=opendir(searchpath.c_str());
        if (!dataptr->dir || !GetNextEntry())
        {
                data=NULL;
                return;
        }

        data = dataptr.release();
}

Directory::~Directory()
{
        delete data; //we need to manually delete this, to maintain Data class invisibility
}

void Directory::ParseStatus()
{
        havestatus=true;
        thisstatus.StatNoDeref(CurrentPath().c_str());
}

bool Directory::FilesLeft(void) const
{
        return data!=NULL;
}

bool Directory::IsMatch()
{
        const char *filename = data->dent->d_name;
        return StrLike(filename, searchmask);
}

bool Directory::GetNextEntry()
{
        havestatus=false;
        while (readdir_r(data->dir, &data->buffer, &data->dent) == 0 && data->dent)
        {
                if (strcmp(data->dent->d_name,".") == 0)
                    continue;
                if (strcmp(data->dent->d_name,"..") == 0)
                    continue;

                if (IsMatch())
                {
                        currentfile=data->dent->d_name;
                        return true;
                }
        }
        return false;
}

void Directory::NextFile(void)
{
        if (!FilesLeft()) //already failed earlier
            return;

        if (GetNextEntry()) //succesful!
            return;

        //end of dir, so close!
        delete data;
        data=NULL;
}

std::string Directory::CurrentPath(void) const
{
        std::string retval = searchpath;
        if(!retval.empty() && retval[retval.size()-1]!='/')
            retval.push_back('/');
        retval += currentfile;
        return retval;
}

const std::string& Directory::CurrentFile(void) const
{
        return currentfile;
}

/* Move back one path section:
   [start,curpos[ == 'a/b/.'   => [start,retval[ == 'a/b'
   [start,curpos[ == '.'       => [start,retval[ == ''
   [start,curpos[ == '/.'      => [start,retval[ == ''  (we treat EVERYTHING as relative)
*/

namespace {

char* RewindPath(char *start, char *curpos, unsigned howmuch)
{
        //Look for the previous slash
        while (start!=curpos)
        {
                --curpos;
                if (*curpos=='/' && --howmuch==0) //cut here?
                    return curpos+1;
        }
        return curpos;
}
} //end anonymous namespace

char* CollapsePath(char *start, char *end, bool preserve_trailing_slash)
{
        //Don't do anything in the simple case
        if (start==end)
            return end;

        //Current number of path parts processed
        unsigned num_parts=0;
        //Minimum number of path parts required
        unsigned min_parts=0;

        preserve_trailing_slash = preserve_trailing_slash && start < end && end[-1]=='/';
        if(preserve_trailing_slash)
        {
                if(end[-1] != '/')
                {
                        preserve_trailing_slash = false;
                }
                else
                {
                        if(start+1 == end) //the slash is all we have!
                                return end; //then we're already done
                }
        }

        //Eat root specifier
        bool rootisslash = *start=='/';
        if (rootisslash)
            ++start;

        //From now on, everything can be treated as a relative path
        char *current_writeptr = start;
        char *current_readptr = start;
        char *component_start = start;

        // Parse and collapse paths, which basically means:
        // - replace any // with /
        // - replace any /./ with /
        // - replace any /name/../ with /

        while (true)
        {
                //End of path section? (end of string is also end of path section)
                if (current_readptr == end || *current_readptr == '/')
                {
                        // If this is an empty section, then just ignore it
                        if (current_readptr != component_start)
                        {
                                unsigned rewind_count;

                                ++num_parts;
                                if (current_readptr == component_start + 1 && *component_start == '.')
                                    rewind_count = 1;
                                else if (current_readptr == component_start + 2 && component_start[0] == '.' && component_start[1] == '.')
                                    rewind_count = 2;
                                else
                                    rewind_count = 0;

                                if (rewind_count > num_parts)
                                    rewind_count = num_parts;

                                if (rewind_count && num_parts - rewind_count < min_parts)
                                    rewind_count = num_parts - min_parts;

                                if (rewind_count)
                                {
                                        current_writeptr = RewindPath(start,current_writeptr,rewind_count);
                                        num_parts -= rewind_count;
                                }
                                else
                                {
                                        if (current_readptr == end)
                                            break; //nothing else to read..

                                        *current_writeptr++ = '/';
                                }
                        }

                        if (current_readptr==end)
                            break;

                        component_start = ++current_readptr;
                }
                else
                {
                        //Copy character
                        *current_writeptr++=*current_readptr++;
                }
        }

        //Destroy terminating slashes (never useful!)
        while (current_writeptr != start && current_writeptr[-1] == '/')
                --current_writeptr;
        if(preserve_trailing_slash && (current_writeptr != start || !rootisslash))
                *current_writeptr++ = '/';
        return current_writeptr;
}

std::string CollapsePathString(std::string const &src, bool preserve_trailing_slash)
{
        std::string retval(src);
        unsigned newlen = CollapsePath(&*retval.begin(), &*retval.end(), preserve_trailing_slash) - &*retval.begin();
        retval.erase(retval.begin() + newlen, retval.end());
        return retval;
}

std::string MergePath(std::string const &path,std::string const &mergepath)
{
        //how many slashes to strip?
        unsigned strip_from_path;
        for (strip_from_path=0; strip_from_path<path.size(); ++strip_from_path)
          if (path[path.size() - strip_from_path - 1] != '/')
            break;

        unsigned strip_from_merge;
        for (strip_from_merge=0; strip_from_merge<mergepath.size(); ++strip_from_merge)
          if (mergepath[strip_from_merge] != '/')
            break;

        std::string retval;
        retval.resize(path.size() + (path.empty()?0:1) + mergepath.size() - strip_from_merge - strip_from_path);

        std::copy(path.begin(),path.end() - strip_from_path ,retval.begin());
        if (!path.empty())
             retval[path.size()-strip_from_path] = '/';

        std::copy(mergepath.begin() + strip_from_merge ,mergepath.end(), retval.begin()+ path.size() + (path.empty()?0:1) - strip_from_path);
        unsigned newlen = CollapsePath(&*retval.begin(), &*retval.end()) - &*retval.begin();
        retval.erase(retval.begin() + newlen, retval.end());

        return retval;
}

bool RemoveFile(std::string const &todel)
{
        return unlink(todel.c_str())==0;
}

bool MovePath(std::string const &oldpath,std::string const &newpath)
{
        return std::rename(oldpath.c_str(),newpath.c_str())==0;
}

bool ChangeDir(std::string const &p)
{
        return chdir(p.c_str())==0;
}

bool CreateDir(const std::string &p,bool publicdir)
{
        return mkdir(p.c_str(),publicdir?0755:0700)==0;
}

bool CreateDirRecursive(const std::string &p,bool publicdir)
{
        if (PathStatus(p).IsDir() || CreateDir(p,publicdir))
            return true; //directory already exists
        if (!PathIsAbsolute(p))
            return false; //can only do it on absolute paths

        //skip the first path, because there is no sense in recreating the root
        std::string const realpath=Blex::CollapsePathString(p);
        std::string::const_iterator slashindex;

        //UNC filename?
        if (realpath.size() > 2 && realpath[0] == '/' && realpath[1] == '/')
        {
                //Skip past computer and sharename (to: //bunny/blaat/)
                slashindex = std::find(realpath.begin()+2,realpath.end(),'/');
                if (slashindex != realpath.end())
                    slashindex = std::find(slashindex+1,realpath.end(),'/');
        }
        else
        {
                slashindex = std::find(realpath.begin(),realpath.end(),'/');
        }

        while (true)
        {
                if (slashindex!=realpath.end())
                    ++slashindex;
                std::string thispath(realpath.begin(),slashindex);

                //std::cerr << "CreateDirRecursive testing " << thispath << " for true path " << realpath << std::endl;

                if (!PathStatus(thispath).IsDir() && !CreateDir(thispath,publicdir))
                {
                        //std::cerr << "CreateDirRecursive creating " << thispath << " for true path " << realpath << " failed" << std::endl;
                        return false;
                }
                if (slashindex==realpath.end())
                    break;
                slashindex=std::find(slashindex+1,realpath.end(),'/');
        }
        return true;
}

bool RemoveDir(std::string const &p)
{
        if (!PathIsAbsolute(p))
            return false; //can only do it on absolute paths

        return rmdir(p.c_str())==0;
}

bool RemoveDirRecursive(const std::string &p)
{
        if (p.empty())
             return false;
        if (!PathIsAbsolute(p))
            return false; //can only do it on absolute paths

        //remove everything, recursively.
        std::deque<std::string> files_to_delete;
        for (Directory file(p,"*");file;++file)
        {
                if (file.CurrentFile()=="." || file.CurrentFile()=="..")
                    continue;

                if (file.GetStatus().IsDir())
                {
                        if (!RemoveDirRecursive(file.CurrentPath()))
                            return false; //Failure :-(
                }
                else //some sort of file
                {
                        files_to_delete.push_back(file.CurrentPath());
                }
        }

        for (std::deque<std::string>::const_iterator itr=files_to_delete.begin();itr!=files_to_delete.end();++itr)
          if (!RemoveFile(*itr))
            return false;

        return PathStatus(p).IsDir() ? RemoveDir(p) : RemoveFile(p);
}

bool RemoveMultiple(std::string const &p, std::string const &mask)
{
        std::vector<std::string> dirs_to_del;
        std::vector<std::string> files_to_del;
        for (Blex::Directory diritr(p, mask);diritr;++diritr)
        {
                if (diritr.CurrentFile()=="." || diritr.CurrentFile()=="..")
                    continue;

                if (diritr.GetStatus().IsDir())
                    dirs_to_del.push_back(diritr.CurrentPath());
                else
                    files_to_del.push_back(diritr.CurrentPath());
        }

        for (unsigned i=0; i<dirs_to_del.size(); ++i)
          if (!RemoveDirRecursive(dirs_to_del[i]))
             return false;
        for (unsigned i=0; i<files_to_del.size(); ++i)
          if (!RemoveFile(files_to_del[i]))
            return false;

        return true;
}

std::string GetCurrentDir()
{
        std::vector<char> path(128);
        while (true)
        {
                if (getcwd(&path[0],path.size()-1))
                    return std::string(&path[0]);
                //failed, expand buffer and retry
                path.resize(path.size()*2);
        }
}

//ADDME: Not really a correct name, just make it GetTempDir() ?
std::string GetSystemTempDir()
{
        const char *tmpdir = getenv("TMPDIR");
        if (tmpdir && *tmpdir)
            return tmpdir;

        tmpdir = getenv("TEMP");
        if (tmpdir && *tmpdir)
            return tmpdir;

        return "/tmp/";
}

std::string CreateTempName(const std::string &start)
{
        static const unsigned NumRandomBytes = 160/8; //20 bytes
        std::string outname;
        outname.reserve(start.size() + NumRandomBytes * 2); //base 16; 2 bytes per char - 40 chars
        outname = start;

        uint8_t store[NumRandomBytes];
        Blex::FillPseudoRandomVector(store, sizeof store);

        Blex::EncodeBase16_LC(store, store + sizeof store, std::back_inserter(outname));
        return outname;
}

std::string CreateTempDir(const std::string &start,bool publicdir)
{
        std::string tryname(CreateTempName(start));
        if (!CreateDir(tryname, publicdir))
                throw std::runtime_error("CreateTempDir unable to create directory");
        return tryname;
}

bool CopySingleFile(const std::string &origfile, const std::string &newfile)
{
        std::unique_ptr<Blex::FileStream> orig(Blex::FileStream::OpenRead (origfile));
        if (orig.get() == NULL)
             return false;

        std::unique_ptr<Blex::FileStream> dest(Blex::FileStream::OpenWrite(newfile,true,false,Blex::FilePermissions::PublicRead));
        if (dest.get() == NULL)
            return false;

        if (orig->SendAllTo(*dest) != orig->GetFileLength())
        {
                dest.reset();
                Blex::RemoveFile(newfile);
                return false;
        }
        dest->SetFileLength(orig->GetFileLength());
        return true;
}

bool CopyDirRecursive(const std::string &orgdir, const std::string &newdir)
{
        if (Blex::PathStatus(newdir).Exists())
                return false;
        if (!Blex::CreateDirRecursive(newdir, true))
                return false;

        bool succes = true;
        for (Blex::Directory files(orgdir,"*");(files && succes);++files)
        {
                if (files.CurrentFile() == "." || files.CurrentFile() == "..")
                        continue;

                if (files.GetStatus().IsDir())          // copy all folders recursively
                {
                        succes = succes && CopyDirRecursive(files.CurrentPath(), Blex::MergePath(newdir, files.CurrentFile()));
                        continue;
                }
                if (files.GetStatus().IsFile())         // copy all files
                {
                        succes = succes && CopySingleFile(files.CurrentPath(), Blex::MergePath(newdir, files.CurrentFile()));
                        continue;
                }
        }
        return succes;
}

void PathStatus::ParseStatbuf(void const *__statbuf, const char *)
{
        struct stat const &statbuf=*static_cast<struct stat const *>(__statbuf);
        if (S_ISREG(statbuf.st_mode)!=0)
            flags = File;
        else if (S_ISDIR(statbuf.st_mode)!=0)
            flags = Dir;
        else if (S_ISLNK(statbuf.st_mode)!=0)
            flags = Link;
        else
            flags = Other;

#if defined(PLATFORM_LINUX)
        modtime=Blex::DateTime::FromTimeT(statbuf.st_mtime, statbuf.st_mtim.tv_nsec / 1000000);
        accesstime=Blex::DateTime::FromTimeT(statbuf.st_atime, statbuf.st_atim.tv_nsec / 1000000);
        createtime=Blex::DateTime::FromTimeT(statbuf.st_ctime, statbuf.st_ctim.tv_nsec / 1000000);
#elif defined(PLATFORM_DARWIN)
        modtime=Blex::DateTime::FromTimeT(statbuf.st_mtime, statbuf.st_mtimespec.tv_nsec / 1000000);
        accesstime=Blex::DateTime::FromTimeT(statbuf.st_atime, statbuf.st_atimespec.tv_nsec / 1000000);
        createtime=Blex::DateTime::FromTimeT(statbuf.st_ctime, statbuf.st_ctimespec.tv_nsec / 1000000);
#else
        modtime=Blex::DateTime::FromTimeT(statbuf.st_mtime);
        accesstime=Blex::DateTime::FromTimeT(statbuf.st_atime);
        createtime=Blex::DateTime::FromTimeT(statbuf.st_ctime);
#endif

        length=statbuf.st_size;
        unix_permissions=(Blex::FilePermissions::AccessFlags)statbuf.st_mode;
}

void PathStatus::Stat(std::string const &name)
{
        Stat(name.c_str());
}
void PathStatus::StatNoDeref(std::string const &name)
{
        StatNoDeref(name.c_str());
}

void PathStatus::Stat(const char *name)
{
        struct stat statbuf;

        if (stat(name,&statbuf)!=0)
            flags=None;
        else
            ParseStatbuf(&statbuf, name);
}
void PathStatus::StatNoDeref(const char *name)
{
        struct stat statbuf;

        if (lstat(name,&statbuf)!=0)
            flags=None;
        else
            ParseStatbuf(&statbuf, name);
}

void PathStatus::Stat(int fd)
{
        struct stat statbuf;

        if (fstat(fd,&statbuf)!=0)
            flags = None;
        else
            ParseStatbuf(&statbuf, NULL);
}

bool PathIsAbsolute(const std::string &p)
{
        return p.size() >= 1 && p[0]=='/';
}

std::string StripExtensionFromPath(std::string const &path)
{
        std::string::size_type lastdotslash = path.find_last_of("/.");

        if (lastdotslash != std::string::npos && path[lastdotslash]=='.')
            return std::string(path.begin(),path.begin() + lastdotslash);
        else
            return path;
}

std::string GetDirectoryFromPath(std::string const &path)
{
        std::string::size_type lastslash = path.rfind('/');
        if (lastslash != std::string::npos)
            return std::string(path.begin(), path.begin() + lastslash);
        else
            return std::string();

}

///Strip the folder information from a path, leaving only its name
std::string GetNameFromPath(std::string const &path)
{
        std::string::size_type lastslash = path.rfind('/');
        if (lastslash != std::string::npos)
            return path.substr(lastslash+1);
        else
            return path;

}

///Strip the folder information from a path, leaving only its name
std::string GetExtensionFromPath(std::string const &path)
{
        std::string::size_type lastslash = path.rfind('/');
        std::string::size_type lastdot = path.rfind('.');
        if (lastdot == std::string::npos)
            return std::string();
        if (lastslash != std::string::npos && lastslash > lastdot)
            return std::string();

        return path.substr(lastdot);
}

/** Set UNIX permissions on a folder or file.*/
bool SetUNIXPermissions(std::string const &path, FilePermissions::AccessFlags newpermissions)
{
        return chmod(path.c_str(), newpermissions) == 0;
}

bool SetFileModificationDate(std::string const &path, Blex::DateTime new_modification_date)
{
        struct timespec newtimes[2];
        newtimes[0] = new_modification_date.GetTimeSpec();
#if !defined(PLATFORM_DARWIN)
        newtimes[1] = newtimes[0];
        return utimensat(AT_FDCWD, path.c_str(), newtimes, 0) == 0;
#else
        struct timeval newtimeval[2];
        newtimeval[0].tv_sec = newtimes[0].tv_sec;
        newtimeval[0].tv_usec = newtimes[0].tv_nsec / 1000;
        newtimeval[1] = newtimeval[0];
        return utimes(path.c_str(), newtimeval) == 0;
#endif
}

bool CreateNewHardLink(std::string const &path, std::string const &source)
{
        int res = link(source.c_str(), path.c_str());
        return res == 0;
}

bool CreateNewSoftLink(std::string const &path, std::string const &source)
{
        int res = symlink(source.c_str(), path.c_str());
        return res == 0;
}

std::string ReadSoftLink(std::string const &path)
{
        struct stat sb;
        if (lstat(path.c_str(),&sb) == -1)
                return std::string();

        std::vector<char> linkreceiver(sb.st_size);
        int len = readlink(path.c_str(), &linkreceiver[0], sb.st_size);
        if(len==-1)
                return std::string();

        return std::string(&linkreceiver[0], &linkreceiver[len]);
}

std::string GetLastOSError()
{
        return strerror(errno);
}

FileStream::Lock::Lock()
:owner(NULL)
{
}
FileStream::Lock::~Lock()
{
        if(owner)
            owner->LL_Unlock(start,length);
}

FileStream::FileStream(FileHandle _fd, bool _canread, bool _canwrite)
 : Stream(true)
 , canread(_canread)
 , canwrite(_canwrite)
 , eof(false)
 , evictonclose(false)
 , filehandle(_fd)
{
}

FileStream::~FileStream()
{
#if defined(PLATFORM_LINUX)
        if(evictonclose)
            posix_fadvise(filehandle, 0, GetFileLength(), POSIX_FADV_DONTNEED);
#endif
        close(filehandle);
}

void FileStream::AssumeReadOnce()
{
        FileOffset filelen = GetFileLength();
        if (filelen == 0)
            return;

#if defined(PLATFORM_LINUX)
        posix_fadvise (filehandle, 0, filelen, POSIX_FADV_SEQUENTIAL | POSIX_FADV_WILLNEED);

        //check if the first pagesize bytes are already in memory. we only evict if we are likely to be responsible for loading the file
        unsigned mapbytes = filelen > pagesize ? pagesize : filelen;
        void *tempmap = mmap(0, mapbytes, PROT_NONE, MAP_SHARED, filehandle, 0);
        if(tempmap)
        {
              unsigned char memstatus = 0;
              if(mincore(tempmap, 1, &memstatus) == 0 && memstatus == 0) //it's not in memory!
                  evictonclose = true;
              munmap(tempmap, mapbytes);
        }
#endif
#if defined(PLATFORM_DARWIN)
        radvisory r;
        r.ra_offset = 0;
        r.ra_count = filelen;
        fcntl(filehandle, F_RDADVISE, &r);
#endif
}

FileStream* FileStream::InternalOpen(const std::string &filename,
                                            bool read_access,
                                            bool write_access,
                                            bool create_file,
                                            bool exclusive_create,
                                            bool auto_delete,
                                            FilePermissions::AccessFlags accessmode)
{
        int openflags = O_NOCTTY
                        | ( read_access ? ( write_access ? O_RDWR : O_RDONLY) : O_WRONLY )
                        | (create_file ? O_CREAT : 0)
                        | (exclusive_create ? O_EXCL : 0);

#ifdef PLATFORM_LINUX
        openflags |= O_CLOEXEC;
#endif
        int filehandle=open(filename.c_str(),openflags,accessmode);
        if (filehandle==-1)
            return NULL;
#ifndef PLATFORM_LINUX
        fcntl(filehandle, F_SETFD, 1); //set close-on-exc
#endif

        FileStream *newfile = new FileStream(filehandle,read_access,write_access);
        if (auto_delete && unlink(filename.c_str()) != 0) //setting up autodelete failed?!
        {
                delete newfile;
                unlink(filename.c_str());
                return NULL;
        }
        return newfile;
}

FileStream* FileStream::OpenRead(std::string const &filename)
{
        FileStream *stream=InternalOpen(filename,true,false,false,false,false,(FilePermissions::AccessFlags)0);
        return stream;
}

FileStream* FileStream::OpenWrite(std::string const &filename,bool create,bool exclusive,FilePermissions::AccessFlags accessmode)
{
        return InternalOpen(filename,false,true,create,exclusive,false,accessmode);
}

FileStream* FileStream::OpenWriteTemp(std::string const &start,FilePermissions::AccessFlags accessmode)
{
        for (unsigned int attempts=0;attempts<10;++attempts)
        {
                std::string path = CreateTempName(start);
                FileStream *retval=InternalOpen(path,false,true,true,true,true,accessmode);
                if (retval)
                    return retval;
        }
        return 0;
}

FileStream* FileStream::OpenRWTemp(std::string const &start,FilePermissions::AccessFlags accessmode)
{
        for (unsigned int attempts=0;attempts<10;++attempts)
        {
                std::string path = CreateTempName(start);
                FileStream *retval=InternalOpen(path,true,true,true,true,true,accessmode);
                if (retval)
                    return retval;
        }
        return 0;
}

FileStream* FileStream::OpenRW(std::string const &filename,bool create,bool exclusive,FilePermissions::AccessFlags accessmode)
{
        return InternalOpen(filename,true,true,create,exclusive,false,accessmode);
}

bool FileStream::OSFlush()
{
#if defined(PLATFORM_LINUX)
        return fdatasync(filehandle)==0;
#elif defined(PLATFORM_DARWIN)
        return fcntl(filehandle, F_FULLFSYNC, 0) != -1;
#else
        return fsync(filehandle)==0;
#endif
}

FileStream::Lock* FileStream::LockRegion(Blex::FileOffset start, Blex::FileOffset length)
{
        std::unique_ptr<Lock> lock(new Lock);
        if (!LL_Lock(start,length))
            return NULL;

        lock->start=start;
        lock->length=length;
        lock->owner=this;
        return lock.release();
}

std::size_t FileStream::DirectRead(FileOffset startpos,void *buf,std::size_t maxbufsize)
{
        if (!canread)
            throw std::runtime_error("FileStream::Read() from write-only file");

        if (maxbufsize==0)
            return 0;

        std::size_t bytesread=pread(filehandle,buf,maxbufsize,startpos);

        if (int32_t(bytesread)==-1) //cancelled
            return false;

        return bytesread;
}

std::size_t FileStream::DirectWrite(FileOffset startpos, const void *buf, std::size_t bufsize)
{
        if (!canwrite)
            throw std::runtime_error("FileStream::Write() on read-only file");

        ssize_t totalbyteswritten=pwrite(filehandle,buf,bufsize,startpos);
        if (totalbyteswritten<0)
            return 0;
        else
            return totalbyteswritten;
}

bool FileStream::SetFileLength(FileOffset newlength)
{
        if (!canwrite)
            throw std::runtime_error("FileStream::SetFileLength() on read-only file");

        if (ftruncate(filehandle,newlength) != 0) //despite the name, ftruncate also extends
            return false;
        return true;
}

FileOffset FileStream::GetFileLength()
{
        struct stat buf;
        if(fstat(filehandle,&buf) != 0 || !S_ISREG(buf.st_mode))
                return 0;
        return buf.st_size;
}

FileOffset FileStream::GetOffset()
{
        return lseek(filehandle,0,SEEK_CUR);
}
bool FileStream::SetOffset(FileOffset newoffset)
{
        return lseek(filehandle,newoffset,SEEK_SET)==static_cast<off_t>(newoffset);
}

PathStatus FileStream::GetStatus()
{
        PathStatus retval;
        retval.Stat(filehandle);
        return retval;
}

std::size_t FileStream::Read(void *buf,std::size_t maxbufsize)
{
        if (!canread)
            throw std::runtime_error("FileStream::Read() from write-only file");

        if (maxbufsize==0)
            return 0;

        ssize_t bytesread=read(filehandle,buf,maxbufsize);
        if (bytesread<0) //cancelled
            return 0;
        eof = static_cast< std::size_t >(bytesread) < maxbufsize;
        return bytesread;
}

std::size_t FileStream::Write(const void *buf,std::size_t bufsize)
{
        if (!canwrite)
            throw std::runtime_error("FileStream::Write() on read-only file");

        ssize_t totalbyteswritten=write(filehandle,buf,bufsize);
        if (totalbyteswritten<0)
            return 0;
        return totalbyteswritten;
}

bool FileStream::EndOfStream()
{
        return eof;
}

bool FileStream::LL_Lock(Blex::FileOffset start, Blex::FileOffset length)
{
        struct flock file_lock;
        file_lock.l_type = F_WRLCK;
        file_lock.l_start = start;
        file_lock.l_whence = SEEK_SET;
        file_lock.l_len = length;
        file_lock.l_pid=getpid();
        return fcntl(filehandle, F_SETLKW, &file_lock) != -1;
}
bool FileStream::LL_Unlock(Blex::FileOffset start, Blex::FileOffset length)
{
        struct flock file_lock;
        file_lock.l_type = F_UNLCK;
        file_lock.l_start = start;
        file_lock.l_whence = SEEK_SET;
        file_lock.l_len = length;
        file_lock.l_pid=getpid();
        return fcntl(filehandle, F_SETLKW, &file_lock) != -1;
}

inline bool ValidNTFileChar(uint8_t ch)
{
        return ch>=32 && ch!='\\' && ch!=':' && ch!='*' && ch!='?'
               && ch!='"' && ch!='<' && ch!='>' && ch!='|';
}

bool IsSafeFilePath(char const *namebegin, char const *nameend, bool slashes_ok)
{
        if (!Blex::IsValidUTF8(namebegin,nameend,false))
            return false;

        if (namebegin==nameend)
            return false;

        //Don't permit filenames starting with a space
        if (*namebegin==' ')
            return false;

        //Don't permit filenames ending in a dot or a space (this also filters "." and ".."
        if (nameend[-1]=='.' || nameend[-1]==' ')
             return false;

        for (;namebegin != nameend;++namebegin)
          if ( (!slashes_ok && *namebegin=='/') || !ValidNTFileChar(*namebegin) )
            return false;

        return true;
}

std::string FixupToAbsolutePath(std::string const &inpath)
{
                std::string p = inpath;
                if(!Blex::PathIsAbsolute(p))
                        p = Blex::GetCurrentDir() + "/" + p;
                p = Blex::CollapsePathString(p);
                return p;
}

} //end namespace Blex
