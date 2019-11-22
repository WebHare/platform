#ifndef blex_webhare_compiler_astcoder
#define blex_webhare_compiler_astcoder

#include <blex/decimalfloat.h>
#include "ast.h"

/** The AstCoder is responsible for the building the ast from the input it
    gets from the parser. This is done to decouple the parser from the AST
    generation.

    Expression-encoding actions return the root of the ast-tree generated
    by that action. Statement-emitting actions emit their AST-objects to the
    current block.

    Internally, the coder keeps a blockstack. Statements are always emitted at
    the end of the block on top of the blockstack.
*/

namespace HareScript
{
namespace Compiler
{

// Forward declarations we need
struct Symbol;
struct CompilerContext;
class SymbolTable;

class AstCoder
{
    private:
        CompilerContext &context;

        // Object adopter
        template <class A> A* Adopt(A* a) { context.owner.Adopt(a); return a; }

        /** Private statement stack (we must keep this because the parser nests calls)
            Outside functions, the top of stack MUST be a block. */
        std::vector<AST::Statement *> stack;

        /** Root of the AST */
        AST::Module * root;

    public:
        AstCoder(CompilerContext &context, std::string const &orgsrcname);
        ~AstCoder();

        /** Returns ast module
            @return module */
        AST::Module * GetRoot() { return root; }

        /** Returns the current block
            @return Current block */
        AST::Block * GetCurrentBlock();

        /** Returns a variant value (safe for most error returns)
        */
        AST::Variable * ImSafeErrorValueReturn(LineColumn const &position);

        /** Adds library to root->loadlibs loadlib, returns a pointer to the loaded lib and optionally executes the loadlib
            @param position Relevant position in sourcefile
            @param name Unprefixed name of library
            @param execute_load Set to true to loadlibrary and import symbols into symboltable
            @return Pointer to library object (only when execute_load is true) and prefixed URI to library */
        std::pair<SymbolDefs::Library*, LoadlibInfo> LoadLib(LineColumn const &position, std::string const &requester, std::string const &name, bool execute_load);

        /** Pushes a print for external data into the current block
            @param position Relevant position in sourcefile
            @param start Pointer to data
            @param len Length of data
            @param at_eof At end of file?*/
        void CodeExternalData(LineColumn const &position, const char *start, unsigned len, bool at_eof);

        /** Pushes a statementinto the current block that initialized the variable symbol with it's default value
            @param symbol Symbol to initialize */
        void CodeInitialize(Symbol *symbol);

        /** Pushes a block into the current block
            @param block Symbol to initialize */
        void DoCodeBlock(AST::Block *block);

        /** Register a new external function.
            @param position Relevant position in the source file
            @param symbol Symbol defining the function */
        void ImRegisterExternalFunction(LineColumn const &position, Symbol *symbol);

        /** Opens a new function. The current block is set to the function block
            @param position Relevant position in the source file
            @param symbol Symbol defining the function
            @returns Function object
        */
        AST::Function * ImOpenFunction(LineColumn const &position, Symbol *symbol);

        /** Closes the current function. Current block is set to the previous block
            @param position Relevant position in the source file */
        void ImCloseFunction(LineColumn const &position);

        // --- Statements ---

        /** Pushes an if-statement into the current block, sets the current block to the true-block of the if
            @param position Relevant position in the source file
            @param exec_condition Boolean expression that decides which path is taken */
        void ImIf_Open(LineColumn const &position, AST::Rvalue * exec_condition);

        /** Sets the current block to the false-block of a previously opened if-statement. The current block must be
            the true-block of that statement
            @param position Relevant position in the source file */
        void ImIf_Else(LineColumn const &position);

        /** Sets the current block to the owning block of the previously opened if-statement. The current block must be
            the true-block or the false-block of that statement
            @param position Relevant position in the source file */
        void ImIf_Close(LineColumn const &position);

        /** Pushes a forevery-statement into the current block
            @param position Relevant position in the source file
            @param iteratevar Iteration variable
            @param source Source epxression
            @param positionvar Current position var
            @param loop Loop block */
        void ImForEvery(LineColumn const &position, AST::Variable * iteratevar, AST::Rvalue * source, AST::Block * loop, AST::Variable * positionvar);

        /** Pushes a for-statment into the current block, and sets the current block to the loop-block of that for
            @param position Relevant position in the source file
            @param loop_condition Condition on which the loop must be executed (can be NULL)
            @param increment_condition Expression that must be evalueated after each loop execution (can be NULL) */
        void ImFor_Open(LineColumn const &position, AST::Rvalue * loop_condition, AST::Rvalue * increment_condition);

