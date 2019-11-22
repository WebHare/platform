//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

/** Translate complex nodes (not SQL) like FOREVERY and SWITCH to code that
    implements them. */

#include <blex/logfile.h>
#include "astcomplexnodetranslator.h"
#include "utilities.h"
#include "debugprints.h"

namespace HareScript
{
namespace Compiler
{

using namespace AST;

ASTComplexNodeTranslator::ASTComplexNodeTranslator(CompilerContext &context, AstCoder *coder, TypeStorage &typestorage, SemanticChecker &semanticchecker, Opt_ConstantsArithmatic::Opt_ConstantsArithmatic &opt_carim)
: context(context)
, coder(coder)
, typestorage(typestorage)
, semanticchecker(semanticchecker)
, opt_carim(opt_carim)
, copier(context)
, lengthvalue(NULL)
, currentfunction(nullptr)
{
}

ASTComplexNodeTranslator::~ASTComplexNodeTranslator()
{
}

Symbol * ASTComplexNodeTranslator::GetFunctionObjectMemberIsSimple(LineColumn position)
{
        std::string invoke_func = ":OBJECTMEMBERISSIMPLE";

        Symbol* symbol = context.symboltable->ResolveSymbol(position, invoke_func, NULL, false);
        if (!symbol)
        {
                symbol = context.symboltable->RegisterNewCalledFunction(position, invoke_func, false);

                SymbolDefs::FunctionDef *def = Adopt(new SymbolDefs::FunctionDef);
                symbol->functiondef = def;
                def->returntype = VariableTypes::Boolean;
                SymbolDefs::FunctionDef::Argument arg;
                arg.value = 0;
                arg.symbol = context.symboltable->RegisterDeclaredVariable(position, 0, false, false, VariableTypes::Object);
                def->arguments.push_back(arg);
                arg.symbol = context.symboltable->RegisterDeclaredVariable(position, 0, false, false, VariableTypes::String);
                def->arguments.push_back(arg);
        }
        return symbol;
}

AST::Variable * ASTComplexNodeTranslator::EnsureStoredInVariable(LineColumn const &position, AST::Rvalue *expr)
{
        if (Variable *var = dynamic_cast< Variable * >(expr))
            return var;

        Symbol *newvar = context.symboltable->RegisterDeclaredVariable(position, NULL, false, false, VariableTypes::Uninitialized);
        Rvalue *assign =
            coder->ImAssignment(position,
                coder->ImVariable(position, newvar),
                expr);

        semanticchecker.Visit(assign, false);
        Visit(assign, Empty());

        coder->ImExecute(position, assign);
        return coder->ImVariable(position, newvar);
}

void ASTComplexNodeTranslator::V_BinaryOperator(BinaryOperator *obj, Empty)
{
        Visit(obj->lhs, Empty());
        Visit(obj->rhs, Empty());

        if (obj->operation != BinaryOperatorType::OpNullCoalesce)
          return;

        LineColumn pos = obj->position;
        Symbol *retval = context.symboltable->RegisterDeclaredVariable(pos, NULL, false, false, typestorage[obj]);
        ExpressionBlock* eblock = Adopt(new ExpressionBlock(pos, Adopt(new Block(pos)), coder->ImVariable(pos, retval)));

        coder->ImOpenBlock(eblock->block);

        // retval = obj->lhs
        coder->ImExecute(obj->position,
                coder->ImAssignment(obj->position,
                        coder->ImVariable(obj->position, retval),
                        obj->lhs));

        std::string invoke_func = ":ISDEFAULTVALUE";
        Symbol* symbol = context.symboltable->ResolveSymbol(pos, invoke_func, NULL, false);
        if (!symbol)
        {
                symbol = context.symboltable->RegisterNewCalledFunction(pos, invoke_func, false);

                SymbolDefs::FunctionDef *def = Adopt(new SymbolDefs::FunctionDef);
                symbol->functiondef = def;
                def->returntype = VariableTypes::Boolean;
                SymbolDefs::FunctionDef::Argument arg;
                arg.value = 0;
                arg.symbol = context.symboltable->RegisterDeclaredVariable(pos, 0, false, false, VariableTypes::Variant);
                def->arguments.push_back(arg);
        }

        RvaluePtrs params(1, coder->ImVariable(obj->position, retval));
        coder->ImIf_Open(pos,
                coder->ImFunctionCall(obj->position, symbol, params));
        // retval = obj->rhs
        coder->ImExecute(obj->position,
                coder->ImAssignment(obj->position,
                        coder->ImVariable(obj->position, retval),
                        obj->rhs));
        coder->ImIf_Close(pos);

        coder->ImCloseBlock();

        Visit(eblock, Empty());

        ReplacePtr(eblock);
}


void ASTComplexNodeTranslator::V_ForEveryStatement(ForEveryStatement *obj, Empty)
{
        Visit(obj->source, Empty());
        Visit(obj->loop, Empty());
        Visit(obj->positionvar, Empty());

        Block *block = Adopt(new Block(obj->position));
        ReplacePtr(block);

        coder->ImOpenBlock(block);

        /* The translation is as follows:

           FOREVERY ([type] Var FROM List) Statement
           => position := 0;
              listcopy := list;
              len := LENGTH(listcopy)
              IMFOR(position < len; position := position + 1)
              {
                [type] var := listcopy[position];
                Statement
              } */

        Symbol *f_length = context.symboltable->RetrieveExternalFunction(obj->position, "LENGTH");
        Symbol *len = context.symboltable->RegisterDeclaredVariable (obj->position, 0, false, false, VariableTypes::Integer);
        Symbol *listcopy = context.symboltable->RegisterDeclaredVariable (
                obj->position, 0, false, false,
                static_cast<VariableTypes::Type>(obj->iteratevar->symbol->variabledef->type | VariableTypes::Array));

        // position := 0
        coder->CodeInitialize(obj->positionvar->symbol);

        // listcopy := obj->source
        coder->ImExecute(obj->position,
                coder->ImAssignment(obj->position,
                        coder->ImVariable(obj->position, listcopy),
                        obj->source));

        // len := length(listcopy)
        RvaluePtrs len_call_params(1, coder->ImVariable(obj->position, listcopy));
        coder->ImExecute(obj->position,
                coder->ImAssignment(obj->position,
                        coder->ImVariable(obj->position, len),
                        coder->ImFunctionCall(obj->position, f_length, len_call_params))); //

        //IMFOR (position < len; position := position + 1)
        coder->ImFor_Open(obj->position, coder->ImBinaryOperator(
                                        obj->position,
                                        BinaryOperatorType::OpLess,
                                        coder->ImVariable(obj->position, obj->positionvar->symbol),
                                        coder->ImVariable(obj->position, len)
                                ),
                         coder->ImAssignment
                             ( obj->position,
                               coder->ImVariable(obj->position, obj->positionvar->symbol),
                               coder->ImBinaryOperator(obj->position, BinaryOperatorType::OpAdd,
                                            coder->ImVariable(obj->position, obj->positionvar->symbol),
                                            coder->ImConstantInteger(obj->position, 1)
                                        )
                             )
                        );

        // var := listcopy[position];
        coder->ImExecute(obj->position, coder->ImAssignment
                               ( obj->position,
                                 coder->ImVariable(obj->iteratevar->position, obj->iteratevar->symbol),
                                 coder->ImArrayElementConst(
                                               obj->position,
                                               coder->ImVariable(obj->position, listcopy),
                                               coder->ImVariable(obj->position, obj->positionvar->symbol)
                                          )
                               )

                          );

        coder->DoCodeBlock(obj->loop);

        // And end the loop..
        coder->ImFor_Close(obj->position);

        coder->ImCloseBlock();

        // Visit block to replace array ops
        Visit(block, Empty());
}

void ASTComplexNodeTranslator::SwitchElts(LineColumn pos, Symbol *value, SwitchList::iterator begin, SwitchList::iterator end)
{
        unsigned distance = std::distance(begin, end);
        if (distance == 1)
        {
                if (begin->second)
                    coder->DoCodeBlock(begin->second);
        }
        else if (distance != 0)
        {
                SwitchList::iterator middle = begin + (distance / 2);

                coder->ImIf_Open(pos,
                        coder->ImBinaryOperator(pos,
                                BinaryOperatorType::OpGreaterEqual,
                                coder->ImVariable(pos, value),
                                coder->ImConstantInteger(pos, (middle-1)->first)));
                SwitchElts(pos, value, middle, end);
                coder->ImIf_Else(pos);
                SwitchElts(pos, value, begin, middle);
                coder->ImIf_Close(pos);
        }
}

void ASTComplexNodeTranslator::V_SwitchStatement(SwitchStatement *obj, Empty)
{
        Visit(obj->value, Empty());
        if (obj->defaultcase) Visit(obj->defaultcase, Empty());
        for (AST::SwitchStatement::CaseList::iterator it = obj->cases.begin(); it != obj->cases.end(); ++it)
        {
                for (std::vector< Rvalue * >::iterator it2 = it->first.begin(); it2 != it->first.end(); ++it2)
                    Visit(*it2, Empty());
                Visit(it->second, Empty());
        }

        if (obj->cases.empty() && obj->defaultcase)
        {
                ReplacePtr(obj->defaultcase);
                return;
        }

        Block *block = Adopt(new Block(obj->position));
        ReplacePtr(block);

        if (obj->cases.empty())
            return; // inv: obj->defaultcase == 0

        coder->ImOpenBlock(block);

        StackMachine &stackm(context.stackm);

        VariableTypes::Type type = typestorage[obj->cases[0].first[0]];

        VarId list = stackm.NewHeapVariable();
        stackm.ArrayInitialize(list, 0, ToArray(type));

        SwitchList stats;
        stats.push_back(SwitchList::value_type(0, obj->defaultcase));

        unsigned idx = 0;

        for (SwitchStatement::CaseList::iterator it = obj->cases.begin(); it != obj->cases.end(); ++it)
        {
                for (std::vector< Rvalue * >::iterator it2 = it->first.begin(); it2 != it->first.end(); ++it2)
                {
                        Constant *con = dynamic_cast< Constant * >(*it2);

                        if (!con) // Panic problem; semantic checker should have weeded this out
                            throw Message(true, Error::InternalError, "Constant expression was needed in switch, error not detected by semantic check");

                        VarId elt = stackm.ArrayElementAppend(list);
                        stackm.CopyFrom(elt, con->var);
                }
                idx += it->first.size();
                Block *block = it->second;
                stats.push_back(SwitchList::value_type(idx, block));
        }

        Symbol *f_searchelement = context.symboltable->RetrieveExternalFunction(obj->position, "SEARCHELEMENT");

        RvaluePtrs parameters;
        parameters.push_back(coder->ImConstant(obj->position, list));
        parameters.push_back(obj->value);
        // Extra third parameter is filled in by the semantich checker

        Symbol *val_symbol = context.symboltable->RegisterDeclaredVariable (obj->position, 0, false, false, VariableTypes::Integer);
        coder->ImExecute(obj->position,
                coder->ImAssignment(obj->position,
                        coder->ImVariable(obj->position, val_symbol),
                        coder->ImFunctionCall(obj->position,
                                f_searchelement,
                                parameters)));

        SwitchElts(obj->position, val_symbol, stats.begin(), stats.end());

        coder->ImCloseBlock();
}

void ASTComplexNodeTranslator::V_Function(Function *obj, Empty empty)
{
        currentfunction = obj;
        AllNodeVisitor::V_Function(obj, empty);
}

void ASTComplexNodeTranslator::V_FunctionPtr(AST::FunctionPtr *obj, Empty)
{
        bool is_vararg = obj->function->functiondef->flags & FunctionFlags::VarArg;

        //The semantic check will have verified the number of arguments, added defaults, etc
        LineColumn pos = obj->position;
        for (RvaluePtrs::iterator it = obj->bound_parameters.begin(); it != obj->bound_parameters.end(); ++it)
          if (*it)
             Visit(*it, Empty());

        /* Generate the proper function record */
        Symbol *retval = context.symboltable->RegisterDeclaredVariable(pos, NULL, false, false, VariableTypes::FunctionRecord);
        ExpressionBlock* eblock = Adopt(new ExpressionBlock(pos, Adopt(new Block(pos)), coder->ImVariable(pos, retval)));

        coder->ImOpenBlock(eblock->block);

        /* Function record structure

           cell VM
           cell LIBID
           cell FUNCTIONID
           cell RETURNTYPE
           cell EXCESSARGSTYPE: Type of excess parameters (for vararg)
           cell FIRSTUNUSEDSOURCE: first argument (1-based) that is treated as excess parameters (for vararg)
           cell PARAMETERS
             cell TYPE: required type for this parameter
             cell SOURCE = 0: use value, <0: optional parameter, >0: required parameter
             cell VALUE (optional, not when source > 0 or for vararg parameter)

        Resulting function must have parameters in order required - optional - vararg
        Binding must be in order required/fixed, optional, vararg.
        Rebinding of optional & varag parameters must be in increasing source order.
        */

        AST::ConstantRecord *baserec = coder->ImConstantRecord(pos);
        baserec->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "RETURNTYPE", coder->ImConstantInteger(pos, obj->function->functiondef->returntype)));
        baserec->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "EXCESSARGSTYPE", coder->ImConstantInteger(pos, obj->excessargstype)));
        baserec->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "FIRSTUNUSEDSOURCE", coder->ImConstantInteger(pos, obj->firstunusedsource)));

        AST::ConstantArray *params = coder->ImConstantArray(pos);
        params->type = VariableTypes::RecordArray;

        for (unsigned i=0;i<obj->passthrough_parameters.size();++i)
        {
                AST::ConstantRecord *param = coder->ImConstantRecord(pos);

                param->columns.push_back(
                    std::make_tuple(AST::ConstantRecord::Item, "SOURCE",
                        coder->ImConstantInteger(pos,
                            obj->bound_parameters[i]
                                ? -obj->passthrough_parameters[i]
                                : obj->passthrough_parameters[i])));

                if (obj->passthrough_parameters[i] != 0)
                {
                        VariableTypes::Type type = VariableTypes::Variant;
                        if (i < obj->function->functiondef->arguments.size() - is_vararg)
                            type = obj->function->functiondef->arguments[i].symbol->variabledef->type;

                        param->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "TYPE", coder->ImConstantInteger(pos, type)));
                }
                if (obj->bound_parameters[i])
                    param->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "VALUE", obj->bound_parameters[i]));

                params->values.push_back(std::make_tuple(pos, param, false));
        }

        baserec->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "PARAMETERS", params));

        Rvalue *optimized_baserec = baserec;
        semanticchecker.Visit(optimized_baserec, false);
        opt_carim.Optimize(optimized_baserec);

        // Get record with VM, LIBID and FUNCTIONID
        coder->ImExecute(pos,
            coder->ImAssignment(pos,
                coder->ImVariable(pos, retval),
                coder->ImCodeFunctionRef(pos, obj->function, optimized_baserec))); //ADDME: Can we learn to directly bind to the symbol?

        coder->ImCloseBlock();

        // Revisit to replace all recordcellsets ops.
