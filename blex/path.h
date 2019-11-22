#ifndef blex_path
#define blex_path

#ifndef blex_datetime
#include "datetime.h"
#endif
#ifndef blex_stream
#include "stream.h"
#endif

namespace Blex
{

namespace FilePermissions
{

///Accessflags for newly created files (note: only work on Unix!)
enum AccessFlags
{
        OwnerRead=0400,
        OwnerWrite=0200,
        OwnerExecute=0100,
        GroupRead=0040,
        GroupWrite=0020,
        GroupExecute=0010,
        OthersRead=0004,
        OthersWrite=0002,
        OthersExecute=0001,

        PrivateRead = 0600,
        PublicRead = 0644
};

inline AccessFlags operator | (AccessFlags src, AccessFlags or_with)
{
        return AccessFlags((unsigned)src | unsigned(or_with));
}

inline AccessFlags operator |= (AccessFlags &tomodify, AccessFlags or_with)
{
        return tomodify = tomodify | or_with;
}

} //end namespace Permissions

class Directory;

///status of a file or path
class BLEXLIB_PUBLIC PathStatus
{
        public:
        /** Construct a PathStatus object, with garbage data */
        PathStatus()
        {
        }

        /** Fill in the PathStatus structure with the status of a file or directory
            @param p Path to obtain status for */
        explicit PathStatus(std::string const &p)
        {
                Stat(p);
        }

        /** Fill in the PathStatus structure with the status of a file or directory
            @param p Path to obtain status for */
        explicit PathStatus(const char *p)
        {
                Stat(p);
        }

        /** Fill in the PathStatus structure with the information from a file descriptor
            @param fd File descriptor to obtain status for */
        explicit PathStatus(FileHandle fd)
        {
                Stat(fd);
        }

        /** Fill in the PathStatus structure with the status of a file or directory
            @param p Path to obtain status for */
        void Stat(std::string const &p);

        /** Fill in the PathStatus structure with the status of a file or directory. If p is a link, don't derefence it
            @param p Path to obtain status for */
        void StatNoDeref(std::string const &p);

        /** Fill in the PathStatus structure with the status of a file or directory
            @param p Path to obtain status for */
        void Stat(const char *p);

        /** Fill in the PathStatus structure with the status of a file or directory. If p is a link, don't dereference it
            @param p Path to obtain status for */
        void StatNoDeref(const char *p);

        /** Fill in the PathStatus structure with the information from a file descriptor
            @param fd File descriptor to obtain status for */
        void Stat(FileHandle fd);

        /** Does an object with this path exist? */
        bool Exists() const
        { return (int)flags!=None; }

        /** Is this object a file? */
        bool IsFile() const
        { return (flags&TypeMask)==File; }

        /** Is this object a directory? */
        bool IsDir() const
        { return (flags&TypeMask)==Dir; }

        /** Is this object a link ? */
        bool IsLink() const
        { return (flags&TypeMask)==Link; }

        /** The length of the object in bytes */
        FileOffset FileLength(void) const
        { return length; }

        /** The date and time of the last modification */
        Blex::DateTime ModTime(void) const
        { return modtime; }

        /** The date and time of object creation */
        Blex::DateTime CreateTime(void) const
        { return createtime; }

        /** The date and time of the last access */
        Blex::DateTime AccessTime(void) const
        { return accesstime; }

        /** Access rights */
        FilePermissions::AccessFlags GetUnixAccess(void) const
        { return unix_permissions; }

        private:
        /** Filesystem object types */
        enum Flags
        {
                ///Object does not exist
                None=0,
                ///Object is a directory
                Dir=1,
                ///Object is a regular file
                File=2,
                ///Object is of link type
                Link=3,
                ///Object is of any different type
                Other=4,
                ///Type mask
                TypeMask=7
        };

        /** Parse an OS-given stat buffer into the member variables */
        void ParseStatbuf(const void * statbuf, const char *filename);

