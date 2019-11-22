#ifndef blex_harescript_shared_hsvm_librarywrapper
#define blex_harescript_shared_hsvm_librarywrapper

#include <blex/mapvector.h>
#include "filesystem.h"
#include "hsvm_externals.h"

/*  LibraryWrapper contains the code which deals with the reading and writing
    of compiled libraries. It holds the library in a own format in memory.

    Status:
    - Reading and writing of libraries has been implemented.
    - Reading a library is not totally robust -> no checking on bounds of values,
        eg. length of lists could be corrupted(set to 0xffffffff), leading to a
        crash or app freeze when reading.

    Todo:
    - Make reading more robust.
    - Possible optimization: Reading a library loads a lot of std::string, that
        all are copies of strings in the constants section (and can thus be
        transformed to stringpairs or const char *'s).
    - Push as much information to a later stage (resident -> linker -> debug)
      and try to Private information..
*/

namespace HareScript
{

struct BuiltinFunctionDefinition;

/** The resident section contains the compiled code, data constants and runtime
    type information. */
struct SectionResident
{
        /// Id of compilation of this library (compilation time, measured at compiler!)
        Blex::DateTime compile_id;

        /// Modification time of the source
        Blex::DateTime sourcetime;

        /// Function that must be called to initialize this library
        int32_t initfunction;
        /// Function that must be called to de-initialize this library
        int32_t deinitfunction;
        /// Script property file id (ADDME: Store as a constant)
        int32_t scriptproperty_fileid;
        Blex::DateTime scriptproperty_filecreationdate;
        bool scriptproperty_systemredirect;
        ///Actual harescript opcodes and their paramters
        std::vector<uint8_t> code;
        ///Constant values
        std::vector<uint8_t> c_values;
        ///Constant indexes
        std::vector<uint32_t> c_indexes;
        /// Contains elaborate type info (like table definitions)
        std::vector<DBTypeInfo> types;
        /// Size of the global variable area
        uint32_t globalareasize;

        SectionResident() { initfunction=-1; deinitfunction=-1; }
};

struct SymbolDef
{
        ///Symbol flags
        SymbolFlags::Type symbolflags;
        ///Name of variable
        uint32_t name_index;
        // Index to deprecateion variable
        uint32_t deprecation_index;
        // Library this function is imported from
        int32_t library;
        ///Return or storage type
        VariableTypes::Type resulttype;
};

/// Contains variables (internal, public, imported)
struct VariableDef : public SymbolDef
{
        // Indicates index into types section where the type of this variable is described
        int32_t typeinfo;

        // Sets location in global variable space
        uint32_t globallocation;

        // Is this variable a constant reference (cannot be assigned to?)
        bool is_constref;

        // Constant value for a constant expression
        int32_t constantexprid;
};

/// Function definition
struct FunctionDef : public SymbolDef
{
        // Name of DLL this function is imported from.
        uint32_t dllname_index;

        Blex::Lexer::LineColumn definitionposition;

        uint32_t localvariablecount;
        int32_t codelocation;               // Only valid when not external and not imported (otherwise -1)

        // Flags
        FunctionFlags::Type flags;

        struct Parameter
        {
                // Name of argument (optional)
                uint32_t name_index;

                // Type of variable. Unspecified when type is not specified.
                VariableTypes::Type type;

                // Constant that must be used when this variable is not specified.
                int32_t defaultid;
        };

        typedef std::vector<Parameter> Parameters;
        Parameters parameters;

        // Pointer to definition for builtin functions
        BuiltinFunctionDefinition const *builtindef;
};

struct ObjectCellDef : public SymbolDef
{
        /// Type of this cell
        ObjectCellType::_type type;

        /// Is this object cell private?
        bool is_private;

        /// Is this object cell an update of a base cell?
        bool is_update;

        /// Is this object cell part of the toplevel object (and not of a base object)
        bool is_toplevel;

        /// Function-id of the method of this field (only for methods, -1 if function isn't visible)
        int32_t method;