        /** Sets the current block to the owning block of the previously opened for-statement. The current block must be
            the loop-block of that statement
            @param position Relevant position in the source file */
        void ImFor_Close(LineColumn const &position);

        /** Inserts a break into the current block. This statement be only be issued within a for statement
            @param position Relevant position in the source file */
        void ImBreak(LineColumn const &position);

        /** Inserts a continue into the current block. This statement be only be issued within a for statement
            @param position Relevant position in the source file */
        void ImContinue(LineColumn const &position);

        /** Inserts an expression-evaluation into the current block.
            @param position Relevant position in the source file
            @param expr Expression that must be evaluated */
        void ImExecute(LineColumn const &position, AST::Rvalue * expr);

        /** Inserts an statement into the current block.
            @param position Relevant position in the source file
            @param expr Expression that must be evaluated */
        void ImStatement(AST::Statement *statement);

        /** Inserts a return statement into the current block.
            @param position Relevant position in the source file
            @param return_value Expression which his value must be returned */
        void ImReturn(LineColumn const &position, AST::Rvalue * return_value);

        /** Inserts a switch statement into the current block.
            @param position Relevant position in the source file */
        AST::SwitchStatement * ImSwitch(LineColumn const &position);

        /** Inserts a array-insert statement into the current block.
            @param position Relevant position in the source file
            @param array Array in which a element must be inserted
            @param location Place where element must be put (NULL for at end)
            @param value Value that must be inserted */
        void ImArrayInsert(LineColumn const &position, AST::Lvalue * array, AST::ArrayLocation location, AST::Rvalue * value);

        /** Inserts a array-insert statement into the current block.
            @param position Relevant position in the source file
            @param array Array in which a element must be inserted
            @param location Place that identifies the element that must be deleted (NULL for all elements) */
        void ImArrayDelete(LineColumn const &position, AST::Lvalue * array, AST::ArrayLocation location);

        /** Inserts an deep array-insert statement into the current block
            @param position Relevant position in the source file
            @param var Base variable
            @param layers Layers into which the variable must be inserted
            @param location Location where the value must be inserted
        */
        void ImDeepArrayDelete(LineColumn const &position, AST::ConvertedLvalue const &clvalue, AST::ArrayLocation location);

        /** Inserts an deep array-insert statement into the current block
            @param position Relevant position in the source file
            @param var Base variable
            @param layers Layers into which the variable must be inserted
            @param location Location where the value must be inserted
            @param value Value that must be inserted
        */
        void ImDeepArrayInsert(LineColumn const &position, AST::ConvertedLvalue const &clvalue, AST::ArrayLocation location, AST::Rvalue *value);

        /** If expr isn't a variable, create a new temporary variable, assign expr to it, return new temporary
            @param position Relevant position in the source file
            @param expr Expression to put in variable
        */
        AST::Variable * ImStoreInVariable(LineColumn const &position, AST::Rvalue *expr);

        /** Creates a copy of a variable node
            @param var Variable to copy
        */
        AST::Variable * ImCopyVariable(AST::Variable *var);

        // -- External coding --
        /** Sets the current block to block
            @param block Block that afterwards receives inserted statements */
        void ImOpenBlock(AST::Block * block);

        /** Sets the current block to the previous block */
        void ImCloseBlock();

        // --- Expressions ---

        /** Creates a builtin instruction call
            @param position  Relevant position in the source file
            @param returntype Return type for this function
            @param name Name of the instruction (must be translated in code generator!)
            @param parameters Parameters to the function
            @param mod_outsidestate Whether the function modifies the outside state
            param calls_harescript Whether the function can execute arbitrary harescript (also for object modifying functions!)
            @returns Function call expression.
        */
        AST::Rvalue * ImBuiltinInstruction(LineColumn const &position, VariableTypes::Type returntype, std::string const &name, std::vector< AST::Rvalue * > const &parameters, bool mod_outsidestate, bool calls_harescript);

        /** Returns a expression-ptr that designates an unary operator wiht it's argument
            @param position Relevant position in the source file
            @param operatortoken Token identifying operation
            @param expr Value on which this operator operates */
        AST::Rvalue * ImUnaryOperator(LineColumn const &position, UnaryOperatorType::Types  operatortoken, AST::Rvalue * expr);

