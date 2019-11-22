#include <harescript/compiler/allincludes.h>

#include "diskfilesystem.h"
#include <blex/xml.h>
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


std::string ParseConfigPath(std::string const &configfilepath, std::string const &inpath, bool expectdir)
{
        std::string path = inpath;
        if(path.empty())
            return path;

        if(!Blex::PathIsAbsolute(path))
            path = Blex::MergePath(Blex::GetDirectoryFromPath(configfilepath), path);

        if(expectdir && !path.empty() && path.end()[-1]!='/')
            path.push_back('/');

        return path;
}

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

DiskFileSystem::DiskFileSystem(Blex::OptionParser const &options)
: FileSystem(Blex::GetSystemTempDir(), "")
, lockwaitsecs(60)
, compile_engine(*this, "")
, control(compile_engine, *this)
{
        if(options.Exists("p"))
        {
                precompilecache = options.StringOpt("p");
                precompilecache = Blex::FixupToAbsolutePath(precompilecache);
        }

        std::string configfilepath = options.StringOpt("config");
        if(configfilepath.empty())
            configfilepath = Blex::GetEnvironVariable("HSENGINE_CONFIG");

        if(configfilepath.empty())
        {
                std::string exename = Blex::GetExecutablePath();
                if(!exename.empty())
                    configfilepath = Blex::MergePath(Blex::GetDirectoryFromPath(exename) + "/../etc","hsengine.xml");
        }

        if(!configfilepath.empty() && Blex::PathStatus(configfilepath).IsFile())
        {
                //Get settings from this XML file
                Blex::XML::Document config;
                if(!config.ReadFromFile(configfilepath))
                    throw std::runtime_error("Cannot read the hsengine configuration file " + configfilepath);

                static const Blex::XML::Namespace hsengine("hsengine", "http://www.webhare.net/xmlns/harescript/hsengine");
                Blex::XML::Node docelement = config.GetRoot();
                if(!docelement || !docelement.IsInNamespace(hsengine) || !docelement.LocalNameIs("hsengine") || docelement.GetAttr(0, "version")!="1")
                    throw std::runtime_error("Unrecognized hsengine configuration file " + configfilepath);

                for(Blex::XML::Node confignode = docelement.GetFirstChild(); confignode; confignode = confignode.GetNextSibling())
                {
                        if(confignode.LocalNameIs("namespace"))
                        {
                                std::string prefix = confignode.GetAttr(0,"name");
                                std::string path = ParseConfigPath(configfilepath, confignode.GetAttr(0,"path"), true);
                                SetupNamespace(prefix,path);
                        }
                        else if(confignode.LocalNameIs("resources"))
                        {
                                whresdir = ParseConfigPath(configfilepath, confignode.GetAttr(0,"path"), true);
                        }
                        else if(confignode.LocalNameIs("compilecache"))
                        {
                                compilecache = ParseConfigPath(configfilepath, confignode.GetAttr(0,"path"), true);
                        }
                        else if(confignode.LocalNameIs("dynamiclibrarydir"))
                        {
                                SetupDynamicModulePath(ParseConfigPath(configfilepath, confignode.GetAttr(0,"path"), true));
                        }
                }
        }

        if(options.Exists("c"))
            compilecache = Blex::FixupToAbsolutePath(options.StringOpt("c"));
        if(options.Exists("d"))
            SetupDynamicModulePath(Blex::FixupToAbsolutePath(options.StringOpt("d")));

        if(compilecache.empty()) //FIXME Use safe compile cache dir (eg /tmp is unsafe because of shares!)
        {
                std::string home = Blex::GetEnvironVariable("HOME");
                if (home.empty())
                    compilecache = Blex::MergePath(Blex::GetSystemTempDir(), "hsengine-compilecache");
                else
                    compilecache = Blex::MergePath(home, ".hsengine/compilecache");
        }

        if(compilecache.empty())
           throw std::runtime_error("Compile cache unspecified");

        std::vector<std::string> const &namespaces = options.StringList("n");
        for (unsigned i=0;i<namespaces.size();++i)
        {
                std::string::const_iterator separator = std::find(namespaces[i].begin(),namespaces[i].end(),'=');
                if (separator == namespaces[i].end())
                    throw std::runtime_error("Invalid namespace specification: " + namespaces[i]);

                std::string prefix(namespaces[i].begin(),separator);
                std::string path(separator+1,namespaces[i].end());

                SetupNamespace(prefix,Blex::FixupToAbsolutePath(path));
        }

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

DiskFileSystem::RecompileResult DiskFileSystem::Recompile(Blex::ContextKeeper &keeper, std::string const &_liburi, bool /*isloadlib*/, HareScript::ErrorHandler *errorhandler)
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