        /// Id of the cell for the getter
        uint32_t getter_name_index;

        /// Id of the cell for the getter
        uint32_t setter_name_index;

        /// Parameters for methods
        FunctionDef::Parameters parameters;
};

/// Contains object types
struct ObjectTypeDef : public SymbolDef
{
        /// Whether this object type has a base.
        bool has_base;

        /// Object type nr of base object, -1 if not public or none
        int32_t base;

        /// Object type flags
        ObjectTypeFlags::Type flags;

        /// Constructor
        uint32_t constructor;

        /// List of members
        std::vector< ObjectCellDef > cells;

        // UID of this object and its base objectypes
        std::vector< uint32_t > uid_indices;
};

/// Data about a single required library
struct LoadedLibraryDef
{
        /// Name of this library
        uint32_t liburi_index;

        ///Indicates this library was brought in by a direct preloaded or loadlibbed library
        bool indirect;

        ///Time stamp of compiled library
        Blex::DateTime clib_id;

        ///Time stamp of the source of that library.
        Blex::DateTime sourcetime;
};

/** The linker information section contains all information we need during
    the linkage */
class BLEXLIB_PUBLIC SectionLinkInfo
{
        std::vector<char> names;
        std::vector<uint32_t> nameidx;

    public:
        std::vector<uint32_t> columnidx;

        /// Contains all used libraries, in initialisation order
        std::vector<LoadedLibraryDef> libraries;

        /// Contains data about all variables (internal, public, imported)
        std::vector<VariableDef> variables;
        /// Contains data about all functions (internal, public, imported)
        std::vector<FunctionDef> functions;
        /// Contains data about all object types (internal, public, imported)
        std::vector<ObjectTypeDef> objecttypes;

        Blex::StringPair GetName(unsigned idx) const;

        std::string GetNameStr(unsigned idx) const
        {
                return GetName(idx).stl_str();
        }

        unsigned SetName(std::string const &name);

        void ReadNames(Blex::RandomStream *stream, unsigned start);
        unsigned WriteNames(Blex::RandomStream *stream, unsigned start);
};

/** Contains exception unwind info */
struct SectionExceptions
{
        struct UnwindInfo
        {
                uint32_t target;
                uint32_t stacksize;
        };

        ///Debug entries, maps code indices onto original source file locations
        Blex::MapVector<uint32_t, UnwindInfo> unwindentries;
};

/** Contains debug and compiler information. Information about private
    variables and fuctions, function argument names, etc, should probably
    also be moved here to decrease on link information load time */
struct SectionDebug
{
        ///Debug entries, maps code indices onto original source file locations
        Blex::MapVector<uint32_t, Blex::Lexer::LineColumn> debugentries;
};

/** Contains the real deep debug info
*/
struct SectionDebugInfo
{
        std::vector< uint8_t > data;
};

typedef std::vector<ObjectTypeDef> ObjectTypeDefList;
typedef std::vector<FunctionDef> FunctionDefList;
typedef std::vector<VariableDef> VariableDefList;
typedef std::vector<LoadedLibraryDef> LoadedLibraryDefList;
typedef std::vector<DBTypeInfo> TypeInfoDefList;

/// Contains data about times and ids of a compiled library
struct LibraryCompileIds
{
        /// Id of the library
        Blex::DateTime clib_id;