        /** Returns a expression-ptr that designates an binary operator wiht it's arguments
            @param position Relevant position in the source file
            @param operatortoken Token identifying operation
            @param lhsexpr Left-hand value on which this operator operates
            @param rhsexpr Right-hand value on which this operator operates */
        AST::Rvalue * ImBinaryOperator(LineColumn const &position, BinaryOperatorType::Types operatortoken, AST::Rvalue * lhsexpr, AST::Rvalue * rhsexpr);

        /** Casts an expression to an expression of a certain type
            @param position Relevant position in the source file
            @param expr Expression to cast
            @param type Type to cast the expression to
            @param is_explicit Whether this is an explicit user cast
            @param allow_parameter_cast Whether this cast may not be handled as parameter cast (which report the called function when the cast fails)
            @return Returns the casted expression */
        AST::Rvalue * ImCast(LineColumn const &position, AST::Rvalue *expr, VariableTypes::Type type, bool is_explicit, bool allow_parameter_cast);

        /** Returns a expression-ptr that designates an conditional operator wiht it's arguments
            @param position Relevant position in the source file
            @param condition Condition that must be evaluated
            @param expr_true Value that must be return when condition evaluates to true
            @param expr_false Value that must be return when condition evaluates to false */
        AST::Rvalue * ImConditionalOperator(LineColumn const &position, AST::Rvalue * condition, AST::Rvalue * expr_true, AST::Rvalue * expr_false);

        /** Returns a expression-ptr that designates a column-operator applied to a record
            @param position Relevant position in the source file
            @param var Record this operator applies to
            @param name Name of column */
        AST::Rvalue * ImColumnOf(LineColumn const &position, AST::Rvalue * var, const std::string &name);
        AST::Rvalue * ImMemberOf(LineColumn const &position, AST::Rvalue * var, const std::string &name, bool via_this, LineColumn const &next_token);

        /** Returns a expression ptr that designates a table within a schema
            @param position Relevant position in the source file
            @param var Schema this operator applies to
            @param name Name of table */
        AST::Rvalue * ImSchemaTableOf(LineColumn const &position, AST::Variable * var, const std::string &name);

        /** Sets a cell of a record to a specific value
            @param position Relevant position in the source file
            @param record Record to change
            @param cellname Rvalue evaluating to cell name to change
            @param celldata Rvalue evaluating to data to store in the cell
            @param cancreate If true, only insert, if false only updates (with type check)
            @param check_type if false, insert or update without type check (overrides cancreate), if true honor cancreate */
        AST::Rvalue * ImRecordCellSet(LineColumn const &position, AST::Lvalue * lvalue, std::string const &cellname/*AST::Rvalue * cellname*/, AST::Rvalue * celldata, bool cancreate, bool check_type);

        /** Extend an object with another type
            @param position Relevant position in the source file
            @param object Object to extend
            @param extendwith Symbol of object to extend with
            @param via_this Acces is done through this pointer (access to private cells allowed) */
        void ImObjectExtend(LineColumn const &position, AST::Rvalue *object, Symbol *extendwith, std::vector< AST::Rvalue * > parameters, bool via_this);

        /** Delete an object member
            @param position Relevant position in the source file
            @param record Record to change
            @param via_this Acces is done through this pointer (access to private cells allowed) */
        void ImObjectMemberDelete(LineColumn const &position, AST::Rvalue *object, std::string const &cellname, bool via_this);

        /** Inserts a new member into the object
            @param position Relevant position in the source file
            @param record Record to change
            @param cellname cell name
            @param celldata Rvalue evaluating to data to store in the cell
            @param is_private Whether the member should be private
            @param via_this Acces is done through this pointer (access to private cells allowed) */
        void ImObjectMemberInsert(LineColumn const &position, AST::Rvalue *object, std::string const &cellname, AST::Rvalue *celldata, bool is_private, bool via_this);

        /** Set an object cell to a specific value
            @param position Relevant position in the source file
            @param record Record to change
            @param cellname cell name
            @param celldata Rvalue evaluating to data to store in the cell
            @param via_this Acces is done through this pointer (access to private cells allowed) */
        void ImObjectMemberSet(LineColumn const &position, AST::Rvalue * object, std::string const &cellname, AST::Rvalue * celldata, bool via_this);

        /** Deletes a cell of a record
            @param position Relevant position in the source file
            @param record Record to change
            @param cellname Rvalue evaluating to cell name to delete */
        AST::Rvalue * ImRecordCellDelete(LineColumn const &position, AST::Lvalue * array, std::string const &/*AST::Rvalue * */cellname);