//        semanticchecker.Visit(eblock, Empty()); // FIXME: *OBJECT* implementation: Needed for cell-operations-dispatching; it may not take the object-route
        Visit(eblock, Empty());

        ReplacePtr(eblock);
}

void ASTComplexNodeTranslator::V_FunctionPtrCall(AST::FunctionPtrCall *obj, Empty)
{
        // Get a record with the arguments
        AST::ConstantArray* args = coder->ImConstantArray(obj->position);
        args->type = VariableTypes::VariantArray;
        for (auto &itr: obj->params)
            args->values.push_back(std::make_tuple(itr->position, itr, false));

        // And translate it (quickest way to get that record)
        Rvalue *optimized_args = args;
        opt_carim.Optimize(optimized_args);

        std::string invoke_func = obj->allow_macro ? ":INVOKEFPTR" : ":INVOKEFPTRNM";

        Symbol* symbol = context.symboltable->ResolveSymbol(obj->position, invoke_func, NULL, false);
        if (!symbol)
        {
                symbol = context.symboltable->RegisterNewCalledFunction(obj->position, invoke_func, false);

                SymbolDefs::FunctionDef *def = Adopt(new SymbolDefs::FunctionDef);
                def->flags |= FunctionFlags::ExecutesHarescript;
                symbol->functiondef = def;
                def->returntype = VariableTypes::Variant;
                SymbolDefs::FunctionDef::Argument arg;
                arg.value = 0;
                arg.symbol = context.symboltable->RegisterDeclaredVariable(obj->position, 0, false, false, VariableTypes::VariantArray);
//                arg.symbol = context.symboltable->RegisterForwardSymbol(obj->position, ":params", SymbolType::Variable, true, false);
//                arg.symbol->variabledef->type = VariableTypes::Record;
                def->arguments.push_back(arg);
                arg.symbol = context.symboltable->RegisterDeclaredVariable(obj->position, 0, false, false, VariableTypes::FunctionRecord);
//                arg.symbol = context.symboltable->RegisterForwardSymbol(obj->position, ":functiondata", SymbolType::Variable, true, false);
//                arg.symbol->variabledef->type = VariableTypes::FunctionRecord;
                def->arguments.push_back(arg);
        }

        RvaluePtrs parameters;
        parameters.push_back(optimized_args);
        parameters.push_back(obj->functionptr);

        FunctionCall *call = coder->ImFunctionCall(obj->position, symbol, parameters);

        Visit(call, Empty());
        ReplacePtr(call);
}


