#ifndef blex_webhare_compiler_symboltable
#define blex_webhare_compiler_symboltable

#include "compiler.h"
//#include "hs_lexer.h"

/** The symboltable administrates all used symbols (variables, functions, tables)

    Scopes are layered on top of each other. The top scope is the library scope;
    in here all library public functions and public variables are put.
    On top of that scope is the root scope (the scope of the initfunction where
    functions and global variables are put in). New scopes are again put on top
    of the root scope.
*/

namespace HareScript
{
namespace Compiler
{
namespace AST
{
struct Rvalue;
}
struct Symbol;


typedef unsigned ScopeId;
typedef unsigned ColumnNameId;
typedef unsigned IdentifierId;

/** Type of a symbol */
namespace SymbolType
{
        enum Types
        {
                Variable,       // defined variable
                Function,       // function
                Table,          // table (only at scope 0!). Redefined as record within SQL statements
                ObjectType,     // object type
                Ambiguous,      // publicized by two different libraries
                SignalledAmbiguous // publicized by two different libraries (and already signalled)
        };
}

/** Current state of a symbol */
namespace SymbolState
{
        enum States
        {
                Forward,        // Symbol is used, but not defined yet
                SelectTemporary, // Symbol is a sql select temporary, not accessible yet
                Declaring,      // Symbol is now being declared
                Declared        // The declaration of the symbol has passed
        };
}

/** Type of symbol-lookup to perform */
namespace SymbolLookupType
{
        enum Types
        {
                Variables,      ///< Lookup only variables (ignores object types)
                Columns,        ///< Lookup only columns (ignores object types)
                ColumnsAndVars, ///< Lookup columns and vars (ignores object types)
                ObjectTypes,    ///< Lookup object types (ignores on non-objects)
                Functions       ///< Lookup functions (currently ONLY supported by the AddUnknownERror handler)
        };
}

/** List of all symbols in a particular scope ADDME: replace by a set for great justice uhh speedup */
struct Scope
{
        typedef std::map<std::string, Symbol *, Blex::StrCaseLess<std::string> > Symbols;

        Symbols symbols;
};

namespace SymbolDefs
{

struct FunctionDef;
struct VariableDef;
struct TableDef;
struct ObjectDef;
struct Library;

struct Library
{
        std::string liburi;
        bool indirect;
        Blex::DateTime clib_id;
        Blex::DateTime sourcetime;
};

struct TableDef
{
        struct Column : HareScript::DBTypeInfo::Column
        {
                AST::Rvalue * null_default_value;
                inline Column (const HareScript::DBTypeInfo::Column &rhs) : HareScript::DBTypeInfo::Column(rhs), null_default_value(0) {}
                inline Column () : null_default_value(0) {}
        };

        typedef std::vector< Column > ColumnsDef;
        ColumnsDef columnsdef;

        struct ViewColumn  : HareScript::DBTypeInfo::Column
        {
                AST::Rvalue *view_value_expr;
                inline ViewColumn (const HareScript::DBTypeInfo::Column &rhs) : HareScript::DBTypeInfo::Column(rhs), view_value_expr(0) {}
                inline ViewColumn () : view_value_expr(0) {}
        };

        typedef std::vector< ViewColumn > ViewColumnsDef;
        ViewColumnsDef viewcolumnsdef;
};

struct SchemaDef
{
        struct Table
        {
                TableDef tabledef;

                std::string name;
                std::string dbase_name;
        };

        typedef std::vector< Table > TablesDef;
        TablesDef tablesdef;
};

struct FunctionDef
{
        inline FunctionDef()
        : flags(FunctionFlags::None)
        , object(0)
        , object_initializer(0)
        , generator(0)
        , isasync(false)
        , isasyncmacro(false)
        , returntype(VariableTypes::NoReturn)
        , is_member_defined(false)
        {
        }

        FunctionFlags::Type flags;
        std::string dllmodule;                  ///< Dynamic module this symbol is found ("" is VM internal)
        Symbol *object;
        Symbol *object_initializer;             ///< Is this function the initializer of an object
        Symbol *generator;
        bool isasync;
        bool isasyncmacro;

        /// Class describing an argument
        struct Argument
        {
                Symbol *symbol;                 ///< Name and type of argument
                AST::Rvalue* value;             ///< Default value of argument, NULL if none
        };