        /// Modification time of the source at compile time
        Blex::DateTime sourcetime;
};

/** Function signature of function that looks up external functions
    Must throw when function is not found. Caller of LookupBuiltinDefinitions
    must fill in the position and liburi in the thrown error messages, no modification
    is done.
    @param 1 Position of declaration within library
    @param 2 Name of external function
    @return Pointer to definition of external function. */
typedef std::function< BuiltinFunctionDefinition const *(Blex::Lexer::LineColumn const &, std::string const &) > ExternalsLookupFunction;

/** Loads a library, also immediately resolves the names from the constants section
    Don't copy, that would not be very efficient. We only need one copy anyway.

    This object is threadsafe only when calls are serialized */
class BLEXLIB_PUBLIC WrappedLibrary
{
    private:
        void ReadSectionCode(Blex::RandomStream *stream, unsigned start);
        void ReadSectionLibraries(Blex::RandomStream *stream, unsigned start);
        void ReadSectionConstants(Blex::RandomStream *stream, unsigned start);
        void ReadSectionVariables(Blex::RandomStream *stream, unsigned start);
        void ReadSectionFunctions(Blex::RandomStream *stream, unsigned start);
        void ReadSectionObjectTypes(Blex::RandomStream *stream, unsigned start);
        void ReadSectionTypes(Blex::RandomStream *stream, unsigned start);
        void ReadSectionTypes_Columns(Blex::RandomStream *stream, DBTypeInfo::ColumnsDef &columnsdef);
        void ReadSectionTypes_Column(Blex::RandomStream *stream, DBTypeInfo::Column &column);
        void ReadSectionDebug(Blex::RandomStream *stream, unsigned start);
        void ReadSectionExceptions(Blex::RandomStream *stream, unsigned start);
        void ReadSectionDebugInfo(Blex::RandomStream *stream, unsigned start);

        unsigned WriteSectionCode(Blex::RandomStream *stream, unsigned start);
        unsigned WriteSectionLibraries(Blex::RandomStream *stream, unsigned start);
        unsigned WriteSectionConstants(Blex::RandomStream *stream, unsigned start);
        unsigned WriteSectionVariables(Blex::RandomStream *stream, unsigned start);
        unsigned WriteSectionFunctions(Blex::RandomStream *stream, unsigned start);
        unsigned WriteSectionObjectTypes(Blex::RandomStream *stream, unsigned start);
        unsigned WriteSectionTypes(Blex::RandomStream *stream, unsigned start);
        void WriteSectionTypes_Columns(Blex::RandomStream *stream, DBTypeInfo::ColumnsDef const &columnsdef);
        void WriteSectionTypes_Column(Blex::RandomStream *stream, DBTypeInfo::Column const &column);
        unsigned WriteSectionDebug(Blex::RandomStream *stream, unsigned start);
        unsigned WriteSectionExceptions(Blex::RandomStream *stream, unsigned start);
        unsigned WriteSectionDebugInfo(Blex::RandomStream *stream, unsigned start);

        void DoReadLibrary(Blex::RandomStream *stream);
        void DoWriteLibrary(Blex::RandomStream *stream);

        WrappedLibrary(WrappedLibrary const &) = delete;
        WrappedLibrary& operator=(WrappedLibrary const &) = delete;

    public:
        SectionResident resident;
        SectionLinkInfo linkinfo;
        SectionExceptions exceptions;
        SectionDebug debug;
        SectionDebugInfo debuginfo;

        std::pair<int32_t, uint8_t *> SetConstantBuffer(unsigned length);
        uint8_t const * GetConstantBuffer(int32_t id) const;
        uint32_t GetConstantBufferLength(int32_t id) const;

        const ObjectTypeDefList& ObjectTypeList() const { return linkinfo.objecttypes; }
        const FunctionDefList& FunctionList() const { return linkinfo.functions; }
        const VariableDefList& VariableList() const { return linkinfo.variables; }
        const LoadedLibraryDefList& LibraryList() const { return linkinfo.libraries; }
        const TypeInfoDefList& TypeList() const { return resident.types; }

        WrappedLibrary();
        void ReadLibrary(std::string const &uri, Blex::RandomStream *stream);
        void LookupBuiltinDefinitions(ExternalsLookupFunction const &lookup_function);

        /** Reads compile_id and sourcetime from library. Expects library data at offset 0, leaves stream at offset 0 */
        static bool ReadLibraryIds(Blex::RandomStream *stream, LibraryCompileIds *ids);
        void WriteLibrary(std::string const &uri, Blex::RandomStream *stream);

        ~WrappedLibrary();
};

} // End of namespace HareScript

#endif
