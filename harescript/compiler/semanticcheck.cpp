//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include "semanticcheck.h"
#include "opt_constantsarithmatic.h"
#include "debugprints.h"

/** Contains the checking of symantics

    1. Types of expressions (within operators)
*/

namespace HareScript
{
namespace Compiler
{
using namespace AST;

namespace
{

/* ADDME: be careful when trying to 'reverse' the results of the functions
   below: eg IsTypeNotAnArray(type) is NOT the same as !IsTypeArray(Type)
          because "Variant" can be both an array and not an array */

bool IsTypeArray(VariableTypes::Type type)
{
        return type==VariableTypes::Variant || (type&VariableTypes::Array);
}

bool IsTypeOrderable(VariableTypes::Type type)
{
        return type == VariableTypes::Integer
               || type == VariableTypes::Money
               || type == VariableTypes::Float
               || type == VariableTypes::DateTime
               || type == VariableTypes::String
               || type == VariableTypes::Integer64
               || type == VariableTypes::Variant
               || type == VariableTypes::Boolean ;
}

bool IsTypeNumeric(VariableTypes::Type type)
{
        return type == VariableTypes::Integer
                || type == VariableTypes::Money
                || type == VariableTypes::Float
                || type == VariableTypes::Integer64;
}

/*
bool IsTypeArrayOf(VariableTypes::Type lhs_type, VariableTypes::Type rhs_type)
{
        //'unknown' cases
        return lhs_type == VariableTypes::Variant
               || rhs_type == VariableTypes::Variant
               || (lhs_type & VariableTypes::Array && (lhs_type|VariableTypes::Array) == rhs_type);
}

bool IsTypeStorableInArray(VariableTypes::Type lhs_type, VariableTypes::Type rhs_type)
{
        //'unknown' cases
        return lhs_type == VariableTypes::Variant
               || rhs_type == VariableTypes::Variant
               || (lhs_type & VariableTypes::Array && (lhs_type|VariableTypes::Array) == rhs_type);
}
*/

bool IsTypeComparable(VariableTypes::Type type)
{
        return IsTypeOrderable(type)
               || type == VariableTypes::Variant
               || type == VariableTypes::Blob
               || type == VariableTypes::Object
               || type == VariableTypes::FunctionRecord;
}

} //end anonymous namespace

SemanticChecker::SemanticChecker(TypeStorage &typestorage, AstCoder &coder, CompilerContext &context)
: typestorage(typestorage)
, coder(coder)
, context(context)
, loopdepth(0)
, arrayindexdepth(1) // don't check normally
, top_select(0)
, cur_select(0)
, yield_forbid_counter(0)
{
        carim.reset(new Opt_ConstantsArithmatic::Opt_ConstantsArithmatic(&coder, typestorage, context));
}

SemanticChecker::~SemanticChecker()
{
}

void SemanticChecker::CheckObjectMembers()
{
        Module *mdl = coder.GetRoot();
        for (std::vector< Symbol * >::const_iterator it = mdl->objecttypes.begin(), end = mdl->objecttypes.end(); it != end; ++it)
        {
                for (SymbolDefs::ObjectDef::Fields::const_iterator fit = (*it)->objectdef->fields.begin(), fend = (*it)->objectdef->fields.end(); fit != fend; ++fit)
                {
                        if (fit->object != *it)
                            throw Message(true, Error::InternalError, "Parent symbol of object field not set");
                        if (fit->type == ObjectCellType::Method && fit->method->state == SymbolState::Forward)
                            context.errorhandler.AddErrorAt(fit->method->definitionposition, Error::MethodNotDefined, fit->method->name);
                }
                CheckObject(*it);
        }
}

bool SemanticChecker::TypesEqual(VariableTypes::Type type1, VariableTypes::Type type2)
{
        return (type1 == type2) || (type1 == VariableTypes::Variant) || (type2 == VariableTypes::Variant);
}

bool SemanticChecker::VerifyTypeAt(const LineColumn &position, VariableTypes::Type wantedtype, VariableTypes::Type gottype)
{
        if (TypesEqual(wantedtype, gottype))
            return true;

        if (gottype != VariableTypes::NoReturn)
            context.errorhandler.AddErrorAt(position, Error::CannotConvertType, GetTypeName(gottype), HareScript::GetTypeName(wantedtype));
        else
            context.errorhandler.AddErrorAt(position, Error::MacroDoesNotReturnValue);
        return false;
}

bool SemanticChecker::VerifyTypeWithCast(Rvalue* &expr, VariableTypes::Type wantedtype)
{
        VariableTypes::Type exprtype = typestorage[expr];

        if (exprtype == wantedtype)
            return true;

        if (exprtype == VariableTypes::Schema || wantedtype == VariableTypes::Schema)
        {
                context.errorhandler.AddErrorAt(expr->position, Error::CannotCastSchema);
                return false;
        }

        if (exprtype == VariableTypes::NoReturn)
        {
                context.errorhandler.AddErrorAt(expr->position, Error::MacroDoesNotReturnValue);
                return false;
        }

        // If it accepts a variant, we're done
        if (wantedtype == VariableTypes::Variant)
            return true;

        // Check for situations where we need casting
        if ((exprtype == VariableTypes::Variant)
            || (wantedtype == VariableTypes::Record && exprtype == VariableTypes::RecordArray)
            || (wantedtype == VariableTypes::Integer64 && exprtype == VariableTypes::Integer)
            || (wantedtype == VariableTypes::Money && exprtype == VariableTypes::Integer)
            || (wantedtype == VariableTypes::Float && exprtype == VariableTypes::Integer64)
            || (wantedtype == VariableTypes::Float && exprtype == VariableTypes::Integer)
            || (wantedtype == VariableTypes::Float && exprtype == VariableTypes::Money)
            || (wantedtype == VariableTypes::VariantArray && (exprtype & VariableTypes::Array)))
        {
                Rvalue *cast = coder.ImCast(expr->position, expr, wantedtype, false, true);
                typestorage[cast] = wantedtype;
                expr = cast;

                return true;
        }

        context.errorhandler.AddErrorAt(expr->position, Error::CannotConvertType, HareScript::GetTypeName(exprtype), HareScript::GetTypeName(wantedtype));
        return false;
}

bool SemanticChecker::VerifyTypeNumeric(Rvalue* &expr)
{
        bool isnumeric = (
                (typestorage[expr]==VariableTypes::Integer) ||
                (typestorage[expr]==VariableTypes::Integer64) ||
                (typestorage[expr]==VariableTypes::Money) ||
                (typestorage[expr]==VariableTypes::Float) ||
                (typestorage[expr]==VariableTypes::Variant));
        if (!isnumeric)
            context.errorhandler.AddErrorAt(expr->position, Error::ExpectedNumeric, HareScript::GetTypeName(typestorage[expr]));
        return isnumeric;
}

bool SemanticChecker::VerifyTypeInteger(Rvalue* &expr)
{
        bool isnumeric = (
                (typestorage[expr]==VariableTypes::Integer) ||
                (typestorage[expr]==VariableTypes::Integer64) ||
                (typestorage[expr]==VariableTypes::Variant));
        if (!isnumeric)
            context.errorhandler.AddErrorAt(expr->position, Error::ExpectedInteger, HareScript::GetTypeName(typestorage[expr]));
        return isnumeric;
}

/** Returns the resulting type of a binary numeric operation binop (Add, Subtract,
    Multiply, Divide) on two numeric types:

    binop     | INTEGER   | MONEY   | INTEGER64 | FLOAT
    ----------+-----------+---------+-----------+-------
    INTEGER   | INTEGER   | MONEY   | INTEGER64 | FLOAT
    MONEY     | MONEY     | MONEY   | -         | FLOAT
    INTEGER64 | INTEGER64 | -       | INTEGER64 | FLOAT
    FLOAT     | FLOAT     | FLOAT   | FLOAT     | FLOAT

    This function will add a warning when multiplying or dividing because of a possible
    loss of precision.
    lhstype and rhstype are assumed to be numeric. When binop isn't a numeric binary
    operator, Uninitialized is returned.*/
VariableTypes::Type SemanticChecker::BinaryNumericType(
        VariableTypes::Type lhstype,
        BinaryOperatorType::Types binop,
        VariableTypes::Type rhstype)
{
        switch (binop)
        {
        case BinaryOperatorType::OpMultiply:
        case BinaryOperatorType::OpDivide:
///\todo Add warning for possible loss of precision
        case BinaryOperatorType::OpAdd:
        case BinaryOperatorType::OpSubtract:

        case BinaryOperatorType::OpLess:
        case BinaryOperatorType::OpLessEqual:
        case BinaryOperatorType::OpGreater:
        case BinaryOperatorType::OpGreaterEqual:
        case BinaryOperatorType::OpEqual:
        case BinaryOperatorType::OpUnEqual:
                {
                        // In case of i64<->money, trigger 'cannot convert money to integer64'
                        if ((lhstype == VariableTypes::Float) || (rhstype == VariableTypes::Float))
                            return VariableTypes::Float;
                        else if ((lhstype == VariableTypes::Variant) || (rhstype == VariableTypes::Variant))
                            return VariableTypes::Variant;
                        else if (lhstype == VariableTypes::Money && rhstype != VariableTypes::Integer64)
                            return VariableTypes::Money;
                        else if (rhstype == VariableTypes::Money && lhstype != VariableTypes::Integer64)
                            return VariableTypes::Money;
                        else if (lhstype == VariableTypes::Integer64)// && rhstype != VariableTypes::Money)
                            return VariableTypes::Integer64;
                        else if (rhstype == VariableTypes::Integer64)// && lhstype != VariableTypes::Money)
                            return VariableTypes::Integer64;
                        return VariableTypes::Integer;
                }
        case BinaryOperatorType::OpModulo:
        case BinaryOperatorType::OpBitAnd:
        case BinaryOperatorType::OpBitOr:
        case BinaryOperatorType::OpBitXor:
        case BinaryOperatorType::OpBitLShift:
        case BinaryOperatorType::OpBitRShift:
                {
                        if (lhstype == VariableTypes::Integer64 || rhstype == VariableTypes::Integer64)
                            return VariableTypes::Integer64;
                        if ((lhstype == VariableTypes::Variant) || rhstype == VariableTypes::Variant)
                            return VariableTypes::Variant;

                        return VariableTypes::Integer;
                }
        default: return VariableTypes::Uninitialized;
        }
}

void SemanticChecker::CheckTableDef(SymbolDefs::TableDef &td)
{
        for (SymbolDefs::TableDef::ColumnsDef::iterator it = td.columnsdef.begin(); it != td.columnsdef.end(); ++it)
            if (it->flags & ColumnFlags::TranslateNulls)
            {
                    if (it->null_default_value == 0)
                        context.errorhandler.AddErrorAt(it->null_default_value->position, Error::ExpectedConstantExpression);
                    else
                    {
                            SafeVisit(it->null_default_value, true);
                            VerifyTypeWithCast(it->null_default_value, it->type);

                            if (it->type != VariableTypes::Blob)
                            {
                                    Constant* c = carim->Optimize(it->null_default_value);
                                    if (!c)
                                        context.errorhandler.AddErrorAt(it->null_default_value->position, Error::ExpectedConstantExpression);
                                    else
                                    {
                                            unsigned size = context.marshaller->Analyze(c->var);
                                            it->null_default.resize(size);
                                            context.marshaller->Write(c->var, &it->null_default[0], (&it->null_default[0]) + size);
                                    }
                            }
                            else
                            {
                                    Constant* c = carim->Optimize(it->null_default_value);
                                    if (!c)
                                        context.errorhandler.AddErrorAt(it->null_default_value->position, Error::ExpectedConstantExpression);
                                    else if (context.stackm.GetBlob(c->var).GetLength()>0) // Internal error; non-empty blobs are impossible to make right now.
                                        context.errorhandler.AddErrorAt(it->null_default_value->position, Error::InternalError, "Non-empty blobs not supported as NULL value.");
                            }
                    }
            }

        for (SymbolDefs::TableDef::ViewColumnsDef::iterator it = td.viewcolumnsdef.begin(); it != td.viewcolumnsdef.end(); ++it)
        {
                if (it->view_value_expr == 0)
                    context.errorhandler.AddErrorAt(it->view_value_expr->position, Error::ExpectedConstantExpression);
                else
                {
                        SafeVisit(it->view_value_expr, true);
                        VerifyTypeWithCast(it->view_value_expr, it->type);

                        if (it->type != VariableTypes::Blob)
                        {
                                Constant* c = carim->Optimize(it->view_value_expr);
                                if (!c)
                                    context.errorhandler.AddErrorAt(it->view_value_expr->position, Error::ExpectedConstantExpression);
                                else
                                {
                                        unsigned size = context.marshaller->Analyze(c->var);
                                        it->view_value.resize(size);
                                        context.marshaller->Write(c->var, &it->view_value[0], (&it->view_value[0]) + size);
                                }
                        }
                        else
                        {
                                Constant* c = carim->Optimize(it->view_value_expr);
                                if (!c)
                                    context.errorhandler.AddErrorAt(it->view_value_expr->position, Error::ExpectedConstantExpression);
                                else if (context.stackm.GetBlob(c->var).GetLength()>0) // Internal error; non-empty blobs are impossible to make right now.
                                    context.errorhandler.AddErrorAt(it->view_value_expr->position, Error::InternalError, "Non-empty blobs not supported as NULL value.");
                        }
                }
        }
}

void SemanticChecker::CheckToken(Symbol *symbol)
{
        if (!checkedsymbols.insert(symbol).second)
            return;

        if (!symbol->variabledef) return;

        SymbolDefs::TableDef &td = symbol->variabledef->tabledef;
        CheckTableDef(td);

        for (SymbolDefs::SchemaDef::TablesDef::iterator it = symbol->variabledef->schemadef.tablesdef.begin(); it != symbol->variabledef->schemadef.tablesdef.end(); ++it)
            CheckTableDef(it->tabledef);
}

void SemanticChecker::CheckObject(Symbol *symbol)
{
        SymbolDefs::ObjectDef &objdef = *symbol->objectdef;

        Symbol *constructor = symbol->objectdef->constructor;
        if (constructor->functiondef->returntype != VariableTypes::NoReturn)
            context.errorhandler.AddErrorAt(constructor->definitionposition, Error::MemberNewMustBeMacro);

        // Check all members if the update flag is correct as far as we know
        for (SymbolDefs::ObjectDef::Fields::iterator it = objdef.fields.begin(); it != objdef.fields.end(); ++it)
        {
                if (it->type == ObjectCellType::Property)
                {
                        if (!it->getter.empty() && !objdef.FindField(it->getter, true) && it->getter_check)
                            context.errorhandler.AddErrorAt(it->getter_pos, Error::MemberDoesNotExist, it->getter, symbol->name);
                        if (!it->setter.empty() && !objdef.FindField(it->setter, true) && it->setter_check)
                            context.errorhandler.AddErrorAt(it->setter_pos, Error::MemberDoesNotExist, it->setter, symbol->name);

                        // For complicated getters/setters, the primary field must exist & be a member
                        if (!it->getter_primary.empty())
                        {
                                SymbolDefs::ObjectField *field = objdef.FindField(it->getter_primary, true);
                                if (!field)
                                {
                                        if (it->getter_check)
                                            context.errorhandler.AddErrorAt(it->getter_pos, Error::MemberDoesNotExist, it->getter_primary, symbol->name);
                                }
                                else if (field->type != ObjectCellType::Member)
                                {
                                        context.errorhandler.AddErrorAt(it->getter_pos, Error::NoFunctionsInComplicatedProperties, it->getter_primary, symbol->name);

                                        // Skip checking of the generated getter function, it will generate extra (& confusing) errors
                                        skipfunctions.insert(it->getter);
                                }
                        }
                        if (!it->setter_primary.empty())
                        {
                                SymbolDefs::ObjectField *field = objdef.FindField(it->setter_primary, true);
                                if (!field)
                                {
                                        if (it->setter_check)
                                            context.errorhandler.AddErrorAt(it->setter_pos, Error::MemberDoesNotExist, it->setter_primary, symbol->name);
                                }
                                else if (field->type != ObjectCellType::Member)
                                {
                                        context.errorhandler.AddErrorAt(it->setter_pos, Error::NoFunctionsInComplicatedProperties, it->setter_primary, symbol->name);

                                        // Skip checking of the generated getter function, it will generate extra (& confusing) errors
                                        skipfunctions.insert(it->setter);
                                }
                        }

                        // Either getter or setter must be set for a property
                        if (it->getter.empty() && it->setter.empty())
                            context.errorhandler.AddErrorAt(it->getter_pos, Error::PropertyMustHaveGetOrSet);
                }

                // Can't check further if there ain't no base class
                if (!objdef.base)
                    continue;

                Symbol *curr = objdef.base;
                SymbolDefs::ObjectField *oldfield(0);
                if (curr)
                    oldfield = curr->objectdef->FindField(it->name, true);

                // No previous field found? Can't check any further
                if (!oldfield)
                    continue;

                if (oldfield->type != it->type)
                {
                        context.errorhandler.AddErrorAt(it->declpos, Error::OverrideMemberTypeChange);
                        continue;
                }

                if (!it->is_update)
                {
                        context.errorhandler.AddErrorAt(it->declpos, Error::UpdateReqForFieldOverride, it->name, symbol->name);
                        continue;
                }
                if (it->is_private && !oldfield->is_private)
                {
                        context.errorhandler.AddWarningAt(it->declpos, Warning::UpdateMakesFieldPrivate, it->name, symbol->name);
                }


                // The following check can only be executed when for methods of which weknow the old and new signatures
                if (it->type != ObjectCellType::Method || !oldfield->method || !it->method)
                    continue;

                if (it->method->functiondef->returntype != oldfield->method->functiondef->returntype)
                {
                    context.errorhandler.AddErrorAt(it->declpos, Error::NeedCompatibleSignatures, it->name);
                    continue;
                }

                bool old_is_vararg = oldfield->method->functiondef->flags & FunctionFlags::VarArg;
                bool new_is_vararg = it->method->functiondef->flags & FunctionFlags::VarArg;
                bool have_errors = true;

                // Vararg function must stay a vararg function
                if (new_is_vararg || old_is_vararg)
                {
                        if (new_is_vararg != old_is_vararg)
                            context.errorhandler.AddErrorAt(it->declpos, Error::NeedCompatibleSignatures, it->name);
                        else if (it->method->functiondef->arguments.size() != oldfield->method->functiondef->arguments.size())
                            context.errorhandler.AddErrorAt(it->declpos, Error::NeedCompatibleSignatures, it->name);
                        else
                            have_errors = false;
                }
                else
                {
                        if (it->method->functiondef->arguments.size() < oldfield->method->functiondef->arguments.size())
                            context.errorhandler.AddErrorAt(it->declpos, Error::NeedCompatibleSignatures, it->name);
                        else
                            have_errors = false;
                }
                if (have_errors)
                    continue;

                for (unsigned idx = 0, end = oldfield->method->functiondef->arguments.size(); idx < end; ++idx)
                {
                        if (it->method->functiondef->arguments[idx].symbol->variabledef->type != oldfield->method->functiondef->arguments[idx].symbol->variabledef->type)
                        {
                                context.errorhandler.AddErrorAt(it->declpos, Error::NeedCompatibleSignatures, it->name);
                                break;
                        }
                        if (!it->method->functiondef->arguments[idx].value && oldfield->method->functiondef->arguments[idx].value)
                        {
                                context.errorhandler.AddErrorAt(it->declpos, Error::NeedCompatibleSignatures, it->name);
                                break;
                        }
                }
                for (unsigned idx = oldfield->method->functiondef->arguments.size(), end = it->method->functiondef->arguments.size(); idx < end; ++idx)
                {
                        if (!it->method->functiondef->arguments[idx].value)
                        {
                                context.errorhandler.AddErrorAt(it->declpos, Error::NeedCompatibleSignatures, it->name);
                                break;
                        }
                }
        }
}

SymbolDefs::ObjectDef * SemanticChecker::GetObjectDefFromExpression(Rvalue *expr)
{
        SymbolDefs::ObjectDef *objectdef = 0;
        if (FunctionCall *fc = dynamic_cast< FunctionCall * >(expr))
        {
              if (fc->symbol->name != ":OBJECTMAKEPRIVREF" || fc->parameters.size() == 0)
                  return 0;
              expr = fc->parameters[0];
        }
        Variable *var = dynamic_cast< Variable * >(expr);
        if (var)
            objectdef = var->symbol->variabledef->objectdef;

        return objectdef;
}

void SemanticChecker::V_ArrayDelete (ArrayDelete *obj, bool /*check_return*/)
{
        SafeVisit(obj->array, true);

        if (obj->location.type == ArrayLocation::Index && obj->location.expr)
        {
                ++arrayindexdepth;
                SafeVisit(obj->location.expr, true);
                VerifyTypeWithCast(obj->location.expr, VariableTypes::Integer);
                --arrayindexdepth;
        }
        else
            if (obj->location.type != ArrayLocation::All)
                throw Message(true, Error::InternalError, "Unallowed location type found");

        // array must be of type array, ref must be of type integer
        VariableTypes::Type exprtype = typestorage[obj->array];
        if (!IsTypeArray(exprtype))
            context.errorhandler.AddErrorAt(obj->array->position, Error::TypeNotArray);
}
void SemanticChecker::V_ArrayElementConst (ArrayElementConst *obj, bool /*check_return*/)
{
        SafeVisit(obj->array, true);

        ++arrayindexdepth;
        SafeVisit(obj->index, true);
        --arrayindexdepth;

        VariableTypes::Type exprtype = typestorage[obj->array];
        if (!IsTypeArray(exprtype))
            context.errorhandler.AddErrorAt(obj->array->position, Error::TypeNotArray);

        VerifyTypeWithCast(obj->index, VariableTypes::Integer);

        typestorage[obj] = ToNonArray(typestorage[obj->array]);
}

void SemanticChecker::V_ArrayElementModify (ArrayElementModify *obj, bool /*check_return*/)
{
        SafeVisit(obj->array, true);

        ++arrayindexdepth;
        SafeVisit(obj->index, true);
        --arrayindexdepth;

        SafeVisit(obj->value, true);
        VariableTypes::Type exprtype = typestorage[obj->array];
        if (!IsTypeArray(exprtype))
            context.errorhandler.AddErrorAt(obj->array->position, Error::TypeNotArray);

        VerifyTypeWithCast(obj->index, VariableTypes::Integer);
        VerifyTypeWithCast(obj->value, ToNonArray(typestorage[obj->array]));

        typestorage[obj] = typestorage[obj->array];
}

void SemanticChecker::V_ArrayInsert (ArrayInsert *obj, bool /*check_return*/)
{
        SafeVisit(obj->array, true);
        SafeVisit(obj->value, true);
        VariableTypes::Type exprtype = typestorage[obj->array];
        if (!IsTypeArray(exprtype))
            context.errorhandler.AddErrorAt(obj->array->position, Error::TypeNotArray);

        if (obj->location.type == ArrayLocation::End) ;
        else if (obj->location.type == ArrayLocation::Index && obj->location.expr)
        {
                ++arrayindexdepth;
                SafeVisit(obj->location.expr, true);
                --arrayindexdepth;

                VerifyTypeWithCast(obj->location.expr, VariableTypes::Integer);
        } else
            throw Message(true, Error::InternalError, "Unallowed location type found");

        VerifyTypeWithCast(obj->value, ToNonArray(typestorage[obj->array]));
}

void SemanticChecker::V_Assignment (Assignment *obj, bool)
{
        SafeVisit(obj->source, true);

        VariableTypes::Type source_type = typestorage[obj->source];
        if (source_type == VariableTypes::NoReturn)
        {
                context.errorhandler.AddErrorAt(obj->source->position, Error::MacroDoesNotReturnValue);
                typestorage[obj] = VariableTypes::Variant;
                return;
        }

        // Copy the type from the source if needed
        Variable *var = dynamic_cast<Variable *>(obj->target);
        if (!var) var = dynamic_cast<ExpressionBlock *>(obj->target)->returnvar;
        if (!var)
            throw Message(true, Error::InternalError, "Assignment from a not allowed AST node type");

        CheckToken(var->symbol);

        // If type is not specified, copy from the source
        if (var->symbol->variabledef->type == VariableTypes::Uninitialized)
            var->symbol->variabledef->type = typestorage[obj->source];

        SafeVisit(obj->target, true);

        VerifyTypeWithCast(obj->source, var->symbol->variabledef->type);

        if (var->symbol->variabledef->is_constref && !obj->is_initial_assignment)
            context.errorhandler.AddErrorAt(var->position, Error::CannotModifyAConstantVariable);

        // Handling constants in this way works because the initfunction is checked first
        if (var->symbol->variabledef->is_constant && obj->is_initial_assignment && !var->symbol->variabledef->constexprvalue)
        {
                Constant *c = carim->ForceOptimize(obj->source);
                if (c)
                {
                        var->symbol->variabledef->constexprvalue = c;
                        TreeCopyingVisitor copier(context);
                        obj->source = copier.GetCopy(c);
                }
                else
                {
                        var->symbol->variabledef->constexprvalue = coder.ImSafeErrorValueReturn(obj->source->position);
                }
        }

        typestorage[obj] = var->symbol->variabledef->type;
}
void SemanticChecker::V_BinaryOperator (BinaryOperator *obj, bool)
{
        SafeVisit(obj->lhs, true);
        SafeVisit(obj->rhs, true);

        VariableTypes::Type lhs_type = typestorage[obj->lhs];
        VariableTypes::Type rhs_type = typestorage[obj->rhs];

        if (lhs_type == VariableTypes::NoReturn)
        {
                context.errorhandler.AddErrorAt(obj->lhs->position, Error::MacroDoesNotReturnValue);
                typestorage[obj] = VariableTypes::Variant;
                return;
        }
        if (rhs_type == VariableTypes::NoReturn)
        {
                context.errorhandler.AddErrorAt(obj->rhs->position, Error::MacroDoesNotReturnValue);
                typestorage[obj] = VariableTypes::Variant;
                return;
        }

        switch (obj->operation)
        {
        case BinaryOperatorType::OpAnd:
        case BinaryOperatorType::OpOr:
        case BinaryOperatorType::OpXor:
                {
                        VerifyTypeWithCast(obj->lhs, VariableTypes::Boolean);
                        VerifyTypeWithCast(obj->rhs, VariableTypes::Boolean);
                        typestorage[obj] = VariableTypes::Boolean;
                }; break;
        case BinaryOperatorType::OpAdd:
        case BinaryOperatorType::OpSubtract:
        case BinaryOperatorType::OpMultiply:
        case BinaryOperatorType::OpDivide:
                {
                        // Parameters must be numeric, returntype is numeric
                        bool left_ok = VerifyTypeNumeric(obj->lhs);
                        if (VerifyTypeNumeric(obj->rhs) && left_ok)
                        {
                                VariableTypes::Type lhs_type = BinaryNumericType(typestorage[obj->lhs], obj->operation, typestorage[obj->rhs]);

                                if (typestorage[obj->lhs] != lhs_type && lhs_type != VariableTypes::Variant)
                                    VerifyTypeWithCast(obj->lhs, lhs_type);
                                if (typestorage[obj->rhs] != lhs_type && lhs_type != VariableTypes::Variant)
                                    VerifyTypeWithCast(obj->rhs, rhs_type);

                                typestorage[obj] = lhs_type;
                        }
                        else
                            typestorage[obj] = VariableTypes::Variant;
                }; break;
        case BinaryOperatorType::OpModulo:
        case BinaryOperatorType::OpBitAnd:
        case BinaryOperatorType::OpBitOr:
        case BinaryOperatorType::OpBitXor:
        case BinaryOperatorType::OpBitLShift:
        case BinaryOperatorType::OpBitRShift:
                {
                        // Parameters must be integer, returntype is integer
                        bool left_ok = VerifyTypeInteger(obj->lhs);
                        if (VerifyTypeInteger(obj->rhs) && left_ok)
                        {
                                VariableTypes::Type lhs_type = BinaryNumericType(typestorage[obj->lhs], obj->operation, typestorage[obj->rhs]);

                                if (typestorage[obj->lhs] != lhs_type && lhs_type != VariableTypes::Variant)
                                    VerifyTypeWithCast(obj->lhs, lhs_type);
                                if (typestorage[obj->rhs] != lhs_type && lhs_type != VariableTypes::Variant)
                                    VerifyTypeWithCast(obj->rhs, rhs_type);

                                typestorage[obj] = lhs_type;
                        }
                        else
                            typestorage[obj] = VariableTypes::Variant;
                } break;
/*
                {
                         // Parameters must be integers, returntype is integer
                         VerifyTypeWithCast(obj->lhs, VariableTypes::Integer);
                         VerifyTypeWithCast(obj->rhs, VariableTypes::Integer);
                         typestorage[obj] = VariableTypes::Integer;
                } break;
*/
        case BinaryOperatorType::OpLess:
        case BinaryOperatorType::OpLessEqual:
        case BinaryOperatorType::OpGreater:
        case BinaryOperatorType::OpGreaterEqual:
        case BinaryOperatorType::OpEqual:
        case BinaryOperatorType::OpUnEqual:

                // Parameters must be of compatible types, and one of the following:
                // Integer, Money, Float, String, DateTime
                // For OpEqual and OpUnEqual the lhs_type can also be Boolean
                // Numeric types
                if (IsTypeNumeric(lhs_type) && IsTypeNumeric(rhs_type))
                {
                        lhs_type = BinaryNumericType(lhs_type, obj->operation, rhs_type);
                        VerifyTypeWithCast(obj->lhs, lhs_type);
                        VerifyTypeWithCast(obj->rhs, lhs_type);
                }
                else
                {
                        if (lhs_type == VariableTypes::Variant)
                        {
                                // May not cast numeric types or variants; promotion is done in VM based on dynamic type.
                                if (rhs_type != VariableTypes::Variant && !IsTypeNumeric(rhs_type))
                                    VerifyTypeWithCast(obj->lhs, rhs_type);
                        }
                        else if (rhs_type == VariableTypes::Variant)
                        {
                                // May not cast numeric types; promotion is done in VM based on dynamic type.
                                if (!IsTypeNumeric(lhs_type))
                                    VerifyTypeWithCast(obj->rhs, lhs_type);
                        }
                        else if (!TypesEqual(typestorage[obj->lhs], typestorage[obj->rhs]))
                        {
                                context.errorhandler.AddErrorAt(obj->position, Error::CannotConvertType, HareScript::GetTypeName(typestorage[obj->lhs]), HareScript::GetTypeName(typestorage[obj->rhs]));
                        }
                        else if ((obj->operation == BinaryOperatorType::OpLess || obj->operation == BinaryOperatorType::OpLessEqual || obj->operation == BinaryOperatorType::OpGreater || obj->operation == BinaryOperatorType::OpGreaterEqual)
                                            && !IsTypeOrderable(lhs_type))
                        {
                                context.errorhandler.AddErrorAt(obj->position, Error::NoOrderingDefined, HareScript::GetTypeName(lhs_type));
                        }
                        else if (!IsTypeComparable(typestorage[obj->lhs]))
                        {
                                context.errorhandler.AddErrorAt(obj->position, Error::CompareNotAllowed, HareScript::GetTypeName(typestorage[obj->lhs]));
                        }
                }

                typestorage[obj] = VariableTypes::Boolean;
                break;

        case BinaryOperatorType::OpLike:
                //Stack_Like depends on the semantic checker doing type checking
                VerifyTypeWithCast(obj->lhs, VariableTypes::String);
                VerifyTypeWithCast(obj->rhs, VariableTypes::String);
                typestorage[obj] = VariableTypes::Boolean;
                break;

        case BinaryOperatorType::OpIn:
                if (!IsTypeArray(rhs_type))
                   context.errorhandler.AddErrorAt(obj->rhs->position, Error::TypeNotArray, HareScript::GetTypeName(rhs_type));
                else
                    VerifyTypeWithCast(obj->lhs, ToNonArray(rhs_type));

                typestorage[obj] = VariableTypes::Boolean;
                break;

        case BinaryOperatorType::OpConcat:
                if (!IsTypeArray(lhs_type))
                    context.errorhandler.AddErrorAt(obj->lhs->position, Error::TypeNotArray, HareScript::GetTypeName(rhs_type));
                if (!IsTypeArray(rhs_type))
                    context.errorhandler.AddErrorAt(obj->rhs->position, Error::TypeNotArray, HareScript::GetTypeName(rhs_type));
                if (!TypesEqual(lhs_type, rhs_type))
                    context.errorhandler.AddErrorAt(obj->rhs->position,
                                                    Error::CannotConvertType,
                                                    HareScript::GetTypeName(rhs_type),
                                                    HareScript::GetTypeName(lhs_type));
                typestorage[obj] = IsTypeArray(lhs_type) ? lhs_type : VariableTypes::Variant;
                break;

        case BinaryOperatorType::OpMerge:
                {
                        // Parameters must be of the same lhs_type, and one of the following:
                        // Integer, String
                        if (lhs_type != VariableTypes::String && lhs_type != VariableTypes::Integer && lhs_type != VariableTypes::Integer64 && lhs_type != VariableTypes::Variant)
                            context.errorhandler.AddErrorAt(obj->lhs->position, Error::CannotConvertType, HareScript::GetTypeName(lhs_type), HareScript::GetTypeName(VariableTypes::String));

                        if (rhs_type != VariableTypes::String && rhs_type != VariableTypes::Integer && rhs_type != VariableTypes::Integer64 && rhs_type != VariableTypes::Variant)
                            context.errorhandler.AddErrorAt(obj->rhs->position, Error::CannotConvertType, HareScript::GetTypeName(rhs_type), HareScript::GetTypeName(VariableTypes::String));

                        typestorage[obj] = VariableTypes::String;
                }; break;

        case BinaryOperatorType::OpNullCoalesce:
                {
                        VariableTypes::Type lhstype = typestorage[obj->lhs];
                        VariableTypes::Type rhstype = typestorage[obj->rhs];

                        bool has_error = false;
                        if (!IsTypeComparable(lhstype) && lhstype != VariableTypes::Record && lhstype != VariableTypes::Blob && (!(lhstype & VariableTypes::Array)))
                        {
                                has_error = true;
                                if (lhstype == VariableTypes::NoReturn)
                                    context.errorhandler.AddErrorAt(obj->lhs->position, Error::MacroDoesNotReturnValue);
                                else
                                    context.errorhandler.AddErrorAt(obj->position, Error::CompareNotAllowed, HareScript::GetTypeName(typestorage[obj->lhs]));
                        }

                        if (rhstype == VariableTypes::NoReturn)
                            has_error = true, context.errorhandler.AddErrorAt(obj->rhs->position, Error::MacroDoesNotReturnValue);

                        if (!has_error)
                        {
                                VariableTypes::Type resulttype = (lhstype != VariableTypes::Variant) ? lhstype : rhstype;

                                if (!has_error && lhstype != rhstype && lhstype != VariableTypes::Variant && rhstype != VariableTypes::Variant)
                                    context.errorhandler.AddErrorAt(obj->lhs->position, Error::ConditionEqualTypes, HareScript::GetTypeName(typestorage[obj->lhs]), HareScript::GetTypeName(typestorage[obj->rhs]));
                                else
                                {
                                        VerifyTypeWithCast(obj->lhs, resulttype);
                                        VerifyTypeWithCast(obj->rhs, resulttype);
                                }
                                typestorage[obj] = resulttype;
                        }
                        else
                            typestorage[obj] = VariableTypes::Variant;
                }; break;

        default:
                throw std::runtime_error("Missing binary operation type handler in SemanticChecker::V_BinaryOperator");
        }
}
void SemanticChecker::V_Block (Block *obj, bool)
{
        // Only check END when starting at a block
        unsigned old_arrayindexdepth = arrayindexdepth;
        arrayindexdepth = 0;

        for (std::vector<Statement*>::iterator it = obj->statements.begin(); it != obj->statements.end(); ++it)
            SafeVisit(*it, false);

        arrayindexdepth = old_arrayindexdepth;
}
void SemanticChecker::V_BreakStatement (BreakStatement *obj, bool)
{
        if (!loopdepth)
            context.errorhandler.AddErrorAt(obj->position, Error::UnexpectedBreakContinue);
}

void SemanticChecker::V_BuiltinInstruction (AST::BuiltinInstruction *obj, bool)
{
        std::for_each(obj->parameters.begin(), obj->parameters.end(), GetSafeVisitorFunctor(this, true));

        typestorage[obj] = obj->result_type;
}

void SemanticChecker::V_Cast(Cast *obj, bool)
{
        SafeVisit(obj->expr, true);

        VariableTypes::Type exprtype = typestorage[obj->expr];

        VariableTypes::Type wantedtype = obj->to_type;

        if (wantedtype == VariableTypes::Variant || wantedtype == VariableTypes::Schema)
        {
                typestorage[obj] = VariableTypes::Variant;
                context.errorhandler.AddErrorAt(obj->position, Error::CannotConvertType, HareScript::GetTypeName(exprtype), HareScript::GetTypeName(wantedtype));
        }
        else if (exprtype == VariableTypes::NoReturn)
        {
                typestorage[obj] = VariableTypes::Variant;
                context.errorhandler.AddErrorAt(obj->expr->position, Error::MacroDoesNotReturnValue);
        }
        else
        {
                // Assume the cast works
                typestorage[obj] = obj->to_type;

                // Casts that always work
                if (wantedtype == VariableTypes::VariantArray && (exprtype & VariableTypes::Array))
                    return;
                if (wantedtype == VariableTypes::Record && exprtype == VariableTypes::RecordArray)
                    return;
                if (exprtype == VariableTypes::Variant || exprtype == wantedtype)
                    return;

                if (!obj->is_explicit)
                {
                        // Implicit number casting
                        if ((wantedtype == VariableTypes::Integer64 && exprtype == VariableTypes::Integer)
                             || (wantedtype == VariableTypes::Money && exprtype == VariableTypes::Integer)
                             || (wantedtype == VariableTypes::Float && exprtype == VariableTypes::Integer)
                             || (wantedtype == VariableTypes::Float && exprtype == VariableTypes::Integer64)
                             || (wantedtype == VariableTypes::Float && exprtype == VariableTypes::Money))
                            return;
                }
                else
                {
                        VariableTypes::Type test_wantedtype = wantedtype;
                        VariableTypes::Type test_exprtype = exprtype;

                        // Explicit casts can cast array elements too (but not X array->X in the non-record case)
                        if ((wantedtype & VariableTypes::Array) && (exprtype & VariableTypes::Array))
                        {
                                if (exprtype == VariableTypes::VariantArray)
                                    return;

                                test_wantedtype = ToNonArray(wantedtype);
                                test_exprtype = ToNonArray(exprtype);
                        }

                        // Converting object <-> weak object
                        if ((test_wantedtype == VariableTypes::Object && test_exprtype == VariableTypes::WeakObject)
                             || (test_wantedtype == VariableTypes::WeakObject && test_exprtype == VariableTypes::Object))
                            return;

                        // Explicit number casting
                        if ((test_wantedtype == VariableTypes::Integer
                             || test_wantedtype == VariableTypes::Integer64
                             || test_wantedtype == VariableTypes::Money
                             || test_wantedtype == VariableTypes::Float)
                            && (test_exprtype == VariableTypes::Integer
                             || test_exprtype == VariableTypes::Integer64
                             || test_exprtype == VariableTypes::Money
                             || test_exprtype == VariableTypes::Float))
                                return;
                }

                context.errorhandler.AddErrorAt(obj->position, Error::CannotConvertType, HareScript::GetTypeName(exprtype), HareScript::GetTypeName(wantedtype));
        }
}
void SemanticChecker::V_ConditionalOperator (ConditionalOperator *obj, bool)
{
        SafeVisit(obj->condition, true);
        SafeVisit(obj->expr_true, true);
        SafeVisit(obj->expr_false, true);

        VariableTypes::Type lhstype = typestorage[obj->expr_true];
        VariableTypes::Type rhstype = typestorage[obj->expr_false];

        if (typestorage[obj->condition] != VariableTypes::Boolean && typestorage[obj->condition] != VariableTypes::Variant)
            context.errorhandler.AddErrorAt(obj->condition->position, Error::ConditionMustBeBoolean);
        else
            VerifyTypeWithCast(obj->condition, VariableTypes::Boolean);

        bool has_error = false;
        if (lhstype == VariableTypes::NoReturn)
            has_error = true, context.errorhandler.AddErrorAt(obj->expr_true->position, Error::MacroDoesNotReturnValue);
        if (rhstype == VariableTypes::NoReturn)
            has_error = true, context.errorhandler.AddErrorAt(obj->expr_false->position, Error::MacroDoesNotReturnValue);

        if (!has_error)
        {
                VariableTypes::Type resulttype = (lhstype != VariableTypes::Variant) ? lhstype : rhstype;

                if (!has_error && lhstype != rhstype && lhstype != VariableTypes::Variant && rhstype != VariableTypes::Variant)
                    context.errorhandler.AddErrorAt(obj->expr_true->position, Error::ConditionEqualTypes, HareScript::GetTypeName(typestorage[obj->expr_true]), HareScript::GetTypeName(typestorage[obj->expr_false]));
                else
                {
                        VerifyTypeWithCast(obj->expr_true, resulttype);
                        VerifyTypeWithCast(obj->expr_false, resulttype);
                }
                typestorage[obj] = resulttype;
        }
        else
            typestorage[obj] = VariableTypes::Variant;
}

void SemanticChecker::V_ConditionalStatement (ConditionalStatement *obj, bool)
{
        SafeVisit(obj->condition, false);
        SafeVisit(obj->stat_true, false);
        if (obj->stat_false)
            SafeVisit(obj->stat_false, false);

        if (typestorage[obj->condition] != VariableTypes::Boolean && typestorage[obj->condition] != VariableTypes::Variant)
            context.errorhandler.AddErrorAt(obj->condition->position, Error::ConditionMustBeBoolean);
        else
            VerifyTypeWithCast(obj->condition, VariableTypes::Boolean);
}

void SemanticChecker::V_Constant (Constant *obj, bool)
{
        typestorage[obj] = obj->type;
}

void SemanticChecker::V_ConstantRecord (AST::ConstantRecord *obj, bool)
{
        // Parser forbids empty records
        std::set<std::string> names;
        std::set<std::string> deleted;
        bool have_ellipsis = false;
        // Add all columns
        for (auto &itr: obj->columns)
        {
                SafeVisit(std::get<2>(itr), true);

                // Check for MACRO calls, this is the last chance for that.
                if (typestorage[std::get<2>(itr)] == VariableTypes::NoReturn)
                    context.errorhandler.AddErrorAt(std::get<2>(itr)->position, Error::MacroDoesNotReturnValue);

                Blex::ToUppercase(std::get<1>(itr).begin(), std::get<1>(itr).end());
                switch (std::get<0>(itr))
                {
                    case AST::ConstantRecord::Item:
                    {
                            if (!names.insert(std::get<1>(itr)).second)
                                //insertion of column failed; column already exists
                                context.errorhandler.AddErrorAt(std::get<2>(itr)->position, Error::ColumnNameAlreadyExists, std::get<1>(itr));
                    } break;
                    case AST::ConstantRecord::Ellipsis:
                    {
                            VerifyTypeWithCast(std::get<2>(itr), VariableTypes::Record);
                            names.clear();
                            deleted.clear();
                            have_ellipsis = true;
                    } break;
                    case AST::ConstantRecord::Delete:
                    {
                            if (!deleted.insert(std::get<1>(itr)).second)
                                context.errorhandler.AddErrorAt(std::get<2>(itr)->position, Error::UnknownColumn, std::get<1>(itr));
                            else
                            {
                                    auto nitr = names.find(std::get<1>(itr));
                                    if (nitr != names.end())
                                        names.erase(nitr);
                                    else if (!have_ellipsis)
                                        context.errorhandler.AddErrorAt(std::get<2>(itr)->position, Error::UnknownColumn, std::get<1>(itr));
                            }
                    } break;
                    default: break;
                }
        }
        typestorage[obj] = VariableTypes::Record;
}

void SemanticChecker::V_ConstantArray (AST::ConstantArray *obj, bool)
{
        unsigned auto_type = 0;

        VariableTypes::Type type, elttype;

        if (obj->type == VariableTypes::Uninitialized)
        {
                if (obj->values.empty())
                    throw std::runtime_error("Found a empty constant array without explicity type!");

                bool have_single_elt = false;
                for (auto it = obj->values.begin(); it != obj->values.end(); ++it, ++auto_type)
                {
                        SafeVisit(std::get<1>(*it), true);

                        elttype = typestorage[std::get<1>(*it)];
                        if (std::get<2>(*it)) // ellipsis?
                        {
                                if (elttype != VariableTypes::Variant && !(elttype & VariableTypes::Array))
                                    context.errorhandler.AddErrorAt(std::get<1>(*it)->position, Error::TypeNotArray);
                        }
                        else
                        {
                                have_single_elt = true;
                                if (elttype & VariableTypes::Array)
                                    context.errorhandler.AddErrorAt(std::get<1>(*it)->position, Error::NoMultiLevelArrays);

                                if (elttype == VariableTypes::Table)
                                    context.errorhandler.AddErrorAt(std::get<1>(*it)->position, Error::NoTableArray);
                                if (elttype == VariableTypes::Schema)
                                    context.errorhandler.AddErrorAt(std::get<1>(*it)->position, Error::NoSchemaArray);

                                if (elttype == VariableTypes::Variant)
                                {
                                        context.errorhandler.AddErrorAt(std::get<1>(*it)->position, Error::FirstElementUnknownType);
                                        typestorage[obj] = VariableTypes::Variant;
                                        return;
                                }

                                type = ToArray(elttype);
                                break;
                        }
                }

                if (!have_single_elt)
                {
                        context.errorhandler.AddErrorAt(obj->position, Error::NonEllipsisValueRequired);
                        typestorage[obj] = VariableTypes::Variant;
                        return;
                }

        }
        else
        {
                type = obj->type;
                elttype = ToNonArray(type);
        }

        for (auto it = obj->values.begin() + auto_type; it != obj->values.end(); ++it)
        {
                SafeVisit(std::get<1>(*it), true);
                VerifyTypeWithCast(std::get<1>(*it), std::get<2>(*it) ? type : elttype);
        }

        typestorage[obj] = type;
}

void SemanticChecker::V_ContinueStatement (ContinueStatement *obj, bool)
{
        if (!loopdepth)
            context.errorhandler.AddErrorAt(obj->position, Error::UnexpectedBreakContinue);

}

void SemanticChecker::V_DeepOperation (AST::DeepOperation *obj, bool)
{
        Visit(obj->clvalue.base, false);

        if (obj->clvalue.basevar && obj->clvalue.basevar->variabledef->is_constref)
            context.errorhandler.AddErrorAt(obj->clvalue.base->position, Error::CannotModifyAConstantVariable);

        // All exprs for array indices must be integers, for record cells & objects they must be strings
        for (LvalueLayers::iterator it = obj->clvalue.layers.begin(); it != obj->clvalue.layers.end(); ++it)
        {
               if (it->type == LvalueLayer::Array)
               {
                        ++arrayindexdepth;
                        SafeVisit(it->expr, true);
                        VerifyTypeWithCast(it->expr, VariableTypes::Integer);
                        --arrayindexdepth;
               }
               else if (it->expr)
               {
                        Visit(it->expr, true);
                        VerifyTypeWithCast(it->expr, VariableTypes::String);
               }
        }

        if (!obj->clvalue.layers.empty())
        {
                VariableTypes::Type gottype = VariableTypes::Variant;
                if (obj->clvalue.basevar)
                    gottype = obj->clvalue.basevar->variabledef->type;
                switch (obj->clvalue.layers[0].type)
                {
                case LvalueLayer::Array:
                    {
                            if (obj->clvalue.layers.size() > 1 && obj->clvalue.layers[1].type == LvalueLayer::Record)
                                VerifyTypeAt(obj->position, VariableTypes::RecordArray, gottype);
                            else if (gottype != VariableTypes::Variant && !(gottype & VariableTypes::Array))
                                context.errorhandler.AddErrorAt(obj->position, Error::TypeNotArray);
                    } break;
                case LvalueLayer::Record:
                    {
                            if (gottype == VariableTypes::Object)
                                context.errorhandler.AddErrorAt(obj->position, Error::ExpectedArrowOperator);
                            else if (!TypesEqual(gottype, VariableTypes::Record))
                                context.errorhandler.AddErrorAt(obj->position, Error::CannotConvertType, HareScript::GetTypeName(gottype), HareScript::GetTypeName(VariableTypes::Record));
                    } break;
                case LvalueLayer::Object:
                    {
                            SymbolDefs::ObjectDef *objectdef = GetObjectDefFromExpression(obj->clvalue.base);
                            if (objectdef)
                            {
                                    SymbolDefs::ObjectField *field = objectdef->FindField(obj->clvalue.layers[0].name, true);
                                    if (field && field->type == ObjectCellType::Member)
                                        obj->clvalue.layers[0].is_member = true;
                            }


                            if (gottype == VariableTypes::Record)
                                context.errorhandler.AddErrorAt(obj->position, Error::ExpectedDotOperator);
                            else VerifyTypeWithCast(obj->clvalue.base, VariableTypes::Object);
                    } break;
                }
        }
}

void SemanticChecker::V_DeepArrayDelete (DeepArrayDelete *obj, bool)
{
        V_DeepOperation(obj, false);

        if (obj->location.type == ArrayLocation::Index && obj->location.expr)
        {
                ++arrayindexdepth;
                SafeVisit(obj->location.expr, true);
                --arrayindexdepth;

                VerifyTypeWithCast(obj->location.expr, VariableTypes::Integer);
        }
        else
            throw Message(true, Error::InternalError, "Unallowed location type found");
}

void SemanticChecker::V_DeepArrayInsert (DeepArrayInsert *obj, bool)
{
        V_DeepOperation(obj, false);

        if (obj->location.type == ArrayLocation::End) ;
        else if (obj->location.type == ArrayLocation::Index && obj->location.expr)
        {
                ++arrayindexdepth;
                SafeVisit(obj->location.expr, true);
                --arrayindexdepth;

                VerifyTypeWithCast(obj->location.expr, VariableTypes::Integer);
        }
        else
            throw Message(true, Error::InternalError, "Unallowed location type found");

        Visit(obj->value, true);
}

void SemanticChecker::V_End (End*obj, bool)
{
        if (!arrayindexdepth)
            context.errorhandler.AddErrorAt(obj->position, Error::EndWithoutArray);

        typestorage[obj] = VariableTypes::Integer;
}

void SemanticChecker::V_ExpressionBlock (AST::ExpressionBlock *obj, bool)
{
        if (obj->block)
            Visit(obj->block, false);
        Visit(obj->returnvar, true);
        typestorage[obj] = typestorage[obj->returnvar];
}

void SemanticChecker::V_ForEveryStatement(AST::ForEveryStatement *obj, bool)
{
        Visit(obj->source, true);
        Visit(obj->iteratevar, true);
        Visit(obj->positionvar, true);

        VerifyTypeWithCast(obj->source, static_cast<VariableTypes::Type>(typestorage[obj->iteratevar] | VariableTypes::Array));
        ++loopdepth;
        Visit(obj->loop, false);
        --loopdepth;
}

void SemanticChecker::V_Function (Function *obj, bool)
{
        currentfunc = obj;
        bool is_vararg = obj->symbol->functiondef->flags & FunctionFlags::VarArg;

        // Disallow usage of TABLE and SCHEMA as return type/parameter type for normal (non-external) functions
        // Except when in a system library.

        if (obj->symbol->functiondef->returntype != VariableTypes::NoReturn)
        {
                if (obj->symbol->functiondef->returntype == VariableTypes::Schema && !(obj->symbol->functiondef->flags & FunctionFlags::External) && !context.is_system_library)
                    context.errorhandler.AddErrorAt(obj->position, Error::TypeSchemaNotAllowed);
        }

        // Generators must be a RECORD FUNCTION
        if (obj->symbol->functiondef->generator && obj->symbol->functiondef->returntype != VariableTypes::Object)
            context.errorhandler.AddErrorAt(obj->position, Error::OnlyObjectGeneratorFunctions);

        // Default values
        Symbol *first_default = 0;
        for (std::vector<SymbolDefs::FunctionDef::Argument>::iterator it = obj->symbol->functiondef->arguments.begin();
                it != obj->symbol->functiondef->arguments.end(); ++it)
        {
                if (it->symbol->variabledef->type == VariableTypes::Schema && !(obj->symbol->functiondef->flags & FunctionFlags::External) && !context.is_system_library)
                    context.errorhandler.AddErrorAt(it->symbol->definitionposition, Error::TypeSchemaNotAllowed);

                if (it->value)
                {
                        SafeVisit(it->value, true);
                        VerifyTypeWithCast(it->value, it->symbol->variabledef->type);
                        first_default = it->symbol;

                        carim->ForceOptimize(it->value);
                }
                else if (first_default && (!is_vararg || it != obj->symbol->functiondef->arguments.end() - 1))
                {
                        context.errorhandler.AddErrorAt(it->symbol->definitionposition, Error::MissingDefaultArgument, it->symbol->name, first_default->name);
                        first_default = 0;
                }
        }

        if (!obj->block) // External functions
            return;

        if (skipfunctions.count(obj->symbol->name))
            return;

        if (obj->symbol->functiondef->returntype != VariableTypes::NoReturn) // functions only
        {
                // If the last statement in the block is not a return, add a VM runtime error
                if (obj->block->statements.empty() || dynamic_cast<ReturnStatement *>(obj->block->statements.back()) == 0)
                {
                        if (obj->symbol->functiondef->isasyncmacro)
                        {
                                RvaluePtrs params;
                                params.push_back(coder.ImConstantBoolean(obj->blockcloseposition, false));

                                coder.ImOpenBlock(obj->block);
                                coder.ImReturn(
                                    obj->blockcloseposition,
                                    coder.ImObjectMethodCall(
                                        obj->blockcloseposition,
                                        coder.ImVariable(obj->blockcloseposition, obj->symbol->functiondef->generator),
                                        "RETURNVALUE",
                                        true,
                                        params,
                                        false,
                                        std::vector< int32_t >()));
                                coder.ImCloseBlock();
                        }
                        else
                        {
                                std::string name = ":THROWERROR"; //defined in system.whlib

                                bool add = true;

                                // Check if :THROWERROR has already been added in previous runs
                                if (!obj->block->statements.empty())
                                {
                                        SingleExpression *se = dynamic_cast<SingleExpression *>(obj->block->statements.back());
                                        if (se)
                                        {
                                                FunctionCall *fc = dynamic_cast<FunctionCall *>(se->expr);
                                                if (fc && fc->symbol->name == name)
                                                    add = false;
                                        }
                                }

                                // Add call to :THROWERROR(Error::FunctionMustReturnValue) to the end of the block
                                if (add)
                                {
                                        RvaluePtrs params;
                                        params.push_back(coder.ImConstantInteger(obj->position, Error::FunctionMustReturnValue));

                                        Symbol *symbol = context.symboltable->ResolveSymbol(obj->position, name, NULL, false);
                                        if (!symbol)
                                            symbol = context.symboltable->RegisterNewCalledFunction(obj->position, name, false);

                                        coder.ImOpenBlock(obj->block);
                                        coder.ImExecute(obj->position,
                                                coder.ImFunctionCall(obj->position, symbol, params));
                                        coder.ImCloseBlock();
                                }
                        }
                }
        }

        if (obj->symbol->functiondef->flags & FunctionFlags::DeinitMacro)
        {
                if (obj->symbol->functiondef->returntype != VariableTypes::NoReturn || !obj->symbol->functiondef->arguments.empty())
                    context.errorhandler.AddErrorAt(obj->position, Error::ImproperDeinitMacro);
        }


        SafeVisit(obj->block, false);
}

bool SemanticChecker::LookupFunctionSymbol(Symbol **funcsymbol, LineColumn const &pos)
{
        if (*funcsymbol && (*funcsymbol)->functiondef && (*funcsymbol)->functiondef->object)
        {
                // Is the object itself declared?
                if ((*funcsymbol)->functiondef->object->state == SymbolState::Forward)
                {
                        context.symboltable->AddIsUnknownError(pos, (*funcsymbol)->functiondef->object->name, SymbolLookupType::ObjectTypes);
                        return false;
                }
        }
        if (!(*funcsymbol) || (*funcsymbol)->state != SymbolState::Declared)
        {
                if (*funcsymbol)
                {
                        // Declared in an object? If so, we're ok.
                        if ((*funcsymbol)->functiondef && (*funcsymbol)->functiondef->object)
                            return true;

                        // Try to look up (maybe it is in a library loadlibbed after the function call)
                        Symbol *import = context.symboltable->ResolveSymbolInScope(pos, context.symboltable->GetLibraryScope(), (*funcsymbol)->name);
                        if ((!import || import->state != SymbolState::Declared) && ((*funcsymbol)->name.empty() || (*funcsymbol)->name[0] != ':') && (!(*funcsymbol)->functiondef || !(*funcsymbol)->functiondef->object))
                        {
                                context.symboltable->AddIsUnknownError(pos, (*funcsymbol)->name, SymbolLookupType::Functions);
                                return false;
                        }
                        else
                        {
                                if (import)
                                    (*funcsymbol) = import;
                                else if ((*funcsymbol)->functiondef && (*funcsymbol)->functiondef->object)
                                {
                                        // Search for the definition of the object member
                                        AST::Module *root = coder.GetRoot();
                                        bool found = false;
                                        for (std::vector< Function * >::const_iterator it = root->functions.begin(); it != root->functions.end(); ++it)
                                            if ((*it)->symbol == *funcsymbol)
                                            {
                                                    found = true;
                                                    break;
                                            }
                                        if (!found)
                                            context.symboltable->AddIsUnknownError(pos, (*funcsymbol)->name, SymbolLookupType::Functions);
                                }
                        }
                }
                else
                {
                        context.errorhandler.AddErrorAt(pos, Error::UnknownFunction, "Unknown internal name");
                        return false;
                }
        }
        return true;
}

bool SemanticChecker::LookupObjectTypeSymbol(Symbol **objtypesymbol, LineColumn const &pos)
{
        if ((*objtypesymbol)->state != SymbolState::Declared)
        {
                Symbol *type = context.symboltable->ResolveSymbolInScope(pos, context.symboltable->GetRootScope(), (*objtypesymbol)->name);
                if (!type || type->type != SymbolType::ObjectType || type->state == SymbolState::Forward)
                    context.symboltable->AddIsUnknownError(pos, (*objtypesymbol)->name, SymbolLookupType::ObjectTypes);
                else
                    *objtypesymbol = type;
        }
        return true;
}

std::string SemanticChecker::GetFunctionSignature(Symbol *funcsymbol)
{
        std::string funcdescr = funcsymbol->name;
        unsigned pos = funcdescr.find('#');
        if (pos < funcdescr.size())
        {
                funcdescr[pos] = ':';
                funcdescr.insert(pos, 1, ':');
        }
        bool is_object = funcsymbol->functiondef->object != 0;
        if (is_object)
            funcdescr = funcsymbol->functiondef->object->name + "::" + funcdescr;
        if (funcsymbol->functiondef->returntype == VariableTypes::NoReturn)
            funcdescr = "MACRO " + funcdescr;
        else
            funcdescr = GetTypeName(funcsymbol->functiondef->returntype) + " FUNCTION " + funcdescr;
        funcdescr += "(";
        bool skip_comma = true;
        for (unsigned idx = 0; idx != funcsymbol->functiondef->arguments.size(); ++idx)
        {
                if (idx == 0 && is_object)
                    continue;
                if (skip_comma)
                    skip_comma = false;
                else
                    funcdescr += ", ";

                if (funcsymbol->functiondef->arguments[idx].symbol->name == ":THIS") // Skip :THIS
                {
                        skip_comma = true;
                        continue;
                }

                funcdescr += HareScript::GetTypeName(funcsymbol->functiondef->arguments[idx].symbol->variabledef->type);
                funcdescr += ' ';
                funcdescr += funcsymbol->functiondef->arguments[idx].symbol->name;
        }
        funcdescr += ')';
        return funcdescr;
}

void SemanticChecker::GenerateFunctionParameterError(Symbol *funcsymbol, LineColumn const &pos)
{
        std::string funcdescr = GetFunctionSignature(funcsymbol);
        context.errorhandler.AddErrorAt(pos, Error::ParameterCountWrong, funcdescr);
}

void SemanticChecker::AppendDefaultParameters(Symbol *funcsymbol, AST::RvaluePtrs *current_param_list, std::vector<int32_t> *passthrough_parameters, LineColumn const &callpos)
{
        bool is_vararg = funcsymbol->functiondef->flags & FunctionFlags::VarArg;

        // Add the default parameters
        while (current_param_list->size() < funcsymbol->functiondef->arguments.size() - is_vararg)
        {
                unsigned paramnum = current_param_list->size();
                if (!funcsymbol->functiondef->arguments[paramnum].value)
                    break;

                TreeCopyingVisitor copier(context);
                Rvalue* copy = copier.GetCopy(funcsymbol->functiondef->arguments[paramnum].value);
                copy->position = callpos;

                SafeVisit(copy, true);

                VerifyTypeWithCast(copy,funcsymbol->functiondef->arguments[paramnum].symbol->variabledef->type);

                current_param_list->push_back(copy);

                if (passthrough_parameters)
                    passthrough_parameters->push_back(0);
        }
}

void SemanticChecker::V_FunctionCall (AST::FunctionCall *obj, bool)
{
        ///ADDME Better error message, this occurs when internally used functions are not in an imported library
        if (!LookupFunctionSymbol(&obj->symbol, obj->position))
        {
                // In case of an error, type Variant will yield the least number of garbage errors
                typestorage[obj] = VariableTypes::Variant;

                // Just check the parameters as far as we can
                for (RvaluePtrs::iterator it = obj->parameters.begin(); it != obj->parameters.end(); ++it)
                    SafeVisit(*it, true);

                return;
        }

        bool is_aggregate = obj->symbol->functiondef->flags & FunctionFlags::Aggregate;
        bool set_aggr_forbidden = false;
        std::set<Symbol *> org_aggr_forbidden_inner;

        if (is_aggregate && !obj->as_aggregate && !obj->inhibit_aggregate)
        {
                if (top_select)
                {
                        if (!top_select->is_grouped)
                            top_select->is_grouped_afterall = true;
                        else
                        {
                                //  turn off inaccessability of non-grouped columns
                                for (std::vector<SQLSource*>::iterator it = top_select->sources->sources.begin(); it != top_select->sources->sources.end(); ++it)
                                {
                                        aggr_inaccessible_sv.erase((*it)->symbol);
                                        if ((*it)->symbol->variabledef->countersymbol)
                                            aggr_inaccessible_sv.erase((*it)->symbol->variabledef->countersymbol);
                                }
                                // And turn on inaccessability for temporaries
                                for (std::vector< SQLSelect::Temporary >::iterator it = top_select->temporaries.begin(); it != top_select->temporaries.end(); ++it)
                                    aggr_inaccessible_temporaries.insert(it->symbol);
                        }

                        if (cur_select != top_select)
                        {
                                // make using inner select forbidden
                                set_aggr_forbidden = true;
                                org_aggr_forbidden_inner = aggr_forbidden_inner;

                                for (std::vector<SQLSource*>::iterator it = cur_select->sources->sources.begin(); it != cur_select->sources->sources.end(); ++it)
                                {
                                        aggr_forbidden_inner.insert((*it)->symbol);
                                        if ((*it)->symbol->variabledef->countersymbol)
                                            aggr_forbidden_inner.insert((*it)->symbol->variabledef->countersymbol);
                                }
                                for (std::vector< SQLSelect::Temporary >::iterator it = top_select->temporaries.begin(); it != top_select->temporaries.end(); ++it)
                                    aggr_inaccessible_temporaries.erase(it->symbol);
                        }
                }
                else
                    context.errorhandler.AddErrorAt(obj->position, Error::AggregateOnlyInsideSelect, obj->symbol->name);
        }
        else if (!is_aggregate && obj->inhibit_aggregate)
            context.errorhandler.AddErrorAt(obj->position, Error::NoSubscriptForNonAggregates);

        bool is_special_function = obj->symbol->functiondef->flags & FunctionFlags::IsSpecial;
        bool make_private_this = false;
        if (is_special_function)
        {
                if (obj->symbol->name == "MEMBEREXISTS"
                        || obj->symbol->name == "GETMEMBER"
                        || obj->symbol->name == "MEMBERUPDATE"
                        || obj->symbol->name == "MEMBERINSERT"
                        || obj->symbol->name == "MEMBERDELETE"
                        || obj->symbol->name == "GETOBJECTMETHODPTR"
                        || obj->symbol->name == "EXTENDOBJECT"
                        || obj->symbol->name == "__INTERNAL_DESCRIBEOBJECTSTRUCTURE")
                    make_private_this = obj->symbol->functiondef->flags & FunctionFlags::External;
        }

        // ADDME : muchos better error reporting
        unsigned paramnum=0;
        bool any_prob = false;
        bool is_vararg = obj->symbol->functiondef->flags & FunctionFlags::VarArg;
        for (RvaluePtrs::iterator it = obj->parameters.begin(); it != obj->parameters.end(); ++it, ++paramnum)
        {
                SafeVisit(*it, true);
                if (paramnum >= obj->symbol->functiondef->arguments.size() - is_vararg) //excess parameter, or vararg parameter
                    continue;
                VariableTypes::Type type = obj->symbol->functiondef->arguments[paramnum].symbol->variabledef->type;
                if (is_aggregate && !obj->as_aggregate && !obj->inhibit_aggregate)
                {
                        type = ToNonArray(type);
                }
                unsigned error_count = context.errorhandler.GetErrors().size();
                VerifyTypeWithCast(*it, type);
                if (error_count == context.errorhandler.GetErrors().size())
                {
                        if (make_private_this && type == VariableTypes::Object)
                        {
                                Variable *var = dynamic_cast< Variable * >(*it);
                                if (var && var->symbol->name == ":THIS")
                                {
                                        *it = coder.ImMakePrivilegedObjectReference(var->position, var);
                                        SafeVisit(*it, true);
                                        VerifyTypeWithCast(*it, type);
                                }
                        }
                }
                if (error_count != context.errorhandler.GetErrors().size())
                {
                        if (!any_prob)
                        {
                                context.errorhandler.AddErrorAt(obj->position, Error::RelevantFunction, GetFunctionSignature(obj->symbol));
                                any_prob = true;
                        }
                }
                if (Cast *cast = dynamic_cast< Cast * >(*it))
                {
                        // Only link implicit casts
                        if (!cast->is_explicit && cast->allow_parameter_cast)
                            cast->function = obj->symbol;
                }
        }

        // restore inaccessability of non-grouped columns
        if (is_aggregate && !obj->as_aggregate && top_select && top_select->is_grouped)
        {
                for (std::vector<SQLSource*>::iterator it = top_select->sources->sources.begin(); it != top_select->sources->sources.end(); ++it)
                {
                        aggr_inaccessible_sv.insert((*it)->symbol);
                        if ((*it)->symbol->variabledef->countersymbol)
                            aggr_inaccessible_sv.insert((*it)->symbol->variabledef->countersymbol);
                }
                for (std::vector< SQLSelect::Temporary >::iterator it = top_select->temporaries.begin(); it != top_select->temporaries.end(); ++it)
                    aggr_inaccessible_temporaries.erase(it->symbol);
        }

        if (is_special_function && obj->generated && obj->symbol->name == "GETOBJECTMETHODPTR" && obj->parameters.size() == 2)
        {
                SymbolDefs::ObjectDef *objectdef = GetObjectDefFromExpression(obj->parameters[0]);
                Constant *value = dynamic_cast< Constant * >(obj->parameters[1]);

                if (objectdef && (objectdef->flags & ObjectTypeFlags::Static) && value && value->type == VariableTypes::String)
                {
                        std::string membername = context.stackm.GetSTLString(value->var);
                        Blex::ToUppercase(membername.begin(), membername.end());

                        if (!objectdef->FindField(membername, true))
                        {
                                // Skip checks on hat members
                                if (!membername.empty() && membername[0] == '^')
                                    return;

                                context.errorhandler.AddErrorAt(obj->parameters[0]->position, Error::MemberDoesNotExist, membername);
                        }
                }
        }

        if (set_aggr_forbidden)
            aggr_forbidden_inner = org_aggr_forbidden_inner;

        AppendDefaultParameters(obj->symbol, &obj->parameters, 0, obj->position);

        if (obj->parameters.size() != obj->symbol->functiondef->arguments.size())
        {
                if (!is_vararg || obj->parameters.size() < obj->symbol->functiondef->arguments.size() - 1)
                    GenerateFunctionParameterError(obj->symbol, obj->position);
        }

        typestorage[obj] = obj->symbol->functiondef->returntype;
}

void SemanticChecker::V_FunctionPtr (AST::FunctionPtr *obj, bool)
{
        typestorage[obj] = VariableTypes::FunctionRecord;

        if (obj->outside_ptr)
        {
                context.errorhandler.AddErrorAt(obj->position, Error::NoPassthroughOutsideBind);
                return;
        }

        ///ADDME Better error message, this occurs when internally used functions are not in an imported library
        if (!LookupFunctionSymbol(&obj->function, obj->position))
            return;

        bool is_aggregate = obj->function->functiondef->flags & FunctionFlags::Aggregate;
        if (is_aggregate && !obj->inhibit_aggregate)
            context.errorhandler.AddErrorAt(obj->position, Error::AggregateOnlyInsideSelect, obj->function->name);
        else if (!is_aggregate && obj->inhibit_aggregate)
            context.errorhandler.AddErrorAt(obj->position, Error::NoSubscriptForNonAggregates);

        bool is_vararg = obj->function->functiondef->flags & FunctionFlags::VarArg;

        unsigned numargs = obj->function->functiondef->arguments.size();
        if (!obj->parameters_specified)
        {
                TreeCopyingVisitor copier(context);

                //Generate a bunch of passthrough parameters
                obj->parameters_specified=true;
                for (unsigned i=0;i<numargs - is_vararg;++i)
                {
                        // Ignore default arguments, just add them as passthrough
                        obj->passthrough_parameters.push_back(i+1);
                        Rvalue *def_value = obj->function->functiondef->arguments[i].value;
                        if (def_value)
                            def_value = copier.GetCopy(def_value);
                        obj->bound_parameters.push_back(def_value);
                }
                if (is_vararg)
                    obj->excessargstype = ToNonArray(obj->function->functiondef->arguments.back().symbol->variabledef->type);
        }

        for (std::vector< int32_t >::const_iterator it = obj->passthrough_parameters.begin(); it != obj->passthrough_parameters.end(); ++it)
            if (*it && abs(*it) >= obj->firstunusedsource)
                obj->firstunusedsource = abs(*it) + 1;

        unsigned paramnum=0;
        for (RvaluePtrs::iterator it = obj->bound_parameters.begin(); it != obj->bound_parameters.end(); ++it, ++paramnum)
           if (*it)
        {
                SafeVisit(*it, true);
                if (paramnum >= obj->function->functiondef->arguments.size() - is_vararg) //excess parameter
                    continue;
                VerifyTypeWithCast(*it, obj->function->functiondef->arguments[paramnum].symbol->variabledef->type);
        }

        AppendDefaultParameters(obj->function, &obj->bound_parameters, &obj->passthrough_parameters, obj->position);

        if (obj->bound_parameters.size() != obj->function->functiondef->arguments.size())
        {
                if (!is_vararg || obj->bound_parameters.size() < obj->function->functiondef->arguments.size() - 1)
                    GenerateFunctionParameterError(obj->function, obj->position);
        }
}
void SemanticChecker::V_FunctionPtrCall (AST::FunctionPtrCall *obj, bool check_return)
{
        obj->allow_macro = !check_return;
        typestorage[obj] = VariableTypes::Variant;

        SafeVisit(obj->functionptr, true);
        VerifyTypeWithCast(obj->functionptr, VariableTypes::FunctionRecord);

        for (RvaluePtrs::iterator it = obj->params.begin(); it != obj->params.end(); ++it)
            SafeVisit(*it, true);

        if (check_return)
        {
                // FIXME: replace with macro return value checker
        }
}
void SemanticChecker::V_FunctionPtrRebind (AST::FunctionPtrRebind *obj, bool)
{
        typestorage[obj] = VariableTypes::FunctionRecord;

        Visit(obj->orgptr, true);
        for (RvaluePtrs::iterator it = obj->bound_parameters.begin(); it != obj->bound_parameters.end(); ++it)
        {
                if (*it)
                    SafeVisit(*it, true);
        }
        if (obj->outside_ptr)
            context.errorhandler.AddErrorAt(obj->position, Error::NoPassthroughOutsideBind);
}
void SemanticChecker::V_InitializeStatement (InitializeStatement *obj, bool)
{
        CheckToken(obj->symbol);
}

void SemanticChecker::V_LoopStatement (LoopStatement *obj, bool)
{
        if (obj->loopincrementer) SafeVisit(obj->loopincrementer, true);
        ++loopdepth;
        SafeVisit(obj->loop, false);
        --loopdepth;
        if (obj->precondition)
        {
                SafeVisit(obj->precondition, true);
                VerifyTypeWithCast(obj->precondition, VariableTypes::Boolean);
        }
}

void SemanticChecker::V_Lvalue (Lvalue *, bool) {}

void SemanticChecker::V_LvalueSet (LvalueSet *obj, bool check_return)
{
        V_DeepOperation(obj, check_return);
        Visit(obj->value, true);

        // If direct assignment, copy the type if currently uninitialized
        if (obj->clvalue.layers.empty() && obj->clvalue.basevar->variabledef->type == VariableTypes::Uninitialized)
          obj->clvalue.basevar->variabledef->type = typestorage[obj->value];
}

void SemanticChecker::V_Module (Module *obj, bool)
{
        // Only check END when starting at module or block
        unsigned old_arrayindexdepth = arrayindexdepth;
        arrayindexdepth = 0;

        loopdepth = 0;
        std::for_each(obj->functions.begin(), obj->functions.end(), GetSafeVisitorFunctor(this, false));
        std::for_each(obj->external_functions.begin(), obj->external_functions.end(), GetSafeVisitorFunctor(this, false));

        arrayindexdepth = old_arrayindexdepth;
}

void SemanticChecker::V_Node (Node *, bool) {}

void SemanticChecker::V_RecordCellSet (RecordCellSet *obj, bool)
{
        SafeVisit(obj->record, true);
        SafeVisit(obj->value, true);

        typestorage[obj] = VariableTypes::Record;

        // Check if RecordColumnConst is called on an object, we have a special error for that
        if (typestorage[obj->record] == VariableTypes::Object)
            context.errorhandler.AddErrorAt(obj->position, Error::ExpectedArrowOperator);
        // Extra functionality for function records
        else if (typestorage[obj->record] != VariableTypes::FunctionRecord)
            VerifyTypeAt(obj->record->position, VariableTypes::Record, typestorage[obj->record]);
        else
            typestorage[obj] = VariableTypes::FunctionRecord;

        if (typestorage[obj->value] == VariableTypes::Schema)
            context.errorhandler.AddErrorAt(obj->position, Error::TypeSchemaNotInCell);
        if (typestorage[obj->value] == VariableTypes::NoReturn)
            context.errorhandler.AddErrorAt(obj->value->position, Error::MacroDoesNotReturnValue);
}
void SemanticChecker::V_RecordCellDelete (RecordCellDelete *obj, bool)
{
        SafeVisit(obj->record, true);
        VerifyTypeAt(obj->record->position, VariableTypes::Record, typestorage[obj->record]);
        typestorage[obj] = VariableTypes::Record;
}

void SemanticChecker::V_RecordColumnConst (RecordColumnConst *obj, bool)
{
        typestorage[obj] = VariableTypes::Variant;

        // If obj->record is a substitution record we can check the type, otherwise we cannot...
        Variable* var = dynamic_cast<Variable*>(obj->record);
        if (var)
        {
                if (var->symbol && var->symbol->variabledef->is_substitute)
                {
                        bool found = false;
                        SymbolDefs::TableDef *def = var->symbol->variabledef->substitutedef;
                        if (def)
                        {
                                for (SymbolDefs::TableDef::ColumnsDef::iterator it = def->columnsdef.begin(); it != def->columnsdef.end(); ++it)
                                {
                                        if (Blex::StrCaseCompare(it->name, obj->name) == 0)
                                        {
                                                typestorage[obj] = it->type;
                                                found = true;
                                        }
                                }
                                if (!found)
                                    context.errorhandler.AddErrorAt(obj->position, Error::UnknownColumn, obj->name);
                        }
                }
//                DEBUGPRINT("Grouped cols: " << var->symbol->variabledef->group_cols);

                if (aggr_inaccessible_sv.count(var->symbol) && var->symbol->variabledef->group_cols.count(obj->name))
                {
                        // This column may be accessed; temporarily lift the inaccessiblity
                        aggr_inaccessible_sv.erase(var->symbol);
                        SafeVisit(obj->record, true);
                        aggr_inaccessible_sv.insert(var->symbol);
                }
                else
                    SafeVisit(obj->record, true);
        }
        else
            SafeVisit(obj->record, true);

        // Check if RecordColumnConst is called on an object, we have a special error for that
        if (typestorage[obj->record] == VariableTypes::Object)
            context.errorhandler.AddErrorAt(obj->position, Error::ExpectedArrowOperator);
        else
        {
                if (var && typestorage[obj->record] == VariableTypes::RecordArray)
                    context.errorhandler.AddWarningAt(obj->position, Warning::RecordArrayUsedAsRecord);

                VerifyTypeWithCast(obj->record, VariableTypes::Record);
        }
}

void SemanticChecker::V_ObjectExtend(ObjectExtend *obj, bool)
{
        SafeVisit(obj->object, true);

        if (!VerifyTypeWithCast(obj->object, VariableTypes::Object))
            return;

        if (obj->extendwith->objectdef->flags & ObjectTypeFlags::InternalProtected)
            context.errorhandler.AddErrorAt(obj->position, Error::CannotAccessProtectedObjectType);

        SymbolDefs::ObjectDef *objectdef = GetObjectDefFromExpression(obj->object);
        if (objectdef)
        {
                if (objectdef->flags & ObjectTypeFlags::Static)
                    context.errorhandler.AddErrorAt(obj->object->position, Error::CannotDynamicallyModifyStaticObjectType);

                if (objectdef->flags & ObjectTypeFlags::InternalProtected)
                    context.errorhandler.AddErrorAt(obj->position, Error::CannotAccessProtectedObjectType);
        }
}

void SemanticChecker::V_ObjectMemberConst (ObjectMemberConst*obj, bool)
{
        SafeVisit(obj->object, true);
        typestorage[obj] = VariableTypes::Variant;

        // Check if ObjectMemberConst is called on a record, we have a special error for that
        if (typestorage[obj->object] == VariableTypes::Record)
            context.errorhandler.AddErrorAt(obj->position, Error::ExpectedDotOperator);
        else
        {
                VerifyTypeWithCast(obj->object, VariableTypes::Object);

                SymbolDefs::ObjectDef *objectdef = GetObjectDefFromExpression(obj->object);
                if (objectdef)
                {
                        SymbolDefs::ObjectField *field = objectdef->FindField(obj->name, true);
                        if (field)
                        {
                                switch (field->type)
                                {
                                case ObjectCellType::Member:
                                    {
                                            obj->is_member = true;
                                            typestorage[obj] = field->var_type;
                                    } break;
                                case ObjectCellType::Method:
                                    {
                                            context.errorhandler.AddErrorAt(obj->next_token, Error::ExpectedOpeningParenthesis);
                                            typestorage[obj] = VariableTypes::FunctionRecord;
                                    } break;
                                case ObjectCellType::Property:
                                case ObjectCellType::Unknown:
                                    break; // Ignore for now
                                }
                        }
                        else if (objectdef->flags & ObjectTypeFlags::Static)
                        {
                                // Skip checks on hat members
                                if (!obj->name.empty() && obj->name[0] == '^')
                                    return;

                                context.errorhandler.AddErrorAt(obj->position, Error::MemberDoesNotExist, obj->name);
                        }
//                        DEBUGPRINT("XX NAME " << obj->name);
                }
        }
}

void SemanticChecker::V_ObjectMemberDelete(ObjectMemberDelete *obj, bool)
{
        SafeVisit(obj->object, true);

        if (!VerifyTypeWithCast(obj->object, VariableTypes::Object))
            return;

        SymbolDefs::ObjectDef *objectdef = GetObjectDefFromExpression(obj->object);
        if (objectdef)
        {
                if (objectdef->flags & ObjectTypeFlags::Static)
                {
                        // Skip checks on hat members
                        if (!obj->name.empty() && obj->name[0] == '^')
                            return;

                        context.errorhandler.AddErrorAt(obj->object->position, Error::CannotDynamicallyModifyStaticObjectType);
                        return;
                }

                SymbolDefs::ObjectField *field = objectdef->FindField(obj->name, true);
                if (field)
                    context.errorhandler.AddErrorAt(obj->position, Error::MemberDeleteNotAllowed, obj->name);
        }
}
void SemanticChecker::V_ObjectMemberInsert(ObjectMemberInsert *obj, bool)
{
        SafeVisit(obj->object, true);
        SafeVisit(obj->value, true);

        if (!VerifyTypeWithCast(obj->object, VariableTypes::Object))
            return;

        if (typestorage[obj->value] == VariableTypes::Schema)
            context.errorhandler.AddErrorAt(obj->position, Error::TypeSchemaNotInCell);
        if (typestorage[obj->value] == VariableTypes::NoReturn)
            context.errorhandler.AddErrorAt(obj->value->position, Error::MacroDoesNotReturnValue);

        SymbolDefs::ObjectDef *objectdef = GetObjectDefFromExpression(obj->object);
        if (objectdef)
        {
                if (objectdef->flags & ObjectTypeFlags::Static)
                {
                        // Skip checks on hat members
                        if (!obj->name.empty() && obj->name[0] == '^')
                            return;

                        context.errorhandler.AddErrorAt(obj->object->position, Error::CannotDynamicallyModifyStaticObjectType);
                        return;
                }

                SymbolDefs::ObjectField *field = objectdef->FindField(obj->name, true);
                if (field)
                    context.errorhandler.AddErrorAt(obj->position, Error::MemberAlreadyExists, obj->name);
        }
}

void SemanticChecker::V_ObjectMemberSet (ObjectMemberSet *obj, bool)
{
        SafeVisit(obj->object, true);
//        SafeVisit(obj->name, Empty());
        SafeVisit(obj->value, true);

        // Check if ObjectMemberConst is called on a record, we have a special error for that
        if (typestorage[obj->object] == VariableTypes::Record)
            context.errorhandler.AddErrorAt(obj->position, Error::ExpectedDotOperator);
        else
            VerifyTypeAt(obj->object->position, VariableTypes::Object, typestorage[obj->object]);

        if (typestorage[obj->value] == VariableTypes::Schema)
            context.errorhandler.AddErrorAt(obj->position, Error::TypeSchemaNotInCell);
        if (typestorage[obj->value] == VariableTypes::NoReturn)
            context.errorhandler.AddErrorAt(obj->value->position, Error::MacroDoesNotReturnValue);

        SymbolDefs::ObjectDef *objectdef = GetObjectDefFromExpression(obj->object);
        if (objectdef)
        {
                SymbolDefs::ObjectField *field = objectdef->FindField(obj->name, true);
                if (field)
                {
                        switch (field->type)
                        {
                        case ObjectCellType::Member:
                            {
                                    obj->is_member = true;
                                    SafeVisit(obj->value, true);
                                    VerifyTypeWithCast(obj->value, field->var_type);
                            } break;
                        case ObjectCellType::Method:
                            {
                                    context.errorhandler.AddErrorAt(obj->position, Error::MemberFunctionWriteDisallowed);
                            } break;
                        case ObjectCellType::Property:
                        case ObjectCellType::Unknown:
                            break; // Ignore for now
                        }
                }
                else if (objectdef->flags & ObjectTypeFlags::Static)
                {
                        // Skip checks on hat members
                        if (!obj->name.empty() && obj->name[0] == '^')
                            return;

                        context.errorhandler.AddErrorAt(obj->position, Error::MemberDoesNotExist, obj->name);
                }

//                        DEBUGPRINT("XX NAME " << obj->name);
        }

//        VerifyTypeWithCast(obj->name, VariableTypes::String);
//        typestorage[obj] = typestorage[obj->object];

}

void SemanticChecker::V_ObjectMethodCall (AST::ObjectMethodCall *obj, bool check_return)
{
        obj->allow_macro = !check_return;

        SafeVisit(obj->object, true);
        typestorage[obj] = VariableTypes::Variant;

        // Passthroughs should have been eaten by binding expression
        if (obj->has_passthroughs)
            context.errorhandler.AddErrorAt(obj->position, Error::NoPassthroughOutsideBind);

        // Check if ObjectMemberConst is called on a record, we have a special error for that
        if (typestorage[obj->object] == VariableTypes::Record)
            context.errorhandler.AddErrorAt(obj->position, Error::ExpectedDotOperator);
        else
        {
                VerifyTypeWithCast(obj->object, VariableTypes::Object);

                std::for_each(obj->parameters.begin(), obj->parameters.end(), GetSafeVisitorFunctor(this, true));

                SymbolDefs::ObjectDef *objectdef = GetObjectDefFromExpression(obj->object);
                if (objectdef)
                {
                        SymbolDefs::ObjectField *field = objectdef->FindField(obj->membername, true);
                        if (field)
                        {
                                switch (field->type)
                                {
                                case ObjectCellType::Member:
                                    {
                                            if (field->var_type != VariableTypes::FunctionRecord && field->var_type != VariableTypes::Variant)
                                                context.errorhandler.AddErrorAt(obj->position, Error::CannotConvertType, HareScript::GetTypeName(field->var_type), HareScript::GetTypeName(VariableTypes::FunctionRecord));
                                    } break;
                                case ObjectCellType::Method:
                                    {
                                            if (field->method)
                                                typestorage[obj] = field->method->functiondef->returntype;

                                            bool is_vararg = field->method->functiondef->flags & FunctionFlags::VarArg;
                                            unsigned real_param_count = obj->parameters.size() + 1;
                                            if (real_param_count < field->method->functiondef->arguments.size() - is_vararg && field->method->functiondef->arguments[real_param_count].value == 0)
                                                GenerateFunctionParameterError(field->method, obj->position);
                                            else if (real_param_count > field->method->functiondef->arguments.size() && !is_vararg)
                                                GenerateFunctionParameterError(field->method, obj->position);
                                            else
                                            {
                                                    unsigned checkcount = std::min(obj->parameters.size(), field->method->functiondef->arguments.size() - 1 - is_vararg);
                                                    bool any_prob = false;
                                                    for (unsigned idx = 0; idx < checkcount; ++idx)
                                                    {
                                                            if (!obj->parameters[idx])
                                                                continue;
                                                            unsigned error_count = context.errorhandler.GetErrors().size();
                                                            VerifyTypeWithCast(obj->parameters[idx], field->method->functiondef->arguments[idx + 1].symbol->variabledef->type);
                                                            if (error_count != context.errorhandler.GetErrors().size())
                                                            {
                                                                    if (!any_prob)
                                                                    {
                                                                            context.errorhandler.AddErrorAt(obj->position, Error::RelevantFunction, GetFunctionSignature(field->method));
                                                                            any_prob = true;
                                                                    }
                                                            }
                                                    }

                                            }
                                    } break;
                                case ObjectCellType::Property:
                                case ObjectCellType::Unknown:
                                    break; // Ignore for now
                                }
                        }
                        else if (objectdef->flags & ObjectTypeFlags::Static)
                        {
                                // Skip checks on hat members
                                if (!obj->membername.empty() && obj->membername[0] == '^')
                                    return;

                                context.errorhandler.AddErrorAt(obj->position, Error::MemberDoesNotExist, obj->membername);
                        }
                }
        }
}

void SemanticChecker::V_ObjectTypeUID (ObjectTypeUID *obj, bool)
{
        LookupObjectTypeSymbol(&obj->objtype, obj->position);

        // FIXME: Lookup object type
        typestorage[obj] = VariableTypes::String;
}

void SemanticChecker::V_ReturnStatement (ReturnStatement *obj, bool)
{
        bool is_macro = currentfunc->symbol->functiondef->returntype == VariableTypes::NoReturn;

        if (obj->returnvalue)
            Visit(obj->returnvalue, true);
        if (obj->returnvalue && is_macro)
            context.errorhandler.AddErrorAt(obj->position, Error::MacroNoReturnValue);
        else if (!obj->returnvalue && !is_macro)
            context.errorhandler.AddErrorAt(obj->position, Error::FunctionMustReturnValue);
        else if (!is_macro && !currentfunc->symbol->functiondef->generator)
            VerifyTypeWithCast(obj->returnvalue, currentfunc->symbol->functiondef->returntype);
}

void SemanticChecker::V_Rvalue (Rvalue *, bool) {}

void SemanticChecker::V_SchemaTable (SchemaTable *obj, bool)
{
        SafeVisit(obj->schema, true);
        VerifyTypeAt(obj->position, VariableTypes::Schema, typestorage[obj->schema]);
        typestorage[obj] = VariableTypes::Table;

        SymbolDefs::SchemaDef const &schemadef = obj->schema->symbol->variabledef->schemadef;
        bool found = false;
        for (SymbolDefs::SchemaDef::TablesDef::const_iterator it = schemadef.tablesdef.begin(); it != schemadef.tablesdef.end(); ++it)
        {
                if (Blex::StrCaseCompare(it->name, obj->name) == 0)
                    found = true;
        }
        if (!found)
            context.errorhandler.AddErrorAt(obj->position, Error::TableDoesNotExistInSchema, obj->name);
}

void SemanticChecker::V_SingleExpression (SingleExpression *obj, bool check_return)
{
        SafeVisit(obj->expr, check_return);
}

void SemanticChecker::V_Statement (Statement *, bool) {}

void SemanticChecker::V_SwitchStatement (SwitchStatement *obj, bool)
{
        SafeVisit(obj->value, true);
        if (obj->defaultcase)
            SafeVisit(obj->defaultcase, false);

        VariableTypes::Type type = VariableTypes::Uninitialized;
        VarId list = context.stackm.NewHeapVariable();

        for (SwitchStatement::CaseList::iterator it = obj->cases.begin(); it != obj->cases.end(); ++it)
        {
                for (std::vector< Rvalue * >::iterator it2 = it->first.begin(); it2 != it->first.end(); ++it2)
                {
                        SafeVisit(*it2, true);
                        if (type == VariableTypes::Uninitialized)
                        {
                                type = typestorage[*it2];
                                VerifyTypeWithCast(obj->value, type);
                                context.stackm.ArrayInitialize(list, 0, ToArray(type));
                        }

                        VerifyTypeWithCast(*it2, type);
                        if (!context.errorhandler.AnyErrors())
                        {
                                if (!carim->Optimize(*it2))
                                    context.errorhandler.AddErrorAt((*it2)->position, Error::ExpectedConstantExpression);
                                else
                                {
                                        Constant *value = dynamic_cast<Constant *>(*it2);
                                        if (!value)
                                            throw Message(true, Error::InternalError, "Constant folding of case label failed without warning");

                                        if (context.stackm.SearchElement(list, value->var, 0) != -1)
                                            context.errorhandler.AddErrorAt((*it2)->position, Error::DuplicateCase);

                                        context.stackm.CopyFrom(
                                                context.stackm.ArrayElementAppend(list),
                                                value->var);
                                }
                        }
                }
                SafeVisit(it->second, false);
        }
        context.stackm.DeleteHeapVariable(list);
}

void SemanticChecker::V_TryCatchStatement(TryCatchStatement *obj, bool)
{
        Visit(obj->tryblock, false);
        Visit(obj->catchblock, false);
}

void SemanticChecker::V_TryFinallyStatement(TryFinallyStatement *obj, bool)
{
        Visit(obj->tryblock, false);
        Visit(obj->finallyblock, false);
}

void SemanticChecker::V_TypeInfo(TypeInfo *obj, bool)
{
        typestorage[obj] = VariableTypes::Integer;
        if (obj->symbol)
            CheckToken(obj->symbol);
        if (!obj->typeinfo)
            obj->BuildTypeInfoFromSymbol(context);
}

void SemanticChecker::V_UnaryOperator (UnaryOperator *obj, bool)
{
        SafeVisit(obj->lhs, true);
        switch (obj->operation)
        {
        case UnaryOperatorType::OpNot:
                {
                        VerifyTypeWithCast(obj->lhs, VariableTypes::Boolean);
                        typestorage[obj] = VariableTypes::Boolean;
                }; break;
        case UnaryOperatorType::OpBitNeg:
        case UnaryOperatorType::OpNeg:
                {
                        VerifyTypeNumeric(obj->lhs);
                        typestorage[obj] = typestorage[obj->lhs];
                }; break;
        case UnaryOperatorType::OpPlus:
                {
                        VerifyTypeNumeric(obj->lhs);
                        typestorage[obj] = typestorage[obj->lhs];
                }; break;
        case UnaryOperatorType::OpMakeExisting:
                {
                        VerifyTypeWithCast(obj->lhs, VariableTypes::Record);
                        typestorage[obj] = typestorage[obj->lhs];
                }; break;
        default:
            throw Message(true, Error::InternalError, "Unknown unary operator type found");
        };
}
void SemanticChecker::V_Variable (Variable *obj, bool)
{
        if (obj->symbol)
        {
                if (/*obj->symbol->variabledef->is_counter && */aggr_inaccessible_sv.count(obj->symbol))
                    context.errorhandler.AddErrorAt(obj->position, Error::NonGroupedNotAllowedOutsideAggregate);
                else if (aggr_forbidden_inner.count(obj->symbol))
                    context.errorhandler.AddErrorAt(obj->position, Error::AggregateInWhereUsesOwnSelect);
                else if (aggr_inaccessible_temporaries.count(obj->symbol))
                    context.errorhandler.AddErrorAt(obj->position, Error::NoUseTemporaryWithinAggregate);

                typestorage[obj] = obj->symbol->variabledef->type;
        }
        else
            throw Message(true, Error::InternalError, "Found a variable without a symbol");
}

void SemanticChecker::V_Yield (Yield *obj, bool)
{
        if (yield_forbid_counter)
            context.errorhandler.AddErrorAt(obj->position, Error::YieldNotInThisContext);

        SafeVisit(obj->generator, true);
        SafeVisit(obj->yieldexpr, true);

        VerifyTypeWithCast(obj->generator, VariableTypes::Object);
        VerifyTypeWithCast(obj->yieldexpr, obj->isasync || obj->isawait || obj->wrapped ? VariableTypes::Variant : VariableTypes::Object);
        typestorage[obj] = VariableTypes::Variant;
}


void SemanticChecker::V_SQL (SQL *, bool) {}

void SemanticChecker::V_SQLDataModifier (SQLDataModifier *obj, bool)
{
        if (obj->columns.size() != obj->values.size())
        {
                context.errorhandler.AddErrorAt(obj->position, Error::InsertSizeMismatch);
                return;
        }

        std::vector<Rvalue*>::iterator vit = obj->values.begin();
        SymbolDefs::TableDef *tdef(0);
        if (obj->source && obj->source->symbol && obj->source->symbol->variabledef)
        {
                tdef = obj->source->symbol->variabledef->substitutedef;
                if (!tdef && obj->source->symbol->variabledef->type == VariableTypes::Table)
                    tdef = &obj->source->symbol->variabledef->tabledef;
        }
        if (!tdef && !obj->source->symbol)
        {
                SchemaTable *st = dynamic_cast< SchemaTable * >(obj->source->expression);
                if (st)
                {
                        SymbolDefs::SchemaDef &schemadef = st->schema->symbol->variabledef->schemadef;
                        for (SymbolDefs::SchemaDef::TablesDef::iterator it = schemadef.tablesdef.begin(); it != schemadef.tablesdef.end(); ++it)
                            if (it->name == st->name)
                                tdef = &it->tabledef;
                }
        }
        std::set<std::string> names;
        unsigned idx = 0;
        for (std::vector<std::string>::iterator cnit = obj->columns.begin(); cnit != obj->columns.end(); ++cnit, ++vit, ++idx)
        {
                Visit(*vit, true);
                if (*cnit != "")
                {
                        if (tdef)
                        {
                                SymbolDefs::TableDef::ColumnsDef::iterator it = tdef->columnsdef.begin();
                                for (;it < tdef->columnsdef.end(); ++it)
                                    if (Blex::StrCaseCompare(it->name, *cnit) == 0)
                                        break;
                                if (it == tdef->columnsdef.end())
                                    context.errorhandler.AddErrorAt(obj->position, Error::UnknownColumn, *cnit);
                                else
                                    VerifyTypeWithCast(*vit, it->type);
                        }
                }
                else
                    VerifyTypeWithCast(*vit, VariableTypes::Record);

                std::string name = *cnit;
                Blex::ToUppercase(name.begin(), name.end());
                if (!names.insert(name).second)
                    context.errorhandler.AddErrorAt(obj->values[idx]->position, Error::ColumnNameAlreadyExists, *cnit);
        }
}
void SemanticChecker::V_SQLDelete (SQLDelete *obj, bool)
{
        assign_query = true;
        ++yield_forbid_counter;

        SafeVisit(obj->sources, true);

        switch(obj->location.type)
        {
        case ArrayLocation::Where:
                if (obj->location.expr)
                {
                        SafeVisit(obj->location.expr, true);
                        VerifyTypeWithCast(obj->location.expr, VariableTypes::Boolean);
                }
                break;
        case ArrayLocation::Missing:
                break;
        default:
                throw Message(true, Error::InternalError, "Unallowed location type found");
        }
        --yield_forbid_counter;
}
void SemanticChecker::V_SQLInsert (SQLInsert *obj, bool)
{
        assign_query = true;
        SafeVisit(obj->source, true);
        SafeVisit(obj->modifier, true);

        if (typestorage[obj->source->expression] == VariableTypes::Table)
        {
                if (obj->location.type != ArrayLocation::Missing)
                    context.errorhandler.AddErrorAt(obj->position, Error::NoATInTableQuery);
        }
        else if (obj->location.type == ArrayLocation::End) ;
        else if (obj->location.type == ArrayLocation::Index && obj->location.expr)
        {
                ++arrayindexdepth;
                SafeVisit(obj->location.expr, true);
                --arrayindexdepth;
                VerifyTypeWithCast(obj->location.expr, VariableTypes::Integer);
        }
        else
        {
                context.errorhandler.AddErrorAt(obj->position, Error::ExpectedAtOrEnd);
                obj->location.type = ArrayLocation::End;
        }
}
void SemanticChecker::V_SQLSource (SQLSource *obj, bool)
{
        SafeVisit(obj->expression, true);
        VariableTypes::Type exprtype = typestorage[obj->expression];

        if (exprtype != VariableTypes::Table)
            VerifyTypeWithCast(obj->expression, VariableTypes::RecordArray);

        if (assign_query)
        {
                if (obj->reassign)
                {
                        SafeVisit(obj->reassign, true);
                        if (exprtype == VariableTypes::Table)
                            obj->reassign = 0;
                }

                if (exprtype != VariableTypes::Table)
                    if (!obj->reassign)
                        context.errorhandler.AddErrorAt(obj->position, Error::InternalError, "Encountered no result variable in SQL query modifying a record array");
        }
        else
            obj->reassign = 0;
}

void SemanticChecker::V_SQLSources (SQLSources *obj, bool)
{
        std::for_each(obj->sources.begin(), obj->sources.end(), GetSafeVisitorFunctor(this, true));
}
void SemanticChecker::V_SQLSelect (SQLSelect *obj, bool)
{
        bool assign_query_copy = assign_query;
        assign_query = false;
        ++yield_forbid_counter;

        SafeVisit(obj->sources, true);
        if (obj->limit_expr)
        {
                SafeVisit(obj->limit_expr, true);
                VerifyTypeWithCast(obj->limit_expr, VariableTypes::Integer);
        }

        SQLSelect *old_cur_select = cur_select;
        cur_select = obj;

        // All columns in where are directly accessable
        if (obj->location.type == ArrayLocation::All) ;
        else if (obj->location.type == ArrayLocation::Where && obj->location.expr)
        {
                SafeVisit(obj->location.expr, true);
                VerifyTypeWithCast(obj->location.expr, VariableTypes::Boolean);
        }
        else
            throw Message(true, Error::InternalError, "Unallowed location type found");

        for (std::vector< Rvalue * >::iterator it = obj->groupings.begin(); it != obj->groupings.end(); ++it)
            SafeVisit(*it, true);

        SQLSelect *old_top_select = top_select;
        top_select = obj;
        bool old_select_grouped = top_select->is_grouped;

        if (!old_select_grouped)
            CheckGroupableExpressions(obj, top_select->is_grouped);

        // Check grouped (don't check again if any errors have been found)
        if (obj->is_grouped || (obj->is_grouped_afterall && !context.errorhandler.AnyErrors()))
        {
                obj->is_grouped = true;
                for (std::vector<SQLSource*>::iterator it = obj->sources->sources.begin(); it != obj->sources->sources.end(); ++it)
                {
                        aggr_inaccessible_sv.insert((*it)->symbol);
                        if ((*it)->symbol->variabledef->countersymbol)
                            aggr_inaccessible_sv.insert((*it)->symbol->variabledef->countersymbol);
                }

                CheckGroupableExpressions(obj, top_select->is_grouped);

                for (std::vector<SQLSource*>::iterator it = obj->sources->sources.begin(); it != obj->sources->sources.end(); ++it)
                {
                        aggr_inaccessible_sv.erase((*it)->symbol);
                        if ((*it)->symbol->variabledef->countersymbol)
                            aggr_inaccessible_sv.erase((*it)->symbol->variabledef->countersymbol);
                }
        }

        typestorage[obj] = obj->result_type == VariableTypes::Uninitialized ? VariableTypes::RecordArray : obj->result_type;

        --yield_forbid_counter;
        assign_query = assign_query_copy;

        top_select = old_top_select;
        cur_select = old_cur_select;
}

void SemanticChecker::CheckGroupableExpressions(AST::SQLSelect *obj, bool is_grouped)
{
        std::set<std::string> all_names;
        std::set<std::string> explicit_names;
        std::set<std::string> deleted_names;
        bool have_star = false;
        bool have_star_source = false;
        bool have_spread = false;

        for (std::vector< SQLSelect::Temporary >::iterator it = obj->temporaries.begin();
                it != obj->temporaries.end(); ++it)
        {
                SafeVisit(it->expr, true);
                VerifyTypeWithCast(it->expr, it->symbol->variabledef->type);
        }

        for (std::vector< SQLSelect::SelectItem >::iterator it = obj->namedselects.begin();
                it != obj->namedselects.end(); ++it)
        {
                SafeVisit(it->expr, true);

                // Check for macro call
                if (typestorage[it->expr] == VariableTypes::NoReturn)
                    context.errorhandler.AddErrorAt(it->expr->position, Error::MacroDoesNotReturnValue);

                if (!it->is_star)
                {
                        std::string name = it->name;
                        Blex::ToUppercase(name.begin(), name.end());

                        if (it->is_delete)
                        {
                                // Column DELETE may only delete names from *. and ...
                                // Also, names it already deleted may not be deleted again
                                if (explicit_names.count(name) || (!have_star_source && !have_spread))
                                    context.errorhandler.AddErrorAt(it->deletecolumnpos, Error::ColumnDeleteOnlyFromStar, name);
                                else if ((!all_names.count(name) && !have_star && !have_spread) || deleted_names.count(name))
                                    context.errorhandler.AddErrorAt(it->deletecolumnpos, Error::UnknownColumn, name);

                                all_names.erase(name);
                                deleted_names.insert(name);
                        }
                        else if (it->is_spread)
                        {
                                VerifyTypeWithCast(it->expr, VariableTypes::Record);
                                have_spread = true;

                                // everything can be overwritten, so clear name lists
                                all_names.clear();
                                deleted_names.clear();
                                explicit_names.clear();
                        }
                        else
                        {
                                if (!it->from_star)
                                {
                                        // Explicit names override implicit names from *, but not other explicit names
                                        if (!explicit_names.insert(name).second)
                                            context.errorhandler.AddErrorAt(it->expr->position, Error::ColumnNameAlreadyExists, name);
                                }
                                else
                                {
                                        have_star_source = true;
                                        if (all_names.count(name))
                                            context.errorhandler.AddErrorAt(it->expr->position, Error::ColumnNameAlreadyExists, name);
                                }

                                all_names.insert(name);
                                deleted_names.erase(name);
                        }
                }
                else
                {
                        if (is_grouped)
                            context.errorhandler.AddErrorAt(it->expr->position, Error::NoSelectStarWhenGrouped);
                        have_star = true;
                        have_star_source = true;

                        // Unknown contents, so clear deleted_names
                        deleted_names.clear();
                }
        }

        for (std::vector<std::pair<Rvalue*, bool> >::const_iterator it = obj->orderings.begin();
                it != obj->orderings.end(); ++it)
        {
                SafeVisit(it->first, true);

                if (typestorage[it->first] == VariableTypes::NoReturn)
                    context.errorhandler.AddErrorAt(it->first->position, Error::MacroDoesNotReturnValue);
                else if (!IsTypeOrderable(typestorage[it->first]))
                    context.errorhandler.AddErrorAt(obj->position, Error::NoOrderingDefined, HareScript::GetTypeName(typestorage[it->first]));
        }

        if (obj->having_expr)
            SafeVisit(obj->having_expr, true);
}

void SemanticChecker::V_SQLUpdate (SQLUpdate *obj, bool)
{
        assign_query = true;
        ++yield_forbid_counter;

        SafeVisit(obj->source, true);
        SafeVisit(obj->modifier, true);

        if (obj->location.type == ArrayLocation::Missing) ;
        else if (obj->location.type == ArrayLocation::Where && obj->location.expr)
        {
                SafeVisit(obj->location.expr, true);
                VerifyTypeWithCast(obj->location.expr, VariableTypes::Boolean);
        }
        else
            throw Message(true, Error::InternalError, "Unallowed location type found");

        --yield_forbid_counter;
}

} // end of namespace Compiler
} // end of namespace HareScript