void ASTComplexNodeTranslator::V_FunctionPtrRebind(AST::FunctionPtrRebind *obj, Empty)
{
        //The semantic check will have verified the number of arguments, added defaults, etc
        LineColumn pos = obj->position;
/*        for (RvaluePtrs::iterator it = obj->bound_parameters.begin(); it != obj->bound_parameters.end(); ++it)
          if (*it)
             Visit(*it, Empty());

        Visit(obj->orgptr, Empty());*/

        Symbol *f_rebindfunctiontr = context.symboltable->RetrieveExternalFunction(obj->position, "__HS_REBINDFUNCTIONPTR");

        StackMachine &stackm(context.stackm);
        VarId pt_list = stackm.NewHeapVariable();
        stackm.ArrayInitialize(pt_list, 0, VariableTypes::IntegerArray);


        /* Generate the proper function record */
        Symbol *retval = context.symboltable->RegisterDeclaredVariable(pos, NULL, false, false, VariableTypes::FunctionRecord);
        ExpressionBlock* eblock = Adopt(new ExpressionBlock(pos, Adopt(new Block(pos)), coder->ImVariable(pos, retval)));

        coder->ImOpenBlock(eblock->block);
        coder->CodeInitialize(retval);

        Symbol *bound_params = context.symboltable->RegisterDeclaredVariable(pos, NULL, false, false, VariableTypes::VariantArray);
        coder->CodeInitialize(bound_params);

        for (int i = 0, size = obj->passthrough_parameters.size(); i < size; ++i)
        {
                int32_t passthrough = obj->passthrough_parameters[i];
                Rvalue *arg = obj->bound_parameters[i];
                if (obj->bound_parameters[i])
                {
                        passthrough = -passthrough;
                        arg = obj->bound_parameters[i];
                }
                else
                    arg = coder->ImConstantBoolean(obj->position, false);

                VarId elt = stackm.ArrayElementAppend(pt_list);
                stackm.SetInteger(elt, obj->passthrough_parameters[i]);


                ArrayLocation loc(ArrayLocation::End);
                coder->ImArrayInsert(obj->position,
                        coder->ImVariable(obj->position, bound_params),
                        loc,
                        arg);
        }

        RvaluePtrs params;
        params.push_back(obj->orgptr);
        params.push_back(coder->ImConstant(obj->position, pt_list));
        params.push_back(coder->ImVariable(obj->position, bound_params));

        coder->ImExecute(pos,
            coder->ImAssignment(obj->position,
                    coder->ImVariable(obj->position, retval),
                    coder->ImFunctionCall(obj->position,
                            f_rebindfunctiontr,
                            params)));

        coder->ImCloseBlock();

        // Go and replace deeper
        Visit(eblock, Empty());
        ReplacePtr(eblock);
}


AST::Variable* ASTComplexNodeTranslator::GetLvalueVar(AST::Lvalue* val)
{
        AST::Variable* var = dynamic_cast<AST::Variable*>(val);
        if (!var)
        {
                AST::ExpressionBlock* eb = dynamic_cast<AST::ExpressionBlock*>(val);
                if (!eb)
                    throw std::runtime_error("Problem getting lvalue replacement variable");
                var = coder->ImVariable(eb->returnvar->position, eb->returnvar->symbol);
        }
        return var;
}

void ASTComplexNodeTranslator::V_End(AST::End *obj, Empty)
{
        if (!lengthvalue) //replace request
            throw Message(true, Error::InternalError, "Found END outside of array index (should have been disallowed by semantic check");

        Rvalue *var = coder->ImVariable(obj->position, lengthvalue);
        typestorage[var] = VariableTypes::Integer;
        ReplacePtr(var);
}