        VariableTypes::Type returntype;         ///< return value type, or NoReturn

        bool is_member_defined;                 ///< Has the body of the function been defined (object members only)

        std::vector<Argument> arguments;        ///< Arguments to this function
};

struct VariableDef
{
        VariableDef()
        : is_substitute(false)
        , allow_substitute_use(false)
        , substitutedef(0)
        , countersymbol(0)
        , is_counter(false)
        , is_global(false)
        , is_constant(false)
        , is_constref(false)
        , type(VariableTypes::Uninitialized)
        , constexprvalue(0)
        , objectdef(0)
        {
        }

        bool is_substitute;                     ///< True if this is a record used as substitute for a SQL statement
        bool allow_substitute_use;              ///< True if usable as substitution record (used for denying bindings within UPDATE SET RECORD)
        TableDef *substitutedef;                ///< Not null if substitute for a table, points to tabledef then
        std::set< std::string > group_cols;     ///< Columns of this substitution variable that are grouped

        Symbol *countersymbol;                  ///< Current counter for this symbol

        bool is_counter;
        bool is_global;                         ///< True if this is a global one, false if it is allocated at the stack

        bool is_constant;                       ///< True if the value for this symbol is a constant expression
        bool is_constref;                       ///< True if this symbol may not be assigned to a second time

        VariableTypes::Type type;               ///< Type of variable
        AST::Rvalue *constexprvalue;            ///< Value for constexpr variables

        TableDef tabledef;                      ///< Available columns (only for table type!)
        SchemaDef schemadef;                    ///< Available tables (only for schema type!)
        ObjectDef *objectdef;                   ///< Objectdef for :this variables
};

struct ObjectField
{
        inline ObjectField(Symbol *parent)
        : object(parent)
        , is_private(false)
        , type(ObjectCellType::Unknown)
        , var_type(VariableTypes::Uninitialized)
//        , initvalue(0)
        , method(0)
        {}

        /// Parent object
        Symbol *object;

        /// Place where symbol is defined
        LineColumn declpos;

        bool is_private;
        bool is_update;
        ObjectCellType::_type type;
        std::string name;

        // Member
        VariableTypes::Type var_type;           ///< Type of variable
//        AST::Rvalue *initvalue;

        Symbol *method;

        // Property;
        LineColumn getter_pos;
        std::string getter;
        bool getter_check;
        std::string getter_primary; // If of form primaryfield->sub.sub.sub, name of primary field
        LineColumn setter_pos;
        std::string setter;
        bool setter_check;
        std::string setter_primary; // If of form primaryfield->sub.sub.sub, name of primary field
};

struct ObjectDef : public Scope
{
        ObjectDef();

        //Base object type
        Symbol *base;

        /// Uids of this objecttype
        std::vector< std::string > uids;

        ObjectTypeFlags::Type flags;

        //Constructor
        Symbol *constructor;
        bool constructor_is_generated;

        typedef std::vector< ObjectField > Fields;
        Fields fields;

        ObjectField * FindField(std::string const &name, bool recursive);
        bool AddField(ObjectField const &field);
};

} // End of namespace SymbolDef

/** Captures ALL info we have about a particular symbol */
struct Symbol
{
        Symbol(std::string const &name, SymbolType::Types type);

        /// Place where symbol is defined
        LineColumn definitionposition;

        /// Did we warn for deprecation yet?
        bool did_deprecation_warning;

        /// Name of this symbol
        std::string name;

        /// Type of symbol
        SymbolType::Types type;

        /// State of this symbol
        SymbolState::States state;

        /// Symbol flags (public, imported, deprecated...)
        SymbolFlags::Type flags;

        /// True if this symbol is used by a function ptr or extendsfrom
        bool force_export;

        /// If is_imported is true, pointer to Library thing that contains the library this symbol is directly imported from
        SymbolDefs::Library* importlibrary;

        /// If is_imported is true, pointer to Library thing that contains the library that last exported this symbol
        std::vector<SymbolDefs::Library*> exportlibraries;

        /// If type == Variable, this contains the variable definition (except when name == ":outsidestate" or ":itempXXX"!)
        SymbolDefs::VariableDef *variabledef;

        /// If type == Function, this contains the function definition
        SymbolDefs::FunctionDef *functiondef;

        /// If type == ObjectType, this contains the function definition
        SymbolDefs::ObjectDef *objectdef;