        /** File type and flags*/
        Flags flags;
        /** Time of last modification */
        Blex::DateTime modtime;
        /** Time of last acces */
        Blex::DateTime accesstime;
        /** Time of creation */
        Blex::DateTime createtime;
        /** Object length */
        FileOffset length;
        /** UNIX File permssion mask */
        FilePermissions::AccessFlags unix_permissions;

        friend class Directory;
};

/** A class for iterating the contents of a directory.

    Note that this class currently only supports the simple wildcards '*'
    and '?', and will always use Unix-style globbing, which means that
    the searchmask 'site.*' will not match the file 'site'

    ADDME: This class should use regular iterator style, and not _be_ an
    iterator itself. We should probably replace this code with the boost
    directory iterator */
class BLEXLIB_PUBLIC Directory
{
        public:
        /** Construct a directory iterator
            @param searchpath Path to scan (eg '/var/webhare/data')
            @param searchmask Files to scan (eg '*.tmp') */
        Directory(std::string const &searchpath,std::string const &searchmask);

        /** Destroy directory iterator and free its resources */
        ~Directory();

        /** Get the path status of the currently iterated object */
        PathStatus const & GetStatus(void) const
        {
                if (!havestatus)
                    const_cast<Directory*>(this)->ParseStatus();
                return thisstatus;
        }

        /** Were there any files length in the directory?
            @return false, if the last iteration did not return any file. */
        bool FilesLeft(void) const;    //Any files left?

        /** Iterate to the next file in the directory matching the search mask */
        void NextFile(void);           //Move on to the next file

        /** Were there any files length in the directory?
            @return false, if the last iteration did not return any file. */
        operator bool(void) const
        {
                return FilesLeft();
        }
        /** Iterate to the next file in the directory matching the search mask */
        Directory& operator ++(void)
        {
                NextFile();
                return *this;
        }

        /** Get the current object's full path
            @return A MergePath between searchpath and CurrentFile()*/
        std::string CurrentPath(void) const;

        /** Get the current object's name */
        std::string const &CurrentFile(void) const;

        private:
        bool IsMatch();
        bool GetNextEntry();
        void ParseStatus();

        struct Data;
        Data *data;