/** Rewrite for simple array index accesses, to handle indexes with END
*/
AST::Rvalue * ASTComplexNodeTranslator::ArrayExpressionEndRewrite(LineColumn position, AST::Rvalue *array, AST::Rvalue **index, VariableTypes::Type return_type, AST::ExpressionBlock **eblock)
{
        ArrayEndVisitor arrayendvisitor(context, coder, typestorage);
        if (arrayendvisitor.HasEnds(*index))
        {
                /* The index expression has an END expression.

                   Replace by an expression block that evaluates the array expression once, stores it in a variable,
                   then calculates the length based of that variable, and executes the ARRAYINDEX operation on
                   that variable too.
                */

                Symbol *retval = context.symboltable->RegisterDeclaredVariable(position, NULL, false, false, return_type);
                *eblock = Adopt(new ExpressionBlock(position, Adopt(new Block(position)), coder->ImVariable(position, retval)));

                // Open the block
                coder->ImOpenBlock((*eblock)->block);

                /* If the array is an expression, evaluate and store in temp variable (used twice, once for
                   length, once for operations. For simple variables, don't bother, use the variable
                */
                Symbol *arraysymbol;
                if (AST::Variable *arrayvar = dynamic_cast< AST::Variable * >(array))
                    arraysymbol = arrayvar->symbol;
                else
                {
                        arraysymbol = context.symboltable->RegisterDeclaredVariable(array->position, 0, false, false, typestorage[array]);
                        coder->ImExecute(position,
                                coder->ImAssignment(array->position,
                                        coder->ImVariable(array->position, arraysymbol),
                                        array));
                }

                // Store the old lengthvalue
                Symbol *old_lengthvalue = lengthvalue;

                // Emit calculation of length in current block
                lengthvalue = arrayendvisitor.CreateLengthSymbol(coder->ImVariable(array->position, arraysymbol));

                // Close the block, we're done for now (operation will be added by reopen)
                coder->ImCloseBlock();

                // Visit the index too, replace the END in the index by our new lengthvalue. Then restore the old lengthvalue
                Visit(*index, Empty());
                lengthvalue = old_lengthvalue;

                // Return a ref to the tempvar with the array contents
                return coder->ImVariable(array->position, arraysymbol);
        }

        Visit(*index, Empty());
        return array;
}


void ASTComplexNodeTranslator::V_ArrayElementConst (AST::ArrayElementConst *obj, Empty)
{
        // Figure out the return type
        VariableTypes::Type return_type = ToNonArray(typestorage[obj]);
        if (return_type == VariableTypes::Uninitialized)
        {
                // Obj was added in this pass, try to find out the type
                Variable *var = dynamic_cast< Variable * >(obj->array);
                if (var)
                    return_type = ToNonArray(var->symbol->variabledef->type);
                else // not known, Variant to be safe
                    return_type = VariableTypes::Variant;
        }

        // Inner replaces of the array go first
        Visit(obj->array, Empty());

        ExpressionBlock* eblock(0);
        Rvalue *index = obj->index;

        Rvalue *arrayexpr = ArrayExpressionEndRewrite(obj->position, obj->array, &index, return_type, &eblock);

        RvaluePtrs parameters;
        parameters.push_back(arrayexpr);
        parameters.push_back(index);

        BuiltinInstruction *newobj = Adopt(new BuiltinInstruction(
                        obj->position,
                        return_type,
                        ":ARRAYINDEX",
                        parameters,
                        false,
                        false));

        typestorage[newobj] = return_type;

        if (eblock)
        {
                // Place the ARRAYINDEX in our expression block too
                coder->ImOpenBlock(eblock->block);

                coder->ImExecute(obj->position,
                        coder->ImAssignment(obj->position,
                                coder->ImVariable(eblock->returnvar->position, eblock->returnvar->symbol),
                                newobj));

                coder->ImCloseBlock();

                ReplacePtr(eblock);
        }
        else
        {
                // Simple arrayindex, just return ARRAYINDEX
                ReplacePtr(newobj);
        }
}

void ASTComplexNodeTranslator::V_ArrayElementModify (AST::ArrayElementModify *obj, Empty)
{
        VariableTypes::Type return_type = typestorage[obj];
        if (return_type == VariableTypes::Uninitialized)
            return_type = VariableTypes::Variant;

        // Inner replaces of the array go first
        Visit(obj->array, Empty());

        ExpressionBlock* eblock(0);
        Rvalue *index = obj->index;

        Rvalue *arrayexpr = ArrayExpressionEndRewrite(obj->position, obj->array, &index, return_type, &eblock);

        Visit(obj->value, Empty());

        RvaluePtrs parameters;
        parameters.push_back(arrayexpr);
        parameters.push_back(index);
        parameters.push_back(obj->value);

        BuiltinInstruction *newobj = Adopt(new BuiltinInstruction(
                        obj->position,
                        VariableTypes::Variant,
                        ":ARRAYSET",
                        parameters,
                        false,
                        false)); //

        typestorage[newobj] = return_type;

        if (eblock)
        {
                // Place the ARRAYINDEX in our expression block too
                coder->ImOpenBlock(eblock->block);

                coder->ImExecute(obj->position,
                        coder->ImAssignment(obj->position,
                                coder->ImVariable(eblock->returnvar->position, eblock->returnvar->symbol),
                                newobj));

                coder->ImCloseBlock();

                ReplacePtr(eblock);
        }
        else
        {
                // Simple arrayindex, just return ARRAYINDEX
                ReplacePtr(newobj);
        }
}

void ASTComplexNodeTranslator::ArrayExpressionStatementEndRewrite(LineColumn position, AST::Variable *array, AST::Rvalue **index, AST::Block **block)
{
        ArrayEndVisitor arrayendvisitor(context, coder, typestorage);
        if (*index)
        {
                if (arrayendvisitor.HasEnds(*index))
                {
                        *block = Adopt(new Block(position));
                        coder->ImOpenBlock(*block);

                        // Store the old lengthvalue
                        Symbol *old_lengthvalue = lengthvalue;

                        // Emit calculation of length in current block
                        lengthvalue = arrayendvisitor.CreateLengthSymbol(coder->ImVariable(array->position, array->symbol));

                        // Close the block, we're done for now (operation will be added by reopen)
                        coder->ImCloseBlock();

                        // Visit the index too, replace the END in the index by our new lengthvalue. Then restore the old lengthvalue
                        Visit(*index, Empty());
                        lengthvalue = old_lengthvalue;
                }
                else
                {
                        // Visit the index expression
                        Visit(*index, Empty());
                }
        }
}

void ASTComplexNodeTranslator::V_ArrayDelete(AST::ArrayDelete *obj, Empty)
{
        Visit(obj->array, Empty());

        AST::Variable *array = GetLvalueVar(obj->array);
        AST::Rvalue *index = obj->location.expr;
        Block *block(0);

        ArrayExpressionStatementEndRewrite(obj->position, array, &index, &block);

        RvaluePtrs parameters;
        parameters.push_back(array);

        std::string name;

        switch (obj->location.type)
        {
        case AST::ArrayLocation::All:
            name = ":ARRAYDELETEALL"; break;
        case AST::ArrayLocation::Index:
            {
                    name = ":ARRAYDELETE";
                    parameters.push_back(index);
            } break;
        default:
            throw Message(true, Error::InternalError, "Unsupported location type found in translation of ArrayDelete");
        }

        Assignment *newobj = coder->ImAssignment(
                obj->position,
                copier.GetCopy(array),
                Adopt(new BuiltinInstruction(
                        obj->position,
                        array->symbol->variabledef->type,
                        name,
                        parameters,
                        false,
                        false)));

        if (block)
        {
                coder->ImOpenBlock(block);
                coder->ImExecute(obj->position, newobj);
                coder->ImCloseBlock();

                ReplacePtr(block);
        }
        else
            ReplacePtr(Adopt(new SingleExpression(obj->position, newobj)));
}

