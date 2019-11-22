#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include "astcoder.h"
#include "symboltable.h"
#include "libraryimporter.h"
#include <blex/decimalfloat.h>
#include "astvisitors.h"

// AST-coder, contains the coder that transforms a parsed program into an AST.

namespace HareScript
{
namespace Compiler
{
using namespace AST;

AstCoder::AstCoder(CompilerContext &context, std::string const &orgsrcname)
: context(context)
{
        root = Adopt(new Module(LineColumn()));
        root->orgsrcname = orgsrcname;
        root->outsidestate = Adopt(new Symbol(":outsidestate", SymbolType::Variable));

        {
                // Build and add :throwerror function (ADDME: Why not call __HS_FATALERROR?)
                Symbol *symbol = context.symboltable->RegisterForwardSymbol(LineColumn(), ":THROWERROR", SymbolType::Function, false, false);
                symbol->functiondef->flags |= FunctionFlags::External;
                // Do not add terminates to this function, it is used in places that need the flow to go on (function return without return)

                SymbolDefs::FunctionDef::Argument arg;
                arg.value = 0;
                arg.symbol = context.symboltable->RegisterDeclaredVariable(LineColumn(), 0, false, false, VariableTypes::Integer);
                symbol->functiondef->arguments.push_back(arg);
                arg.value = ImConstantString(LineColumn(), "");
                arg.symbol = context.symboltable->RegisterDeclaredVariable(LineColumn(), 0, false, false, VariableTypes::String);
                symbol->functiondef->arguments.push_back(arg);
                arg.value = ImConstantString(LineColumn(), "");
                arg.symbol = context.symboltable->RegisterDeclaredVariable(LineColumn(), 0, false, false, VariableTypes::String);
                symbol->functiondef->arguments.push_back(arg);

                context.symboltable->RegisterDeclaredFunction(LineColumn(), symbol, false);
        }

        Function * initfunction = Adopt(new Function(LineColumn()));
        Symbol *symbol = context.symboltable->RegisterForwardSymbol(LineColumn(), ":INITFUNCTION", SymbolType::Function, false, false);
        context.symboltable->RegisterDeclaredFunction(LineColumn(), symbol, false);

        // Put all root level code in the init functions
        initfunction->symbol = symbol;
        initfunction->block = Adopt(new Block(LineColumn()));
        root->functions.push_back(initfunction);
        stack.push_back(initfunction->block);
}

AstCoder::~AstCoder()
{
}

std::pair<SymbolDefs::Library*, LoadlibInfo> AstCoder::LoadLib(LineColumn const &position, std::string const &requester, std::string const &name, bool execute_load)
{
        std::unique_ptr< Blex::RandomStream > libraryfile;
        LoadlibInfo llibinfo;

        llibinfo.loadlib = name;
        llibinfo.requester = requester;
        llibinfo.loc = position;

        if (execute_load)
        {
                HareScript::FileSystem::FilePtr file = context.filesystem->OpenLibrary(*context.keeper, name);

                Blex::DateTime clibtime;
                if (file)
                {
                        file->GetClibData(&libraryfile, &clibtime);
                }

                if (!libraryfile.get())
                {
                        context.errorhandler.AddErrorAt(position, Error::CannotFindCompiledLibrary, name);
                        return std::make_pair((SymbolDefs::Library*)0, llibinfo);
                }

                LibraryImporter importer(context);
                importer.Execute(position, *libraryfile, llibinfo.loadlib, clibtime, this);

                return std::make_pair(importer.library, llibinfo);
        }
        else
        {
                return std::make_pair((SymbolDefs::Library*)0, llibinfo);
        }
}

Block * AstCoder::GetCurrentBlock()
{
        Block * list = dynamic_cast<Block *>(stack.back());
        assert(list != 0);
        return list;
}

Variable * AstCoder::ImSafeErrorValueReturn(LineColumn const &position)
{
        return ImVariable(position, context.symboltable->RegisterDeclaredVariable (position, 0, false, false, VariableTypes::Variant));
}

void AstCoder::ImRegisterExternalFunction(LineColumn const &position, Symbol *symbol)
{
        Function * function = Adopt(new Function(position));

        function->symbol = symbol;
        root->external_functions.push_back(function);
}

/** Intermediate coding */
AST::Function * AstCoder::ImOpenFunction(LineColumn const &position, Symbol *symbol)
{
        Function * function = Adopt(new Function(position));

        function->symbol = symbol;
        function->block = Adopt(new Block(LineColumn()));
        root->functions.push_back(function);
        stack.push_back(function->block);
        return function;
}

void AstCoder::ImCloseFunction(LineColumn const &)
{
        stack.pop_back();
}

void AstCoder::DoCodeBlock(AST::Block * block)
{
        Block * list = GetCurrentBlock();
        list->statements.push_back(block);
}

void AstCoder::CodeExternalData(LineColumn const &position, const char *start, unsigned len, bool at_eof)
{
        if (at_eof) //Skip final external data tokens if they consist of nothing but whitespace
        {
                const char *ptr;
                for (ptr=start;ptr<start+len;++ptr)
                  if (!Blex::IsWhitespace(*ptr))
                    break;
                if (ptr==start+len) //all whitespace
                    return;
        }

        Block * list = GetCurrentBlock();

        Symbol* symbol = context.symboltable->ResolveSymbol(position, "PRINT", NULL, false);
        if (!symbol)
        {
                symbol = context.symboltable->RegisterNewCalledFunction(position, "PRINT", false);
        }

        // Break in blocks of max 4KB, print them
        while (len > 0)
        {
                unsigned thislen = std::min(len, 4096u);
                RvaluePtrs parameters;
                Constant *str = ImConstantString(position, std::string(start, start + thislen));
                parameters.push_back(str);
                start += thislen;
                len -= thislen;
                FunctionCall *call = Adopt(new FunctionCall(position, symbol, parameters, true));
                list->statements.push_back(Adopt(new SingleExpression(position, call)));
        }
}

void AstCoder::ImIf_Open(LineColumn const &position, Rvalue * exec_condition)
{
        Block * list = GetCurrentBlock();
        assert(list != 0);
        ConditionalStatement *stat = Adopt(new ConditionalStatement(position));
        stat->stat_true = Adopt(new Block(position));
        stack.push_back(stat);
        stack.push_back(stat->stat_true);
        stat->condition = exec_condition;
        list->statements.push_back(stat);
}

void AstCoder::ImIf_Else(LineColumn const &position)
{
        stack.pop_back();
        ConditionalStatement *stat = dynamic_cast<ConditionalStatement *>(stack.back());
        assert(stat != 0);
        stat->stat_false = Adopt(new Block(position));
        stack.push_back(stat->stat_false);
}

void AstCoder::ImIf_Close(LineColumn const &)
{
        stack.pop_back();
        stack.pop_back();
}
void AstCoder::ImForEvery(LineColumn const &position, AST::Variable * iteratevar, AST::Rvalue * source, AST::Block * loop, AST::Variable * positionvar)
{
        Block * list = GetCurrentBlock();
        assert(list != 0);
        ForEveryStatement *stat = Adopt(new ForEveryStatement(position));
        stat->source = source;
        stat->iteratevar = iteratevar;
        stat->loop = loop;
        stat->positionvar = positionvar;
        list->statements.push_back(stat);
}

void AstCoder::ImFor_Open(LineColumn const &position, AST::Rvalue * loop_condition, AST::Rvalue * increment_condition)
{
        Block * list = GetCurrentBlock();
        assert(list != 0);
        LoopStatement *stat = Adopt(new LoopStatement(position));
        stat->loop = Adopt(new Block(position));
        stack.push_back(stat);
        stack.push_back(stat->loop);
        stat->precondition = loop_condition;
        stat->loopincrementer = increment_condition;
        list->statements.push_back(stat);
}

void AstCoder::ImFor_Close(LineColumn const &position)
{
        Block * list = GetCurrentBlock();
        if (list)
            list->statements.push_back(Adopt(new ContinueStatement(position)));
        stack.pop_back();
        stack.pop_back();
}

void AstCoder::ImBreak(LineColumn const &position)
{
        Block * list = GetCurrentBlock();
        list->statements.push_back(Adopt(new BreakStatement(position)));
}

void AstCoder::ImContinue(LineColumn const &position)
{
        Block * list = GetCurrentBlock();
        list->statements.push_back(Adopt(new ContinueStatement(position)));
}

void AstCoder::ImExecute(LineColumn const &position, Rvalue * expr)
{
        Block * list = GetCurrentBlock();
        list->statements.push_back(Adopt(new SingleExpression(position, expr)));
}

void AstCoder::ImStatement(AST::Statement *statement)
{
        Block * list = GetCurrentBlock();
        list->statements.push_back(statement);
}

void AstCoder::ImReturn(LineColumn const &position, Rvalue * return_value)
{
        Block * list = GetCurrentBlock();
        list->statements.push_back(Adopt(new ReturnStatement(position, return_value)));
}

SwitchStatement * AstCoder::ImSwitch(LineColumn const &position)
{
        Block * list = GetCurrentBlock();

        SwitchStatement *stat = Adopt(new SwitchStatement(position));

        list->statements.push_back(stat);
        return stat;
}

void AstCoder::CodeInitialize(Symbol *symbol)
{
        Block * list = GetCurrentBlock();
        list->statements.push_back(Adopt(new InitializeStatement(symbol->definitionposition, symbol)));
}

void AstCoder::ImArrayInsert(LineColumn const &position, Lvalue * array, ArrayLocation location, Rvalue * value)
{
        Block * list = GetCurrentBlock();
        list->statements.push_back(Adopt(new ArrayInsert(position, array, location, value)));
}

void AstCoder::ImArrayDelete(LineColumn const &position, Lvalue * array, AST::ArrayLocation location)
{
        Block * list = GetCurrentBlock();
        list->statements.push_back(Adopt(new ArrayDelete(position, array, location)));
}

void AstCoder::ImDeepArrayDelete(LineColumn const &position, AST::ConvertedLvalue const &clvalue, AST::ArrayLocation location)
{
        Block * list = GetCurrentBlock();
        list->statements.push_back(Adopt(new DeepArrayDelete(
                position,
                clvalue,
                location)));
}

void AstCoder::ImDeepArrayInsert(LineColumn const &position, AST::ConvertedLvalue const &clvalue, AST::ArrayLocation location, AST::Rvalue *value)
{
        Block * list = GetCurrentBlock();
        list->statements.push_back(Adopt(new DeepArrayInsert(
                position,
                clvalue,
                location,
                value)));
}

void AstCoder::ImLvalueSet(LineColumn const &position, AST::ConvertedLvalue const &clvalue, AST::Rvalue *value)
{
        if (clvalue.layers.empty())
        {
                ImExecute(position,
                    ImAssignment(position,
                        ImVariable(clvalue.exprpos, clvalue.basevar),
                        value));
        }
        else
        {
                Block * list = GetCurrentBlock();
                list->statements.push_back(Adopt(new LvalueSet(
                        position,
                        clvalue,
                        value)));
        }
}

Variable * AstCoder::ImStoreInVariable(LineColumn const &position, Rvalue *expr)
{
        if (Variable *var = dynamic_cast< Variable * >(expr))
            return var;

        Symbol *newvar = context.symboltable->RegisterDeclaredVariable(position, NULL, false, false, VariableTypes::Uninitialized);
        ImExecute(position,
            ImAssignment(position,
                ImVariable(position, newvar),
                expr));

        return ImVariable(position, newvar);
}

Variable * AstCoder::ImCopyVariable(AST::Variable *var)
{
        return ImVariable(var->position, var->symbol);
}

/**/ //Im-functions for expressions

Rvalue * AstCoder::ImColumnOf(LineColumn const &position, Rvalue * var, const std::string &name)
{
        return Adopt(new RecordColumnConst(position, var, name));
}
Rvalue * AstCoder::ImMemberOf(LineColumn const &position, Rvalue * var, const std::string &name, bool via_this, LineColumn const &next_token)
{
        return Adopt(new ObjectMemberConst(position, var, name, via_this, next_token));
}
Rvalue * AstCoder::ImSchemaTableOf(LineColumn const &position, Variable * var, const std::string &name)
{
        std::string uname(name);
        Blex::ToUppercase(uname.begin(), uname.end());
        return Adopt(new SchemaTable(position, var, uname));
}

Rvalue * AstCoder::ImRecordCellSet(LineColumn const &position, AST::Lvalue * lvalue, std::string const &/*AST::Rvalue * */cellname, AST::Rvalue * celldata, bool cancreate, bool check_type)
{
        std::string uname = cellname;
        Blex::ToUppercase(uname.begin(), uname.end());

        return Adopt(new RecordCellSet(position, lvalue, uname, celldata, cancreate, check_type));
}

void AstCoder::ImObjectExtend(LineColumn const &position, AST::Rvalue *object, Symbol *extendwith, std::vector< AST::Rvalue * > parameters, bool via_this)
{
        ImStatement(Adopt(new ObjectExtend(position, object, extendwith, parameters, via_this)));
}

void AstCoder::ImObjectMemberDelete(LineColumn const &position, AST::Rvalue * object, std::string const &cellname, bool via_this)
{
        ImStatement(Adopt(new ObjectMemberDelete(position, object, cellname, via_this)));
}

void AstCoder::ImObjectMemberInsert(LineColumn const &position, AST::Rvalue * object, std::string const &cellname, AST::Rvalue *celldata, bool is_private, bool via_this)
{
        ImStatement(Adopt(new ObjectMemberInsert(position, object, cellname, celldata, is_private, via_this)));
}

void AstCoder::ImObjectMemberSet(LineColumn const &position, AST::Rvalue * object, std::string const &cellname, AST::Rvalue * celldata, bool via_this)
{
        Block * list = GetCurrentBlock();
        list->statements.push_back(Adopt(new ObjectMemberSet(position, object, cellname, celldata, via_this)));
}

Rvalue * AstCoder::ImRecordCellDelete(LineColumn const &position, AST::Lvalue * lvalue, std::string const &/*AST::Rvalue * */cellname)
{
        std::string uname = cellname;
        Blex::ToUppercase(uname.begin(), uname.end());

        return Adopt(new RecordCellDelete(position, lvalue, uname));
}

Rvalue * AstCoder::ImArrayElementModify(LineColumn const &position, Rvalue * var, Rvalue * subscript_expr, Rvalue * value)
{
        return Adopt(new ArrayElementModify(position, var, subscript_expr, value));
}

Rvalue * AstCoder::ImArrayElementConst(LineColumn const &position, Rvalue * var, Rvalue * subscript_expr)
{
        return Adopt(new ArrayElementConst(position, var, subscript_expr));
}

Rvalue * AstCoder::ImEnd(LineColumn const &position)
{
        return Adopt(new End(position));
}

AST::Rvalue * AstCoder::ImBuiltinInstruction(LineColumn const &position, VariableTypes::Type returntype, std::string const &name, std::vector< AST::Rvalue * > const &parameters, bool mod_outsidestate, bool calls_harescript)
{
        return Adopt(new BuiltinInstruction(position, returntype, name, parameters, mod_outsidestate, calls_harescript));
}

Rvalue * AstCoder::ImUnaryOperator(LineColumn const &position, UnaryOperatorType::Types op, Rvalue * expr)
{
        return Adopt(new UnaryOperator(position, op, expr));
}

Rvalue * AstCoder::ImBinaryOperator(LineColumn const &position, BinaryOperatorType::Types op, Rvalue * lhsexpr, Rvalue * rhsexpr)
{
        return Adopt(new BinaryOperator(position, op, lhsexpr, rhsexpr));
}

AST::Rvalue * AstCoder::ImCast(LineColumn const &position, AST::Rvalue *expr, VariableTypes::Type type, bool is_explicit, bool allow_parameter_cast)
{
        if (type == VariableTypes::Variant)
            return expr;
        else
            return Adopt(new Cast(position, expr, type, is_explicit, allow_parameter_cast));
}

Rvalue * AstCoder::ImConditionalOperator(LineColumn const &position, Rvalue * condition, Rvalue * expr_true, Rvalue * expr_false)
{
        return Adopt(new ConditionalOperator(position, condition, expr_true, expr_false));
}

Assignment * AstCoder::ImAssignment(LineColumn const &position, Variable * storeto, Rvalue * value)
{
        return Adopt(new Assignment(position, storeto, value, false));
}

Assignment * AstCoder::ImInitialAssignment(LineColumn const &position, Variable * storeto, Rvalue * value)
{
        return Adopt(new Assignment(position, storeto, value, true));
}

Constant * AstCoder::ImConstant(LineColumn const &position, VarId var)
{
        if (!var)
        {
                var = context.stackm.NewHeapVariable();
                context.stackm.SetBoolean(var, false);
        }

        VariableTypes::Type type = context.stackm.GetType(var);
        return Adopt(new Constant(position, type, var));
}

Constant * AstCoder::ImConstantDefault(LineColumn const &position, VariableTypes::Type type)
{
        try
        {
                VarId var = context.stackm.NewHeapVariable();
                context.stackm.InitVariable(var, type);
                return ImConstant(position, var);
        }
        catch (VMRuntimeError &e)
        {
                e.position = position;
                throw;
        }
}

AST::ConstantRecord * AstCoder::ImConstantRecord(LineColumn const &position)
{
        return Adopt(new ConstantRecord(position));
}

AST::ConstantArray * AstCoder::ImConstantArray(LineColumn const &position, VariableTypes::Type type)
{
        return Adopt(new ConstantArray(position, type));
}

Constant * AstCoder::ImConstantBoolean(LineColumn const &position, bool value)
{
        VarId var = context.stackm.NewHeapVariable();
        context.stackm.SetBoolean(var, value);
        return ImConstant(position, var);
}

Constant * AstCoder::ImConstantFloat(LineColumn const &position, F64 value)
{
        VarId var = context.stackm.NewHeapVariable();
        context.stackm.SetFloat(var, value);
        return ImConstant(position, var);
}

Constant * AstCoder::ImConstantInteger(LineColumn const &position, int32_t value)
{
        VarId var = context.stackm.NewHeapVariable();
        context.stackm.SetInteger(var, value);
        return ImConstant(position, var);
}

Constant * AstCoder::ImConstantMoney(LineColumn const &position, int64_t value)
{
        VarId var = context.stackm.NewHeapVariable();
        context.stackm.SetMoney(var, value);
        return ImConstant(position, var);
}

Constant * AstCoder::ImConstantFloat(LineColumn const &position, Blex::DecimalFloat value)
{
        int numdigits=0;
        int64_t digits=value.digits;
        while (digits!=0)
        {
                digits=digits/10;
                numdigits++;
        }

        if (numdigits <= (6+value.exponent))
            return ImConstantMoney(position, value.ToMoney());

        VarId var = context.stackm.NewHeapVariable();
        context.stackm.SetFloat(var, value.ToFloat());
        return ImConstant(position, var);
}

Constant * AstCoder::ImConstantString(LineColumn const &position, const std::string &value)
{
        VarId var = context.stackm.NewHeapVariable();
        context.stackm.SetString(var, value.begin(), value.end());
        return ImConstant(position, var);
}

Variable * AstCoder::ImVariable(LineColumn const &position, Symbol *symbol)
{
        return Adopt(new Variable(position, symbol));
}

AST::FunctionPtr* AstCoder::ImFunctionPtr(LineColumn const &position, Symbol *symbol, bool parameters_specified, std::vector<int32_t> const &passthroughs, AST::RvaluePtrs const &parameters)
{
        FunctionPtr *newptr = Adopt(new FunctionPtr(position));
        symbol->force_export = true;
        newptr->function = symbol;
        newptr->parameters_specified = parameters_specified;
        newptr->passthrough_parameters = passthroughs;
        newptr->bound_parameters = parameters;
        return newptr;
}
AST::Rvalue* AstCoder::ImFunctionPtrRebind(LineColumn const &position, Rvalue *functionptr, std::vector<int32_t> const &passthroughs, AST::RvaluePtrs const &parameters, bool outside_ptr)
{
        FunctionPtrRebind *newptr = Adopt(new FunctionPtrRebind(position, outside_ptr));
        newptr->orgptr = functionptr;
        newptr->passthrough_parameters = passthroughs;
        newptr->bound_parameters = parameters;

        return newptr;
}
FunctionCall * AstCoder::ImFunctionCallUser(LineColumn const &position, Symbol *symbol, AST::RvaluePtrs const &parameters)
{
        return Adopt(new FunctionCall(position, symbol, parameters, false));
}

FunctionCall * AstCoder::ImFunctionCall(LineColumn const &position, Symbol *symbol, AST::RvaluePtrs const &parameters)
{
        return Adopt(new FunctionCall(position, symbol, parameters, true));
}

AST::Rvalue * AstCoder::ImObjectMethodCall(LineColumn const &position, Rvalue *object, std::string const &membername, bool via_this, AST::RvaluePtrs const &parameters, bool has_passthroughs, std::vector< int32_t > const &passthroughs)
{
        return Adopt(new ObjectMethodCall(position, object, membername, via_this, parameters, has_passthroughs, passthroughs));
}

Rvalue * AstCoder::ImDiscardableRvalue(LineColumn const &, Rvalue * expr)
{
        return expr;
}

TypeInfo * AstCoder::ImTypeInfo(LineColumn const &position, Symbol *symbol, HareScript::DBTypeInfo *typeinfo, bool buildtypeinfo)
{
        TypeInfo *info = Adopt(new TypeInfo(position, symbol, typeinfo));
        if (!typeinfo && buildtypeinfo)
            info->BuildTypeInfoFromSymbol(context);
        return info;
}

Rvalue* AstCoder::LvalueToRvalue(ConvertedLvalue const &clvalue, LvalueLayers::const_iterator const &stopat)
{
        Rvalue *value = ImVariable(clvalue.exprpos, clvalue.basevar);
        if (!clvalue.layers.empty())
        {
                TreeCopyingVisitor copier(context);
                // Calculate the old value
                for (LvalueLayers::const_iterator it = clvalue.layers.begin(); it != stopat; ++it)
                    switch (it->type)
                    {
                    case LvalueLayer::Array:    value = ImArrayElementConst(it->position, value, copier.GetCopy(it->expr)); break;
                    case LvalueLayer::Record:   value = ImColumnOf(it->position, value, it->name); break;
                    case LvalueLayer::Object:   value = ImMemberOf(it->position, value, it->name, it->via_this, it->next_token); break;
                    default: ;
                        context.errorhandler.AddErrorAt(it->position, Error::InternalError, "Unexpected type in ImLvalue");
                    }
        }

        return value;
}

AST::ExpressionBlock * AstCoder::ImLvalue(LineColumn const &/*position*/, ConvertedLvalue const &_clvalue, AST::Block * baseblock, AST::Block * workblock, bool old_value_needed)
{
        assert(workblock != 0);
        ConvertedLvalue clvalue(_clvalue);

//        LineColumn const &position = clvalue.exprpos;
//        Symbol *basevar = clvalue.basevar;
//        LvalueLayers const &layers = clvalue.layers;

        // Fast path (the big overhead isn't needed here)
        if (clvalue.layers.empty())
        {
                if (baseblock)
                {
                        ImOpenBlock(baseblock);
                        DoCodeBlock(workblock);
                        ImCloseBlock();
                }
                else
                    baseblock = workblock;

                return Adopt(new ExpressionBlock(clvalue.exprpos, baseblock, ImVariable(clvalue.exprpos, clvalue.basevar)));
        }

        // Open a new block; we need to do much processink.
        if (!baseblock)
            baseblock = Adopt(new Block(clvalue.exprpos));
        ImOpenBlock(baseblock);

        // Lvalues of the form a->b->c.d.f can be rewritten to x := a->b->c; x->c.d.f because a and b are not changed
        // Plus, the rest of the machinery doesn't handle them correctly, so we need to rewrite anyway.
        for (LvalueLayers::iterator oit = clvalue.layers.end(); oit != clvalue.layers.begin();)
        {
                --oit;
                if (oit == clvalue.layers.begin())
                    break;

                if (oit->type == LvalueLayer::Object)
                {
                        TreeCopyingVisitor copier(context);
                        Rvalue *value = ImVariable(clvalue.exprpos, clvalue.basevar);

                        // Calculate the old value
                        for (LvalueLayers::const_iterator it = clvalue.layers.begin(); it != oit; ++it)
                            switch (it->type)
                            {
                            case LvalueLayer::Array:    value = ImArrayElementConst(it->position, value, copier.GetCopy(it->expr)); break;
                            case LvalueLayer::Record:   value = ImColumnOf(it->position, value, it->name); break;
                            case LvalueLayer::Object:   value = ImMemberOf(it->position, value, it->name, it->via_this, it->next_token); break;
                            default: ;
                                context.errorhandler.AddErrorAt(it->position, Error::InternalError, "Unexpected type in ImLvalue");
                            }

                        LineColumn position = oit->position;

                        clvalue.basevar = context.symboltable->RegisterDeclaredVariable(position, NULL, false, false, VariableTypes::Object);
                        clvalue.base = value;
                        clvalue.layers.erase(clvalue.layers.begin(), oit);

                        ImExecute(position,
                                ImAssignment(position,
                                        ImVariable(position, clvalue.basevar),
                                        value));

                        break;
                }
        }

        /* We now generate the code within the current block that retrieves the current value (only
           if requested, recreating the layers of the lvalue on top of the basevar), then code the
           workblock, then emit code that places the updated value back in its original place
        */
        Symbol *tempvar;
        if (clvalue.layers.empty())
        {
                tempvar = clvalue.basevar;
        }
        else
        {
                tempvar = context.symboltable->RegisterDeclaredVariable(clvalue.exprpos, NULL, false, false, VariableTypes::Uninitialized);

                if (old_value_needed)
                {
                        TreeCopyingVisitor copier(context);
                        Rvalue *value = ImVariable(clvalue.exprpos, clvalue.basevar);

                        // Calculate the old value
                        for (LvalueLayers::const_iterator it = clvalue.layers.begin(); it != clvalue.layers.end(); ++it)
                            switch (it->type)
                            {
                            case LvalueLayer::Array:    value = ImArrayElementConst(it->position, value, copier.GetCopy(it->expr)); break;
                            case LvalueLayer::Record:   value = ImColumnOf(it->position, value, it->name); break;
                            case LvalueLayer::Object:   value = ImMemberOf(it->position, value, it->name, it->via_this, it->next_token); break;
                            default: ;
                                context.errorhandler.AddErrorAt(it->position, Error::InternalError, "Unexpected type in ImLvalue");
                            }

                        // Assign the value to the tempvar
                        ImExecute(clvalue.exprpos,
                                ImAssignment(clvalue.exprpos,
                                        ImVariable(clvalue.exprpos, tempvar),
                                        value));
                }
        }

        // Place the workblock here
        DoCodeBlock(workblock);

        // And do the backassign
        Block * list = GetCurrentBlock();
        list->statements.push_back(Adopt(new LvalueSet(
                clvalue.exprpos,
                clvalue,
                ImVariable(clvalue.exprpos, tempvar))));

        ImCloseBlock();
        return Adopt(new ExpressionBlock(clvalue.exprpos, baseblock, ImVariable(clvalue.exprpos, tempvar)));
}

AST::Rvalue * AstCoder::ImObjectMemberIsSimple(LineColumn const &position, AST::Rvalue *object, std::string const &membername)
{
        Symbol* symbol = context.symboltable->ResolveSymbol(position, ":OBJECTMEMBERISSIMPLE", NULL, false);
        if (!symbol)
        {
                symbol = context.symboltable->RegisterNewCalledFunction(position, ":OBJECTMEMBERISSIMPLE", false);

                SymbolDefs::FunctionDef *def = Adopt(new SymbolDefs::FunctionDef);
                def->flags |= FunctionFlags::ExecutesHarescript;
                symbol->functiondef = def;
                def->returntype = VariableTypes::Boolean;
                SymbolDefs::FunctionDef::Argument arg;
                arg.value = 0;
                arg.symbol = context.symboltable->RegisterDeclaredVariable(position, 0, false, false, VariableTypes::Object);
                def->arguments.push_back(arg);
                arg.symbol = context.symboltable->RegisterDeclaredVariable(position, 0, false, false, VariableTypes::String);
                def->arguments.push_back(arg);
        }

        AST::RvaluePtrs parameters;
        // Cast here, make sure that cast errors won't be traced to objissimple
        parameters.push_back(ImCast(object->position, object, VariableTypes::Object, false, false));
        parameters.push_back(ImConstantString(object->position, membername));

        return ImFunctionCall(object->position, symbol, parameters);
}

AST::Rvalue * AstCoder::ImYield(LineColumn const &position, AST::Rvalue *generator, AST::Rvalue *yieldexpr, bool isasync, bool isawait, bool wrapped, bool star)
{
        return Adopt(new Yield(position, generator, yieldexpr, isasync, isawait, wrapped, star));
}

void AstCoder::ImSQLInsert(LineColumn const &position, SQLSource * source, SQLDataModifier * values, ArrayLocation location)
{
        Block * list = GetCurrentBlock();
        list->statements.push_back(Adopt(new SQLInsert(position, source, values, location)));
}

void AstCoder::ImSQLUpdate(LineColumn const &position, SQLSource * source, SQLDataModifier * values, ArrayLocation location)
{
        Block * list = GetCurrentBlock();
        list->statements.push_back(Adopt(new SQLUpdate(position, source, values, location)));
}

SQLDataModifier * AstCoder::ImGetSQLDataModifier(LineColumn const &position)
{
        return Adopt(new SQLDataModifier(position));
}

SQLSelect * AstCoder::ImGetSQLSelect(LineColumn const &position)
{
        return Adopt(new SQLSelect(position));
}

void AstCoder::ImSQLDelete(LineColumn const &position, SQLSource * source, ArrayLocation location)
{
        Block * list = GetCurrentBlock();
        list->statements.push_back(Adopt(new SQLDelete(position, source, location)));
}

SQLSource * AstCoder::ImSQLSource(LineColumn const &position, Rvalue *expression, Rvalue *org_expression, Variable * reassign)
{
        return Adopt(new SQLSource(position, "", expression, org_expression, reassign));
}

/*SQLSource * AstCoder::ImSQLSourceTable(LineColumn const &position, std::string const &rename, Symbol *table)
{
        return Adopt(new SQLSourceTable(position, rename, table));
}*/

SQLSources * AstCoder::ImSQLSources(LineColumn const &position)
{
        return Adopt(new SQLSources(position));
}

void AstCoder::ImOpenBlock(AST::Block * block)
{
        stack.push_back(block);
}
void AstCoder::ImCloseBlock()
{
        if (stack.empty())
            throw Message(true, Error::InternalError, "Mismatched openblock-closeblocks");
        stack.pop_back();
}

Rvalue * AstCoder::ImCodeFunctionRef(LineColumn const &position, Symbol *function, Rvalue *typedescription)
{
        Symbol* symbol = context.symboltable->ResolveSymbol(position, ":INITFUNCTIONPTR", NULL, false);
        if (!symbol)
        {
                symbol = context.symboltable->RegisterNewCalledFunction(position, ":INITFUNCTIONPTR", false);
                SymbolDefs::FunctionDef *def = Adopt(new SymbolDefs::FunctionDef);
                symbol->functiondef = def;
                def->returntype = VariableTypes::FunctionRecord;
                SymbolDefs::FunctionDef::Argument arg;
                arg.value = 0;
                arg.symbol = context.symboltable->RegisterForwardSymbol(position, ":typedescription", SymbolType::Variable, true, false);
                arg.symbol->variabledef->type = VariableTypes::Record;
                def->arguments.push_back(arg);
                arg.symbol = context.symboltable->RegisterForwardSymbol(position, ":libname", SymbolType::Variable, true, false);
                arg.symbol->variabledef->type = VariableTypes::String;
                def->arguments.push_back(arg);
                arg.symbol = context.symboltable->RegisterForwardSymbol(position, ":functionname", SymbolType::Variable, true, false);
                arg.symbol->variabledef->type = VariableTypes::String;
                def->arguments.push_back(arg);
        }

        RvaluePtrs parameters;
        parameters.push_back(typedescription);
        if (function->importlibrary)
            parameters.push_back(ImConstantString(position, function->importlibrary->liburi));
        else
            parameters.push_back(ImConstantString(position, ""));

        //ADDME: Directly refer to function id?! doesn't work for external funcs though... shouldn't referred functions be made public so the VM can find them?
        parameters.push_back(ImConstantString(position, GetMangledFunctionName(function)));

        return Adopt(new FunctionCall(position, symbol, parameters, true));
}

Rvalue * AstCoder::ImFunctionPtrCall(LineColumn const &position, Rvalue *expr, RvaluePtrs params)
{
        return Adopt(new FunctionPtrCall(position, expr, params));
}

void AstCoder::ImCodeObjectInitFunction(LineColumn const &position, LineColumn const &baseinitpos, Symbol *object)
{
        Symbol *symbol = context.symboltable->RegisterForwardSymbol(LineColumn(), object->name + "#NEW", SymbolType::Function, false, false);
        context.symboltable->RegisterDeclaredFunction(LineColumn(), symbol, false);
        object->objectdef->constructor = symbol;
        symbol->functiondef->object = object;

        if (object->flags & SymbolFlags::Public)
            symbol->flags = SymbolFlags::Type(symbol->flags | SymbolFlags::Public);

        context.symboltable->EnterScope(position);

        SymbolDefs::FunctionDef *def = Adopt(new SymbolDefs::FunctionDef);
        symbol->functiondef = def;
        symbol->functiondef->flags |= FunctionFlags::Constructor;
        symbol->functiondef->flags |= FunctionFlags::SkipTrace;
        def->returntype = VariableTypes::NoReturn;
        def->object_initializer = object;
        SymbolDefs::FunctionDef::Argument arg;
        arg.value = 0;
        arg.symbol = context.symboltable->RegisterForwardSymbol(position, ":THIS", SymbolType::Variable, true, false);
        arg.symbol->variabledef->type = VariableTypes::Object;
        arg.symbol->variabledef->objectdef = object->objectdef;
        def->arguments.push_back(arg);

        RvaluePtrs base_params;

        if (object->objectdef->base) // copy arguments of base constructor
        {
                TreeCopyingVisitor copier(context);

                SymbolDefs::FunctionDef *constructordef = object->objectdef->base->objectdef->constructor->functiondef;

                // Skip first :THIS argument
                if (!constructordef->arguments.empty())
                {
                        for (std::vector< SymbolDefs::FunctionDef::Argument >::iterator it = constructordef->arguments.begin() + 1; it != constructordef->arguments.end(); ++it)
                        {
                                SymbolDefs::FunctionDef::Argument basearg;
                                basearg.symbol = context.symboltable->RegisterForwardSymbol(position, it->symbol->name, SymbolType::Variable, true, false);
                                basearg.symbol->variabledef->type = it->symbol->variabledef->type;
                                basearg.value = it->value ? copier.GetCopy(it->value) : 0;
                                def->arguments.push_back(basearg);

                                base_params.push_back(ImVariable(position, basearg.symbol));
                        }
                }
        }

        ImOpenFunction(position, symbol);

        Symbol *tempobject = arg.symbol;//context.symboltable->RegisterDeclaredVariable(position, NULL, false, false, VariableTypes::Object);

        ImCodeObjectInit(position, object, tempobject, base_params, baseinitpos);

        ImCloseFunction(position);

        context.symboltable->LeaveScope(position);
}

void AstCoder::ImCodeObjectInit(LineColumn const &position, Symbol *object, Symbol *this_var, RvaluePtrs const &base_params, LineColumn const &baseinitpos)
{
        Symbol *tempobject = this_var;

        RvaluePtrs parameters;

        // Do we have a parent? If so, call its new operator first
        if (object->objectdef->base)
        {
                RvaluePtrs exprs(base_params);
                exprs.insert(exprs.begin(), ImVariable(baseinitpos, tempobject));

                ImExecute(position,
                    ImFunctionCall(baseinitpos, object->objectdef->base->objectdef->constructor, exprs));
        }

        Symbol* symbol = context.symboltable->ResolveSymbol(position, ":OBJECTSETTYPE", NULL, false);
        if (!symbol)
        {
                symbol = context.symboltable->RegisterNewCalledFunction(position, ":OBJECTSETTYPE", false);

                SymbolDefs::FunctionDef *def = Adopt(new SymbolDefs::FunctionDef);
                symbol->functiondef = def;
                def->returntype = VariableTypes::NoReturn;
                SymbolDefs::FunctionDef::Argument arg;
                arg.value = 0;
                arg.symbol = context.symboltable->RegisterDeclaredVariable(LineColumn(), 0, false, false, VariableTypes::Object);
                def->arguments.push_back(arg);
                arg.symbol = context.symboltable->RegisterDeclaredVariable(LineColumn(), 0, false, false, VariableTypes::String);
                def->arguments.push_back(arg);
        }

        RvaluePtrs set_typeparameters;
        set_typeparameters.push_back(ImVariable(position, tempobject));
        set_typeparameters.push_back(ImConstantString(position, object->name));
        ImExecute(position,
                ImFunctionCall(position, symbol, set_typeparameters));
}

void AstCoder::ImCodeObjectNonStaticTest(LineColumn const &position, AST::Rvalue *expr, bool via_test)
{
        const char *fname = via_test ? ":OBJECTTESTNONSTATICTHIS" : ":OBJECTTESTNONSTATIC";
        Symbol* symbol = context.symboltable->ResolveSymbol(position, fname, NULL, false);
        if (!symbol)
        {
                symbol = context.symboltable->RegisterNewCalledFunction(position, fname, false);

                SymbolDefs::FunctionDef *def = Adopt(new SymbolDefs::FunctionDef);
                symbol->functiondef = def;
                def->returntype = VariableTypes::NoReturn;
                SymbolDefs::FunctionDef::Argument arg;
                arg.value = 0;
                arg.symbol = context.symboltable->RegisterDeclaredVariable(LineColumn(), 0, false, false, VariableTypes::Object);
                def->arguments.push_back(arg);
        }

        RvaluePtrs parameters;
        parameters.push_back(expr);
        ImExecute(position,
                ImFunctionCall(position, symbol, parameters));
}

AST::Rvalue * AstCoder::ImCodeNew(LineColumn const &position, Symbol *object, AST::Rvalue *current_object, RvaluePtrs const &params)
{
        bool is_expr = !current_object;

        AST::Block *block = 0;
        if (is_expr)
        {
                block = Adopt(new Block(position));
                ImOpenBlock(block);
        }

        Symbol *tempobject = 0;
        if (!current_object)
        {
                tempobject = context.symboltable->RegisterDeclaredVariable(position, NULL, false, false, VariableTypes::Object);

                RvaluePtrs parameters;

                //   tempobject := OBJECTNEW();
                ImExecute(position,
                        ImAssignment(position,
                                ImVariable(position, tempobject),
                                ImBuiltinInstruction(position,
                                        VariableTypes::Object,
                                        ":OBJECTNEW",
                                        parameters,
                                        false,
                                        false))); // Outside state doesn't change visibly; dependence on object variable is enough

                current_object = ImVariable(position, tempobject);
        }

        RvaluePtrs parameters(params);
//        parameters.insert(parameters.begin(), ImConstantString(position, object->name));
        parameters.insert(parameters.begin(), current_object);

        ImExecute(position, ImFunctionCall(position, object->objectdef->constructor, parameters));
        context.symboltable->AddDeprecationWarnings(position, object);

        if (is_expr)
        {
                ImCloseBlock();
                return Adopt(new ExpressionBlock(position, block, ImVariable(position, tempobject)));
        }
        return 0;
}

AST::Rvalue * AstCoder::ImMakePrivilegedObjectReference(LineColumn const &position, AST::Rvalue *expr)
{
        Symbol* symbol = context.symboltable->ResolveSymbol(position, ":OBJECTMAKEPRIVREF", NULL, false);
        if (!symbol)
        {
                symbol = context.symboltable->RegisterNewCalledFunction(position, ":OBJECTMAKEPRIVREF", false);
                SymbolDefs::FunctionDef *def = Adopt(new SymbolDefs::FunctionDef);
                symbol->functiondef = def;
                def->returntype = VariableTypes::Object;
                SymbolDefs::FunctionDef::Argument arg;
                arg.value = 0;
                arg.symbol = context.symboltable->RegisterForwardSymbol(position, ":ref", SymbolType::Variable, true, false);
                arg.symbol->variabledef->type = VariableTypes::Object;
                def->arguments.push_back(arg);
        }
        RvaluePtrs parameters;
        parameters.push_back(expr);

        return ImFunctionCall(position, symbol, parameters);
}

AST::TryCatchStatement * AstCoder::ImTryCatch(LineColumn const &position)
{
        AST::TryCatchStatement *stat = Adopt(new AST::TryCatchStatement(position));

        stat->tryblock = Adopt(new Block(position));
        stat->catchblock = Adopt(new Block(position));

        Block * list = GetCurrentBlock();
        list->statements.push_back(stat);

        return stat;
}

AST::TryFinallyStatement * AstCoder::ImTryFinally(LineColumn const &position, bool withinfunction, bool in_loop, bool have_var, LineColumn namepos)
{
        AST::TryCatchStatement *trycatch = Adopt(new AST::TryCatchStatement(position));

        trycatch->tryblock = Adopt(new Block(position));
        trycatch->catchblock = Adopt(new Block(position));

        AST::TryFinallyStatement *stat = Adopt(new AST::TryFinallyStatement(position));

        stat->tryblock = trycatch;
        stat->finallyblock = Adopt(new Block(position));
        stat->finallycodeblock = Adopt(new Block(position));
        stat->var = nullptr;

        stat->type = context.symboltable->RegisterDeclaredVariable (position, 0, false, false, VariableTypes::Integer);
        CodeInitialize(stat->type);

        stat->value = context.symboltable->RegisterDeclaredVariable (position, 0, false, false, VariableTypes::Variant);
        ImExecute(position,
                ImAssignment(
                        position,
                        ImVariable(position, stat->value),
                        ImConstantInteger(position, 0)));

        if (have_var)
        {
                stat->var = context.symboltable->RegisterDeclaredVariable(namepos, 0, false, false, VariableTypes::Object);
                CodeInitialize(stat->var);
        }

        // Code the exception catcher
        ImOpenBlock(stat->tryblock->catchblock);

        ImExecute(position,
                ImAssignment(
                        position,
                        ImVariable(position, stat->type),
                        ImConstantInteger(position, 1)));
        ImExecute(position,
                ImAssignment(
                        position,
                        ImVariable(position, stat->value),
                        ImGetThrowVariable(position)));
        if (have_var)
        {
                ImExecute(position,
                        ImAssignment(
                                position,
                                ImVariable(position, stat->var),
                                ImVariable(position, stat->value)));
        }

        ImCloseBlock();

        ImOpenBlock(stat->finallyblock);

        DoCodeBlock(stat->finallycodeblock);

        // After use code, handle the original throw/return/break/continue if the user code just fell through.
        ImIf_Open(position,
            ImBinaryOperator(
                position,
                BinaryOperatorType::OpEqual,
                ImVariable(position, stat->type),
                ImConstantInteger(position, 1)));

        // Got exception: rethrow
        ImThrow(position, ImVariable(position, stat->value), true);

        ImIf_Close(position);

        ImIf_Open(position,
            ImBinaryOperator(
                position,
                BinaryOperatorType::OpEqual,
                ImVariable(position, stat->type),
                ImConstantInteger(position, 2)));

        ImReturn(position, withinfunction ? ImVariable(position, stat->value) : 0);

        ImIf_Close(position);

        if (in_loop)
        {
                ImIf_Open(position,
                    ImBinaryOperator(
                        position,
                        BinaryOperatorType::OpEqual,
                        ImVariable(position, stat->type),
                        ImConstantInteger(position, 3)));

                ImBreak(position);

                ImIf_Close(position);

                ImIf_Open(position,
                    ImBinaryOperator(
                        position,
                        BinaryOperatorType::OpEqual,
                        ImVariable(position, stat->type),
                        ImConstantInteger(position, 4)));

                ImContinue(position);

                ImIf_Close(position);
        }

        ImCloseBlock(); // finallyblock


        Block * list = GetCurrentBlock();
        list->statements.push_back(stat);

        return stat;
}

AST::Rvalue * AstCoder::ImObjectIsOfType(LineColumn const &position, AST::Rvalue *obj, Symbol *objtype)
{
        Symbol* symbol = context.symboltable->ResolveSymbol(position, "__HS_OBJECTMATCHESOUID", NULL, false);
        if (!symbol)
        {
                symbol = context.symboltable->RegisterNewCalledFunction(position, "__HS_OBJECTMATCHESOUID", false);
                SymbolDefs::FunctionDef *def = Adopt(new SymbolDefs::FunctionDef);
                symbol->functiondef = def;
                def->returntype = VariableTypes::Boolean;
                SymbolDefs::FunctionDef::Argument arg;
                arg.value = 0;
                arg.symbol = context.symboltable->RegisterDeclaredVariable(LineColumn(), 0, false, false, VariableTypes::Object);
                def->arguments.push_back(arg);
                arg.value = 0;
                arg.symbol = context.symboltable->RegisterDeclaredVariable(LineColumn(), 0, false, false, VariableTypes::String);
                def->arguments.push_back(arg);
        }
        RvaluePtrs parameters;
        parameters.push_back(obj);
        parameters.push_back(Adopt(new ObjectTypeUID(position, objtype)));

        objtype->force_export = true;
//        parameters.push_back(ImConstantString(position, objtype->objectdef->uids.empty() ? std::string() : objtype->objectdef->uids.back()));

        return ImFunctionCall(position, symbol, parameters);
}

void AstCoder::ImThrow(LineColumn const &position, AST::Rvalue *obj, bool is_rethrow)
{
        Symbol* symbol = context.symboltable->ResolveSymbol(position, "__HS_THROWEXCEPTION", NULL, false);
        if (!symbol)
        {
                symbol = context.symboltable->RegisterNewCalledFunction(position, "__HS_THROWEXCEPTION", false);
                SymbolDefs::FunctionDef *def = Adopt(new SymbolDefs::FunctionDef);
                symbol->functiondef = def;
                def->returntype = VariableTypes::NoReturn;
                SymbolDefs::FunctionDef::Argument arg;
                arg.value = 0;
                arg.symbol = context.symboltable->RegisterDeclaredVariable(LineColumn(), 0, false, false, VariableTypes::Object);
                def->arguments.push_back(arg);
                arg.value = 0;
                arg.symbol = context.symboltable->RegisterDeclaredVariable(LineColumn(), 0, false, false, VariableTypes::Boolean);
                def->arguments.push_back(arg);
        }
        RvaluePtrs parameters;
        parameters.push_back(ImCast(position, obj, VariableTypes::Object, false, false));
        parameters.push_back(ImConstantBoolean(position, is_rethrow));

        ImExecute(position, ImFunctionCall(position, symbol, parameters));
}

AST::Rvalue * AstCoder::ImGetThrowVariable(LineColumn const &position)
{
        Symbol* symbol = context.symboltable->ResolveSymbol(position, "__HS_GETRESETTHROWVAR", NULL, false);
        if (!symbol)
        {
                symbol = context.symboltable->RegisterNewCalledFunction(position, "__HS_GETRESETTHROWVAR", false);
                SymbolDefs::FunctionDef *def = Adopt(new SymbolDefs::FunctionDef);
                symbol->functiondef = def;
                def->returntype = VariableTypes::Object;
        }
        RvaluePtrs parameters;
        return ImFunctionCall(position, symbol, parameters);
}

AST::Rvalue * AstCoder::ImGetAsyncContextModifier(LineColumn const &position, AST::Rvalue *asynccontext, AST::Rvalue *skipframes)
{
        std::string name = asynccontext ? "__HS_INTERNAL_ADDASYNCCONTEXT" : "__HS_INTERNAL_REMOVEASYNCCONTEXT";
        Symbol* symbol = context.symboltable->ResolveSymbol(position, name, NULL, false);
        if (!symbol)
        {
                symbol = context.symboltable->RegisterNewCalledFunction(position, name, false);
                SymbolDefs::FunctionDef *def = Adopt(new SymbolDefs::FunctionDef);
                symbol->functiondef = def;
                def->returntype = VariableTypes::NoReturn;
                if (asynccontext)
                {
                        SymbolDefs::FunctionDef::Argument arg;
                        arg.value = 0;
                        arg.symbol = context.symboltable->RegisterDeclaredVariable(LineColumn(), 0, false, false, VariableTypes::Object);
                        def->arguments.push_back(arg);
                        arg.value = 0;
                        arg.symbol = context.symboltable->RegisterDeclaredVariable(LineColumn(), 0, false, false, VariableTypes::Integer);
                        def->arguments.push_back(arg);
                }
        }

        RvaluePtrs parameters;
        if (asynccontext)
        {
               parameters.push_back(asynccontext);
               parameters.push_back(skipframes);
        }
        return ImFunctionCall(position, symbol, parameters);
}

Symbol* AstCoder::ImPropertyAccessFunction(LineColumn const &position, Symbol *objtype, std::string const &name, AST::LvalueLayers const &lvaluelayers, bool setter)
{
        std::string func_name = objtype->name + (setter ? "#SET#" : "#GET#") + name;

        Symbol *symbol = 0;

        context.symboltable->EnterCustomScope(objtype->objectdef, position);
        symbol = context.symboltable->RegisterNewCalledFunction(position, func_name, true);
        context.symboltable->LeaveScope(position);

        SymbolDefs::FunctionDef *def = Adopt(new SymbolDefs::FunctionDef);
        symbol->functiondef = def;
        symbol->functiondef->flags = FunctionFlags::ObjectMember;
        symbol->state = SymbolState::Declared;
        symbol->definitionposition = position;

        context.symboltable->EnterScope(position);

        Symbol *symbol_this = context.symboltable->RegisterForwardSymbol(position, ":THIS", SymbolType::Variable, true, false);

        SymbolDefs::FunctionDef::Argument mem_arg;
        mem_arg.symbol = symbol_this;
        mem_arg.symbol->variabledef->type = VariableTypes::Object;
        mem_arg.symbol->variabledef->objectdef = objtype->objectdef;
        mem_arg.value = 0;
        symbol->functiondef->arguments.push_back(mem_arg);
        context.symboltable->RegisterDeclaredVariable(LineColumn(), mem_arg.symbol, false, false, VariableTypes::Object);

        AST::ConvertedLvalue clvalue;
        clvalue.exprpos = position;
        clvalue.basevar = symbol_this;
        clvalue.base = ImVariable(lvaluelayers[0].position, symbol_this);
        clvalue.first_layer_is_objectref = true;
        clvalue.layers = lvaluelayers;

        SymbolDefs::FunctionDef::Argument val_arg;
        if (setter)
        {
                val_arg.symbol = context.symboltable->RegisterForwardSymbol(position, "VALUE", SymbolType::Variable, true, false);
                val_arg.symbol->variabledef->type = VariableTypes::Variant;
                val_arg.symbol->variabledef->objectdef = objtype->objectdef;
                val_arg.value = 0;
                symbol->functiondef->arguments.push_back(val_arg);
                context.symboltable->RegisterDeclaredVariable(LineColumn(), val_arg.symbol, false, false, VariableTypes::Variant);

                symbol->functiondef->returntype = VariableTypes::NoReturn;

                // Well, build the function body
                ImOpenFunction(position, symbol);

                Block* workblock = Adopt(new Block(position));
                AST::ExpressionBlock *lvalue = ImLvalue(position, clvalue, 0, workblock, false);

                ImOpenBlock(workblock);
                ImExecute(position,
                    ImAssignment(position,
                        ImVariable(lvalue->returnvar->position, lvalue->returnvar->symbol),
                        ImVariable(position, val_arg.symbol)));
                ImCloseBlock(); // workblock

                ImExecute(position, lvalue);

                ImCloseFunction(position);
        }
        else
        {
                symbol->functiondef->returntype = VariableTypes::Variant;

                // Well, build the function body
                ImOpenFunction(position, symbol);

                ImReturn(position, LvalueToRvalue(clvalue, clvalue.layers.end()));

                ImCloseFunction(position);
        }

        context.symboltable->LeaveScope(position);
        return symbol;
}

} // end of namespace compiler
} // end of namespace HareScript