        /** Returns a writable expression-ptr that designates an array element
            @param position Relevant position in the source file
            @param var Array that is written to
            @param subscript_expr Subscript of element to write to */
        AST::Rvalue * ImArrayElementModify(LineColumn const &position, AST::Rvalue * var, AST::Rvalue * subscript_expr, AST::Rvalue * value);

        /** Returns a expression-ptr that designates a constant array element
            @param position Relevant position in the source file
            @param var Array
            @param subscript_expr Subscript of element that is referenced */
        AST::Rvalue * ImArrayElementConst(LineColumn const &position, AST::Rvalue * var, AST::Rvalue * subscript_expr);

        /** Returns a expression-ptr that designates an assignment
            @param position Relevant position in the source file
            @param storeto Target of the assignment
            @param value Value that must be stored into the target */
        AST::Assignment * ImAssignment(LineColumn const &position, AST::Variable * storeto, AST::Rvalue * value);

        /** Returns a expression-ptr that designates the initial assignment to a constant variable
            @param position Relevant position in the source file
            @param storeto Target of the assignment
            @param value Value that must be stored into the target */
        AST::Assignment * ImInitialAssignment(LineColumn const &position, AST::Variable * storeto, AST::Rvalue * value);

        /** Returns a expression-ptr that designates a constant value (value stored in context->stackm)
            @param position Relevant position in the source file
            @param var Optional value to initialize with (0 to allocate new variable)
            @param value Value that must be stored into the target */
        AST::Constant * ImConstant(LineColumn const &position, VarId var);

        /** Returns a expression-ptr that designates a constant of a particular type (with its default value)
            @param position Relevant position in the source file
            @param type Type of the constant
            @param value Value that must be stored into the target */
        AST::Constant * ImConstantDefault(LineColumn const &position, VariableTypes::Type type);

        /** Returns a expression-ptr that designates a constant record
            @param position Relevant position in the source file */
        AST::ConstantRecord * ImConstantRecord(LineColumn const &position);

        /** Returns a expression-ptr that designates a constant array
            @param position Relevant position in the source file
            @param type Type of array, defaults to auto-determine */
        AST::ConstantArray * ImConstantArray(LineColumn const &position, VariableTypes::Type type = VariableTypes::Uninitialized);

        /** Returns a expression-ptr that designates a constant boolean
            @param position Relevant position in the source file
            @param value Value that is returned */
        AST::Constant * ImConstantBoolean(LineColumn const &position, bool value);

        /** Returns a expression-ptr that designates a constant float
            @param position Relevant position in the source file
            @param value Value that is returned */
        AST::Constant * ImConstantFloat(LineColumn const &position, F64 value);

        /** Returns a expression-ptr that designates a constant integer
            @param position Relevant position in the source file
            @param value Value that is returned */
        AST::Constant * ImConstantInteger(LineColumn const &position, int32_t value);

        /** Returns a expression-ptr that designates a constant money
            @param position Relevant position in the source file
            @param value Value that is returned */
        AST::Constant * ImConstantMoney(LineColumn const &position, int64_t value);

        /** Returns a expression-ptr that designates a constant real
            @param position Relevant position in the source file
            @param value Value that is returned */
        AST::Constant * ImConstantFloat(LineColumn const &position, Blex::DecimalFloat value);

        /** Returns a expression-ptr that designates a constant string
            @param position Relevant position in the source file
            @param value Value that is returned */
        AST::Constant * ImConstantString(LineColumn const &position, const std::string &value);

        /** Returns a writable variable-ptr that designates a variable
            @param position Relevant position in the source file
            @param symbol Symbol that identifies the variable */
        AST::Variable * ImVariable(LineColumn const &position, Symbol *symbol);

        /** Returns a epxression-ptr that designates a functionptr
            @param position Relevant position in the source file
            @param symbol Symbol that identifies the function
            @param parameters Parameters that must be passed to the function */
        AST::FunctionPtr * ImFunctionPtr(LineColumn const &position, Symbol *symbol, bool parameters_specified, std::vector<int32_t> const &passthroughs, AST::RvaluePtrs const &parameters);

        /** Returns a rebinder of a function ptr
            @param position Relevant position in the source file
            @param functionptr Function pointer to rebind
            @param passthroughs Passthroughs (which parameter must be taken for this argument (negated if default present), 0 for constant)
            @param parameters Constants and defaults, one for every element in passthroughs
            @param is_legal Whether the rebind is (known) legal at this point*/
        AST::Rvalue* ImFunctionPtrRebind(LineColumn const &position, AST::Rvalue *functionptr, std::vector<int32_t> const &passthroughs, AST::RvaluePtrs const &parameters, bool is_legal);

