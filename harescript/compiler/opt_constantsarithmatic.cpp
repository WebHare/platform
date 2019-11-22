//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------


#include "opt_constantsarithmatic.h"
#include <blex/decimalfloat.h>

namespace HareScript
{
namespace Compiler
{
namespace Opt_ConstantsArithmatic
{
using namespace AST;

Opt_ConstantsArithmatic::Opt_ConstantsArithmatic(AstCoder *coder, TypeStorage &typestorage, CompilerContext &context)
: errorhandler(context.errorhandler)
, coder(coder)
, typestorage(typestorage)
, context(context)
, stackm(context.stackm)
, forceconstexpr(false)
{
}

Opt_ConstantsArithmatic::~Opt_ConstantsArithmatic()
{
}

void Opt_ConstantsArithmatic::Pop()
{
        stackm.PopVariablesN(1);
}

VarId Opt_ConstantsArithmatic::Argument(unsigned idx)
{
        return stackm.StackPointer() - idx - 1;
}

VarId Opt_ConstantsArithmatic::Push()
{
        return stackm.PushVariables(1);
}

void Opt_ConstantsArithmatic::Swap()
{
        return stackm.Swap();
}

bool Opt_ConstantsArithmatic::BinaryOp(LineColumn pos, void (StackMachine::* stack_op)())
{
        try
        {
                (stackm.*stack_op)();
        }
        catch (VMRuntimeError &e)
        {
                errorhandler.AddErrorAt(pos, static_cast<Error::Codes>(e.code), e.msg1, e.msg2);
                stackm.PopVariablesN(2);
                return false;
        }
        return true;
}
bool Opt_ConstantsArithmatic::UnaryOp(LineColumn pos, void (StackMachine::* stack_op)())
{
        try
        {
                (stackm.*stack_op)();
        }
        catch (VMRuntimeError &e)
        {
                errorhandler.AddErrorAt(pos, static_cast<Error::Codes>(e.code), e.msg1, e.msg2);
                stackm.PopVariablesN(1);
                return false;
        }
        return true;
}

int32_t Opt_ConstantsArithmatic::Compare(LineColumn pos)
{
        int32_t retval = 0;
        try
        {
                VarId lhs = stackm.StackPointer() - 2;
                VarId rhs = lhs + 1;

                retval = stackm.Compare(lhs, rhs, true);
                stackm.PopVariablesN(2);
        }
        catch (VMRuntimeError &e)
        {
                errorhandler.AddErrorAt(pos, static_cast<Error::Codes>(e.code), e.msg1, e.msg2);
                stackm.PopVariablesN(2);
        }
        return retval;
}

bool Opt_ConstantsArithmatic::CastOp(LineColumn pos, VariableTypes::Type totype, bool is_explicit)
{
        try
        {
                if (is_explicit)
                    stackm.Stack_ForcedCastTo(totype);
                else
                    stackm.Stack_CastTo(totype);
        }
        catch (VMRuntimeError &e)
        {
                errorhandler.AddErrorAt(pos, static_cast<Error::Codes>(e.code), e.msg1, e.msg2);
                stackm.PopVariablesN(1);
                return false;
        }
        return true;
}

Constant * Opt_ConstantsArithmatic::Replace(Rvalue* & obj)
{
        // Create a copy to pass to the astcoder
        VarId var = context.stackm.NewHeapVariable();
        context.stackm.CopyFrom(var, stackm.StackPointer()-1);

        Constant *new_const = coder->ImConstant(obj->position, var);
        obj = new_const;
        Pop();
        return new_const;
}

Constant * Opt_ConstantsArithmatic::Optimize(Rvalue* & obj)
{
        if (obj)
        {
                Optimizable opt = Visit(obj, Empty());
                if (opt != None)
                {
                        if (opt == Multiple)
                            return Replace(obj);
                        else
                            Pop();
                        return last_single;
                }
                else if (forceconstexpr)
                {
                        forceconstexpr = false; // stop at first error
                        errorhandler.AddErrorAt(obj->position, Error::ExpectedConstantExpression);
                }
        }
        return 0;
}
Constant * Opt_ConstantsArithmatic::ForceOptimize(Rvalue* & obj)
{
        bool saved_forceconstexpr = forceconstexpr;
        forceconstexpr = true;
        Constant *retval = Optimize(obj);
        forceconstexpr = saved_forceconstexpr;
        return retval;
}

Optimizable Opt_ConstantsArithmatic::V_ArrayDelete (ArrayDelete *obj, Empty)
{
        if (obj->location.expr) Optimize(obj->location.expr);
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_ArrayElementConst (ArrayElementConst *obj, Empty)
{
        Optimize(obj->array);
        Optimize(obj->index);
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_ArrayElementModify (ArrayElementModify *obj, Empty)
{
        Optimize(obj->array);
        Optimize(obj->index);
        Optimize(obj->value);
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_ArrayInsert (ArrayInsert *obj, Empty)
{
        if (obj->location.expr) Optimize(obj->location.expr);
        Optimize(obj->value);
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_Assignment (Assignment *obj, Empty)
{
        Optimize(obj->source);
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_BinaryOperator (BinaryOperator *obj, Empty)
{
        Optimizable lhs_opt = Visit(obj->lhs, Empty());
        Optimizable rhs_opt = Visit(obj->rhs, Empty());

        if (lhs_opt != None && rhs_opt != None)
        {
                bool is_ok = true;
                int32_t compare_res = 0;
                // Execute op
                switch (obj->operation)
                {
                case BinaryOperatorType::OpAnd:
                        is_ok = BinaryOp(obj->position, &StackMachine::Stack_Bool_And);
                        break;
                case BinaryOperatorType::OpOr:
                        is_ok = BinaryOp(obj->position, &StackMachine::Stack_Bool_Or);
                        break;
                case BinaryOperatorType::OpXor:
                        is_ok = BinaryOp(obj->position, &StackMachine::Stack_Bool_Xor);
                        break;

                case BinaryOperatorType::OpAdd:
                        is_ok = BinaryOp(obj->position, &StackMachine::Stack_Arith_Add);
                        break;
                case BinaryOperatorType::OpSubtract:
                        is_ok = BinaryOp(obj->position, &StackMachine::Stack_Arith_Sub);
                        break;
                case BinaryOperatorType::OpMultiply:
                        is_ok = BinaryOp(obj->position, &StackMachine::Stack_Arith_Mul);
                        break;
                case BinaryOperatorType::OpDivide:
                        is_ok = BinaryOp(obj->position, &StackMachine::Stack_Arith_Div);
                        break;
                case BinaryOperatorType::OpModulo:
                        is_ok = BinaryOp(obj->position, &StackMachine::Stack_Arith_Mod);
                        break;

                case BinaryOperatorType::OpLess:
                        compare_res = Compare(obj->position);
                        stackm.SetBoolean(Push(), compare_res < 0);
                        break;
                case BinaryOperatorType::OpLessEqual:
                        compare_res = Compare(obj->position);
                        stackm.SetBoolean(Push(), compare_res <= 0);
                        break;
                case BinaryOperatorType::OpGreater:
                        compare_res = Compare(obj->position);
                        stackm.SetBoolean(Push(), compare_res > 0);
                        break;
                case BinaryOperatorType::OpGreaterEqual:
                        compare_res = Compare(obj->position);
                        stackm.SetBoolean(Push(), compare_res >= 0);
                        break;
                case BinaryOperatorType::OpEqual:
                        compare_res = Compare(obj->position);
                        stackm.SetBoolean(Push(), compare_res == 0);
                        break;
                case BinaryOperatorType::OpUnEqual:
                        compare_res = Compare(obj->position);
                        stackm.SetBoolean(Push(), compare_res != 0);
                        break;

                case BinaryOperatorType::OpMerge:
                        is_ok = BinaryOp(obj->position, &StackMachine::Stack_String_Merge);
                        break;
                case BinaryOperatorType::OpLike:
                        is_ok = BinaryOp(obj->position, &StackMachine::Stack_Like);
                        break;
                case BinaryOperatorType::OpIn:
                        is_ok = BinaryOp(obj->position, &StackMachine::Stack_In);
                        break;
                case BinaryOperatorType::OpConcat:
                        is_ok = BinaryOp(obj->position, &StackMachine::Stack_Concat);
                        break;

                default:
                        is_ok = false;
                        stackm.PopVariablesN(2);

                        Optimize(obj->lhs);
                        Optimize(obj->rhs);
                }
                return is_ok ? Multiple : None;
        }

        if (rhs_opt != None)
        {
                if (rhs_opt == Multiple)
                    Replace(obj->rhs);
                else
                    Pop();
        }
        if (lhs_opt != None)
        {
                if (lhs_opt == Multiple)
                    Replace(obj->lhs);
                else
                    Pop();
        }

        return None;
}
Optimizable Opt_ConstantsArithmatic::V_Block (Block *obj, Empty)
{
        for (std::vector<Statement*>::iterator it = obj->statements.begin(); it != obj->statements.end();)
        {
                Optimizable opt = Visit(*it, Empty());
                if (opt != None)
                {
                        Pop();
                        it = obj->statements.erase(it);
                }
                else
                    ++it;
        }
//        std::for_each(obj->statements.begin(), obj->statements.end(), GetSafeVisitorFunctor(this, Empty()));
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_BreakStatement (BreakStatement *, Empty)
{
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_BuiltinInstruction (AST::BuiltinInstruction *obj, Empty)
{
        for (RvaluePtrs::iterator it = obj->parameters.begin(); it != obj->parameters.end(); ++it)
        {
                Optimize(*it);
        }
        return None;
}

Optimizable Opt_ConstantsArithmatic::V_Cast(Cast *obj, Empty)
{
        Optimizable expr_opt = Visit(obj->expr, Empty());

        if (expr_opt != None) //We can implicitly convert the value
            if (!CastOp(obj->position, obj->to_type, obj->is_explicit))
                return None;
            else
                return Multiple;
        else
        {
                // Eliminate casts that do nothing. If allow_parameter_cast is off, disable it
                // in a toplevel cast too
                if (typestorage[obj->expr] == obj->to_type)
                {
                        Cast *subcast = dynamic_cast< Cast * >(obj->expr);
                        if (subcast && !obj->allow_parameter_cast)
                            subcast->allow_parameter_cast = false;

                        ReplacePtr(obj->expr);
                }

                return None;
        }
}
Optimizable Opt_ConstantsArithmatic::V_ConditionalOperator (ConditionalOperator *obj, Empty)
{
        Optimize(obj->expr_true);
        Optimize(obj->expr_false);

        Optimizable opt = Visit(obj->condition, Empty());
        if (opt != None)
        {
                bool cond = stackm.GetBoolean(Argument(0));
                Pop();

                Rvalue* expr;

                if (cond)
                    expr = obj->expr_true;
                else
                    expr = obj->expr_false;
                opt = Visit(expr, Empty());

                ReplacePtr(expr);
                return opt;
        }
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_ConditionalStatement (ConditionalStatement *obj, Empty)
{
        Visit(obj->stat_true, Empty());
        if (obj->stat_false) Visit(obj->stat_false, Empty());

        Optimizable opt = Visit(obj->condition, Empty());
        if (opt != None)
        {
                bool cond = stackm.GetBoolean(Argument(0));
                Pop();

                Statement* stat;
                if (cond)
                    stat = obj->stat_true;
                else
                    stat = obj->stat_false;
                if (!stat) stat = Adopt(new Block(obj->position));
                ReplacePtr(stat);
        }
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_Constant (Constant *obj, Empty)
{
        if (obj->var)
        {
                context.stackm.CopyFrom(Push(), obj->var);
                last_single = obj;
                return Single;
        }
        else
            return None;
}


ExpressionBlock * Opt_ConstantsArithmatic::MergeSimpleCells(LineColumn position, VarId var, std::vector< std::pair< std::string, Rvalue* > > const &unopt)
{
        Symbol *retval = context.symboltable->RegisterDeclaredVariable(position, NULL, false, false, VariableTypes::Record);
        ExpressionBlock* eblock = Adopt(new ExpressionBlock(position, Adopt(new Block(position)),
                coder->ImVariable(position, retval)));

        VarId heap_var = context.stackm.NewHeapVariable();
        context.stackm.CopyFrom(heap_var, var);

        coder->ImOpenBlock(eblock->block);

        coder->ImExecute(position,
                coder->ImAssignment(position,
                        coder->ImVariable(position, retval),
                        coder->ImConstant(position, heap_var)));

        for (auto it = unopt.begin(); it != unopt.end(); ++it)
        {
                Rvalue* expr = coder->ImRecordCellSet(
                        it->second->position,
                        coder->ImVariable(position, retval),
                        it->first,
                        it->second,
                        true,
                        true);

                Optimize(expr);

                coder->ImExecute(position, expr);
        }

        coder->ImCloseBlock();
        return eblock;
}


Optimizable Opt_ConstantsArithmatic::V_ConstantRecord (ConstantRecord *obj, Empty)
{
        VarId var = 0;
        LineColumn varpos;
        bool sure_existing = false; // true if we'll merge with an existing record

        // parts is the final list that is executed
        // unopt the list of items/deletes that can be inserted after var (stuff in between ellipsis won't collide anyway).
        // (unopt must be flushed before every ellipsis)
        std::vector< std::tuple< ConstantRecord::EltType, std::string, Rvalue * > > parts, unopt;
        for (auto &itr: obj->columns)
        {
                switch (std::get<0>(itr))
                {
                        case ConstantRecord::Item:
                        {
                                Constant *c = Optimize(std::get<2>(itr));
                                if (!c)
                                {
                                        unopt.push_back(itr);
                                }
                                else
                                {
                                        if (!var)
                                        {
                                                var = context.stackm.NewHeapVariable();
                                                context.stackm.RecordInitializeEmpty(var);
                                                varpos = c->position;
                                        }

                                        ColumnNameId id = context.columnmapper.GetMapping(std::get<1>(itr));
                                        VarId elt = context.stackm.RecordCellCreate(var, id);
                                        context.stackm.CopyFrom(elt, c->var);
                                }

                                sure_existing = true;
                        } break;

                        case ConstantRecord::Ellipsis:
                        {
                                Constant *c = Optimize(std::get<2>(itr));
                                if (!c)
                                {
                                        if (var)
                                        {
                                                parts.push_back(std::make_tuple(ConstantRecord::Ellipsis, "", coder->ImConstant(varpos, var)));
                                                var = 0;
                                        }
                                        if (!unopt.empty())
                                        {
                                                parts.insert(parts.end(), unopt.begin(), unopt.end());
                                                unopt.clear();
                                        }
                                        parts.push_back(itr);
                                }
                                else
                                {
                                        if (!var)
                                        {
                                                var = context.stackm.NewHeapVariable();
                                                context.stackm.RecordInitializeEmpty(var);
                                                varpos = c->position;
                                        }

                                        for (unsigned idx = 0; idx < context.stackm.RecordSize(c->var); ++idx)
                                        {
                                                ColumnNameId nameid = context.stackm.RecordCellNameByNr(c->var, idx);
                                                context.stackm.CopyFrom(
                                                        context.stackm.RecordCellCreate(var, nameid),
                                                        context.stackm.RecordCellGetByName(c->var, nameid));
                                        }

                                        sure_existing = true;
                                }
                        } break;

                        case ConstantRecord::Delete:
                        {
                                // Delete must be done at runtime if anything before this entry has runtime calculation
                                // ignore delete if it is the first in the list
                                if (!parts.empty() || !unopt.empty())
                                {
                                        unopt.push_back(itr);
                                }
                                else if (var)
                                {
                                        ColumnNameId id = context.columnmapper.GetMapping(std::get<1>(itr));
                                        context.stackm.RecordCellDelete(var, id);
                                }
                        } break;
                }
        }

        // Everything could be optimized?
        if (parts.empty() && unopt.empty())
        {
                VarId retval = Push();
                if (!var)
                    context.stackm.RecordInitializeEmpty(retval);
                else
                    context.stackm.CopyFrom(retval, var);
                return Multiple;
        }

        // Place the last cells in the parts list
        if (var)
        {
                parts.push_back(std::make_tuple(ConstantRecord::Ellipsis, "", coder->ImConstant(varpos, var)));
                var = 0;
        }

        if (!unopt.empty())
        {
                parts.insert(parts.end(), unopt.begin(), unopt.end());
                unopt.clear();
        }

        // Build the runtime calculation
        Symbol *retval = context.symboltable->RegisterDeclaredVariable(obj->position, NULL, false, false, VariableTypes::Record);
        ExpressionBlock* eblock = Adopt(new ExpressionBlock(obj->position, Adopt(new Block(obj->position)),
                coder->ImVariable(obj->position, retval)));

        coder->ImOpenBlock(eblock->block);

        Symbol *f_overwriterecord = nullptr;
        bool firstval = true;
        for (auto &part: parts)
        {
                LineColumn position = std::get<2>(part)->position;

                switch (std::get<0>(part))
                {
                        case ConstantRecord::Item:
                        {
                                if (firstval)
                                {
                                        coder->ImExecute(position,
                                                coder->ImAssignment(position,
                                                        coder->ImVariable(position, retval),
                                                        coder->ImConstantDefault(obj->position, VariableTypes::Record)));
                                        firstval = false;
                                }

                                coder->ImExecute(position,
                                        coder->ImRecordCellSet(
                                                position,
                                                coder->ImVariable(position, retval),
                                                std::get<1>(part),
                                                std::get<2>(part),
                                                true,
                                                false));
                        } break;
                        case ConstantRecord::Ellipsis:
                        {
                                if (firstval)
                                {
                                        coder->ImExecute(position,
                                                coder->ImAssignment(position,
                                                        coder->ImVariable(position, retval),
                                                        std::get<2>(part)));
                                        firstval = false;
                                }
                                else
                                {
                                        if (!f_overwriterecord)
                                                f_overwriterecord = context.symboltable->RetrieveExternalFunction(obj->position, "__HS_SQL_OVERWRITERECORD");

                                        RvaluePtrs parameters;
                                        parameters.push_back(coder->ImVariable(position, retval));
                                        parameters.push_back(std::get<2>(part));

                                        coder->ImExecute(position,
                                                coder->ImAssignment(position,
                                                        coder->ImVariable(position, retval),
                                                        coder->ImFunctionCall(position, f_overwriterecord, parameters)));
                                }
                        } break;
                        case ConstantRecord::Delete:
                        {
                                if (!firstval)
                                {
                                        coder->ImExecute(position,
                                                coder->ImRecordCellDelete(
                                                        std::get<2>(part)->position,
                                                        coder->ImVariable(position, retval),
                                                        std::get<1>(part)));
                                }
                        } break;
                }
        }

        coder->ImCloseBlock();
        ReplacePtr(sure_existing
                ? eblock
                : coder->ImUnaryOperator(obj->position, UnaryOperatorType::OpMakeExisting, eblock));
        return None;
}

Optimizable Opt_ConstantsArithmatic::V_ConstantArray (ConstantArray *obj, Empty)
{
        VarId var = Push();
        VariableTypes::Type type = obj->type;
        if (type == VariableTypes::Uninitialized)
        {
                for (auto &itr: obj->values)
                {
                        // get the type from the first non-ellipsis value
                        if (!std::get<2>(itr))
                            type = static_cast<VariableTypes::Type>(typestorage[std::get<1>(itr)] | VariableTypes::Array);
                }
        }

        context.stackm.ArrayInitialize(var, 0, type);

        RvaluePtrs appendparts;

        unsigned size = 0;
        std::vector< std::pair< unsigned, Rvalue* > > unopt;
        for (auto it = obj->values.begin();
                it != obj->values.end(); ++it)
        {
                Optimizable opt = Visit(std::get<1>(*it), Empty());
                if (opt == None)
                {
                        if (std::get<2>(*it))
                        {
                                appendparts.push_back(coder->ImCast(std::get<1>(*it)->position, std::get<1>(*it), type, false, false));
                                ++it;
                                if (it != obj->values.end())
                                {
                                        ConstantArray *rest = coder->ImConstantArray(std::get<0>(*it));
                                        rest->type = type;
                                        typestorage[rest] = type;
                                        rest->values.assign(it, obj->values.end());
                                        appendparts.push_back(rest);
                                }
                                break;
                        }
                        unopt.push_back(std::make_pair(std::distance(obj->values.begin(), it), std::get<1>(*it)));
                }
                else
                {
                        if (std::get<2>(*it))
                        {
                                context.stackm.Stack_CastTo(type);

                                size += context.stackm.ArraySize(Argument(0));
                                context.stackm.MoveFrom(Push(), var);
                                Swap();
                                context.stackm.Stack_Concat();
                                context.stackm.MoveFrom(var, Argument(0));
                        }
                        else
                        {
                                VarId elt = context.stackm.ArrayElementAppend(var);
                                ++size;
                                context.stackm.CopyFrom(elt, Argument(0));
                        }
                        Pop();
                }
        }

        if (!unopt.empty() || !appendparts.empty())
        {
                Symbol *retval = context.symboltable->RegisterDeclaredVariable(obj->position, NULL, false, false, type);
                ExpressionBlock* eblock = Adopt(new ExpressionBlock(obj->position, Adopt(new Block(obj->position)),
                        coder->ImVariable(obj->position, retval)));

                VarId heap_var = context.stackm.NewHeapVariable();
                context.stackm.CopyFrom(heap_var, var);

                coder->ImOpenBlock(eblock->block);

                if (size || !unopt.empty() || appendparts.empty())
                {
                        coder->ImExecute(obj->position,
                                coder->ImAssignment(obj->position,
                                        coder->ImVariable(obj->position, retval),
                                        coder->ImConstant(obj->position, heap_var)));

                        for (std::vector< std::pair< unsigned, Rvalue* > >::iterator it = unopt.begin(); it != unopt.end(); ++it)
                        {
                                ArrayLocation loc(ArrayLocation::Index);
                                if (size == it->first)
                                    loc.type = ArrayLocation::End;
                                else
                                    loc.expr = coder->ImConstantInteger(it->second->position, it->first);

                                Optimize(loc.expr);

                                coder->ImArrayInsert(it->second->position,
                                        coder->ImVariable(obj->position, retval),
                                        loc,
                                        it->second);
                                ++size;
                        }
                }
                else
                {
                        coder->ImExecute(obj->position,
                                coder->ImAssignment(obj->position,
                                        coder->ImVariable(obj->position, retval),
                                        appendparts[0]));
                        appendparts.erase(appendparts.begin());
                }

                for (auto &itr: appendparts)
                {
                        Optimize(itr);
                        coder->ImExecute(itr->position,
                                coder->ImAssignment(itr->position,
                                        coder->ImVariable(itr->position, retval),
                                        coder->ImBinaryOperator(
                                                itr->position,
                                                BinaryOperatorType::OpConcat,
                                                coder->ImVariable(itr->position, retval),
                                                coder->ImCast(itr->position, itr, type, false, false))));
                }

                Pop();

                coder->ImCloseBlock();
                ReplacePtr(eblock);
                return None;
        }

        return Multiple;
}

Optimizable Opt_ConstantsArithmatic::V_ContinueStatement (ContinueStatement *, Empty)
{
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_DeepOperation (AST::DeepOperation *obj, Empty)
{
        Optimize(obj->clvalue.base);
        for (LvalueLayers::iterator it = obj->clvalue.layers.begin(); it != obj->clvalue.layers.end(); ++it)
            if (it->expr)
                Optimize(it->expr);
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_DeepArrayDelete (AST::DeepArrayDelete *obj, Empty)
{
        V_DeepOperation(obj, Empty());
        if (obj->location.expr)
            Optimize(obj->location.expr);

        return None;
}
Optimizable Opt_ConstantsArithmatic::V_DeepArrayInsert (AST::DeepArrayInsert *obj, Empty)
{
        V_DeepOperation(obj, Empty());
        if (obj->location.expr)
            Optimize(obj->location.expr);
        Optimize(obj->value);

        return None;
}
Optimizable Opt_ConstantsArithmatic::V_End(End*, Empty)
{
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_ExpressionBlock (AST::ExpressionBlock *obj, Empty)
{
        Visit(obj->block, Empty());
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_ForEveryStatement(AST::ForEveryStatement *obj, Empty)
{
        Optimize(obj->source);
        Visit(obj->iteratevar, Empty());
        Visit(obj->loop, Empty());
        Visit(obj->positionvar, Empty());
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_Function (Function *obj, Empty)
{
        for (std::vector<SymbolDefs::FunctionDef::Argument>::iterator it = obj->symbol->functiondef->arguments.begin();
                it != obj->symbol->functiondef->arguments.end(); ++it)
            if (it->value)
                Optimize(it->value);
        Visit(obj->block, Empty());
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_FunctionCall(FunctionCall *obj, Empty)
{
        for (RvaluePtrs::iterator it = obj->parameters.begin(); it != obj->parameters.end(); ++it)
        {
                Optimize(*it);
        }
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_FunctionPtr(FunctionPtr *obj, Empty)
{
        for (RvaluePtrs::iterator it = obj->bound_parameters.begin(); it != obj->bound_parameters.end(); ++it)
            Optimize(*it);

        return None;
}
Optimizable Opt_ConstantsArithmatic::V_FunctionPtrCall(FunctionPtrCall *obj, Empty)
{
        Optimize(obj->functionptr);
        for (RvaluePtrs::iterator it = obj->params.begin(); it != obj->params.end(); ++it)
            Optimize(*it);

        return None;
}
Optimizable Opt_ConstantsArithmatic::V_FunctionPtrRebind(FunctionPtrRebind *obj, Empty)
{
        Optimize(obj->orgptr);
        for (RvaluePtrs::iterator it = obj->bound_parameters.begin(); it != obj->bound_parameters.end(); ++it)
            Optimize(*it);

        return None;
}

Optimizable Opt_ConstantsArithmatic::V_InitializeStatement (InitializeStatement *, Empty)
{
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_LoopStatement (LoopStatement *obj, Empty)
{
        if (obj->precondition)
        {
                Optimizable opt = Visit(obj->precondition, Empty());
                if (opt != None)
                {
                        if (context.stackm.GetType(Argument(0)) == VariableTypes::Boolean && context.stackm.GetBoolean(Argument(0)))
                            obj->precondition = 0;
                        else
                            Replace(obj->precondition);
                }
        }
        if (obj->loopincrementer)
            Optimize(obj->loopincrementer);
        Visit(obj->loop, Empty());
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_Lvalue (Lvalue *, Empty)
{
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_LvalueSet (LvalueSet *obj, Empty)
{
        V_DeepOperation(obj, Empty());
        Optimize(obj->value);

        return None;
}

Optimizable Opt_ConstantsArithmatic::V_Module (Module *obj, Empty)
{
        std::for_each(obj->functions.begin(), obj->functions.end(), GetSafeVisitorFunctor(this, Empty()));
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_Node (Node *, Empty)
{
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_RecordCellSet (RecordCellSet *obj, Empty)
{
        Optimize(obj->value);
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_ObjectMemberSet (ObjectMemberSet *obj, Empty)
{
//        Optimize(obj->name);
        Optimize(obj->value);
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_RecordCellDelete (RecordCellDelete *, Empty)
{
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_RecordColumnConst (RecordColumnConst *obj, Empty)
{
        Optimize(obj->record);
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_ObjectExtend(AST::ObjectExtend *obj, Empty)
{
        Optimize(obj->object);
        for (auto &itr: obj->parameters)
            Optimize(itr);
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_ObjectMemberConst(ObjectMemberConst*obj, Empty)
{
        Optimize(obj->object);
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_ObjectMemberDelete(AST::ObjectMemberDelete *obj, Empty)
{
        Optimize(obj->object);
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_ObjectMemberInsert(AST::ObjectMemberInsert *obj, Empty)
{
        Optimize(obj->object);
        Optimize(obj->value);
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_ObjectMethodCall (AST::ObjectMethodCall*obj, Empty)
{
        Optimize(obj->object);
        for (RvaluePtrs::iterator it = obj->parameters.begin(); it != obj->parameters.end(); ++it)
            Optimize(*it);
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_ObjectTypeUID (AST::ObjectTypeUID*, Empty)
{
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_ReturnStatement (ReturnStatement *obj, Empty)
{
        if (obj->returnvalue)
            Optimize(obj->returnvalue);
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_Rvalue (Rvalue *, Empty)
{
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_SchemaTable (SchemaTable *, Empty)
{
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_SingleExpression (SingleExpression *obj, Empty)
{
        return Visit(obj->expr, Empty());
}
Optimizable Opt_ConstantsArithmatic::V_Statement (Statement *, Empty)
{
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_SwitchStatement (AST::SwitchStatement *obj, Empty)
{
        Optimize(obj->value);

        if (obj->defaultcase)
            Visit(obj->defaultcase, Empty());

        for (SwitchStatement::CaseList::iterator it = obj->cases.begin(); it != obj->cases.end(); ++it)
        {
                for (std::vector< Rvalue * >::iterator it2 = it->first.begin(); it2 != it->first.end(); ++it2)
                    Optimize(*it2);
                Visit(it->second, Empty());
        }
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_TryCatchStatement(TryCatchStatement *obj, Empty)
{
        Visit(obj->tryblock, Empty());
        Visit(obj->catchblock, Empty());
        return None;
}

Optimizable Opt_ConstantsArithmatic::V_TryFinallyStatement(TryFinallyStatement *obj, Empty)
{
        Visit(obj->tryblock, Empty());
        Visit(obj->finallyblock, Empty());
        return None;
}

Optimizable Opt_ConstantsArithmatic::V_TypeInfo (TypeInfo *, Empty)
{
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_UnaryOperator (UnaryOperator *obj, Empty)
{
        if (obj->operation == UnaryOperatorType::OpPlus)
            ReplacePtr(obj->lhs);

        Optimizable opt = Visit(obj->lhs, Empty());
        if (opt != None)
        {
                bool is_ok = true;
                // Execute op
                switch (obj->operation)
                {
                case UnaryOperatorType::OpNot:
                        is_ok = UnaryOp(obj->position, &StackMachine::Stack_Bool_Not); break;
                case UnaryOperatorType::OpNeg:
                        is_ok = UnaryOp(obj->position, &StackMachine::Stack_Arith_Neg); break;
                case UnaryOperatorType::OpPlus:
                        break;
                default: ;
                    is_ok = false;
                    Pop();
                }
                if (is_ok)
                    return Multiple;
                else
                    return None;
        }
        return None;
}

Optimizable Opt_ConstantsArithmatic::V_Variable (Variable *obj, Empty)
{
        if (obj->symbol->variabledef->is_constant && obj->symbol->variabledef->constexprvalue)
        {
                Optimizable opt = Visit(obj->symbol->variabledef->constexprvalue, Empty());

                // Returning Single (a single AST::Constant node) won't trigger replacement
                if (opt == Single)
                    opt = Multiple;

                return opt;
        }
        return None;
}

Optimizable Opt_ConstantsArithmatic::V_Yield (Yield *obj, Empty)
{
        Optimize(obj->generator);
        Optimize(obj->yieldexpr);
        return None;
}

Optimizable Opt_ConstantsArithmatic::V_SQL (SQL *, Empty)
{
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_SQLDataModifier (SQLDataModifier *obj, Empty)
{
        for (RvaluePtrs::iterator it = obj->values.begin(); it != obj->values.end(); ++it)
            Optimize(*it);
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_SQLDelete (SQLDelete *obj, Empty)
{
        Visit(obj->sources, Empty());
        if (obj->location.expr)
            Optimize(obj->location.expr);
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_SQLInsert (SQLInsert *obj, Empty)
{
        Visit(obj->source, Empty());
        Visit(obj->modifier, Empty());
        if (obj->location.expr)
            Optimize(obj->location.expr);
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_SQLSource (SQLSource *obj, Empty)
{
        Optimize(obj->expression);
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_SQLSources (SQLSources *obj, Empty)
{
        std::for_each(obj->sources.begin(), obj->sources.end(), GetVisitorFunctor(this, Empty()));
        return None;
}
Optimizable Opt_ConstantsArithmatic::V_SQLSelect (SQLSelect *obj, Empty)
{
        Visit(obj->sources, Empty());
        if (obj->limit_expr)
            Optimize(obj->limit_expr);
        if (obj->location.expr)
            Optimize(obj->location.expr);
        for (std::vector< SQLSelect::Temporary >::iterator it = obj->temporaries.begin(); it != obj->temporaries.end(); ++it)
            Optimize(it->expr);
        for (std::vector< SQLSelect::SelectItem >::iterator it = obj->namedselects.begin(); it != obj->namedselects.end(); ++it)
            if (it->expr)
                Optimize(it->expr);
        for (std::vector<std::pair<Rvalue*, bool> > ::iterator it = obj->orderings.begin(); it != obj->orderings.end(); ++it)
            Optimize(it->first);
        for(std::vector< Rvalue * >::iterator it = obj->groupings.begin(); it != obj->groupings.end(); ++it)
            Optimize(*it);
        if (obj->having_expr)
            Optimize(obj->having_expr);

        return None;
}
Optimizable Opt_ConstantsArithmatic::V_SQLUpdate (SQLUpdate *obj, Empty)
{
        Visit(obj->source, Empty());
        Visit(obj->modifier, Empty());
        if (obj->location.expr)
            Optimize(obj->location.expr);
        return None;
}

} // end of namespace Opt_ConstantsArithmatic
} // end of namespace Compiler
} // end of namespace HareScript

//---------------------------------------------------------------------------