void ASTComplexNodeTranslator::V_ArrayInsert(AST::ArrayInsert *obj, Empty)
{
        Visit(obj->array, Empty());

        AST::Variable *array = GetLvalueVar(obj->array);
        AST::Rvalue *index = obj->location.expr;
        Block *block(0);

        ArrayExpressionStatementEndRewrite(obj->position, array, &index, &block);

        Visit(obj->value, Empty());

        RvaluePtrs parameters;
        parameters.push_back(array);

        std::string instrname;
        switch (obj->location.type)
        {
        case AST::ArrayLocation::End:
                {
                        instrname = ":ARRAYAPPEND";
                } break;
        case AST::ArrayLocation::Index:
                {
                        instrname = ":ARRAYINSERT";
                        parameters.push_back(index);
                } break;
        default:
            throw Message(true, Error::InternalError, "Unsupported location type found in translation of ArrayInsert");
        }

        parameters.push_back(obj->value);

        Assignment *newobj = coder->ImAssignment(
                obj->position,
                copier.GetCopy(array),
                Adopt(new BuiltinInstruction(
                        obj->position,
                        array->symbol->variabledef->type,
                        instrname,
                        parameters,
                        false,
                        false)));

        typestorage[newobj] = array->symbol->variabledef->type;

        if (block)
        {
                coder->ImOpenBlock(block);
                coder->ImExecute(obj->position, newobj);
                coder->ImCloseBlock();

                ReplacePtr(block);
        }
        else
            ReplacePtr(Adopt(new SingleExpression(obj->position, newobj)));
}

void ASTComplexNodeTranslator::RewriteDeepOperation(AST::DeepOperation *obj, AST::ArrayLocation *arrayloc)
{
        ArrayEndVisitor arrayendvisitor(context, coder, typestorage);

        bool arrayloc_has_ends = arrayloc && arrayloc->expr && arrayendvisitor.HasEnds(arrayloc->expr);
        bool any_end = arrayloc_has_ends;
        for (LvalueLayers::iterator it = obj->clvalue.layers.begin(); it != obj->clvalue.layers.end(); ++it)
            if (it->expr && arrayendvisitor.HasEnds(it->expr))
                any_end = true;

        /* Simple: only arrays/records
                   or object *member* variable
        */
        bool is_simple = obj->clvalue.layers[0].type != LvalueLayer::Object;
        bool via_this = false;
        if (!is_simple)
        {
                via_this = obj->clvalue.basevar && obj->clvalue.basevar->name == ":THIS";
                if (obj->clvalue.layers[0].is_member)
                    is_simple = true;
        }

        AST::DeepOperation *work_obj = obj;

        if (!is_simple)
        {
                // First layer is non-simple objectref. Extract it.
                work_obj = copier.GetCopy(obj);
                work_obj->clvalue.layers.erase(work_obj->clvalue.layers.begin());
                work_obj->clvalue.first_layer_is_objectref = false;

                AST::Variable *rootobj;

                // If the ref to object is an expression, visit & precalc it
                if (!obj->clvalue.basevar)
                {
                        Visit(obj->clvalue.base, Empty());
                        rootobj = EnsureStoredInVariable(obj->clvalue.base->position, obj->clvalue.base);
                }
                else
                    rootobj = coder->ImVariable(obj->position, obj->clvalue.basevar);

                // Original first layer
                LvalueLayer const &firstlayer = obj->clvalue.layers[0];

                // Initialize the basevar & the base of the new deep op
                VariableTypes::Type want_type = VariableTypes::Uninitialized;
                if (!work_obj->clvalue.layers.empty() && work_obj->clvalue.layers[0].type == LvalueLayer::Record)
                    want_type = VariableTypes::Record;

                LineColumn memberpos = obj->clvalue.layers[0].position;
                work_obj->clvalue.basevar = context.symboltable->RegisterDeclaredVariable(memberpos, 0, false, false, want_type);
                work_obj->clvalue.base = coder->ImVariable(memberpos, work_obj->clvalue.basevar);

                // Get the member value
                coder->ImExecute(firstlayer.position,
                    coder->ImAssignment(firstlayer.position,
                        coder->ImVariable(firstlayer.position, work_obj->clvalue.basevar),
                        coder->ImMemberOf(firstlayer.position,
                            coder->ImVariable(rootobj->position, rootobj->symbol),
                            firstlayer.name,
                            via_this,
                            firstlayer.next_token)));

                coder->ImStatement(work_obj);

                // For non-simple, we need to place the processed value back into the object member
                coder->ImObjectMemberSet(
                    firstlayer.position,
                    coder->ImVariable(rootobj->position, rootobj->symbol),
                    firstlayer.name,
                    coder->ImVariable(work_obj->clvalue.base->position, work_obj->clvalue.basevar),
                    via_this);

                AST::Block *currentblock = coder->GetCurrentBlock();
                semanticchecker.Visit(currentblock, true);
                Visit(currentblock, Empty());

                // Mark as rewritten
                obj->is_rewritten = true;
                return;
        }

        // Simple case: only record/array accesses

        bool record_rvalues = any_end;

        // Record rvalues when there is an inner object layer
        for (LvalueLayers::iterator it = work_obj->clvalue.layers.begin(); it != work_obj->clvalue.layers.end(); ++it)
            if (it->type == LvalueLayer::Object && it != work_obj->clvalue.layers.begin())
                record_rvalues = true;

        AST::Rvalue *current(0);
        if (record_rvalues)
            current = coder->ImVariable(work_obj->position, work_obj->clvalue.basevar);

        // last object layer (layer 0 is ignored, begin means no layer op pos 1+)
        LvalueLayers::iterator last_object_layer = work_obj->clvalue.layers.begin();
        AST::Rvalue *last_object = 0;

        for (LvalueLayers::iterator it = work_obj->clvalue.layers.begin(); it != work_obj->clvalue.layers.end(); ++it)
        {
                if (it->expr) // array index
                {
                        // Store the old lengthvalue
                        Symbol *old_lengthvalue = lengthvalue;

                        // Any end? Calculate the length
                        if (arrayendvisitor.HasEnds(it->expr))
                        {
                                AST::Variable *currentasvar = EnsureStoredInVariable(current->position, current);
                                current = currentasvar;

                                // Emit calculation of length in current block
                                lengthvalue = arrayendvisitor.CreateLengthSymbol(coder->ImVariable(currentasvar->position, currentasvar->symbol));
                        }

                        // Replace all ENDs before storing it a variable
                        Visit(it->expr, Empty());
                        //it->expr = EnsureStoredInVariable(it->expr->position, it->expr);

                        lengthvalue = old_lengthvalue;

                        if (current)
                            current = coder->ImArrayElementConst(it->position, current, copier.GetCopy(it->expr));
                }
                else
                {
                        it->expr = coder->ImConstantString(it->position, it->name);

                        if (current)
                        {
                                if (it->type == LvalueLayer::Record)
                                    current = coder->ImColumnOf(it->position, current, it->name);
                                else
                                {
                                        last_object = current;
                                        last_object_layer = it;

                                        current = coder->ImMemberOf(it->position, current, it->name, it->is_member, it->next_token);
                                }
                        }
                }
        }

        if (last_object_layer != work_obj->clvalue.layers.begin())
        {
                // Extract all layers until the last object layer
                coder->ImExecute(obj->position,
                        coder->ImAssignment(obj->position,
                                coder->ImVariable(obj->position, work_obj->clvalue.basevar),
                                last_object));

                work_obj->clvalue.layers.erase(work_obj->clvalue.layers.begin(), last_object_layer);
        }

        if (arrayloc && arrayloc->expr)
        {
                // Store the old lengthvalue
                Symbol *old_lengthvalue = lengthvalue;

                if (arrayloc_has_ends)
                {
                        AST::Variable *currentasvar = EnsureStoredInVariable(current->position, current);
                        current = currentasvar;

                        lengthvalue = arrayendvisitor.CreateLengthSymbol(coder->ImVariable(currentasvar->position, currentasvar->symbol));
                }

                Visit(arrayloc->expr, Empty());

                lengthvalue = old_lengthvalue;
        }

        AST::Block *currentblock = coder->GetCurrentBlock();
        semanticchecker.Visit(currentblock, true);

        // Mark original as rewritten, code work object
        obj->is_rewritten = true;
        coder->ImStatement(work_obj);
}