        /// Reason for deprecation
        std::string deprecation_message;
};

struct ScopeRange
{
        inline ScopeRange(Scope *scope, LineColumn const &begin, LineColumn const &end)
        : scope(scope)
        , begin(begin)
        , end(end)
        {
        }

        Scope *scope;

        LineColumn begin;

        LineColumn end;
};

/** Symbol administration class */
class SymbolTable
{
    private:
        CompilerContext &context;

        // Counter for temporary variables
        unsigned temporarycounter;

        // Object adopter
        template <class A> A* Adopt(A* a) { context.owner.Adopt(a); return a; }

        /// Stack that contains the stack of current scopes
        std::vector<Scope*> scopestack;

        std::vector< ScopeRange > scoperanges;

        /** Add a symbol in a specific scope
            @param scope Scopt to add symbol in
            @param name Name of symbol
            @param type Type of symbol
            @return New symbol object */
        Symbol * AddSymbolInScope(Scope *scope, std::string const &name, SymbolType::Types type);

        /** Add a symbol in the current scope
            @param name Name of symbol
            @param type Type of symbol
            @return New symbol object */
        Symbol * AddSymbolInCurrentScope(std::string const &name, SymbolType::Types type);

    public:
        /** Lookup filter functions */
        typedef bool (*symbolmatch)(Symbol const &symbol);

        static bool matchall(Symbol const &) { return true; }
        static bool matchvariables(Symbol const &symbol) { return symbol.type == SymbolType::Variable && !symbol.variabledef->is_substitute; }
        static bool matchnotables(Symbol const &symbol) { return symbol.type != SymbolType::Table; }
        static bool matchobjects(Symbol const &symbol) { return symbol.type == SymbolType::ObjectType; }
        static bool matchnonsubstiturerecords(Symbol const &symbol) { return symbol.type == SymbolType::Variable && symbol.variabledef->is_substitute; }

        struct SavedState
        {
                /// Stack that contains the stack of current scopes
                std::vector<Scope*> scopestack;
        };

        /// Initializes the symbol table, pushes the library scope and the root scope
        SymbolTable(CompilerContext &context);

        /// Resets the symboltable to the initial state
        void Reset();

        /// Add the deprecation warning (if present) for this symbol to the warnings list
        void AddDeprecationWarnings(LineColumn const &position, Symbol *symbol) const;

        void AddIsUnknownError(const LineColumn &position, std::string const &name, SymbolLookupType::Types lookuptype) const;

        // Scope management

        /** Enters new scope */
        Scope* EnterScope(LineColumn position);

        /** Enters a new custom scope */
        void EnterCustomScope(Scope *scope, LineColumn position);

        /** Leaves current scope. Never leave the top scope! */
        void LeaveScope(LineColumn position);

        /** Returns current scope */
        Scope * GetCurrentScope();

        /** Returns library scope (lowest scope available) */
        Scope const * GetLibraryScope() const;

        /** Returns root scope (scope just above library scope */
        Scope const * GetRootScope() const;

        std::vector< ScopeRange > const & GetScopeRanges() { return scoperanges; }

        /** Returns an id based on a name
            @param name Name of column
            @return Id corresponding to that name */
        ColumnNameId GetColumnNameId(std::string const &name);

        /** Registers a symbol, and returns a pointer to it. Subsequent registrations
            must be passed this symbol, and update it
            @param name Name of symbol
            @param type Type of symbol
            @param isargument Set to TRUE if this symbol is an argument in a function
            @param register_funcs_in_current_scope Set to TRUE to register functions in current scope, otherwise they are registered in the root scope.
            @return symbol */
        Symbol * RegisterForwardSymbol(const LineColumn &position, std::string const &name, SymbolType::Types type, bool isargument, bool register_funcs_in_current_scope);

        /** Registers a function in current scope (must be done AFTER argument declaration)
            When a similar name already exists, 0 is given back, and an error
            is added to the errorhandler
            @param definitionposition Relevant position in source file
            @param symbol Forward registered symbol
            @param functiondata Partial data about function
            @return Pointer to symbol definition, NULL when error */
        void RegisterDeclaredFunction (const LineColumn &definitionposition, Symbol *symbol, bool is_public);

