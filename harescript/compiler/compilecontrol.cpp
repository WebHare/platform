//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include "compilecontrol.h"
#include "../vm/hsvm_librarywrapper.h"
#include <iostream>

// ADDME: Start splitting the huge functions here..
//ADDME: Shouldn't compilecontrol and engine classes just merge ?

namespace HareScript
{
namespace Compiler
{

CompileControl::Library::Library(LoadlibInfo const &_llibinfo)
: llibinfo(_llibinfo)
, loadlibsdone(false)
{
}

void CompileControl::AddToQueue(Assignment &assignment, Library const &lib)
{
        std::list<Library>::iterator it = assignment.queue.begin();
        for (; it != assignment.queue.end(); ++it)
          if (it->llibinfo.loadlib == lib.llibinfo.loadlib)
            {
                if (it->loadlibsdone)
                    throw SetMessagePositions(Message(true, Error::RecursiveLoadlib, it->llibinfo.loadlib), lib.llibinfo);
                break;
            }

        // Push to front (or move to front, if it had been found already)
        if (it == assignment.queue.end())
        {
                assignment.queue.push_front(lib);
        }
        else
        {
                assignment.queue.push_front(*it);
                assignment.queue.erase(it);
        }
}

bool CompileControl::CheckDependencies(Assignment &assignment, std::string const &liburi, Blex::RandomStream *libstream, bool showmsgs)
{
        if (showmsgs)
            std::cerr << "Checking deps of " << liburi << std::endl;

        // Read the library into the wrapper (via a MemoryRWStream, this increases performance of the wrapper code
        WrappedLibrary wrapper;
        Blex::MemoryRWStream str;
        libstream->SendAllTo(str);
        str.SetOffset(0);
        try
        {
                wrapper.ReadLibrary(liburi, &str);
        }
        catch (Message &m)
        {
                if (showmsgs)
                    std::cerr << " Load failed, " << GetMessageString(m) << std::endl;
                if (m.iserror && m.code == Error::InvalidLibrary)
                    return false;
                throw;
        }

        // Check all libraries this library depends on.
        LoadedLibraryDefList const &liblist = wrapper.LibraryList();
        for (LoadedLibraryDefList::const_iterator it = liblist.begin(), end = liblist.end(); it != end; ++it)
        {
                std::string uri = wrapper.linkinfo.GetNameStr(it->liburi_index);

                FileSystem::FilePtr file = filesystem.OpenLibrary(*assignment.keeper, uri);

                if (!file.get())
                    return false;

                LibraryCompileIds ids;
                std::unique_ptr< Blex::RandomStream > clib;
                Blex::DateTime modtime;
                file->GetClibData(&clib,&modtime);
                if (!clib.get() || !WrappedLibrary::ReadLibraryIds(clib.get(), &ids))
                    return false;

                Blex::DateTime sourcetime = file->GetSourceModTime();

                // Error if expected id was not equal to found one, or source time is not expected one
                if (ids.clib_id != it->clib_id || ids.sourcetime != sourcetime)
                    return false;
        }
        return true;
}

void CompileControl::CompileLibrary(Blex::ContextKeeper &keeper, std::string const &liburi)
{
        Assignment assignment;
        assignment.keeper = &keeper;
        LoadlibInfo llib;
        llib.loadlib = liburi;
        assignment.queue.push_front(Library(llib));

        try
        {
                while (true)
                {
                        if (CompileLibraryIterate(assignment))
                            break;
                }
        }
        catch(HareScript::Message &m)
        {
                engine.GetErrorHandler().AddMessage(m);
        }
}

void CompileControl::CompileLibraryFromSource(Blex::ContextKeeper &keeper, std::shared_ptr< Blex::RandomStream > const &source, std::string const &liburi)
{
        Assignment assignment;
        assignment.keeper = &keeper;
        LoadlibInfo llib;
        llib.loadlib = liburi;
        assignment.queue.push_front(Library(llib));
        assignment.queue.begin()->source = source;
        assignment.queue.begin()->sourcetime = Blex::DateTime::Now();

        try
        {
                while (true)
                {
                        if (CompileLibraryIterate(assignment))
                            break;
                }
        }
        catch(HareScript::Message &m)
        {
                engine.GetErrorHandler().AddMessage(m);
        }
}


bool CompileControl::CheckLibraryValidity(Assignment &assignment, Library const &library, bool show_debug)
{
        if (!library.file)
            return library.source.get();

        // Get the time of the source
        Blex::DateTime sourcetime = library.file->GetSourceModTime();

        // Get the clib id's (compile-id, source-time
        bool clib_is_valid = false;
        LibraryCompileIds ids;

        std::unique_ptr< Blex::RandomStream > clib;
        Blex::DateTime modtime;
        library.file->GetClibData(&clib, &modtime);
        if (clib.get())
            clib_is_valid = WrappedLibrary::ReadLibraryIds(clib.get(), &ids);

        // We are done locally if the clib is valid and the sourcetime matches the stored source time
        if (clib_is_valid && ids.sourcetime == sourcetime)
        {
                // Check all used libraries
                if (clib.get() && CheckDependencies(assignment, library.llibinfo.loadlib, clib.get(), show_debug))
                {
                        assignment.okcheckcache.insert(library.llibinfo.loadlib);
                        assignment.compiling.erase(library.llibinfo.loadlib);
                        return true;
                }
        }

        // Not valid! Remove the clib
        clib.reset();
        library.file->RemoveClib();

        return false;
}

FileSystem::FilePtr CompileControl::GetLibraryFile(Assignment &assignment, LoadlibInfo const &lib, bool show_debug)
{
        FileSystem::FilePtr file;
        try
        {
                file = filesystem.OpenLibrary(*assignment.keeper, lib.loadlib);
                if (!file)
                {
                        if (show_debug)
                            std::cerr << "Could not open source file for " << lib.loadlib << std::endl;
                        throw Message(true, Error::CannotFindLibrary, lib.loadlib);
                }
        }
        catch (Message &m)
        {
                throw SetMessagePositions(m, lib);
        }
        return file;
}

std::unique_ptr< Blex::RandomStream > CompileControl::GetSource(LoadlibInfo const &lib, FileSystem::FilePtr const&file, Blex::DateTime &modtime, bool show_debug)
{
        std::unique_ptr< Blex::RandomStream > source;
        file->GetSourceData(&source, &modtime);

        if (!source.get())
        {
                if (show_debug)
                    std::cerr << "Could not open source file for " << lib.loadlib << std::endl;

                throw SetMessagePositions(Message(true, Error::CannotFindLibrary, lib.loadlib), lib);
        }

        return source;
}

Message CompileControl::SetMessagePositions(Message const &m, LoadlibInfo const &lib)
{
        Message msg(m);
        msg.filename=lib.requester;
        msg.position=lib.loc;
        return msg;
}

bool CompileControl::CompileLibraryIterate(Assignment &assignment)
{
/*      Execution of compilation of a library:

        1. Try to read the compiled version. Valid && source mod time matches recorded one->check dependencies
           for (valid && source mod time matches recorded one). If so->done
        2. Parse loadlibs from source file and compile all those libraries. */

        Library &library = assignment.queue.front();

        // Already compiled or checked?
        if (assignment.okcheckcache.count(library.llibinfo.loadlib) != 0)
        {
                assignment.queue.pop_front();
                return assignment.queue.empty();
        }

        if (!library.loadlibsdone)
        {
                // Predefinition, because of borland exception bugs
                std::vector<LoadlibInfo> loadlibs;

                // Check for circular loadlibs
                if (assignment.compiling.count(library.llibinfo.loadlib))
                     throw SetMessagePositions(Message(true, Error::RecursiveLoadlib, library.llibinfo.loadlib), library.llibinfo);

                assignment.compiling.insert(library.llibinfo.loadlib);

                bool show_debug = engine.GetDebugOptions().show_compilecontrol;

                // Get the library file access object from the filesystem
                if (!library.source.get())
                {
                        library.file = GetLibraryFile(assignment, library.llibinfo, show_debug);

                        // Are the library and its dependencies valid?
                        if (CheckLibraryValidity(assignment, library, show_debug))
                        {
                                assignment.queue.pop_front();
                                return assignment.queue.empty();
                        }

                        library.source.reset(GetSource(library.llibinfo, library.file, library.sourcetime, show_debug).release());
                }

                // Not valid: we need to recompile the library (or a loadlib). Get the source, get the loadlibs, do them
                library.loadlibsdone = true;

                // Parse loadlibs from the source file
                loadlibs = engine.GetLoadLibs(*assignment.keeper, library.llibinfo.loadlib, *library.source.get());
                for (std::vector<LoadlibInfo>::reverse_iterator it = loadlibs.rbegin(); it != loadlibs.rend(); ++it)
                {
                        if (show_debug)
                            std::cerr << " Recursively compiling " << it->loadlib << " to queue" << std::endl;
                        AddToQueue(assignment, Library(*it)); //NOTE! Invalidates 'library' reference
                }
                return false;
        }
        else
        {
                // All done, proceed with compiling
                Blex::MemoryRWStream newstr;
                engine.Compile(*assignment.keeper, library.llibinfo.loadlib, library.sourcetime, *library.source.get(), newstr);
                newstr.SetOffset(0);
                if (engine.GetErrorHandler().AnyErrors())
                    return true;
                if (library.file.get() && !library.file->CreateClib(newstr))
                    throw SetMessagePositions(Message(true, Error::CannotWriteCompiledLibrary, library.llibinfo.loadlib), library.llibinfo);

                // Done compiling
                assignment.compiling.erase(library.llibinfo.loadlib);
                assignment.okcheckcache.insert(library.llibinfo.loadlib);

                assignment.queue.pop_front();

                return assignment.queue.empty();
        }
}

} // End of namespace Compiler
} // End of namespace HareScript
