#include <harescript/vm/allincludes.h>

#include "hsvm_librarywrapper.h"
#include "errors.h"

namespace HareScript
{

const unsigned LibraryFormatVersion = HARESCRIPT_LIBRARYVERSION;
const int ConstAlignment = 4; // Must be multiple of 4!

//---------------------------------------------------------------------------

std::pair<int32_t, uint8_t *> WrappedLibrary::SetConstantBuffer(unsigned length)
{
        int32_t index = resident.c_values.size(); //get index of new constant
        unsigned id = resident.c_indexes.size();

        resident.c_values.resize(resident.c_values.size() + length);
        resident.c_indexes.push_back(index);
        return std::make_pair(id, &resident.c_values[index]);
}

uint8_t const * WrappedLibrary::GetConstantBuffer(int32_t id) const
{
        return &resident.c_values[resident.c_indexes[id]];
}

uint32_t WrappedLibrary::GetConstantBufferLength(int32_t id) const
{
        return resident.c_indexes[id + 1] - resident.c_indexes[id];
}


//---------------------------------------------------------------------------
Blex::StringPair SectionLinkInfo::GetName(unsigned idx) const
{
        if (idx==0)
            return Blex::StringPair((char*)NULL,(char*)NULL);

        if (idx>nameidx.size())
            throw std::runtime_error("Name index out of range");
        return Blex::StringPair(&names[nameidx[idx-1]],
                                idx == nameidx.size() ? &names[names.size()] : &names[nameidx[idx]]);
}
unsigned SectionLinkInfo::SetName(std::string const &newname)
{
        if (newname.empty())
            return 0;

        //ADDME: When writing a library, try to combine non-unique names
        nameidx.push_back(names.size());
        names.insert(names.end(),newname.begin(),newname.end());
        return nameidx.size();
}


//---------------------------------------------------------------------------
WrappedLibrary::WrappedLibrary()
{
}
WrappedLibrary::~WrappedLibrary()
{
}

//---------------------------------------------------------------------------
bool WrappedLibrary::ReadLibraryIds(Blex::RandomStream *stream, LibraryCompileIds *ids)
{
        uint8_t buffer[32];
        stream->DirectRead(0, buffer, sizeof(buffer));
        stream->SetOffset(0);
        Blex::MemoryReadStream memstream(buffer, sizeof(buffer));

        if (memstream.ReadLsb<uint32_t>() != 0x4c485244)
        {
                stream->SetOffset(0);
                return false;
        }
        if (memstream.ReadLsb<uint32_t>() != LibraryFormatVersion)
        {
                stream->SetOffset(0);
                return false;
        }

        ids->clib_id = memstream.ReadLsb<Blex::DateTime>();
        ids->sourcetime = memstream.ReadLsb<Blex::DateTime>();
        return true;
}

void WrappedLibrary::DoReadLibrary(Blex::RandomStream *stream)
{
        stream->SetOffset(0);

        if (stream->ReadLsb<uint32_t>() != 0x4c485244)
            throw std::runtime_error("Not a HareScript library");
        if (stream->ReadLsb<uint32_t>() != LibraryFormatVersion)
            throw std::runtime_error("Wrong library version, recompile needed");

        resident.compile_id = stream->ReadLsb<Blex::DateTime>();
        resident.sourcetime = stream->ReadLsb<Blex::DateTime>();
        uint32_t length = stream->ReadLsb<uint32_t>();

        if (length != stream->GetFileLength())
            throw std::runtime_error("Real length of library does not match length set in library, please recompile.");

        resident.initfunction = stream->ReadLsb<int32_t>();
        resident.deinitfunction = stream->ReadLsb<int32_t>();
        resident.scriptproperty_fileid = stream->ReadLsb<int32_t>();
        resident.scriptproperty_filecreationdate = stream->ReadLsb<Blex::DateTime>();
        resident.scriptproperty_systemredirect = stream->ReadLsb<uint8_t>();

        uint32_t start_code = stream->ReadLsb<uint32_t>();
        uint32_t start_libraries = stream->ReadLsb<uint32_t>();
        uint32_t start_constants = stream->ReadLsb<uint32_t>();
        uint32_t start_variables = stream->ReadLsb<uint32_t>();
        uint32_t start_functions = stream->ReadLsb<uint32_t>();
        uint32_t start_objecttypes = stream->ReadLsb<uint32_t>();
        uint32_t start_names = stream->ReadLsb<uint32_t>();
        uint32_t start_types = stream->ReadLsb<uint32_t>();
        uint32_t start_exceptions = stream->ReadLsb<uint32_t>();
        uint32_t start_debug = stream->ReadLsb<uint32_t>();
        uint32_t start_debuginfo = stream->ReadLsb<uint32_t>();

        if (start_code == 0)
            throw std::runtime_error("Library corrupt, missing code section");
        if (start_libraries == 0)
            throw std::runtime_error("Library corrupt, missing libraries section");
        if (start_code == 0)
            throw std::runtime_error("Library corrupt, missing code section");
        if (start_variables == 0)
            throw std::runtime_error("Library corrupt, missing variables section");
        if (start_functions == 0)
            throw std::runtime_error("Library corrupt, missing functions section");
        if (start_objecttypes == 0)
            throw std::runtime_error("Library corrupt, missing object types section");
        if (start_names == 0)
            throw std::runtime_error("Library corrupt, missing column names section");
        if (start_types == 0)
            throw std::runtime_error("Library corrupt, missing types section");

        // Section constants MUST be read first
        if (start_constants != 0)
            ReadSectionConstants(stream, start_constants);
        if (start_names != 0) linkinfo.ReadNames(stream, start_names);

        // Section types MUST be read before variables section!
        if (start_types != 0) ReadSectionTypes(stream, start_types);

        if (start_code != 0) ReadSectionCode(stream, start_code);
        if (start_libraries != 0) ReadSectionLibraries(stream, start_libraries);
        if (start_variables != 0) ReadSectionVariables(stream, start_variables);
        if (start_functions != 0) ReadSectionFunctions(stream, start_functions);
        if (start_objecttypes != 0) ReadSectionObjectTypes(stream, start_objecttypes);
        if (start_exceptions != 0) ReadSectionExceptions(stream, start_exceptions);
        if (start_debug != 0) ReadSectionDebug(stream, start_debug);
        if (start_debuginfo != 0) ReadSectionDebugInfo(stream, start_debuginfo);
}

void WrappedLibrary::ReadLibrary(std::string const &uri, Blex::RandomStream *stream)
{
        if (!stream)
            throw VMRuntimeError (Error::CannotFindLibrary, std::string());

        try
        {
                DoReadLibrary(stream);
        }
        catch(std::bad_alloc &) //translate bad_alloc to a specific exception
        {
                throw VMRuntimeError (Error::InvalidLibrary, uri, "Library corrupted or system out of memory");
        }
        catch(std::exception &e)
        {
                throw VMRuntimeError (Error::InvalidLibrary, uri, e.what());
        }
}

void WrappedLibrary::LookupBuiltinDefinitions(ExternalsLookupFunction const &lookup_function)
{
        for (FunctionDefList::iterator it = linkinfo.functions.begin(), end = linkinfo.functions.end(); it != end; ++it)
        {
                if (it->flags & FunctionFlags::External)
                    it->builtindef = lookup_function(it->definitionposition, linkinfo.GetNameStr(it->name_index));
        }
}

void WrappedLibrary::DoWriteLibrary(Blex::RandomStream *orig_stream)
{
        Blex::MemoryRWStream mem_stream;
        Blex::RandomStream *stream = &mem_stream;

        orig_stream->SetFileLength(0);

        stream->WriteLsb<uint32_t>(0x4c485244);
        stream->WriteLsb<uint32_t>(LibraryFormatVersion);
        stream->WriteLsb<Blex::DateTime>(Blex::DateTime::Now());
        stream->WriteLsb<Blex::DateTime>(resident.sourcetime);

        unsigned lengthoffset = (unsigned)stream->GetOffset();
        stream->WriteLsb<uint32_t>(0);

        stream->WriteLsb<uint32_t>(resident.initfunction);
        stream->WriteLsb<uint32_t>(resident.deinitfunction);
        stream->WriteLsb<uint32_t>(resident.scriptproperty_fileid);
        stream->WriteLsb<Blex::DateTime>(resident.scriptproperty_filecreationdate);
        stream->WriteLsb<uint8_t>(resident.scriptproperty_systemredirect);

        unsigned sectionsptrs = (unsigned)stream->GetOffset();

        stream->WriteLsb<uint32_t>(0);
        stream->WriteLsb<uint32_t>(0);
        stream->WriteLsb<uint32_t>(0);
        stream->WriteLsb<uint32_t>(0);
        stream->WriteLsb<uint32_t>(0);
        stream->WriteLsb<uint32_t>(0);
        stream->WriteLsb<uint32_t>(0);
        stream->WriteLsb<uint32_t>(0);
        stream->WriteLsb<uint32_t>(0);
        stream->WriteLsb<uint32_t>(0);
        stream->WriteLsb<uint32_t>(0);

        unsigned nextsectionstart = ((signed)stream->GetOffset() + ConstAlignment - 1) & -ConstAlignment;
        unsigned len;

        uint32_t start_code;
        uint32_t start_libraries;
        uint32_t start_constants;
        uint32_t start_variables;
        uint32_t start_functions;
        uint32_t start_objecttypes;
        uint32_t start_names;
        uint32_t start_types;
        uint32_t start_exceptions;
        uint32_t start_debug;
        uint32_t start_debuginfo;

        start_code = nextsectionstart;
        len = WriteSectionCode(stream, nextsectionstart);
        nextsectionstart = (nextsectionstart + len + ConstAlignment - 1) & -ConstAlignment;
        if (((nextsectionstart - stream->GetFileLength()) / ConstAlignment) != 0)
            throw std::runtime_error("Error when writing library: actual written length did not match reported written length");

        start_libraries = nextsectionstart;
        len = WriteSectionLibraries(stream, nextsectionstart);
        nextsectionstart = (nextsectionstart + len + ConstAlignment - 1) & -ConstAlignment;
        if (((nextsectionstart - stream->GetFileLength()) / ConstAlignment) != 0)
            throw std::runtime_error("Error when writing library: actual written length did not match reported written length");

        start_variables = nextsectionstart;
        len = WriteSectionVariables(stream, nextsectionstart);
        nextsectionstart = (nextsectionstart + len + ConstAlignment - 1) & -ConstAlignment;
        if (((nextsectionstart - stream->GetFileLength()) / ConstAlignment) != 0)
            throw std::runtime_error("Error when writing library: actual written length did not match reported written length");

        start_functions = nextsectionstart;
        len = WriteSectionFunctions(stream, nextsectionstart);
        nextsectionstart = (nextsectionstart + len + ConstAlignment - 1) & -ConstAlignment;
        if (((nextsectionstart - stream->GetFileLength()) / ConstAlignment) != 0)
            throw std::runtime_error("Error when writing library: actual written length did not match reported written length");

        start_objecttypes = nextsectionstart;
        len = WriteSectionObjectTypes(stream, nextsectionstart);
        nextsectionstart = (nextsectionstart + len + ConstAlignment - 1) & -ConstAlignment;
        if (((nextsectionstart - stream->GetFileLength()) / ConstAlignment) != 0)
            throw std::runtime_error("Error when writing library: actual written length did not match reported written length");

        // Section types MUST be written after variables section!
        start_types = nextsectionstart;
        len = WriteSectionTypes(stream, nextsectionstart);
        nextsectionstart = (nextsectionstart + len + ConstAlignment - 1) & -ConstAlignment;
        if (((nextsectionstart - stream->GetFileLength()) / ConstAlignment) != 0)
            throw std::runtime_error("Error when writing library: actual written length did not match reported written length");

        start_exceptions = nextsectionstart;
        len = WriteSectionExceptions(stream, nextsectionstart);
        nextsectionstart = (nextsectionstart + len + ConstAlignment - 1) & -ConstAlignment;
        if (((nextsectionstart - stream->GetFileLength()) / ConstAlignment) != 0)
            throw std::runtime_error("Error when writing library: actual written length did not match reported written length");

///ADDME check wether debug info should be included
        start_debug = nextsectionstart;
        len = WriteSectionDebug(stream, nextsectionstart);
        nextsectionstart = (nextsectionstart + len + ConstAlignment - 1) & -ConstAlignment;
        if (((nextsectionstart - stream->GetFileLength()) / ConstAlignment) != 0)
            throw std::runtime_error("Error when writing library: actual written length did not match reported written length");

        start_names = nextsectionstart;
        len = linkinfo.WriteNames(stream, nextsectionstart);
        nextsectionstart = (nextsectionstart + len + ConstAlignment - 1) & -ConstAlignment;
        if (((nextsectionstart - stream->GetFileLength()) / ConstAlignment) != 0)
            throw std::runtime_error("Error when writing library: actual written length did not match reported written length");

        ///ADDME check wether debug info should be included
        start_debuginfo = nextsectionstart;
        len = WriteSectionDebugInfo(stream, nextsectionstart);
        nextsectionstart = (nextsectionstart + len + ConstAlignment - 1) & -ConstAlignment;
        if (((nextsectionstart - stream->GetFileLength()) / ConstAlignment) != 0)
            throw std::runtime_error("Error when writing library: actual written length did not match reported written length");

        // Section constants MUST be written last
        start_constants = nextsectionstart;
        len = WriteSectionConstants(stream, nextsectionstart);
        nextsectionstart = (nextsectionstart + len + ConstAlignment - 1) & -ConstAlignment;
        if (((nextsectionstart - stream->GetFileLength()) / ConstAlignment) != 0)
            throw std::runtime_error("Error when writing library: actual written length did not match reported written length");

        stream->SetOffset(sectionsptrs);
        stream->WriteLsb<uint32_t>(start_code);
        stream->WriteLsb<uint32_t>(start_libraries);
        stream->WriteLsb<uint32_t>(start_constants);
        stream->WriteLsb<uint32_t>(start_variables);
        stream->WriteLsb<uint32_t>(start_functions);
        stream->WriteLsb<uint32_t>(start_objecttypes);
        stream->WriteLsb<uint32_t>(start_names);
        stream->WriteLsb<uint32_t>(start_types);
        stream->WriteLsb<uint32_t>(start_exceptions);
        stream->WriteLsb<uint32_t>(start_debug);
        stream->WriteLsb<uint32_t>(start_debuginfo);

        stream->SetOffset(lengthoffset);
        stream->WriteLsb<uint32_t>((uint32_t)stream->GetFileLength());

        stream->SetOffset(0);
        stream->SendAllTo(*orig_stream);
}

void WrappedLibrary::WriteLibrary(std::string const &uri, Blex::RandomStream *orig_stream)
{
        if (!orig_stream)
            throw VMRuntimeError (Error::CannotFindLibrary, uri);

        try
        {
                DoWriteLibrary(orig_stream);
        }
        catch(std::exception &e)
        {
                throw VMRuntimeError (Error::CannotWriteCompiledLibrary, uri, e.what());
        }
}

//---------------------------------------------------------------------------

void WrappedLibrary::ReadSectionCode(Blex::RandomStream *stream, unsigned start)
{
        stream->SetOffset(start);

        uint32_t length = stream->ReadLsb<uint32_t>();
        resident.code.resize(length);
        unsigned pos = (unsigned)stream->GetOffset();
        if (stream->DirectRead(pos, &resident.code[0], length) != length)
            throw std::runtime_error("Could not read in code section");
        stream->SetOffset(pos + length);
}

unsigned WrappedLibrary::WriteSectionCode(Blex::RandomStream *stream, unsigned start)
{
        if (stream->GetFileLength() < start)
            stream->SetFileLength(start);
        stream->SetOffset(start);

        stream->WriteLsb<uint32_t>(resident.code.size());

        unsigned pos = (unsigned)stream->GetOffset();
        unsigned length = resident.code.size();
        if (stream->DirectWrite(pos, &resident.code[0], length) != length)
            throw std::runtime_error("Could not write code section");
        stream->SetOffset(pos + length);
        return (unsigned)stream->GetOffset() - start;
}

//---------------------------------------------------------------------------

void WrappedLibrary::ReadSectionLibraries(Blex::RandomStream *stream, unsigned start)
{
        stream->SetOffset(start);

        // Read length
        unsigned length = stream->ReadLsb<uint32_t>();

        // Read number of library definitions
        unsigned count = stream->ReadLsb<uint32_t>();

        // ADDME: Check against self-referencing?
        LoadedLibraryDef lib;
        for (unsigned idx = 0; idx != count; ++idx)
        {
                // Per library: _pathid
                lib.liburi_index = stream->ReadLsb<int32_t>();
                lib.indirect = stream->ReadLsb<uint8_t>() != 0;
                lib.clib_id = stream->ReadLsb<Blex::DateTime >();
                lib.sourcetime = stream->ReadLsb<Blex::DateTime >();
                linkinfo.libraries.push_back(lib);
        }
        if (stream->GetOffset() != start + length)
            throw std::runtime_error("Library corrupt, length of library-section wrong");
}

unsigned WrappedLibrary::WriteSectionLibraries(Blex::RandomStream *stream, unsigned start)
{
        if (stream->GetFileLength() < start)
            stream->SetFileLength(start);
        stream->SetOffset(start);

        // Dummy length
        stream->WriteLsb<uint32_t>(0);
        // Number of library definitions
        stream->WriteLsb<uint32_t>(linkinfo.libraries.size());

        for (std::vector<LoadedLibraryDef>::iterator it = linkinfo.libraries.begin();
             it != linkinfo.libraries.end(); ++it)
        {
                // Per library: _pathid
                stream->WriteLsb<uint32_t>(it->liburi_index);
                stream->WriteLsb<uint8_t>(static_cast<uint8_t>(it->indirect?1:0));
                stream->WriteLsb(it->clib_id);
                stream->WriteLsb(it->sourcetime);
        }

        // Patch length
        uint32_t length = (uint32_t)stream->GetOffset() - start;
        stream->SetOffset(start);
        stream->WriteLsb<uint32_t>(length);

        return length;
}

//---------------------------------------------------------------------------

void WrappedLibrary::ReadSectionConstants(Blex::RandomStream *stream, unsigned start)
{
        stream->SetOffset(start);

        uint32_t length = stream->ReadLsb<uint32_t>();
        uint32_t count = stream->ReadLsb<uint32_t>();

        for (unsigned idx = 0; idx != count; ++idx)
            resident.c_indexes.push_back(stream->ReadLsb<uint32_t>());

        uint32_t values_length = stream->ReadLsb<uint32_t>();
        unsigned pos = (unsigned)stream->GetOffset();
        resident.c_values.resize(values_length);
        resident.c_indexes.push_back(values_length);
        if (stream->Read(&resident.c_values[0], resident.c_values.size()) != resident.c_values.size())
            throw std::runtime_error("Cannot read constants");

        stream->SetOffset(pos + resident.c_values.size());
        if (stream->GetOffset() != start + length)
            throw std::runtime_error("Library corrupt, length of constants-section was set wrong");
}

unsigned WrappedLibrary::WriteSectionConstants(Blex::RandomStream *stream, unsigned start)
{
        if (stream->GetFileLength() < start)
            stream->SetFileLength(start);
        stream->SetOffset(start);

        // Dummy length
        stream->WriteLsb<uint32_t>(0);
        // Number of definitions
        stream->WriteLsb<uint32_t>(resident.c_indexes.size());

        for(unsigned i=0;i<resident.c_indexes.size();++i)
            stream->WriteLsb<uint32_t>(resident.c_indexes[i]);

        stream->WriteLsb<uint32_t>(resident.c_values.size());
        unsigned pos = (unsigned)stream->GetOffset();
        if (stream->Write(&resident.c_values[0], resident.c_values.size()) != resident.c_values.size())
            throw std::runtime_error("Cannot write constants");
        stream->SetOffset(pos + resident.c_values.size());

        // Patch length
        uint32_t length = (uint32_t)stream->GetOffset() - start;
        stream->SetOffset(start);
        stream->WriteLsb<uint32_t>(length);

        return length;
}

//---------------------------------------------------------------------------

void ReadSymbolDef(Blex::RandomStream *stream, SymbolDef *store)
{
        store->symbolflags = static_cast<SymbolFlags::Type>(stream->ReadLsb<int32_t>());
        store->name_index = stream->ReadLsb<uint32_t>();
        store->deprecation_index = stream->ReadLsb<uint32_t>();
        store->library = stream->ReadLsb<int32_t>();
        store->resulttype = static_cast<VariableTypes::Type>(stream->ReadLsb<int32_t>());
}
void WriteSymbolDef(Blex::RandomStream *stream, SymbolDef const &src)
{
        stream->WriteLsb<int32_t>(src.symbolflags);
        stream->WriteLsb<uint32_t>(src.name_index);
        stream->WriteLsb<uint32_t>(src.deprecation_index);
        stream->WriteLsb<int32_t>(src.library);
        stream->WriteLsb<int32_t>(src.resulttype);
}

void WrappedLibrary::ReadSectionVariables(Blex::RandomStream *stream, unsigned start)
{
        stream->SetOffset(start);

        unsigned length = stream->ReadLsb<uint32_t>();
        unsigned count = stream->ReadLsb<uint32_t>();

        for (unsigned idx = 0; idx != count; ++idx)
        {
                VariableDef v;
                ReadSymbolDef(stream, &v);
                v.typeinfo = stream->ReadLsb<int32_t>();
                v.globallocation = stream->ReadLsb<uint32_t>();
                v.is_constref =  stream->ReadLsb<uint8_t>();
                v.constantexprid = stream->ReadLsb<uint32_t>();
                linkinfo.variables.push_back(v);
        }

        resident.globalareasize  = stream->ReadLsb<uint32_t>();

        if (stream->GetOffset() != start + length)
            throw std::runtime_error("Library corrupt, length of variable-section was set wrong");
}

unsigned WrappedLibrary::WriteSectionVariables(Blex::RandomStream *stream, unsigned start)
{
        if (stream->GetFileLength() < start)
            stream->SetFileLength(start);
        stream->SetOffset(start);

        // Dummy length
        stream->WriteLsb<uint32_t>(0);
        // Number of definitions
        stream->WriteLsb<uint32_t>(linkinfo.variables.size());

        for (std::vector<VariableDef>::iterator it = linkinfo.variables.begin();
             it != linkinfo.variables.end(); ++it)
        {
                WriteSymbolDef(stream, *it);
                stream->WriteLsb<int32_t>(it->typeinfo);
                stream->WriteLsb<uint32_t>(it->globallocation);
                stream->WriteLsb<uint8_t>(it->is_constref);
                stream->WriteLsb<uint32_t>(it->constantexprid);
        }

        stream->WriteLsb<uint32_t>(resident.globalareasize);

        // Patch length
        uint32_t length = (uint32_t)stream->GetOffset() - start;
        stream->SetOffset(start);
        stream->WriteLsb<uint32_t>(length);

        return length;
}

//---------------------------------------------------------------------------

void SectionLinkInfo::ReadNames(Blex::RandomStream *stream, unsigned start)
{
        stream->SetOffset(start);

        unsigned length = stream->ReadLsb<uint32_t>();
        unsigned count = stream->ReadLsb<uint32_t>();
        unsigned colcount = stream->ReadLsb<uint32_t>();

        //data size is length - the space for the length bytes and the space for the indexes
        unsigned datasize = length-((3+count+colcount)*sizeof (uint32_t));

        nameidx.reserve(count);
        for (unsigned i=0;i<count;++i)
        {
                uint32_t index = stream->ReadLsb<uint32_t>();
                //check against range or overlap (=this index _before_ previous index)
                if (index>datasize || (i>0 && index<nameidx[i-1]))
                    throw std::runtime_error("Saved name index invalid");
                nameidx.push_back(index);
        }
        columnidx.reserve(colcount);
        for (unsigned i=0;i<colcount;++i)
        {
                uint32_t colindex = stream->ReadLsb<uint32_t>();
                if (colindex == 0 || colindex>nameidx.size())
                    throw std::runtime_error("Saved column index invalid");
                columnidx.push_back(colindex);
        }

        names.resize(datasize);
        if (stream->Read(&names[0], datasize) != datasize)
            throw std::runtime_error("Cannot read names linkinfo section");

        if (stream->GetOffset() != start + length)
            throw std::runtime_error("Library corrupt, length of variable-section was set wrong");
}

unsigned SectionLinkInfo::WriteNames(Blex::RandomStream *stream, unsigned start)
{
        if (stream->GetFileLength() < start)
            stream->SetFileLength(start);
        stream->SetOffset(start);

        // Dummy length
        stream->WriteLsb<uint32_t>(0);
        // Number of definitions
        stream->WriteLsb<uint32_t>(nameidx.size());
        stream->WriteLsb<uint32_t>(columnidx.size());
        for (unsigned i=0;i<nameidx.size();++i)
            stream->WriteLsb<uint32_t>(nameidx[i]);
        for (unsigned i=0;i<columnidx.size();++i)
            stream->WriteLsb<uint32_t>(columnidx[i]);
        if (stream->Write(&names[0], names.size()) != names.size())
            throw std::runtime_error("Cannot write names linkinfo section");

        // Patch length
        uint32_t length = (uint32_t)stream->GetOffset() - start;
        stream->SetOffset(start);
        stream->WriteLsb<uint32_t>(length);

        return length;
}

//---------------------------------------------------------------------------

void WrappedLibrary::ReadSectionFunctions(Blex::RandomStream *stream, unsigned start)
{
        stream->SetOffset(start);

        unsigned length = stream->ReadLsb<uint32_t>();
        unsigned count = stream->ReadLsb<uint32_t>();

        for (unsigned idx = 0; idx != count; ++idx)
        {
                FunctionDef f;
                ReadSymbolDef(stream, &f);

                f.dllname_index = stream->ReadLsb<uint32_t>();
                f.definitionposition.line = stream->ReadLsb<int32_t>();
                f.definitionposition.column = stream->ReadLsb<int32_t>();
                f.localvariablecount = stream->ReadLsb<uint32_t>();
                f.codelocation = stream->ReadLsb<int32_t>();
                f.flags = static_cast<FunctionFlags::Type>(stream->ReadLsb<uint32_t>());

                uint32_t parameter_count = stream->ReadLsb<uint32_t>();
                for (unsigned i = 0; i != parameter_count; ++i)
                {
                        FunctionDef::Parameter p;
                        p.name_index = stream->ReadLsb<uint32_t>();
                        p.type = (VariableTypes::Type)stream->ReadLsb<uint32_t>();
                        p.defaultid = stream->ReadLsb<int32_t>();
                        f.parameters.push_back(p);
                }
                linkinfo.functions.push_back(f);
        }
        if (stream->GetOffset() != start + length)
            throw std::runtime_error("Library corrupt, length of functions-section was set wrong");
}

unsigned WrappedLibrary::WriteSectionFunctions(Blex::RandomStream *stream, unsigned start)
{
        if (stream->GetFileLength() < start)
            stream->SetFileLength(start);
        stream->SetOffset(start);

        // Dummy length
        stream->WriteLsb<uint32_t>(0);
        // Number of definitions
        stream->WriteLsb<uint32_t>(linkinfo.functions.size());

        for (std::vector<FunctionDef>::iterator it = linkinfo.functions.begin();
             it != linkinfo.functions.end(); ++it)
        {
                WriteSymbolDef(stream, *it);
                stream->WriteLsb<uint32_t>(it->dllname_index);
                stream->WriteLsb<int32_t>(it->definitionposition.line);
                stream->WriteLsb<int32_t>(it->definitionposition.column);
                stream->WriteLsb<uint32_t>(it->localvariablecount);
                stream->WriteLsb<uint32_t>(it->codelocation);
                stream->WriteLsb<uint32_t>(it->flags);

                stream->WriteLsb<uint32_t>(it->parameters.size());
                for (std::vector<FunctionDef::Parameter>::iterator pit = it->parameters.begin();
                     pit != it->parameters.end(); ++pit)
                {
                        stream->WriteLsb<uint32_t>(pit->name_index);
                        stream->WriteLsb<uint32_t>(pit->type);
                        stream->WriteLsb<int32_t>(pit->defaultid);
                }
        }

        // Patch length
        uint32_t length = (uint32_t)stream->GetOffset() - start;
        stream->SetOffset(start);
        stream->WriteLsb<uint32_t>(length);

        return length;
}

//---------------------------------------------------------------------------

void WrappedLibrary::ReadSectionObjectTypes(Blex::RandomStream *stream, unsigned start)
{
        stream->SetOffset(start);

        unsigned length = stream->ReadLsb<uint32_t>();
        unsigned count = stream->ReadLsb<uint32_t>();

        for (unsigned idx = 0; idx != count; ++idx)
        {
                ObjectTypeDef o;
                ReadSymbolDef(stream, &o);
                o.has_base = stream->ReadLsb<uint8_t>() != 0;
                o.base = stream->ReadLsb<int32_t>();
                o.flags = (ObjectTypeFlags::Type)stream->ReadLsb<int32_t>();
                o.constructor = stream->ReadLsb<uint32_t>();

                uint32_t uid_count = stream->ReadLsb<uint32_t>();
                for (unsigned x = 0; x < uid_count; ++x)
                    o.uid_indices.push_back(stream->ReadLsb<uint32_t>());

                if (o.constructor >= linkinfo.functions.size())
                    throw std::runtime_error("Library corrupt, illegal method index for constructor encountered");
                unsigned member_count = stream->ReadLsb<uint32_t>();

                for (unsigned x = 0; x < member_count; ++x)
                {
                        ObjectCellDef member;
                        ReadSymbolDef(stream, &member);
                        member.is_private = stream->ReadLsb<uint8_t>();
                        member.is_update = stream->ReadLsb<uint8_t>();
                        member.is_toplevel = stream->ReadLsb<uint8_t>();
                        member.type = static_cast<ObjectCellType::_type>(stream->ReadLsb<uint8_t>());
                        member.method = -1;
                        member.getter_name_index = 0;
                        member.setter_name_index = 0;
                        if (member.method < -1 || (member.method >= 0 && (unsigned)member.method >= linkinfo.functions.size()))
                            throw std::runtime_error("Library corrupt, illegal method index encountered");
                        if (member.type != ObjectCellType::Member && member.type != ObjectCellType::Method && member.type != ObjectCellType::Property)
                            throw std::runtime_error("Library corrupt, illegal object cell type encountered");
                        if (member.type == ObjectCellType::Method)
                        {
                                member.method = stream->ReadLsb<int32_t>();
                                uint32_t parameter_count = stream->ReadLsb<uint32_t>();
                                for (unsigned i = 0; i != parameter_count; ++i)
                                {
                                        FunctionDef::Parameter p;
                                        p.name_index = stream->ReadLsb<int32_t>();
                                        p.type = (VariableTypes::Type)stream->ReadLsb<uint32_t>();
                                        p.defaultid = stream->ReadLsb<int32_t>();
                                        member.parameters.push_back(p);
                                }
                        }
                        else if (member.type == ObjectCellType::Property)
                        {
                                member.getter_name_index = stream->ReadLsb<uint32_t>();
                                member.setter_name_index = stream->ReadLsb<uint32_t>();
                        }
                        o.cells.push_back(member);
                }

                linkinfo.objecttypes.push_back(o);
        }
        if (stream->GetOffset() != start + length)
            throw std::runtime_error("Library corrupt, length of objecttypes-section was set wrong");
}

unsigned WrappedLibrary::WriteSectionObjectTypes(Blex::RandomStream *stream, unsigned start)
{
        if (stream->GetFileLength() < start)
            stream->SetFileLength(start);
        stream->SetOffset(start);

        // Dummy length
        stream->WriteLsb<uint32_t>(0);
        // Number of definitions
        stream->WriteLsb<uint32_t>(linkinfo.objecttypes.size());

        for (std::vector< ObjectTypeDef >::iterator it = linkinfo.objecttypes.begin();
             it != linkinfo.objecttypes.end(); ++it)
        {
                WriteSymbolDef(stream, *it);
                stream->WriteLsb<uint8_t>(it->has_base ? 1 : 0);
                stream->WriteLsb<int32_t>(it->base);
                stream->WriteLsb<uint32_t>(it->flags);
                stream->WriteLsb<uint32_t>(it->constructor);

                stream->WriteLsb<uint32_t>(it->uid_indices.size());
                for (std::vector< uint32_t >::iterator it2 = it->uid_indices.begin(), end = it->uid_indices.end(); it2 != end; ++it2)
                    stream->WriteLsb<uint32_t>(*it2);

                stream->WriteLsb<uint32_t>(it->cells.size());
                for (std::vector< ObjectCellDef >::iterator it2 = it->cells.begin();
                     it2 != it->cells.end(); ++it2)
                {
                        WriteSymbolDef(stream, *it2);
                        stream->WriteLsb<uint8_t>(it2->is_private);
                        stream->WriteLsb<uint8_t>(it2->is_update);
                        stream->WriteLsb<uint8_t>(it2->is_toplevel);
                        stream->WriteLsb<uint8_t>(it2->type);
                        if (it2->type == ObjectCellType::Method)
                        {
                                stream->WriteLsb<uint32_t>(it2->method);
                                stream->WriteLsb<uint32_t>(it2->parameters.size());
                                for (std::vector<FunctionDef::Parameter>::iterator pit = it2->parameters.begin();
                                     pit != it2->parameters.end(); ++pit)
                                {
                                        stream->WriteLsb<int32_t>(pit->name_index);
                                        stream->WriteLsb<uint32_t>(pit->type);
                                        stream->WriteLsb<int32_t>(pit->defaultid);
                                }
                        }
                        else if (it2->type == ObjectCellType::Property)
                        {
                                stream->WriteLsb<uint32_t>(it2->getter_name_index);
                                stream->WriteLsb<uint32_t>(it2->setter_name_index);
                        }
                }
        }

        // Patch length
        uint32_t length = (uint32_t)stream->GetOffset() - start;
        stream->SetOffset(start);
        stream->WriteLsb<uint32_t>(length);

        return length;
}

//---------------------------------------------------------------------------

void WrappedLibrary::ReadSectionExceptions(Blex::RandomStream *stream, unsigned start)
{
        stream->SetOffset(start);

        // Read length
        unsigned length = stream->ReadLsb<uint32_t>();

        // Read number of exception mappings
        unsigned count = stream->ReadLsb<uint32_t>();

        for (unsigned idx = 0; idx != count; ++idx)
        {
                // Per entry: code index, location line and column
                uint32_t codeindex = stream->ReadLsb<uint32_t>();

                SectionExceptions::UnwindInfo info;
                info.target = stream->ReadLsb<uint32_t>();
                info.stacksize = stream->ReadLsb<uint32_t>();
                exceptions.unwindentries.Insert(std::make_pair(codeindex, info));
        }
        if (stream->GetOffset() != start + length)
            throw std::runtime_error("Library corrupt, length of exception-section wrong");
}

unsigned WrappedLibrary::WriteSectionExceptions(Blex::RandomStream *stream, unsigned start)
{
        if (stream->GetFileLength() < start)
            stream->SetFileLength(start);
        stream->SetOffset(start);

        // Dummy length
        stream->WriteLsb<uint32_t>(0);

        // Number of mappings
        stream->WriteLsb<uint32_t>(exceptions.unwindentries.Size());

        for (Blex::MapVector< uint32_t, SectionExceptions::UnwindInfo >::iterator it = exceptions.unwindentries.Begin();
             it != exceptions.unwindentries.End(); ++it)
        {
                // Per entry: code index, target code index
                stream->WriteLsb<uint32_t>(it->first);
                stream->WriteLsb<uint32_t>(it->second.target);
                stream->WriteLsb<uint32_t>(it->second.stacksize);
        }

        // Patch length
        uint32_t length = (uint32_t)stream->GetOffset() - start;
        stream->SetOffset(start);
        stream->WriteLsb<uint32_t>(length);

        return length;
}

//---------------------------------------------------------------------------

void WrappedLibrary::ReadSectionDebug(Blex::RandomStream *stream, unsigned start)
{
        stream->SetOffset(start);

        // Read length
        unsigned length = stream->ReadLsb<uint32_t>();

        // Read number of debug mappings
        unsigned count = stream->ReadLsb<uint32_t>();

        for (unsigned idx = 0; idx != count; ++idx)
        {
                // Per entry: code index, location line and column
                uint32_t codeindex = stream->ReadLsb<uint32_t>();
                Blex::Lexer::LineColumn position;
                position.line = stream->ReadLsb<uint32_t>();
                position.column = stream->ReadLsb<uint32_t>();
                debug.debugentries.Insert(std::make_pair(codeindex,position));
        }
        if (stream->GetOffset() != start + length)
            throw std::runtime_error("Library corrupt, length of debug-section wrong");
}

unsigned WrappedLibrary::WriteSectionDebug(Blex::RandomStream *stream, unsigned start)
{
        if (stream->GetFileLength() < start)
            stream->SetFileLength(start);
        stream->SetOffset(start);

        // Dummy length
        stream->WriteLsb<uint32_t>(0);

        // Number of mappings
        stream->WriteLsb<uint32_t>(debug.debugentries.Size());

        for (Blex::MapVector<uint32_t, Blex::Lexer::LineColumn>::iterator it = debug.debugentries.Begin();
             it != debug.debugentries.End(); ++it)
        {
                // Per entry: code index, location line and column
                stream->WriteLsb<uint32_t>(it->first);
                stream->WriteLsb<uint32_t>(it->second.line);
                stream->WriteLsb<uint32_t>(it->second.column);
        }

        // Patch length
        uint32_t length = (uint32_t)stream->GetOffset() - start;
        stream->SetOffset(start);
        stream->WriteLsb<uint32_t>(length);

        return length;
}

//---------------------------------------------------------------------------

void WrappedLibrary::ReadSectionTypes(Blex::RandomStream *stream, unsigned start)
{
        stream->SetOffset(start);

        // Read length
        unsigned length = stream->ReadLsb<uint32_t>();

        // Read number of table definitions
        unsigned types_count = stream->ReadLsb<uint32_t>();

        for (unsigned idx = 0; idx != types_count; ++idx)
        {
                // Per entry: nr of columns
                DBTypeInfo typeinfo;
                typeinfo.type = VariableTypes::Type(stream->ReadLsb<uint32_t>());

                if (typeinfo.type == VariableTypes::Table || ToNonArray(typeinfo.type) == VariableTypes::Record)
                {
                        ReadSectionTypes_Columns(stream, typeinfo.columnsdef);
                        if (typeinfo.type == VariableTypes::Table)
                            ReadSectionTypes_Columns(stream, typeinfo.viewcolumnsdef);
                }
                else if (typeinfo.type == VariableTypes::Schema)
                {
                        uint32_t table_count = stream->ReadLsb<uint32_t>();
                        for (; table_count; --table_count)
                        {
                                DBTypeInfo::Table table;

                                uint32_t namelen = stream->ReadLsb<uint32_t>();
                                table.name.resize(namelen);
                                stream->Read(&table.name[0],namelen);

                                uint32_t dbnamelen = stream->ReadLsb<uint32_t>();
                                table.dbase_name.resize(dbnamelen);
                                stream->Read(&table.dbase_name[0],dbnamelen);

                                ReadSectionTypes_Columns(stream, table.columnsdef);
                                ReadSectionTypes_Columns(stream, table.viewcolumnsdef);

                                typeinfo.tablesdef.push_back(table);
                        }
                }
                resident.types.push_back(typeinfo);
        }

        if (stream->GetOffset() != start + length)
            throw std::runtime_error("Library corrupt, length of types-section wrong");
}

void WrappedLibrary::ReadSectionTypes_Columns(Blex::RandomStream *stream, DBTypeInfo::ColumnsDef &columnsdef)
{
        uint32_t column_count = stream->ReadLsb<uint32_t>();
        for (; column_count; --column_count)
        {
                DBTypeInfo::Column column;
                ReadSectionTypes_Column(stream, column);
                columnsdef.push_back(column);
        }
}

void WrappedLibrary::ReadSectionTypes_Column(Blex::RandomStream *stream, DBTypeInfo::Column &column)
{
        //ADDME: Optimize this data storage? still some plain std::strings, could be coded inside constant data ?
        uint32_t namelen = stream->ReadLsb<uint32_t>();

        column.name.resize(namelen);
        stream->Read(&column.name[0],namelen);

        uint32_t dbasenamelen = stream->ReadLsb<uint32_t>();
        if (dbasenamelen)
        {
                column.dbase_name.resize(dbasenamelen);
                stream->Read(&column.dbase_name[0],dbasenamelen);
        }
        else
        {
                column.dbase_name=column.name;
        }

        column.type = (VariableTypes::Type)stream->ReadLsb<uint8_t>();
        column.flags = (ColumnFlags::_type)stream->ReadLsb<uint32_t>();
        column.null_default.resize(stream->ReadLsb<uint32_t>());
        for (std::vector<uint8_t>::iterator it = column.null_default.begin(); it != column.null_default.end(); ++it)
            *it = stream->ReadLsb<uint8_t>();
        column.view_value.resize(stream->ReadLsb<uint32_t>());
        for (std::vector<uint8_t>::iterator it = column.view_value.begin(); it != column.view_value.end(); ++it)
            *it = stream->ReadLsb<uint8_t>();
}


unsigned WrappedLibrary::WriteSectionTypes(Blex::RandomStream *stream, unsigned start)
{
        if (stream->GetFileLength() < start)
            stream->SetFileLength(start);
        stream->SetOffset(start);

        // Dummy length
        stream->WriteLsb< uint32_t >(0);

        // Number of tabldefs
        stream->WriteLsb< uint32_t >(resident.types.size());

        for (auto it = resident.types.begin(); it != resident.types.end(); ++it)
        {
                // Per entry: nr of columndefintions
                stream->WriteLsb<uint32_t>(it->type);

                if (it->type == VariableTypes::Table || ToNonArray(it->type) == VariableTypes::Record)
                {
                        WriteSectionTypes_Columns(stream, it->columnsdef);
                        if (it->type == VariableTypes::Table)
                            WriteSectionTypes_Columns(stream, it->viewcolumnsdef);
                }
                else if (it->type == VariableTypes::Schema)
                {
                        stream->WriteLsb< uint32_t >(it->tablesdef.size());
                        for (auto it2 = it->tablesdef.begin(); it2 != it->tablesdef.end(); ++it2)
                        {
                                stream->WriteLsb< uint32_t >(it2->name.size());
                                stream->Write(it2->name.data(),it2->name.size());
                                stream->WriteLsb< uint32_t >(it2->dbase_name.size());
                                stream->Write(it2->dbase_name.data(),it2->dbase_name.size());

                                WriteSectionTypes_Columns(stream, it2->columnsdef);
                                WriteSectionTypes_Columns(stream, it2->viewcolumnsdef);
                        }
                }
        }

        // Patch length
        uint32_t length = (uint32_t)stream->GetOffset() - start;
        stream->SetOffset(start);
        stream->WriteLsb<uint32_t>(length);

        return length;

}

void WrappedLibrary::WriteSectionTypes_Columns(Blex::RandomStream *stream, DBTypeInfo::ColumnsDef const &columnsdef)
{
        stream->WriteLsb< uint32_t >(columnsdef.size());
        for (auto it = columnsdef.begin(); it != columnsdef.end(); ++it)
            WriteSectionTypes_Column(stream, *it);
}

void WrappedLibrary::WriteSectionTypes_Column(Blex::RandomStream *stream, DBTypeInfo::Column const &column)
{
        stream->WriteLsb< uint32_t >(column.name.size());
        stream->Write(column.name.data(),column.name.size());
        if (column.name == column.dbase_name)
        {
                stream->WriteLsb< uint32_t >(0); //indicates equal name
        }
        else
        {
                stream->WriteLsb<uint32_t>(column.dbase_name.size());
                stream->Write(column.dbase_name.data(),column.dbase_name.size());
        }
        stream->WriteLsb< uint8_t >((uint8_t)column.type);
        stream->WriteLsb< uint32_t >(column.flags);
        stream->WriteLsb< uint32_t >(column.null_default.size());
        for (std::vector< uint8_t >::const_iterator it = column.null_default.begin(); it != column.null_default.end(); ++it)
            stream->WriteLsb< uint8_t >(*it);
        stream->WriteLsb< uint32_t >(column.view_value.size());
        for (std::vector< uint8_t >::const_iterator it = column.view_value.begin(); it != column.view_value.end(); ++it)
            stream->WriteLsb< uint8_t >(*it);
}

//---------------------------------------------------------------------------

void WrappedLibrary::ReadSectionDebugInfo(Blex::RandomStream *stream, unsigned start)
{
        stream->SetOffset(start);

        uint32_t length = stream->ReadLsb<uint32_t>();
        debuginfo.data.resize(length);
        unsigned pos = (unsigned)stream->GetOffset();
        if (length)
        {
                if (stream->DirectRead(pos, &debuginfo.data[0], length) != length)
                    throw std::runtime_error("Could not read in debuginfo section");
        }
        stream->SetOffset(pos + length);

}

unsigned WrappedLibrary::WriteSectionDebugInfo(Blex::RandomStream *stream, unsigned start)
{
        if (stream->GetFileLength() < start)
            stream->SetFileLength(start);
        stream->SetOffset(start);

        stream->WriteLsb<uint32_t>(debuginfo.data.size());

        unsigned pos = (unsigned)stream->GetOffset();
        unsigned length = debuginfo.data.size();
        if (stream->DirectWrite(pos, &debuginfo.data[0], length) != length)
            throw std::runtime_error("Could not write debuginfo section");
        stream->SetOffset(pos + length);
        return (unsigned)stream->GetOffset() - start;
}

//---------------------------------------------------------------------------
} // End of namespace HareScript