void ASTComplexNodeTranslator::V_DeepArrayDelete(AST::DeepArrayDelete *obj, Empty)
{
        if (obj->is_rewritten)
            return;

        if (obj->clvalue.layers.empty())
        {
                // Equivalent to normal array insert
                AST::ArrayDelete *delstatement = Adopt(new AST::ArrayDelete(
                      obj->position,
                      coder->ImVariable(obj->position, obj->clvalue.basevar),
                      obj->location));

                // Tailcall, will replace the current node
                semanticchecker.Visit(delstatement, false);
                V_ArrayDelete(delstatement, Empty());
        }
        else
        {
                Block* block = Adopt(new Block(obj->position));
                coder->ImOpenBlock(block);

                RewriteDeepOperation(obj, &obj->location);

                coder->ImCloseBlock(); // workblock

                Statement *statement = block;
                semanticchecker.Visit(statement, false);
                Visit(statement, Empty());

                ReplacePtr(statement);
        }
}

void ASTComplexNodeTranslator::V_DeepArrayInsert(AST::DeepArrayInsert *obj, Empty)
{
        if (obj->is_rewritten)
            return;

        Visit(obj->value, Empty());

        if(obj->location.expr && dynamic_cast<AST::End*>(obj->location.expr)) //this is the simple AT END case. optimize it away
        {
                obj->location.type = ArrayLocation::End;
                obj->location.expr = NULL;
        }

        if (obj->clvalue.layers.empty())
        {
                // Equivalent to normal array insert
                AST::ArrayInsert * insert = Adopt(new AST::ArrayInsert(
                      obj->position,
                      coder->ImVariable(obj->position, obj->clvalue.basevar),
                      obj->location,
                      obj->value));

                // Tailcall, will replace the current node
                semanticchecker.Visit(insert, false);
                V_ArrayInsert(insert, Empty());
        }
        else
        {
                Block* block = Adopt(new Block(obj->position));
                coder->ImOpenBlock(block);

                // If top layer is an object, the op will be duplicated; precalc vals in that case
                if (obj->clvalue.first_layer_is_objectref)
                {
                        //obj->value = EnsureStoredInVariable(obj->value->position, obj->value);
                        //if (obj->location.expr)
                            //obj->location.expr = EnsureStoredInVariable(obj->location.expr->position, obj->location.expr);
                }

                RewriteDeepOperation(obj, &obj->location);

                coder->ImCloseBlock(); // workblock

                Statement *statement = block;
                semanticchecker.Visit(statement, false);
                Visit(statement, Empty());

                ReplacePtr(statement);
        }
}

void ASTComplexNodeTranslator::V_LvalueSet(AST::LvalueSet *obj, Empty)
{
        if (obj->is_rewritten)
            return;

        Visit(obj->value, Empty());

        AST::Statement *statement = 0;
        if (obj->clvalue.layers.empty())
        {
                // Equivalent to direct assignment
                statement = Adopt(
                    new SingleExpression(
                        obj->position,
                        coder->ImAssignment(obj->position,
                            coder->ImVariable(obj->position, obj->clvalue.basevar),
                            obj->value)));
        }
        else if (obj->clvalue.layers.size() == 1)
        {
                if (obj->clvalue.layers[0].type == LvalueLayer::Array)
                {
                        // Equivalent to array[idx] := x
                        statement = Adopt(
                            new SingleExpression(
                                obj->position,
                                coder->ImAssignment(obj->position,
                                    coder->ImVariable(obj->position, obj->clvalue.basevar),
                                        Adopt(new AST::ArrayElementModify(
                                              obj->clvalue.layers[0].position,
                                              coder->ImVariable(obj->position, obj->clvalue.basevar),
                                              obj->clvalue.layers[0].expr,
                                              obj->value)))));

                        // FIXME: only use of ArrayElementModify in whole compiler, inline it here?
                }
                else if (obj->clvalue.layers[0].type == LvalueLayer::Record)
                {
                        // Equivalent to record.name := x
                        AST::RecordCellSet *set = Adopt(new AST::RecordCellSet(
                              obj->clvalue.layers[0].position,
                              coder->ImVariable(obj->position, obj->clvalue.basevar),
                              obj->clvalue.layers[0].name,
                              obj->value,
                              false,
                              true));

                        statement =
                            Adopt(new SingleExpression(
                                obj->position,
                                coder->ImAssignment(obj->position,
                                    coder->ImVariable(obj->position, obj->clvalue.basevar),
                                    set)));
                }
                else if (obj->clvalue.layers[0].type == LvalueLayer::Object)
                {
                        // Equivalent to object->name := x
                        statement = Adopt(new ObjectMemberSet(
                            obj->clvalue.layers[0].position,
                            coder->ImVariable(obj->position, obj->clvalue.basevar),
                            obj->clvalue.layers[0].name,
                            obj->value,
                            obj->clvalue.layers[0].via_this));
                }
        }
        else
        {
                Block* block = Adopt(new Block(obj->position));
                coder->ImOpenBlock(block);

                //if (obj->clvalue.first_layer_is_objectref)
                    //obj->value = EnsureStoredInVariable(obj->value->position, obj->value);
                RewriteDeepOperation(obj, NULL);

                coder->ImCloseBlock(); // workblock

                statement = block;
        }

        semanticchecker.Visit(statement, false);
        Visit(statement, Empty());
        ReplacePtr(statement);
}

void ASTComplexNodeTranslator::V_RecordColumnConst(AST::RecordColumnConst *obj, Empty)
{
        Visit(obj->record, Empty());
}

void ASTComplexNodeTranslator::V_ObjectExtend(AST::ObjectExtend *obj, Empty)
{
        Visit(obj->object, Empty());
        for (auto &itr: obj->parameters)
            Visit(itr, Empty());

        Block *block = Adopt(new Block(obj->position));
        ReplacePtr(block);

        coder->ImOpenBlock(block);

        AST::Variable *objcopy = coder->ImStoreInVariable(obj->object->position, obj->object);

        coder->ImCodeObjectNonStaticTest(obj->object->position, coder->ImCopyVariable(objcopy), obj->via_this);
        coder->ImCodeNew(obj->position, obj->extendwith, coder->ImCopyVariable(objcopy), obj->parameters);

        coder->ImCloseBlock();
}

void ASTComplexNodeTranslator::V_ObjectTypeUID(AST::ObjectTypeUID *obj, Empty)
{
        std::string uid = obj->objtype->objectdef->uids.empty() ? std::string() : obj->objtype->objectdef->uids.back();
        Rvalue *str = coder->ImConstantString(obj->position, uid);
        ReplacePtr(str);
}