        PathStatus thisstatus;
        bool havestatus;
        std::string searchpath;
        std::string searchmask;
        std::string currentfile;
};

/** \brief Clean up a path, by collapsing it and removing duplicate slashes.

    This function also removes /dir/../ parts, and will remove any references
    to parents higher that the given path itself. It works like 'unique',
    returning a pointer to the new end of the path

    @param start Start of path to clean up
    @param end Limit of path to clean up
    @return A pointer to end of the cleaned up path*/
BLEXLIB_PUBLIC char* CollapsePath(char *start, char *end, bool preserve_trailing_slash = false);

/** Clean up a path, by collapsing it and removing duplicate slashes. This
    function is simply a more user-friendly wrapper around CollapsePath.
    @param p Path to clean up
    @return Cleaned-up path */
BLEXLIB_PUBLIC std::string CollapsePathString(std::string const &p, bool preserve_trailing_slash = false);

/** Merge two paths together, inserting a slash at the merge point if necessary. Strips any double-dots in the pathname
    @param path Starting path
    @param mergepath Path or filename to append
    @return The merged and sanitized path */
BLEXLIB_PUBLIC std::string MergePath(std::string const &path,std::string const &mergepath);

/** Delete a file. For directories, use RemoveDir or RemoveDirRecursive
    @param todel File to delete
    @return true if the delete was succesful, false if it failed */
BLEXLIB_PUBLIC bool RemoveFile(std::string const &todel);

/** Move or rename a file or directory, overwriting the destination file if necessary and possible
    Note that, amongst other reasons, a Move can fail because an attempt
    was made to cross a filesystem boundary.
    @param oldpath Original path
    @param newpath New path
    @return true if the move was succesful, false if it failed */
BLEXLIB_PUBLIC bool MovePath(std::string const &oldpath,std::string const &newpath);

/** Check if a path is absolute (for this OS).
    eg. A:/ would be considered absolute under WinNT, but not under unix
    and,/hi/ha/ would be considered absolute under unix, but not under WinNT
    @param p Path to check
    @return true if the path is absolute, false if it seems to be relative */
BLEXLIB_PUBLIC bool PathIsAbsolute(std::string const &p);

/** Change the current directory
    @param newdir New current directory
    @return True if changing the directory succeeded */
BLEXLIB_PUBLIC bool ChangeDir(std::string const &p);

/** Returns the current directory
    @return Path to the current directory */
BLEXLIB_PUBLIC std::string GetCurrentDir();

/** Create a directory. .
    @param p Directory to create
    @param publicdir True to make the directory visible to all, false to make it private (currently UNIX only)
    @return True if creating the directory succeeded */
BLEXLIB_PUBLIC bool CreateDir(std::string const &p,bool publicdir);

/** Create a directory, and any of its parent directories.
    @param p Directory to create
    @param publicdir True to make the directory visible to all, false to make it private (currently UNIX only)
    @return True if creating the directory succeeded or the directory already exists*/
BLEXLIB_PUBLIC bool CreateDirRecursive(std::string const &p,bool publicdir);

/** Remove a directory if it doesn't contain any files or subdirectories.
    @param p Directory to remove
    @return True if removing the directory succeeded */
BLEXLIB_PUBLIC bool RemoveDir(std::string const &p);

/** Remove a directory and all files and directories it contains.
    @param p Directory to remove
    @return True if removing the directory succeeded */
BLEXLIB_PUBLIC bool RemoveDirRecursive(std::string const &p);

/** Remove files and directories recursively, by wildcard mask
    @param p Directory to remove
    @param mask Mask for files/folders to remove (will never match '.' or '..')
    @return True if removing the directory succeeded */
BLEXLIB_PUBLIC bool RemoveMultiple(std::string const &p, std::string const &mask);

/** Create a temporary directory inside another directory. .
    @param start Path and start of the name of the temp directory (something like '/my/dir/tempdir')
    @param publicdir True to make the directory visible to all, false to make it private (currently UNIX only)
    @return Name of the new directory if succesful, otherwise an empty string  */
BLEXLIB_PUBLIC std::string CreateTempDir(std::string const &start,bool publicdir);

/** Generate a temporary pathname.
    Use this function to create a new name without using it, but be careful
    about race conditions, as another process may have taken the name already.
    @param start Path and start of the name of the temp directory (something like '/my/dir/tempdir')
    @return Suggested name for the temporary file */
BLEXLIB_PUBLIC std::string CreateTempName(std::string const &start);

/** Return a path with its extension stripped off, including the dot that starts the extension
    @param path Path to strip the extension from
    @return Stripped pathname */
BLEXLIB_PUBLIC std::string StripExtensionFromPath(std::string const &path);

/** Get the system temporary directory. Using this directory may be a SECURITY
    RISK under many circumstances. Always set the 'exclusive' flag on files
    created in this directory to prevent symbolic link races. */
BLEXLIB_PUBLIC std::string GetSystemTempDir();

///Get the folder from a path, leaving everything up to the slash
BLEXLIB_PUBLIC std::string GetDirectoryFromPath(std::string const &path);

///Strip the folder information from a path, leaving only its name and extension
BLEXLIB_PUBLIC std::string GetNameFromPath(std::string const &path);

///Strip the folder and filename information from a path, leaving only its extension, including the dot
BLEXLIB_PUBLIC std::string GetExtensionFromPath(std::string const &path);

/** Copy a directory and everything it contains, recursively
    @param origdir Source directory
    @param newdir Name of the final directory (should not exist yet)
    @return true on success */
BLEXLIB_PUBLIC bool CopyDirRecursive(const std::string &orgdir, const std::string &newdir);
/** Copy a file. Overwrites any existing file
    @param origfile Source file
    @param newfile Path to the new file
    @return True on success */
BLEXLIB_PUBLIC bool CopySingleFile(const std::string &origfile, const std::string &newfile);

/** Set UNIX permissions on a folder or file. */
BLEXLIB_PUBLIC bool SetUNIXPermissions(std::string const &path, FilePermissions::AccessFlags newpermissions);

/** Set a file's modification date
    @param path File path to update
    @param new_modification_date The new file modification date
    @return True on success */
BLEXLIB_PUBLIC bool SetFileModificationDate(std::string const &path, Blex::DateTime new_modification_date);

/** Create a hard link
    @param path File path to create the link at
    @param source Source file that must be linked to
    @return True on success
*/
BLEXLIB_PUBLIC bool CreateNewHardLink(std::string const &path, std::string const &source);

/** Create a soft link
    @param path File path to create the link at
    @param source Source file that must be linked to
    @return True on success
*/
BLEXLIB_PUBLIC bool CreateNewSoftLink(std::string const &path, std::string const &source);

/** Read a soft link
    @param path File path to read the link from
    @return The soft link, or an empty string if it's not a soft link or the path couldn't be properly read (eg if it was modified and grew in size during the call to ReadSoftLink)
*/
BLEXLIB_PUBLIC std::string ReadSoftLink(std::string const &path);


/** Returns a string containing a description of the last OS error (errno/GetLastError)
    @return Textual representation of the last error.
*/
BLEXLIB_PUBLIC std::string GetLastOSError();

/** Verify whether a [namebegin,nameend[ is acceptable as a file, folder, site or username in WebHare.
    @param slashesok true to ignore slashes in the name (used to validate full paths)
    @return true if the name is acceptable in WebHare */
BLEXLIB_PUBLIC bool IsSafeFilePath(const char *namebegin, const char *nameend, bool slashesok);

/** FileStreams allow access to files on disk, or at least to objects that
    look like files on disk. Access to all FileStream members functions
    must be synchronized in MT environments */
class BLEXLIB_PUBLIC FileStream : public RandomStream
{
        public:
        class Lock
        {
                private:
                Lock();
                Blex::FileOffset start;
                Blex::FileOffset length;
                Blex::FileStream *owner;