        /** Registers a new object type in the current scope
            When a similar name already exists, 0 is given back, and an error
            is added to the errorhandler
            @param definitionposition Relevant position in source file
            @param symbol Forward registered symbol
            @return Pointer to symbol definition, NULL when error
        */
        Symbol * RegisterDeclaredObjectType (const LineColumn &definitionposition, Symbol *symbol, bool is_public);

        /** Registers a function that has been called, but not declared. Symbol may NOT be known at the
            moment in scopestack[1]; if so it won't be registered. */
        Symbol * RegisterNewCalledFunction(const LineColumn &position, std::string const &name, bool is_object_constructor);

//        /** Registers a new method. Used in object type declarations */
//        Symbol * RegisterMethod(const LineColumn &position, std::string const &name, bool is_private_function, Scope *object_scope);

        /** Registers a variable when it is totally declared
            @param definitionposition Relevant position in source file
            @param symbol Forward registered symbol, NULL for temporary
            @param is_public True if symbol is a public
            @param is_global True if symbol is a global
            @param type Type of variable
            @return Pointer to symbol definition */
        Symbol * RegisterDeclaredVariable (const LineColumn &definitionposition, Symbol *symbol, bool is_public, bool is_global, VariableTypes::Type type);

        /** Registers a temporary variable
            @param definitionposition Relevant position in source file
            @param type Type of variable
            @return Pointer to symbol definition of temporary variable */
        Symbol * RegisterTempVariable(const LineColumn &definitionposition, VariableTypes::Type type);

        /** Creates a SQLSubstitute record (holder for the records coming from tables in a SQL expression or statement
            @param position Relevant position in source file
            @param name Name of substitute record (equal to name or rename of the source) */
        Symbol * CreateSQLSubstituteRecord (const LineColumn &position, std::string const &name);

        /** Registers a new table
            @param name Name of table
            @return Symbol in which definition of table must be stored. */
        Symbol * RegisterTable (std::string const &name);

        /** Resolves a symbol in a specific scope
            @param position Relevant position in source file
            @param scope Scope to search in
            @param name Name of symbol
            @return Symbol if found, 0 (and possibly an error!) otherwise */
        Symbol * ResolveSymbolInScope(const LineColumn &position, Scope const *scope, std::string const &name) const;

        /** Resolves a symbol in all scopes, with filter functions
            @param position Relevant position in source file
            @param scope Scope to search in
            @param name Name of symbol
            @param match Match function to use
            @return Symbol if found, 0 (and possibly an error!) otherwise */
        Symbol * ResolveSymbol(const LineColumn &position, std::string const &name, symbolmatch match, bool warn_if_deprecated) const;

        /** Resolves a symbol a in the parents of the current scope
            @param position Relevant position in source file
            @param name Name of symbol
        */
        Symbol * ResolveVariableInParentScope(const LineColumn &position, std::string const &name) const;

        /** Resolves a symbol in all scopes, with a lookup type
            @param position Relevant position in source file
            @param scope Scope to search in
            @param name Name of symbol
            @param lookuptype Lookup type to use
            @return
                Match has been found: first = relevant symbol, second = true if symbol points to substitute var where name is a column from
                No match (or error): first = 0; second = false if an error has been found, true when the name just hasn't been found */
        std::pair<Symbol *, bool> ResolveSymbolEx(const LineColumn &position, std::string const &name, SymbolLookupType::Types lookuptype, bool is_tryout, bool warn_if_deprecated) const;

        /** Resolves a symbol for a external function
            @param position Relevant position in source file
            @param name Name of symbol
            @return Symbol if found, 0 (and an error!) otherwise*/
        Symbol * RetrieveExternalFunction(const LineColumn &position, std::string const &name);

        /** Inserts a symbol from a library library symbol
            @param position Relevant position in source file
            @param symbol Symbo to import */
        void RegisterLibrarySymbol (const LineColumn &definitionposition, SymbolDefs::Library* lib, Symbol *symbol);

        /** Pass the position of the end of the script to the symboltable, for marking end of root scopes */
        void CloseScript(LineColumn position);

        /** Reset the symbol table to library scope, save the current scope stack
            @param state Filled with saved state
        */
        void ResetToLibraryScope(SavedState *state);

        /** Restore a previous state
            @param state State to restore
        */
        void RestoreState(SavedState const &state);
};

bool TestSymbolTable();
std::string GetMangledFunctionName(Symbol *function_symbol);

} // End of namespace Compiler
} // End of namespace HareScript

#endif