        /** Returns a epxression-ptr that designates a functioncall, generated by compiler
            @param position Relevant position in the source file
            @param symbol Symbol that identifies the function
            @param parameters Parameters that must be passed to the function */
        AST::FunctionCall * ImFunctionCall(LineColumn const &position, Symbol *symbol, AST::RvaluePtrs const &parameters);

        /** Returns a epxression-ptr that designates a functioncall, directly specified by user
            @param position Relevant position in the source file
            @param symbol Symbol that identifies the function
            @param parameters Parameters that must be passed to the function */
        AST::FunctionCall * ImFunctionCallUser(LineColumn const &position, Symbol *symbol, AST::RvaluePtrs const &parameters);

        /** Returns a epxression-ptr that designates a method call
            @param position Relevant position in the source file
            @param object Expression for the object
            @param membername Name of the member
            @param via_this Whas this accessed via the this-pointer?
            @param parameters Parameters that must be passed to the function
            @param has_passthroughs Whether any passthrough is present
            @param passthroughs Optional passthroughs, for binding definitions */
        AST::Rvalue * ImObjectMethodCall(LineColumn const &position, AST::Rvalue *object, std::string const &membername, bool via_this, AST::RvaluePtrs const &parameters, bool has_passthroughs, std::vector< int32_t > const &passthroughs);

        /** Returns the epxression-ptr that is passed to it (DEPRECATED)
            @param position Relevant position in the source file
            @param expr Expression to return */
        AST::Rvalue * ImDiscardableRvalue(LineColumn const &position, AST::Rvalue * expr);

        /** Returns an integer with for registered typeinfo
            @param position Relevant position in the source file
            @param symbol Table/schema symbol to build the typeinfo from (not required)
            @param typeinfo Pre-built typeinfo to store
            @param buildtypeinfo If true, build a DBTypeInfo if not passed (using the symbol if passed).
                The symbol MUST be checked by CheckToken in the semantic check, so this cannnot be used
                in the parsing phase. The semantic check will build the DBTypeInfo if missing after parsing. */
        AST::TypeInfo * ImTypeInfo(LineColumn const &position, Symbol *symbol, HareScript::DBTypeInfo *typeinfo, bool buildtypeinfo);

        /** Create a rvalue from a lvalue */
        AST::Rvalue* LvalueToRvalue(AST::ConvertedLvalue const &clvalue, AST::LvalueLayers::const_iterator const &stopat);

        /** Constructs a lvalue read/write block. First all the lvalue is read (put into retval->returnvar)
            The new value has to be written into that variable (make sure that retval->returnvar is used only once!)
            @param position Relevant position in the source file
            @param clvalue Converted Lvalue , describes base variable and layers above it. Basevar must be set, base is ignored.
            @param baseblock Block where evaluation will take place (if 0, allocated self). If base variable is a temporary (for objects), declare and assign it in this object
            @param workblock Block where caller must put the assignment to retval->returnvar with the new value. If no writing is
               performed, set to 0.
            @param old_value_needed Need the old value of the lvalue (can be set to false when the value is not
               neccessary because it is overwritten, as with an assignment). If false, the returnvar variable
               in the returned expression block is NOT initialized!!
            @return Expression block in which the lvalue happens */
        AST::ExpressionBlock * ImLvalue(LineColumn const &position, AST::ConvertedLvalue const &clvalue, AST::Block * baseblock, AST::Block * workblock, bool old_value_needed);

        /** Adds an deep array/record/object-valueset statement into the current block
            @param position Relevant position in the source file
            @param clvalue Converted lvalue, describes the place to set
            @param value Value that must be set
        */
        void ImLvalueSet(LineColumn const &position, AST::ConvertedLvalue const &clvalue, AST::Rvalue *value);

        /** Returns an expression that returns whether deep operations are permitted for an object member
            @param position Relevant position in the source file
            @param object Expression for the object
            @param membername Name of the member */
        AST::Rvalue * ImObjectMemberIsSimple(LineColumn const &position, AST::Rvalue *object, std::string const &membername);