void ASTComplexNodeTranslator::CodeNormalYieldHandling(Yield *obj, Rvalue *yieldret_rvalue, Symbol *retval)
{
        RvaluePtrs params;
        params.push_back(obj->generator);
        params.push_back(yieldret_rvalue);

        BuiltinInstruction *newobj = Adopt(new BuiltinInstruction(
                        obj->position,
                        VariableTypes::Record,
                        ":YIELD",
                        params,
                        true,
                        true));

        Symbol *yieldres = context.symboltable->RegisterDeclaredVariable(obj->position, NULL, false, false, VariableTypes::Record);

        // yieldres := :YIELD(yieldexpr)
        coder->ImExecute(obj->position,
                coder->ImAssignment(obj->position,
                        coder->ImVariable(obj->position, yieldres),
                        newobj/*coder->ImFunctionCall(obj->position, symbol, params)*/));

        // typevar := yieldres.type
        Symbol *typevar = context.symboltable->RegisterDeclaredVariable(obj->position, NULL, false, false, VariableTypes::Integer);
        coder->ImExecute(obj->position,
                coder->ImAssignment(obj->position,
                        coder->ImVariable(obj->position, typevar),
                        coder->ImColumnOf(
                            obj->position,
                            coder->ImVariable(obj->position, yieldres),
                            "TYPE")));

        // retval := yieldres.value
        coder->ImExecute(obj->position,
                coder->ImAssignment(obj->position,
                        coder->ImVariable(obj->position, retval),
                        coder->ImColumnOf(
                            obj->position,
                            coder->ImVariable(obj->position, yieldres),
                            "VALUE")));

        // IF (typevar != 0)
        coder->ImIf_Open(obj->position,
            coder->ImBinaryOperator(
                obj->position,
                BinaryOperatorType::OpUnEqual,
                coder->ImVariable(obj->position, typevar),
                coder->ImConstantInteger(obj->position, 0))); // also used for return in try-finally resolution

        //   IF (typevar = 1)
        coder->ImIf_Open(obj->position,
            coder->ImBinaryOperator(
                obj->position,
                BinaryOperatorType::OpEqual,
                coder->ImVariable(obj->position, typevar),
                coder->ImConstantInteger(obj->position, 1))); // also used for return in try-finally resolution

        //   THROW retval
        coder->ImThrow(obj->position, coder->ImVariable(obj->position, retval), false);

        coder->ImIf_Else(obj->position);

        //   RETURN [ done := TRUE, value := retval ]
        {
                Rvalue *retvalrec_rvalue = 0;
                if (currentfunction->symbol->functiondef->isasync)
                {
                        RvaluePtrs params(1, coder->ImVariable(obj->position, retval));
                        retvalrec_rvalue = coder->ImObjectMethodCall(
                            obj->position,
                            coder->ImVariable(obj->position, currentfunction->symbol->functiondef->generator),
                            "RETURNVALUE",
                            true,
                            params,
                            false,
                            std::vector< int32_t >());
                }
                else
                {
                        AST::ConstantRecord *retvalrec = coder->ImConstantRecord(obj->position);
                        retvalrec->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "DONE", coder->ImConstantBoolean(obj->position, true)));
                        retvalrec->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "VALUE", coder->ImVariable(obj->position, retval)));

                        retvalrec_rvalue = retvalrec;
                }

                semanticchecker.Visit(retvalrec_rvalue, false);
                opt_carim.Optimize(retvalrec_rvalue);

                coder->ImReturn(obj->position, retvalrec_rvalue);
        }

        coder->ImIf_Close(obj->position);

        coder->ImIf_Close(obj->position);
}