                public:
                ~Lock();

                friend class FileStream;
        };

        ~FileStream();

        /** Open a file for reading only
            @param filename File to open
            @return A dynamically allocated filestream (which the receiver must delete)
                    if the file opening was succesful, and NULL otherwise */
        static FileStream* OpenRead(std::string const &filename);

        /** Open a file for writing only
            @param filename File to open
            @param create create if the file doesn't exist (but leave untouched if it does)
            @param exclusive fail if the file exists and 'create' was true
            @param access accessmode for file (eg FilePermissions::PublicRead or FilePermissions::PrivateRead, currently only affects UNIX)
            @return A dynamically allocated filestream (which the receiver must delete)
                    if the file opening was succesful, and NULL otherwise
            \warning Opening a file for write access does not truncate it,
                     so if you might overwrite existing files, considering doing a
                     SetFilelength(GetOffset()) as your last command */
        static FileStream* OpenWrite(std::string const& filename,
                                              bool create,
                                              bool exclusive,
                                              FilePermissions::AccessFlags access);

        /** Open a file for R/W only
            @param filename File to open
            @param create create if the file doesn't exist (but leave untouched if it does)
            @param exclusive fail if the file exists and 'create' was true
            @param access accessmode for file (eg FilePermissions::PublicRead or FilePermissions::PrivateRead, currently only affects UNIX)
            @return A dynamically allocated filestream (which the receiver must delete)
                    if the file opening was succesful, and NULL otherwise
            \warning Opening a file for write access does not truncate it,
                     so if you might overwrite existing files, considering doing a
                     SetFilelength(GetOffset()) as your last command */
        static FileStream* OpenRW(std::string const &filename,
                                            bool create,
                                            bool exclusive,
                                            FilePermissions::AccessFlags  access);

        /** Open a temporary file for R/W. It will be automatically deleted after use
            @param start Start of the filename to open (create using: Blex::MergePath("your-tmp-path","start-of-tmpfile-name")
            @param access accessmode for file (eg, FilePermissions::PrivateRead)
            @return A dynamically allocated filestream
                    if the file opening was succesful, and NULL otherwise */
        static FileStream* OpenRWTemp(std::string const &start, FilePermissions::AccessFlags  access);

