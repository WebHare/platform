#ifndef blex_webhare_harescript_modules_odbc_odbc_binder
#define blex_webhare_harescript_modules_odbc_odbc_binder
//---------------------------------------------------------------------------

#include <sql.h>
#include <sqlext.h>

#include "odbc_base.h"

namespace HareScript
{
namespace SQLLib
{
namespace ODBC
{

namespace BindType
{

enum Type
{
        TryBind = 0,    //< Column should always be bound
        NeverBind = 1,  //< Column may not be bound, must be read through GetData
        MustBind = 2    //< Column _must_ be bound, as we need to update it!
};

} // End of namespace BindType

/** Represents a result-set; cannot handle Bookmark columns (with columnidx 0).
    How to use:
      ResultSet::Prepare(stat)
      SQLExecute(stat)
      ResultSet rset(vm, stat, true)
    or
      ResultSet(vm) rset;
      rset.AddColumn(string)
      rset.AddColumn(string)
      ResultSet::Prepare(stat)
      SQLExecute(stat)
      rset.Bind(stat)
    or
      ResultSet::Prepare(stat)
      SQLExecute(stat)
      ResultSet(vm) rset;
      rset.AddColumn(string)
      rset.AddColumn(string)
      rset.Bind(stat)
 */
class ResultSet
{
        /// Data about a resultcolumn
        struct Column
        {
            public:
                /// Uppercase name of column
                std::string name;

                /// Id of column name, gotten from DB (used for raw db)
                ColumnNameId nameid;

                /// Size of column
                SQLULEN columnsize;

                /// SQL data type of column
                SQLSMALLINT sqldatatype;

            private:
                SQLSMALLINT cdatatype;

                /// Type to cast to
                VariableTypes::Type hstype;

                /// Requested bindtype
                BindType::Type bindtype;

                bool bind_column;
                bool bind_write_only;

                // Offset of data in row
                unsigned data_offset;
                unsigned buffersize;

                // Precision and scale for numerics
                SQLSMALLINT precision;
                SQLSMALLINT scale;

                friend class ResultSet;
        };

    private:
        VirtualMachine *vm;

//        StackMachine &stackm;

        /// Currently bound to statement (SQL_NULL_HANDLE for not bound)
        SQLHSTMT stat;

        /// Charset to use (Unknown for unicode)
        Blex::Charsets::Charset charset;

        /// Workarounds
        ODBCWorkarounds::_type workarounds;

        /// Size of the data of one row
        unsigned rowdata_size;

        /// Offset of indirection array within a row
        unsigned ind_array_start;

        /// Maximum alignment found in the rowdata
        unsigned max_align;

        /// Currently selected row
        unsigned current_row;

        /// Data ptr
        uint8_t *data;

        /// Number of rows in the current block
        SQLUINTEGER blockrowcount;

        /// List of columndescriptions
        std::vector< Column > columns;

        /// List of updates for the current row (column, new value)
        std::map< unsigned, VarId > updates;

        /// Checks whether the HareScript type hstype is supported
        void CheckAllowedTypes(VariableTypes::Type hstype);

        // Translates an ODBC string representation of a money to a money
        void TranslateMoney(VarId id_set, Blex::StringPair str);

        /** Fills a column buffer with a variable. The caller is responsible for using the right SQL_C_XXX type
            @param buffer Start of buffer
            @param ind Length indicator
            @param value Value to fill the buffer with
            @param scale Scale for numerics
            @return Returns whether the data fitted in the column. */
        bool FillBuffer(SQLCHAR *buffer, SQLLEN &ind, VarId value, SQLSMALLINT scale);

        /** Sends a variable at execution time. Only allowed for long BLOBs and STRINGs.
            @param stat Statement to send the variable to
            @param value Variable to send */
        void SendVariable(SQLHSTMT stat, VarId value);

        /// Finalizes all column bindings
        void FinalizeColumnBindings();

        Capabilities capabilities;

    public:
        /** Create a new result set
            @param vm Virtual machine
            @param stat Statement. If unequal to NULL handle, all columns are auto-detected, and immediately bound */
        ResultSet(VirtualMachine *vm, Capabilities const &capabilities, SQLHSTMT stat, Blex::Charsets::Charset charset, ODBCWorkarounds::_type workarounds);

        /** Copy constructor; copying is only permitted when not bound */
        //ResultSet(ResultSet const &rhs);

        /// Destructor for cleanup
        ~ResultSet();

        // Executes a previously prepared statement with parameters
        SQLRETURN ExecuteStatement(SQLHSTMT stat, std::vector< std::pair <VariableTypes::Type, VarId > > const &parameters);

        /// Make decisions about what and what not to bind
        void DecideBindings();

        // Adds a column description, Uninitialized for preferred type
        void AddColumn(VariableTypes::Type castto, BindType::Type bindtype);

        /// Binds column descriptions to an executed statement (creates necessary bindings), all columns have to be added!
        void Bind(SQLHSTMT stat, unsigned maxblockrows);

        // Returns column idx; (row and column 1-based). Returns whether a value was present (not a NULL). ADDME: a good idea to do this in increasing idx, some drivers do not support random access.
        bool Get(unsigned row, unsigned column, VarId id_set);

        // Returns number of columns in result set (expensive function)
        unsigned ColumnCount();

        // Returns number of blocks in current block
        unsigned BlockRowCount() { return blockrowcount; }

        // Position cursor at row within block (row count 1-based)
        void PositionCursor(unsigned row);

        void Set(unsigned column, VarId value);
        void UpdateRow();

        // Retrieve data about the column (columnnr 1-based)
        Column const & GetColumnData(unsigned column);

        /// Scroll to next block
        unsigned NextBlock();

        /// Return total result set in id_set
        void ReturnTotalSet(VarId id_set);

        /// Returnes whether a variabletype can return data that overflows the internal buffers
        static bool CanOverflowBuffer(VariableTypes::Type type);
};

} // End of namespace ODBC
} // End of namespace SQLLib
} // End of namespace HareScript

//---------------------------------------------------------------------------
#endif