void ASTComplexNodeTranslator::V_Yield(Yield *obj, Empty)
{
        Visit(obj->yieldexpr, Empty());

        LineColumn pos = obj->position;
        Symbol *retval = context.symboltable->RegisterDeclaredVariable(pos, NULL, false, false, typestorage[obj]);
        ExpressionBlock* eblock = Adopt(new ExpressionBlock(pos, Adopt(new Block(pos)), coder->ImVariable(pos, retval)));

        coder->ImOpenBlock(eblock->block);

        if (obj->isawait)
        {
                RvaluePtrs params;
                params.push_back(obj->yieldexpr);

                Symbol *generator_res = context.symboltable->RegisterDeclaredVariable(obj->position, NULL, false, false, VariableTypes::Record);

                // generator_res := generator->SendAwait(obj->yieldexpr)
                coder->ImExecute(obj->position,
                        coder->ImAssignment(obj->position,
                                coder->ImVariable(obj->position, generator_res),
                                coder->ImObjectMethodCall(
                                    pos,
                                    copier.GetCopy(obj->generator),
                                    "SENDAWAIT",
                                    true,
                                    params,
                                    false,
                                    std::vector< int32_t >())));

                // retval := generator_res.value
                coder->ImExecute(obj->position,
                        coder->ImAssignment(obj->position,
                                coder->ImVariable(obj->position, retval),
                                coder->ImColumnOf(
                                    obj->position,
                                    coder->ImVariable(obj->position, generator_res),
                                    "VALUE")));

                // IF (generator_res.yield)
                coder->ImIf_Open(obj->position,
                        coder->ImColumnOf(obj->position,
                                coder->ImVariable(obj->position, generator_res),
                                "YIELDVALUE"));

                CodeNormalYieldHandling(obj, coder->ImVariable(obj->position, retval), retval);

                coder->ImIf_Close(obj->position);
        }
        else if (!obj->star) // yield
        {
                Rvalue *yieldret_rvalue = obj->yieldexpr;

                if (obj->isasync)
                {
                        Symbol *generator_res = context.symboltable->RegisterDeclaredVariable(obj->position, NULL, false, false, VariableTypes::Variant);

                        RvaluePtrs params;
                        params.push_back(obj->yieldexpr);

                        // generator_res := generator->SendAwait(obj->yieldexpr)
                        coder->ImExecute(obj->position,
                                coder->ImAssignment(obj->position,
                                        coder->ImVariable(obj->position, generator_res),
                                        coder->ImObjectMethodCall(
                                            pos,
                                            copier.GetCopy(obj->generator),
                                            "SENDYIELD",
                                            true,
                                            params,
                                            false,
                                            std::vector< int32_t >())));

                        yieldret_rvalue = coder->ImVariable(obj->position, generator_res);
                }
                else if (obj->wrapped)
                {
                        AST::ConstantRecord *yieldret = coder->ImConstantRecord(pos);
                        yieldret->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "DONE", coder->ImConstantBoolean(pos, false)));
                        yieldret->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "VALUE", obj->yieldexpr));

                        yieldret_rvalue = yieldret;
                        semanticchecker.Visit(yieldret_rvalue, false);
                        opt_carim.Optimize(yieldret_rvalue);
                }

                CodeNormalYieldHandling(obj, yieldret_rvalue, retval);
        }
        else
        {
                Symbol* f_convert = context.symboltable->ResolveSymbol(obj->position, "__HS_CONVERTTOITERATOR", NULL, false);
                if (!f_convert)
                {
                        f_convert = context.symboltable->RegisterNewCalledFunction(obj->position, "__HS_CONVERTTOITERATOR", false);
                        SymbolDefs::FunctionDef *def = Adopt(new SymbolDefs::FunctionDef);
                        f_convert->functiondef = def;
                        def->returntype = VariableTypes::Object;
                        SymbolDefs::FunctionDef::Argument arg;
                        arg.value = 0;
                        arg.symbol = context.symboltable->RegisterDeclaredVariable(LineColumn(), 0, false, false, VariableTypes::Variant);
                        def->arguments.push_back(arg);
                }

                // generator := obj->generator // need private copy for multiple uses
                Symbol *generator = context.symboltable->RegisterDeclaredVariable(obj->position, NULL, false, false, VariableTypes::Object);
                coder->ImExecute(obj->position,
                        coder->ImAssignment(obj->position,
                                coder->ImVariable(obj->position, generator),
                                obj->generator));


                // iterator := __HS_CONVERTTOITERATOR(obj->yieldexpr)
                Symbol *iterator = context.symboltable->RegisterDeclaredVariable(obj->position, NULL, false, false, VariableTypes::Object);
                RvaluePtrs convert_iterator_params(1, obj->yieldexpr);
                coder->ImExecute(obj->position,
                        coder->ImAssignment(obj->position,
                                coder->ImVariable(obj->position, iterator),
                                coder->ImFunctionCall(obj->position, f_convert, convert_iterator_params)));

                // received := [ type := 0, value := DEFAULT RECORD ]
                Symbol *received = context.symboltable->RegisterDeclaredVariable(obj->position, NULL, false, false, VariableTypes::Record);

                AST::ConstantRecord *initial_received = coder->ImConstantRecord(obj->position);
                initial_received->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "TYPE", coder->ImConstantInteger(obj->position, 0)));
                initial_received->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "VALUE", coder->ImConstantRecord(obj->position)));

                Rvalue *optimized_initial_received = initial_received;
                semanticchecker.Visit(optimized_initial_received, false);
                opt_carim.Optimize(optimized_initial_received);

                coder->ImExecute(obj->position,
                        coder->ImAssignment(obj->position,
                                coder->ImVariable(obj->position, received),
                                optimized_initial_received));


                // WHILE (TRUE)
                // {
                coder->ImFor_Open(obj->position, NULL, NULL);

                Symbol *res = context.symboltable->RegisterDeclaredVariable(obj->position, NULL, false, false, VariableTypes::Record);
                Symbol *receivedtype = context.symboltable->RegisterDeclaredVariable(obj->position, NULL, false, false, VariableTypes::Integer);
                Symbol *receivedvalue = context.symboltable->RegisterDeclaredVariable(obj->position, NULL, false, false, VariableTypes::Variant);

                //   receivedtype := received.type
                coder->ImExecute(obj->position,
                        coder->ImAssignment(obj->position,
                                coder->ImVariable(obj->position, receivedtype),
                                coder->ImColumnOf(
                                    obj->position,
                                    coder->ImVariable(obj->position, received),
                                    "TYPE")));

                //   receivedvalue := received.value
                coder->ImExecute(obj->position,
                        coder->ImAssignment(obj->position,
                                coder->ImVariable(obj->position, receivedvalue),
                                coder->ImColumnOf(
                                    obj->position,
                                    coder->ImVariable(obj->position, received),
                                    "VALUE")));

                coder->CodeInitialize(res);

                //   IF (receivedtype = 0)
                coder->ImIf_Open(obj->position,
                    coder->ImBinaryOperator(
                        obj->position,
                        BinaryOperatorType::OpEqual,
                        coder->ImVariable(obj->position, receivedtype),
                        coder->ImConstantInteger(obj->position, 0))); // also used for return in try-finally resolution

                //     res := iterator->next(receivedvalue)
                coder->ImExecute(obj->position,
                        coder->ImAssignment(obj->position,
                                coder->ImVariable(obj->position, res),
                                coder->ImObjectMethodCall(
                                    obj->position,
                                    coder->ImVariable(obj->position, iterator),
                                    "NEXT",
                                    false,
                                    RvaluePtrs(1, coder->ImVariable(obj->position, receivedvalue)),
                                    false,
                                    std::vector< int32_t >())));

                coder->ImIf_Else(obj->position);

                //   IF (receivedtype = 1)
                coder->ImIf_Open(obj->position,
                    coder->ImBinaryOperator(
                        obj->position,
                        BinaryOperatorType::OpEqual,
                        coder->ImVariable(obj->position, receivedtype),
                        coder->ImConstantInteger(obj->position, 1))); // also used for return in try-finally resolution

                //     res := iterator->sendthrow(receivedvalue)
                coder->ImExecute(obj->position,
                        coder->ImAssignment(obj->position,
                                coder->ImVariable(obj->position, res),
                                coder->ImObjectMethodCall(
                                    obj->position,
                                    coder->ImVariable(obj->position, iterator),
                                    "SENDTHROW",
                                    false,
                                    RvaluePtrs(1, coder->ImVariable(obj->position, receivedvalue)),
                                    false,
                                    std::vector< int32_t >())));

                coder->ImIf_Else(obj->position);

                //     res := iterator->sendreturn(receivedvalue)
                coder->ImExecute(obj->position,
                        coder->ImAssignment(obj->position,
                                coder->ImVariable(obj->position, res),
                                coder->ImObjectMethodCall(
                                    obj->position,
                                    coder->ImVariable(obj->position, iterator),
                                    "SENDRETURN",
                                    false,
                                    RvaluePtrs(1, coder->ImVariable(obj->position, receivedvalue)),
                                    false,
                                    std::vector< int32_t >())));

                coder->ImIf_Close(obj->position);

                coder->ImIf_Close(obj->position);

                // retval := res.value
                coder->ImExecute(obj->position,
                        coder->ImAssignment(obj->position,
                                coder->ImVariable(obj->position, retval),
                                coder->ImColumnOf(obj->position,
                                        coder->ImVariable(obj->position, res),
                                        "VALUE")));

                // IF (res.done)
                coder->ImIf_Open(obj->position,
                        coder->ImColumnOf(obj->position,
                                coder->ImVariable(obj->position, res),
                                "DONE"));

                coder->ImBreak(obj->position);

                coder->ImIf_Close(obj->position);

                // received := YIELD(generator, [ done := FALSE, value := retval ]) // (can reuse res for that)
                RvaluePtrs params;
                params.push_back(coder->ImVariable(obj->position, generator));
                params.push_back(coder->ImVariable(obj->position, res));

                BuiltinInstruction *yield_instr = Adopt(new BuiltinInstruction(
                                obj->position,
                                VariableTypes::Record,
                                ":YIELD",
                                params,
                                true,
                                true));

                coder->ImExecute(obj->position,
                        coder->ImAssignment(obj->position,
                                coder->ImVariable(obj->position, received),
                                yield_instr));

                // }
                coder->ImFor_Close(obj->position);
        }

        coder->ImCloseBlock();

        Visit(eblock, Empty());

        ReplacePtr(eblock);
}

ArrayEndVisitor::ArrayEndVisitor(CompilerContext &context, AstCoder *coder, TypeStorage &typestorage)
: context(context)
, coder(coder)
, typestorage(typestorage)
, lengthvalue(0)
{
}

ArrayEndVisitor::~ArrayEndVisitor()
{

}

void ArrayEndVisitor::V_ArrayElementConst (AST::ArrayElementConst *, Empty)
{
        //Since this starts a new array expression with its own END, do not recurse into it
}

void ArrayEndVisitor::V_ArrayElementModify(AST::ArrayElementModify *, Empty)
{
        //Since this starts a new array expression with its own END, do not recurse into it
}

void ArrayEndVisitor::V_End (AST::End *, Empty)
{
        seenendnodes = true;
}

bool ArrayEndVisitor::HasEnds(AST::Rvalue *index)
{
        seenendnodes=false;
        Visit(index,Empty());
        return seenendnodes;
}

Symbol* ArrayEndVisitor::CreateLengthSymbol(AST::Rvalue *array)
{
        Symbol *f_length = context.symboltable->RetrieveExternalFunction(array->position, "LENGTH");
        Symbol *len = context.symboltable->RegisterDeclaredVariable (array->position, 0, false, false, VariableTypes::Integer);

        // len := length(listcopy)
        RvaluePtrs len_call_params(1, array);
        coder->ImExecute(array->position,
                coder->ImAssignment(array->position,
                        coder->ImVariable(array->position, len),
                        coder->ImFunctionCall(array->position, f_length, len_call_params)));
        return len;
}


} // end of namespace Compiler
} // end of namespace HareScript