        /** Open a temporary file for writing only. It will be automatically deleted after use
            @param start Start of the filename to open (create using: Blex::MergePath("your-tmp-path","start-of-tmpfile-name")
            @param access accessmode for file (eg, FilePermissions::PrivateRead)
            @return A dynamically allocated filestream (which the receiver must delete)
                    if the file opening was succesful, and NULL otherwise */
        static FileStream* OpenWriteTemp(std::string const &start, FilePermissions::AccessFlags  access);

        /** Ask the OS to flush its file buffers
            @return true if the buffers were succesfully flushed */
        virtual bool OSFlush();

        /** Read a file from a specific position.
            @param buf Buffer to fill
            @param pos Starting position
            @param maxbufsize Maximum buffer size
            @return The number of bytes actually read, or 0 on EOF or I/O error*/
        std::size_t DirectRead(FileOffset pos,void *buf,std::size_t maxbufsize) ;
        /** Write a file to a specific position.
            @param buf Buffer to write from
            @param pos Starting position
            @param bufsize Size of the buffer to write
            @return The number of bytes written (bufsize), or 0 on I/O error*/
        std::size_t DirectWrite(FileOffset pos,const void *buf,std::size_t bufsize) ;

        /** Change the file length of the current file (allows both truncation and extending).
            The current file position is not altered, unless it was beyond EOF,
            in which case it is moved to EOF
            @param newlenth Total length the file should have
            @return true if the file was succesfully resized */
        bool SetFileLength(FileOffset newlength);

        /** Retrieve the current length of the file */
        FileOffset GetFileLength() ;

        /** Get the file's properties */
        PathStatus GetStatus() ;

        /** Get the current offset of the read/write pointer in the file */
        FileOffset GetOffset() ;

        /** Set the offset of the read/write pointer in the file */
        bool SetOffset(FileOffset newoffset);

        /** Get the OS's file handle of the file, necessary to use native APIs */
        FileHandle GetFileHandle()
        { return filehandle; }

        /** Read bytes from the stream, at the current file pointer
            @param buf Location to store read data
            @param maxbufsize Maximum number of bytes to read
            @return Number of bytes read. If the returned value is less than
                    'maxbufsize', not enough bytes were available */
        std::size_t Read(void *buf,std::size_t maxbufsize);

        /** Write bytes to the stream, at the current file pointer
            @param buf Location to read data from
            @param bufsize Number of bytes to write
            @return Number of bytes written. If the returned value is less than
                    'bufsize', not enough output space was available */
        std::size_t Write(const void *buf,std::size_t bufsize);

        /** Obtain a lock
            @param start Start offset of the lock
            @param length Length of region to lock
            @return A lock object (which the caller must destroy) if the lock succeeded, NULL otherwise */
        Lock* LockRegion(Blex::FileOffset start, Blex::FileOffset length);

        /** (Re)set the modification and access time of a file
            @return True on success */
        bool SetModAccessTime(Blex::DateTime newaccesstime);

        bool EndOfStream();

        void AssumeReadOnce();

        private:
        bool canread;
        bool canwrite;
        bool eof;
        bool evictonclose;

        FileStream(FileHandle fd,bool canread, bool canwrite);

        static FileStream* InternalOpen(std::string const &filename,
                                        bool read_access,
                                        bool write_access,
                                        bool create_file,
                                        bool exclusive_create,
                                        bool auto_delete,
                                        FilePermissions::AccessFlags access);

        bool LL_Lock(Blex::FileOffset start, Blex::FileOffset length);
        bool LL_Unlock(Blex::FileOffset start, Blex::FileOffset length);

        FileHandle filehandle;
        friend class Lock;
};

/** @short Make the path absolute. */
BLEXLIB_PUBLIC std::string FixupToAbsolutePath(std::string const &inpath);

} //end namspace Blex

#endif