        /** Returns an expression that yields a value in the current generator function
            @param position Relevant position in the source file
            @param generator Generator object
            @param yieldexpr Expression to yield
            @param isasync If this is an yield/await in an async function
            @param isawait If this is an await expression
            @param wrapped Whether the returned value must be wrapped in an [ done := false, value := ... ] record
            @param star Whether this is a YIELD* expression
        */
        AST::Rvalue * ImYield(LineColumn const &position, AST::Rvalue *generator, AST::Rvalue *yieldexpr, bool isasync, bool isawait, bool wrapped, bool star);

        // --- SQL ---

        /** Inserts a SQL DELETE statement into the current block
            @param position Relevant position in the source file
            @param source Source from which elements must be deleted
            @param location Location(s) where the deletes must be done */
        void ImSQLDelete(LineColumn const &position, AST::SQLSource * source, AST::ArrayLocation location);

        /** Inserts a SQL INSERT statement into the current block
            @param position Relevant position in the source file
            @param source Source in which the new record must be added
            @param values Contents of new record
            @param location Place where the insertion must be performed */
        void ImSQLInsert(LineColumn const &position, AST::SQLSource * source, AST::SQLDataModifier * values, AST::ArrayLocation location);

        /** Inserts a SQL UPDATE statement into the current block
            @param position Relevant position in the source file
            @param source Source where records must be updated
            @param values Partial contents of updated record
            @param location Location where the update must occur */
        void ImSQLUpdate(LineColumn const &position, AST::SQLSource * source, AST::SQLDataModifier * values, AST::ArrayLocation location);

        /** Returns an empty SQLDataModifier object
            @param position Relevant position in the source file */
        AST::SQLDataModifier * ImGetSQLDataModifier(LineColumn const &position);

        /** Returns a SQLSource object that designates a record array
            @param position Relevant position in the source file
            @param rename Name that has been given to this source
            @param expression Expression that evaluates to the record array
            @param org_expression Original expression that generated the content of @a expression, used for determining source name
        */
        AST::SQLSource * ImSQLSource(LineColumn const &position, AST::Rvalue * expression, AST::Rvalue *org_expression, AST::Variable * reassign);

        /** Returns an empty SQLSources object, in which sqlsource objects can be added
            @param position Relevant position in the source file */
        AST::SQLSources * ImSQLSources(LineColumn const &position);

        /** Returns a epxression-ptr that designates a SQL SELECT
            @param position Relevant position in the source file */
        AST::SQLSelect * ImGetSQLSelect(LineColumn const &position);

        AST::Rvalue * ImCodeFunctionRef(LineColumn const &position, Symbol *function, AST::Rvalue *typedescription);

        AST::Rvalue * ImFunctionPtrCall(LineColumn const &position, AST::Rvalue *expr, AST::RvaluePtrs params);

        void ImCodeObjectInitFunction(LineColumn const &position, LineColumn const &baseinitpos, Symbol *object);
        void ImCodeObjectInit(LineColumn const &position, Symbol *object, Symbol *this_variable, AST::RvaluePtrs const &base_params, LineColumn const &baseinitpos);

        void ImCodeObjectNonStaticTest(LineColumn const &position, AST::Rvalue *expr, bool via_this);

        AST::Rvalue * ImCodeNew(LineColumn const &position, Symbol *object, AST::Rvalue *current_object, AST::RvaluePtrs const &params);

        AST::Rvalue * ImMakePrivilegedObjectReference(LineColumn const &position, AST::Rvalue *expr);

        AST::TryCatchStatement * ImTryCatch(LineColumn const &position);

        AST::TryFinallyStatement * ImTryFinally(LineColumn const &position, bool in_function, bool in_loop, bool have_var, LineColumn namepos);

        AST::Rvalue * ImObjectIsOfType(LineColumn const &position, AST::Rvalue *obj, Symbol *objtype);

        void ImThrow(LineColumn const &position, AST::Rvalue *obj, bool is_rethrow);
        AST::Rvalue * ImGetThrowVariable(LineColumn const &position);
        AST::Rvalue * ImEnd(LineColumn const &position);

        /// Get a functioncall to push/pop async context. set context to 0 for pop
        AST::Rvalue * ImGetAsyncContextModifier(LineColumn const &position, AST::Rvalue *asynccontext, AST::Rvalue *skipframes);

        Symbol* ImPropertyAccessFunction(LineColumn const &position, Symbol *objtype, std::string const &name, AST::LvalueLayers const &lvaluelayers, bool setter);
};

} // end of namespace Compiler
} // end of namespace HareScript


#endif // blex_webhare_compiler_astcoder
