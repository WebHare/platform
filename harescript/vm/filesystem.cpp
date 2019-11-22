#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------
#include <blex/path.h>
#include <iostream>
#include "filesystem.h"
#include "errors.h"

namespace HareScript
{

bool IsValidFilesystemPath(std::string const &libname)
{
        if (libname.empty() || !Blex::IsValidUTF8(libname.begin(), libname.end(), true))
            return false;

        //Check for simple errors (using backslashes or uppercase in libnames)
        if (std::find(libname.begin(),libname.end(),'\\') != libname.end())
            return false;

        // The end of the prefix
        static const char prefix[3] = {"::"};
        // Is there a prefix
        std::string::const_iterator prefixend = std::search(libname.begin(),libname.end(),prefix,prefix+2);
        if (prefixend == libname.end())
            return false;

        prefixend += 2;
        bool allow_relative = std::string(libname.begin(), prefixend) == "relative::";

        //Check for any path component ending with a space or a dot (excluding '.' and '..')
        std::string::const_iterator compstart = prefixend;
        while (true)
        {
                std::string::const_iterator compend  = std::find(compstart, libname.end(), '/');
                int size = std::distance(compstart, compend);

                if (size != 0)
                {
                        if (compend[-1] == ' ')
                            return false;
                        if (compend[-1]=='.' && (size != 2 || compend[-2]!='.' || !allow_relative))
                            return false;
                }
                if (compend == libname.end())
                    break;
                compstart = ++compend;
        }

        //Check for collapsable paths
        std::string collapsablecopy(prefixend, libname.end());

        unsigned size_before_collapse = collapsablecopy.size();
        Blex::CollapsePathString(collapsablecopy);
        if (collapsablecopy.size() != size_before_collapse)
            return false;

        return true;
}


FileSystem::File::File()
{
}

FileSystem::File::~File()
{
}

FileSystem::FileSystem(std::string const &_tempdir, std::string const &_whresdir)
: tempdir(_tempdir)
, whresdir(_whresdir)
{
}

FileSystem::~FileSystem()
{
}

void FileSystem::ReleaseResources(Blex::ContextKeeper &/*keeper*/)
{
}

FileSystem::RecompileResult FileSystem::Recompile(Blex::ContextKeeper &, std::string const &, bool, HareScript::ErrorHandler *)
{
        return RecompileNotSupported;

}

void FileSystem::Register(Blex::ContextRegistrator &)
{
}

void FileSystem::ResolveAbsoluteLibrary(Blex::ContextKeeper &, std::string const &loader, std::string *libname) const
{
          // The end of the prefix
        static const char prefix[3] = {"::"};

        // Is there a prefix
        std::string::iterator prefixend = std::search(libname->begin(),libname->end(),prefix,prefix+2);
        if (prefixend == libname->end())
            return; // Naah, no prefix, just let it be
        prefixend += 2;

        if (std::string(libname->begin(), prefixend) != "relative::")
            return;

        // Is there a prefix in the loader?
        std::string::const_iterator lprefixend = std::search(loader.begin(),loader.end(),prefix,prefix+2);
        if (lprefixend == loader.end())
            lprefixend = loader.begin();
        else
            lprefixend += 2;

        if (prefixend + 1 != libname->end() && *prefixend == '/')
        {
                ++prefixend;
                *libname = std::string(loader.begin(), lprefixend) + std::string(prefixend, libname->end());
        }
        else
        {
                *libname = std::string(loader.begin(), lprefixend) + Blex::MergePath(
                    Blex::GetDirectoryFromPath(std::string(lprefixend, loader.end())),
                    std::string(prefixend, libname->end()));
        }
}

} // End of namespace HareScript

