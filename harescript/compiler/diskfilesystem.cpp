#include <harescript/compiler/allincludes.h>

#include "diskfilesystem.h"
#include <blex/threads.h>

namespace HareScript
{

struct DiskFileSystem::Data
{
        //ErrorHandler *handler;

        std::map<std::string, FilePtr> files;

        Data()
        //: handler(0)
        {}
};


//used only for tests now:
DiskFileSystem::DiskFileSystem(std::string const &_compilecache,std::string const &_tempdir, std::string const &_precompilecache, std::string const &_hsresdir)
: FileSystem(_tempdir, _hsresdir)
, compilecache(_compilecache)
, precompilecache(_precompilecache)
, lockwaitsecs(60)
, compile_engine(*this, "")
, control(compile_engine, *this)
{
        Blex::CreateDirRecursive(compilecache,true);
}

DiskFileSystem::~DiskFileSystem()
{
}

void DiskFileSystem::SetupNamespace(std::string const &prefix, std::string const &location)
{
        namespaces[prefix]=location;
}

Blex::DateTime DiskFileSystem::DiskFile::GetSourceModTime()
{
        std::unique_ptr< Blex::RandomStream > file;
        Blex::DateTime modtime;
        GetSourceData(&file, &modtime);
        return modtime;
}

void DiskFileSystem::DiskFile::GetSourceData(std::unique_ptr< Blex::RandomStream > *str, Blex::DateTime *modtime)
{
        std::unique_ptr< Blex::FileStream > file;
        file.reset(Blex::FileStream::OpenRead(path));
        if (file.get())
            *modtime = file->GetStatus().ModTime();
        else
            *modtime = Blex::DateTime::Invalid();
        str->reset(file.release());
}

void DiskFileSystem::DiskFile::GetClibData(std::unique_ptr< Blex::RandomStream > *str, Blex::DateTime *modtime)
{
        std::unique_ptr< Blex::FileStream > file;
        file.reset(Blex::FileStream::OpenRead(cpath));
        if (file.get())
            *modtime = file->GetStatus().ModTime();
        else
            *modtime = Blex::DateTime::Invalid();
        str->reset(file.release());
}

std::string DiskFileSystem::DiskFile::GetSourceResourcePath()
{
        return path;
}

std::string DiskFileSystem::DiskFile::GetClibPath()
{
        return cpath;
}

void DiskFileSystem::DiskFile::RemoveClib()
{
        Blex::RemoveFile(cpath);
}

bool DiskFileSystem::DiskFile::CreateClib(Blex::RandomStream &str)
{
        std::unique_ptr<Blex::FileStream> newstr;
        newstr.reset(Blex::FileStream::OpenRW(cpath, true, false, Blex::FilePermissions::PublicRead));
        if (!newstr.get())
           return false;

        newstr->SetFileLength(0);
        str.SendAllTo(*newstr);
        return true;
}

std::string DiskFileSystem::DiskFile::GetDescription()
{
        return "file:" + path;
}

void DiskFileSystem::Register(Blex::ContextRegistrator &creg)
{
        Context::Register(creg);
}

std::string DiskFileSystem::ResolveLibraryName(std::string const &liburi) const
{
        //Get the prefix first..
        static const char prefix_sep[]="::";
        std::string::const_iterator prefix_start = std::search(liburi.begin(),liburi.end(),prefix_sep,prefix_sep+2);

        if (prefix_start == liburi.end())
            return std::string();

        //Look up the filesystem associated with the prefix
        std::string nsprefix(liburi.begin(), prefix_start);
        std::string libname(prefix_start+2,liburi.end());

        NamespaceMap::const_iterator nsitr = namespaces.find(nsprefix);

        //return library from filesystem?
        if (nsprefix=="direct" || (nsitr!=namespaces.end() && nsitr->second.empty()))
        {
                //Make relative paths absolute
                if (!Blex::PathIsAbsolute(libname))
                    libname = Blex::MergePath(Blex::GetCurrentDir(),libname);

                //Create a direct reference
                return libname;
        }

        if (nsitr == namespaces.end())
            return std::string();

        //Create the file in this namespace
        return Blex::MergePath(nsitr->second, libname);
}

FilePtr DiskFileSystem::OpenLibrary(Blex::ContextKeeper &keeper, std::string const &liburi) const
{
        Context context(keeper);

        //Have we got this file cached? (ADDME: why bother with a cache here??)
        std::map<std::string, FilePtr>::iterator it = context->files.find(liburi);
        if (it != context->files.end())
            return it->second;

        std::string libname = ResolveLibraryName(liburi);
        if (libname.empty())
            return FilePtr();

        //Create a direct reference
        std::shared_ptr<DiskFile> newfile(new DiskFile);
        newfile->path = libname;
        SetupCompiledName(&*newfile, liburi);

        it = context->files.insert(std::make_pair(liburi, FilePtr(newfile))).first;
        return it->second;
}

void DiskFileSystem::SetupCompiledName (DiskFile *file, std::string const &uri) const
{
        //ADDME: Not really a proper mapping.. A/B and A B map to the same clib name!

        std::string name;
        for (std::string::const_iterator it = uri.begin(); it != uri.end(); ++it)
        {
                if (*it == '#') //duplicate all #s
                    name.push_back('#');

                // Translate "::" to "#"
                if (*it == ':' && it != uri.begin() && *(it-1) == ':')
                    continue;

                if (*it=='#' || *it == '/' || *it == ':' || *it==' ')
                    name.push_back('#');
                else
                    name.push_back(*it);
        }

        name = Blex::StripExtensionFromPath(name) + ".clib";

        if (!precompilecache.empty())
        {
                std::string precompiledname = Blex::MergePath(precompilecache, name);
                if (Blex::PathStatus(precompiledname).IsFile())
                {
                        file->never_recompile=true;
                        file->cpath = Blex::CollapsePathString(precompiledname);
                        return;
                }
        }

        file->never_recompile=false;
        file->cpath = Blex::CollapsePathString(Blex::MergePath(compilecache, name));
}

void DiskFileSystem::SetupDynamicModulePath(std::string const &location)
{
        dynamicmodulepath = location;
}

std::string DiskFileSystem::GetDynamicModuleFullPath(std::string const &modulename) const
{
        if (dynamicmodulepath.empty())
            return std::string(); //no loading now...

        return Blex::MergePath(dynamicmodulepath, "hsm_" + modulename + Blex::GetDynamicLibExtension());
}

DiskFileSystem::RecompileResult DiskFileSystem::Recompile(Blex::ContextKeeper &keeper, std::string const &_liburi, HareScript::ErrorHandler *errorhandler)
{
        std::unique_ptr<Blex::FileStream> lockfile(Blex::FileStream::OpenRW(Blex::MergePath(compilecache, "lockfile"), true, false, Blex::FilePermissions::PublicRead));
        if(!lockfile.get())
            throw std::runtime_error("Cannot create a lockfile in the compile cache directory");

        if(lockfile->GetFileLength() == 0)
           lockfile->Write("diskfilesystem\0",15);

        //take a write lock on the filesystem while compiling...
        Blex::DateTime lockdeadline =  Blex::DateTime::Now() + Blex::DateTime::Seconds(lockwaitsecs);
        std::unique_ptr<Blex::FileStream::Lock> lock;
        while(true)
        {
                lock.reset(lockfile->LockRegion(0, 1));
                if(lock.get())
                        break;

                if(Blex::DateTime::Now() >= lockdeadline)
                        throw std::runtime_error("Unable to lock the compile cache");

                Blex::SleepThread(100);
        }

        compile_engine.GetErrorHandler().Reset();
        control.CompileLibrary(keeper, _liburi);
        *errorhandler = compile_engine.GetErrorHandler();
        if (compile_engine.GetErrorHandler().AnyErrors())
            return DiskFileSystem::RecompileError;
        else
            return DiskFileSystem::RecompileSuccess;
}

std::string DiskFileSystem::TranslateLibraryURI(Blex::ContextKeeper &, std::string const &directuri) const
{
        if (directuri.size() < 8 || Blex::StrCompare(directuri,"direct::",8) != 0)
            return directuri;

        // find longest match in namespaces
        auto best = namespaces.end();
        for (auto it = namespaces.begin(); it != namespaces.end(); ++it)
        {
                if (Blex::StrCaseCompare<std::string::const_iterator>(
                            it->second.begin(),
                            it->second.end(),
                            directuri.begin() + 8,
                            directuri.begin() + 8 + it->second.size()) == 0)
                {
                        if (best == namespaces.end() || it->second.size() > best->second.size())
                            best = it;
                }
        }

        if (best == namespaces.end())
            return directuri;

        return best->first + "::" + directuri.substr(8 + best->second.size());
}

} // End of namespace HareScript
