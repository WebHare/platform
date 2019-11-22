//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------

#include "hsvm_stackmachine.h"
#include "hsvm_context.h"
#include <blex/decimalfloat.h>
#include <cmath>

namespace HareScript
{
namespace
{

void ThrowError(Error::Codes code, std::string const &errorstr1 = std::string(), std::string const &errorstr2 = std::string())
{
        throw VMRuntimeError(code, errorstr1, errorstr2);
}

} // End of anonymous namespace

StackMachine::StackMachine(ColumnNames::LocalMapper &_columnnamemapper)
: VarMemory(_columnnamemapper)
{
}

StackMachine::~StackMachine()
{
}

void StackMachine::Reset()
{
        VarMemory::Reset();
}

VariableTypes::Type StackMachine::PromoteNumbers()
{
        VarId lhs = StackPointer() - 2;
        VarId rhs = lhs + 1;

        VariableTypes::Type lhs_type = GetType(lhs);
        VariableTypes::Type rhs_type = GetType(rhs);

        VariableTypes::Type result_type = lhs_type;
        if (lhs_type == VariableTypes::Integer)
        {
                if (rhs_type == VariableTypes::Integer64 || rhs_type == VariableTypes::Money || rhs_type == VariableTypes::Float)
                    result_type = rhs_type;
        }
        else if (lhs_type == VariableTypes::Money)
        {
                if (rhs_type == VariableTypes::Float)
                    result_type = rhs_type;
        }
        else if (lhs_type == VariableTypes::Integer64)
        {
                if (rhs_type == VariableTypes::Float)
                    result_type = rhs_type;
        }
        else if (lhs_type != VariableTypes::Float)
        {
                // lhs is of illegal type... is rhs?
                if (rhs_type == VariableTypes::Money || rhs_type == VariableTypes::Float || rhs_type == VariableTypes::Integer64)
                    result_type = rhs_type;
                else
                    result_type = VariableTypes::Integer; // Default if both invalid or left invalid and right integer.
        }

        CastTo(lhs, result_type);
        CastTo(rhs, result_type);

        return result_type;
}

VariableTypes::Type StackMachine::PromoteIntegers()
{
        VarId lhs = StackPointer() - 2;
        VarId rhs = lhs + 1;

        VariableTypes::Type lhs_type = GetType(lhs);
        VariableTypes::Type rhs_type = GetType(rhs);

        VariableTypes::Type result_type =
                lhs_type == VariableTypes::Integer && rhs_type == VariableTypes::Integer ?
                        VariableTypes::Integer :
                        VariableTypes::Integer64;

        CastTo(lhs, result_type);
        CastTo(rhs, result_type);

        return result_type;
}


void StackMachine::Stack_Arith_Add()
{
        VarId lhs = StackPointer() - 2;
        VarId rhs = lhs + 1;
        switch (PromoteNumbers())
        {
        case VariableTypes::Integer:    SetInteger(lhs, GetInteger(lhs) + GetInteger(rhs)); break;
        case VariableTypes::Integer64:  SetInteger64(lhs, GetInteger64(lhs) + GetInteger64(rhs)); break;
        case VariableTypes::Money:      SetMoney(lhs, GetMoney(lhs) + GetMoney(rhs)); break;
        case VariableTypes::Float:      SetFloat(lhs, GetFloat(lhs) + GetFloat(rhs)); break;
        default:
            ThrowInternalError("Adding non-number types");
        }
        PopVariablesN(1);
}

void StackMachine::Stack_Arith_Sub()
{
        VarId lhs = StackPointer() - 2;
        VarId rhs = lhs + 1;
        switch (PromoteNumbers())
        {
        case VariableTypes::Integer:    SetInteger(lhs, GetInteger(lhs) - GetInteger(rhs)); break;
        case VariableTypes::Integer64:  SetInteger64(lhs, GetInteger64(lhs) - GetInteger64(rhs)); break;
        case VariableTypes::Money:      SetMoney(lhs, GetMoney(lhs) - GetMoney(rhs)); break;
        case VariableTypes::Float:      SetFloat(lhs, GetFloat(lhs) - GetFloat(rhs)); break;
        default:
            ThrowInternalError("Subtracting non-number types");
        }
        PopVariablesN(1);
}

void StackMachine::Stack_Arith_Mul()
{
        VarId lhs = StackPointer() - 2;
        VarId rhs = lhs + 1;
        switch (PromoteNumbers())
        {
        case VariableTypes::Integer:    SetInteger(lhs, GetInteger(lhs) * GetInteger(rhs)); break;
        case VariableTypes::Integer64:  SetInteger64(lhs, GetInteger64(lhs) * GetInteger64(rhs)); break;
        case VariableTypes::Money:      SetMoney(lhs, Blex::MoneyMultiply(GetMoney(lhs), GetMoney(rhs))); break;
        case VariableTypes::Float:      SetFloat(lhs, GetFloat(lhs) * GetFloat(rhs)); break;
        default:
            ThrowInternalError("Multiplying non-number types");
        }
        PopVariablesN(1);
}

void StackMachine::Stack_Arith_Div()
{
        VarId lhs = StackPointer() - 2;
        VarId rhs = lhs + 1;
        switch (PromoteNumbers())
        {
        case VariableTypes::Integer:
                {
                        int32_t val1 = GetInteger(lhs);
                        int32_t val2 = GetInteger(rhs);
                        if (val2 == 0)
                            ThrowError(Error::DivisionByZero);
                        SetInteger(lhs, val1 / val2);
                } break;
        case VariableTypes::Integer64:
                {
                        int64_t val1 = GetInteger64(lhs);
                        int64_t val2 = GetInteger64(rhs);
                        if (val2 == 0)
                            ThrowError(Error::DivisionByZero);
                        SetInteger64(lhs, val1 / val2);
                } break;
        case VariableTypes::Money:
                {
                        int64_t val1 = GetMoney(lhs);
                        int64_t val2 = GetMoney(rhs);
                        if (val2 == 0)
                            ThrowError(Error::DivisionByZero);
                        int64_t retval = Blex::MoneyDivide(val1, val2);
                        SetMoney(lhs, retval);
                } break;
        case VariableTypes::Float:
                {
                        F64 val1 = GetFloat(lhs);
                        F64 val2 = GetFloat(rhs);
                        if (val2 == 0)
                            ThrowError(Error::DivisionByZero);
                        F64 retval = val1 / val2;
                        SetFloat(lhs, retval);
                } break;
        default:
            ThrowInternalError("Dividing non-number types");
        }
        PopVariablesN(1);
}

void StackMachine::Stack_Arith_Mod()
{
        VarId lhs = StackPointer() - 2;

        switch (PromoteIntegers())
        {
        case VariableTypes::Integer:
                {
                        int32_t val2 = GetInteger(lhs + 1);
                        if (val2 == 0)
                            ThrowError(Error::DivisionByZero);

                        SetInteger(lhs, GetInteger(lhs) % val2);
                } break;
        case VariableTypes::Integer64:
                {
                        int64_t val2 = GetInteger64(lhs + 1);
                        if (val2 == 0)
                            ThrowError(Error::DivisionByZero);

                        SetInteger64(lhs, GetInteger64(lhs) % val2);
                } break;
        default:
            ThrowInternalError("Modulo non-number types");
        }
        PopVariablesN(1);
}

void StackMachine::Stack_Arith_Neg()
{
        VarId lhs = StackPointer() - 1;
        switch (GetType(lhs))
        {
        case VariableTypes::Integer:    SetInteger(lhs, -GetInteger(lhs)); break;
        case VariableTypes::Integer64:  SetInteger64(lhs, -GetInteger64(lhs)); break;
        case VariableTypes::Money:      SetMoney(lhs, -GetMoney(lhs)); break;
        case VariableTypes::Float:      SetFloat(lhs, -GetFloat(lhs)); break;
        default:
            ThrowError(Error::ExpectedNumeric, HareScript::GetTypeName(GetType(lhs)));
        }
}

void StackMachine::Stack_String_Merge()
{
        VarId rhs = StackPointer() - 1;
        VarId lhs = rhs - 1;
        unsigned lhs_size;

        char buffer[40];
        switch(GetType(lhs))
        {
        case VariableTypes::Integer: //convert the integer to a string
                lhs_size = Blex::EncodeNumber(GetInteger(lhs),10,buffer) - buffer;

                SetString(lhs, buffer, buffer+lhs_size);
                break;
        case VariableTypes::Integer64: //convert the integer64 to a string
                lhs_size = Blex::EncodeNumber(GetInteger64(lhs),10,buffer) - buffer;

                SetString(lhs, buffer, buffer+lhs_size);
                break;
        case VariableTypes::String:
                lhs_size = GetStringSize(lhs);
                break; //okay!
        default:
                ThrowError(Error::CannotConvertType, HareScript::GetTypeName(GetType(lhs)), HareScript::GetTypeName(VariableTypes::String));
                return;
        }

        bool rhs_is_string;
        unsigned rhs_size;

        switch (GetType(rhs))
        {
        case VariableTypes::Integer:
                rhs_is_string=false;
                rhs_size = Blex::EncodeNumber(GetInteger(rhs),10,buffer) - buffer;
                break;
        case VariableTypes::Integer64:
                rhs_is_string=false;
                rhs_size = Blex::EncodeNumber(GetInteger64(rhs),10,buffer) - buffer;
                break;
        case VariableTypes::String:
                rhs_size = GetStringSize(rhs);
                rhs_is_string=true;
                break;
        default:
                ThrowError(Error::CannotConvertType, HareScript::GetTypeName(GetType(rhs)), HareScript::GetTypeName(VariableTypes::String));
                return;
        }

        // Resize lhs to fit rhs
        std::pair<char*,char*> writablestring = ResizeString(lhs, lhs_size + rhs_size);

        if (rhs_is_string) //and add the rhs
        {
                Blex::StringPair rhs_str = GetString(rhs);
                std::copy(rhs_str.begin, rhs_str.end, writablestring.first + lhs_size);
        }
        else
        {
                std::copy(buffer, buffer+rhs_size, writablestring.first + lhs_size);
        }

        PopVariablesN(1);
}


void StackMachine::Stack_Bool_And()
{
        VarId rhs = StackPointer() - 1;
        VarId lhs = rhs - 1;

        SetBoolean(lhs, GetBoolean(lhs) && GetBoolean(rhs));
        PopVariablesN(1);
}

void StackMachine::Stack_Bool_Or()
{
        VarId rhs = StackPointer() - 1;
        VarId lhs = rhs - 1;

        SetBoolean(lhs, GetBoolean(lhs) || GetBoolean(rhs));
        PopVariablesN(1);
}

void StackMachine::Stack_Bool_Xor()
{
        VarId rhs = StackPointer() - 1;
        VarId lhs = rhs - 1;

        // Usage of ^ is ok; boolean converted to integer delivers values 0 or 1.
        SetBoolean(lhs, GetBoolean(lhs) ^ GetBoolean(rhs));
        PopVariablesN(1);
}

void StackMachine::Stack_Bool_Not()
{
        VarId rhs = StackPointer() - 1;

        SetBoolean(rhs, !GetBoolean(rhs));
}

void StackMachine::Stack_Bit_And()
{
        VarId rhs = StackPointer() - 1;
        VarId lhs = rhs - 1;

        switch (PromoteIntegers())
        {
        case VariableTypes::Integer:    SetInteger(lhs, GetInteger(lhs) & GetInteger(rhs)); break;
        case VariableTypes::Integer64:  SetInteger64(lhs, GetInteger64(lhs) & GetInteger64(rhs)); break;
        default: ; // Result MUST be integer(64)
        }
        PopVariablesN(1);
}

void StackMachine::Stack_Bit_Or()
{
        VarId rhs = StackPointer() - 1;
        VarId lhs = rhs - 1;

        switch (PromoteIntegers())
        {
        case VariableTypes::Integer:    SetInteger(lhs, GetInteger(lhs) | GetInteger(rhs)); break;
        case VariableTypes::Integer64:  SetInteger64(lhs, GetInteger64(lhs) | GetInteger64(rhs)); break;
        default: ; // Result MUST be integer(64)
        }
        PopVariablesN(1);
}

void StackMachine::Stack_Bit_Xor()
{
        VarId rhs = StackPointer() - 1;
        VarId lhs = rhs - 1;

        switch (PromoteIntegers())
        {
        case VariableTypes::Integer:    SetInteger(lhs, GetInteger(lhs) ^ GetInteger(rhs)); break;
        case VariableTypes::Integer64:  SetInteger64(lhs, GetInteger64(lhs) ^ GetInteger64(rhs)); break;
        default: ; // Result MUST be integer(64)
        }
        PopVariablesN(1);
}

void StackMachine::Stack_Bit_Neg()
{
        VarId lhs = StackPointer() - 1;

        switch (GetType(lhs))
        {
        case VariableTypes::Integer:    SetInteger(lhs, ~GetInteger(lhs)); break;
        case VariableTypes::Integer64:  SetInteger64(lhs, ~GetInteger64(lhs)); break;
        default:
            CastTo(lhs, VariableTypes::Integer64);
        }
}

void StackMachine::Stack_Bit_ShiftLeft()
{
        VarId rhs = StackPointer() - 1;
        VarId lhs = rhs - 1;

        switch (PromoteIntegers())
        {
        case VariableTypes::Integer:
                {
                        int32_t shift = GetInteger(rhs);
                        if (shift > 0)
                        {
                                if (shift > 31)
                                    SetInteger(lhs, 0);
                                else
                                    SetInteger(lhs, (uint32_t)GetInteger(lhs) << shift);
                        }
                } break;
        case VariableTypes::Integer64:
                {
                        int32_t shift = GetInteger64(rhs);
                        if (shift > 0)
                        {
                                if (shift > 63)
                                    SetInteger64(lhs, 0);
                                else
                                {
                                        uint64_t val = GetInteger64(lhs);
                                        val <<= shift;
                                        SetInteger64(lhs, val);
                                }
                        }
                } break;
        default: ; // Result MUST be integer(64)
        }
        PopVariablesN(1);
}

void StackMachine::Stack_Bit_ShiftRight()
{
        VarId rhs = StackPointer() - 1;
        VarId lhs = rhs - 1;

        switch (PromoteIntegers())
        {
        case VariableTypes::Integer:
                {
                        int32_t shift = GetInteger(rhs);
                        int32_t value = GetInteger(lhs);
                        uint32_t addbits = value < 0 ? (uint32_t)0xFFFFFFFFUL : (uint32_t)0;

                        if (shift > 0)
                        {
                                if (shift > 31)
                                    if (value >= 0)
                                        SetInteger(lhs, 0);
                                    else
                                        SetInteger(lhs, -1);
                                else
                                    SetInteger(lhs, ((uint32_t)value >> shift) | (addbits << (31 - shift)));
                        }
                } break;
        case VariableTypes::Integer64:
                {
                        int64_t shift = GetInteger64(rhs);
                        int64_t value = GetInteger64(lhs);
                        uint64_t addbits = value < 0 ? BIGU64NUM(0xFFFFFFFFFFFFFFFF) : BIGU64NUM(0);

                        if (shift > 0)
                        {
                                if (shift > 63)
                                    if (value >= 0)
                                        SetInteger64(lhs, 0);
                                    else
                                        SetInteger64(lhs, -1);
                                else
                                {
                                        addbits <<= (31 - shift);
                                        uint64_t uvalue = value;
                                        uvalue >>= shift;
                                        uvalue |= addbits;
                                        SetInteger64(lhs, uvalue);
                                }
                        }
                } break;
        default: ; // Result MUST be integer(64)
        }
        PopVariablesN(1);
}

void StackMachine::Stack_Concat()
{
        VarId rhs = StackPointer() - 1;
        VarId lhs = rhs - 1;

        VariableTypes::Type lhs_type = GetType(lhs);
        VariableTypes::Type rhs_type = GetType(rhs);
        if (!(lhs_type & VariableTypes::Array))
            ThrowError(Error::TypeNotArray, HareScript::GetTypeName(lhs_type));
        if (!(rhs_type & VariableTypes::Array))
            ThrowError(Error::TypeNotArray, HareScript::GetTypeName(rhs_type));
        if (lhs_type != rhs_type)
            ThrowError(Error::CannotConvertType, HareScript::GetTypeName(rhs_type), HareScript::GetTypeName(lhs_type));

        unsigned elements_to_add = ArraySize(rhs);
        for (unsigned i=0; i < elements_to_add; ++i)
           ArrayElementCopy(rhs, i, ArrayElementAppend(lhs));

        PopVariablesN(1);
}

void StackMachine::Stack_In()
{
        VarId rhs = StackPointer() - 1;
        VarId lhs = rhs - 1;

        SetBoolean(lhs, SearchElement(rhs, lhs, 0) != -1);
        PopVariablesN(1);
}

void StackMachine::Stack_Like()
{
        //semanticcheck.cpp uses VerifyTypeWithCast so no need to do type checking here
        VarId rhs = StackPointer() - 1;
        VarId lhs = rhs - 1;

        SetBoolean(lhs, Like(lhs, rhs, true));
        PopVariablesN(1);
}

bool StackMachine::Like(VarId arg1, VarId arg2, bool casesensitive) const
{
        Blex::StringPair rhs_str = GetString(arg2);
        Blex::StringPair lhs_str = GetString(arg1);

        if (casesensitive)
            return Blex::StrLike(lhs_str.begin, lhs_str.end, rhs_str.begin, rhs_str.end);
        else
            return Blex::StrCaseLike(lhs_str.begin, lhs_str.end, rhs_str.begin, rhs_str.end);
}

void StackMachine::Stack_TestDefault(bool negate)
{
        VarId lhs = StackPointer() - 1;
        VariableTypes::Type type = GetType(lhs);

        if (type & VariableTypes::Array)
            SetBoolean(lhs, (ArraySize(lhs) == 0) ^ negate);
        else switch (type)
        {
        case VariableTypes::Integer:
                {
                        SetBoolean(lhs, (GetInteger(lhs) == 0) ^ negate);
                } break;
        case VariableTypes::Integer64:
                {
                        SetBoolean(lhs, (GetInteger64(lhs) == 0) ^ negate);
                } break;
        case VariableTypes::Money:
                {
                        SetBoolean(lhs, (GetMoney(lhs) == 0) ^ negate);
                } break;
        case VariableTypes::Float:
                {
                        SetBoolean(lhs, (GetFloat(lhs) == 0) ^ negate);
                } break;
        case VariableTypes::DateTime:
                {
                        SetBoolean(lhs, (GetDateTime(lhs) == Blex::DateTime::Invalid()) ^ negate);
                } break;
        case VariableTypes::Boolean:
                {
                        SetBoolean(lhs, (!GetBoolean(lhs)) ^ negate);
                } break;
        case VariableTypes::String:
                {
                        SetBoolean(lhs, (GetString(lhs).size() == 0) ^ negate);
                } break;
        case VariableTypes::FunctionRecord:
                {
                        SetBoolean(lhs, (RecordSize(lhs) == 0) ^ negate);
                } break;
        case VariableTypes::Object:
                {
                        SetBoolean(lhs, (!ObjectExists(lhs)) ^ negate);
                } break;
        case VariableTypes::WeakObject:
                {
                        SetBoolean(lhs, (!WeakObjectExists(lhs)) ^ negate);
                } break;
        case VariableTypes::Record:
                {
                        SetBoolean(lhs, (RecordNull(lhs)) ^ negate);
                } break;
        case VariableTypes::Blob:
                {
                        BlobRefPtr blob = GetBlob(lhs);
                        SetBoolean(lhs, (blob.GetLength() == 0) ^ negate);
                } break;
        default:
                throw VMRuntimeError (Error::CompareNotAllowed, HareScript::GetTypeName(type));

        }
}


void StackMachine::CastTo(VarId arg, VariableTypes::Type totype)
{
        VariableTypes::Type gottype = GetType(arg);
        if (totype != gottype)
            switch (totype)
            {
            case VariableTypes::Money:
                    {
                            if (gottype == VariableTypes::Integer)
                            {
                                    SetMoney(arg, Blex::IntToMoney(GetInteger(arg)));
                                    return;
                            }
                    } break;
            case VariableTypes::Integer64:
                    {
                            if (gottype == VariableTypes::Integer)
                            {
                                    SetInteger64(arg, GetInteger(arg));
                                    return;
                            }
                    } break;
            case VariableTypes::Float:
                    {
                            if (gottype == VariableTypes::Integer)
                            {
                                    SetFloat(arg, static_cast<F64>(GetInteger(arg)));
                                    return;
                            } else if (gottype == VariableTypes::Integer64)
                            {
                                    SetFloat(arg, GetInteger64(arg));
                                    return;
                            } else if (gottype == VariableTypes::Money)
                            {
                                    SetFloat(arg, Blex::MoneyToFloat(GetMoney(arg)));
                                    return;
                            }
                    } break;
            case VariableTypes::Record:
                    {
                            if (gottype == VariableTypes::RecordArray)
                            {
                                    if (ArraySize(arg) > 0)
                                        ArrayElementCopy(arg, 0, arg);
                                    else
                                        RecordInitializeNull(arg);

                                    return;
                            }
                    } break;
            default: ;
        }
        if (totype != gottype)
        {
                if (totype == (VariableTypes::VariantArray))
                {
                        if (!(gottype & VariableTypes::Array))
                            throw VMRuntimeError (Error::CannotConvertType, HareScript::GetTypeName(gottype), HareScript::GetTypeName(totype));
                        SetArrayType(arg, VariableTypes::VariantArray);
                }
                else if(totype != VariableTypes::Variant)//always cast to variant (fix Cannot convert 'STRING' to 'VARIANT' on function pointers)
                    throw VMRuntimeError (Error::CannotConvertType, HareScript::GetTypeName(gottype), HareScript::GetTypeName(totype));
        }
}


void StackMachine::ForcedCastTo(VarId arg, VariableTypes::Type totype)
{
        VariableTypes::Type gottype = GetType(arg);
        if (totype == gottype)
            return;

        switch (totype)
        {
        case VariableTypes::Integer:
            {
                    switch (gottype)
                    {
                    case VariableTypes::Money:
                        {
                                SetInteger(arg, static_cast< int32_t >(GetMoney(arg) / 100000));
                                return;
                        }
                    case VariableTypes::Integer64:
                        {
                                SetInteger(arg, static_cast< int32_t >(GetInteger64(arg)));
                                return;
                        }
                    case VariableTypes::Float:
                        {
                                SetInteger(arg, static_cast<int32_t>(floor(GetFloat(arg))));
                                return;
                        }
                    default: ;
                    }
            } break;
        case VariableTypes::Money:
            {
                    switch (gottype)
                    {
                    case VariableTypes::Integer:
                        {
                                SetMoney(arg, Blex::IntToMoney(GetInteger(arg)));
                                return;
                        }
                    case VariableTypes::Integer64:
                        {
                                SetMoney(arg, Blex::Int64ToMoney(GetInteger64(arg)));
                                return;
                        }
                    case VariableTypes::Float:
                        {
                                SetMoney(arg, static_cast<int64_t>(floor(GetFloat(arg)*100000)));
                                return;
                        }
                    default: ;
                    }
            } break;
        case VariableTypes::Integer64:
            {
                    switch (gottype)
                    {
                    case VariableTypes::Integer:
                        {
                                SetInteger64(arg, GetInteger(arg));
                                return;
                        }
                    case VariableTypes::Money:
                        {
                                SetInteger64(arg, GetMoney(arg) / 100000);
                                return;
                        }
                    case VariableTypes::Float:
                        {
                                SetInteger64(arg, static_cast<int64_t>(floor(GetFloat(arg))));
                                return;
                        }
                    default: ;
                    }
            } break;
        case VariableTypes::Float:
            {
                    switch (gottype)
                    {
                    case VariableTypes::Integer:
                        {
                                SetFloat(arg, static_cast<F64>(GetInteger(arg)));
                                return;
                        }
                    case VariableTypes::Money:
                        {
                                SetFloat(arg, Blex::MoneyToFloat(GetMoney(arg)));
                                return;
                        }
                    case VariableTypes::Integer64:
                        {
                                SetFloat(arg, GetInteger64(arg));
                                return;
                        }
                    default: ;
                    }
            } break;
        case VariableTypes::Record:
            {
                    if (gottype == VariableTypes::RecordArray)
                    {
                            if (ArraySize(arg) > 0)
                                ArrayElementCopy(arg, 0, arg);
                            else
                                RecordInitializeNull(arg);

                            return;
                    }
            } break;
        case VariableTypes::VariantArray:
            {
                    if (gottype & VariableTypes::Array)
                    {
                            SetArrayType(arg, VariableTypes::VariantArray);
                            return;
                    }
            } break;
        case VariableTypes::Variant: //always cast to variant (fix Cannot convert 'STRING' to 'VARIANT' on function pointers)
            {
                    return;
            }
        case VariableTypes::Object:
            {
                    if (gottype == VariableTypes::WeakObject)
                    {
                            ConvertWeakObjectToObject(arg);
                            return;
                    }
            } break;
        case VariableTypes::WeakObject:
            {
                    if (gottype == VariableTypes::Object)
                    {
                            ConvertObjectToWeakObject(arg);
                            return;
                    }
            } break;
        default: ;
        }

        if ((totype & VariableTypes::Array) && (gottype & VariableTypes::Array))
        {
                // Casting to & from variant arrays is always allowed, and we can cast every numeric array to every other numeric array
                if (totype == VariableTypes::VariantArray
                    || gottype == VariableTypes::VariantArray
                    || (IsExplicitNumericType(ToNonArray(totype)) && IsExplicitNumericType(ToNonArray(gottype)))
                    || (IsObjectType(ToNonArray(totype)) && IsObjectType(ToNonArray(gottype))))
                {
                        // ArrayElementRef will unshare, for empty arrays is isn't needed because there is no
                        // problem with multiple arrays of different types pointing to empty storage
                        int32_t len = ArraySize(arg);
                        VariableTypes::Type elttotype = ToNonArray(totype);
                        for (int32_t idx = 0; idx < len; ++idx)
                            ForcedCastTo(ArrayElementRef(arg, idx), ToNonArray(elttotype));

                        SetArrayType(arg, totype);
                        return;
                }
        }

        throw VMRuntimeError (Error::CannotConvertType, HareScript::GetTypeName(gottype), HareScript::GetTypeName(totype));
}


// Pops argument, returns casted. On error, parameters are left on the stack
void StackMachine::Stack_CastTo(VariableTypes::Type newtype)
{
        VarId lhs = StackPointer() - 1;
        CastTo(lhs, newtype);
}

// Pops argument, returns casted. On error, parameters are left on the stack
void StackMachine::Stack_ForcedCastTo(VariableTypes::Type newtype)
{
        VarId lhs = StackPointer() - 1;
        ForcedCastTo(lhs, newtype);
}

namespace
{
template < class A > inline int32_t CompareValues(A lhs, A rhs)
{
        if (lhs < rhs)
            return -1;
        else if (lhs > rhs)
            return 1;
        return 0;
}
} // End of anonymous namespace

// Pops arguments from the stack, returns compare result (nothing is put on the stack
int32_t StackMachine::Compare(VarId arg1, VarId arg2, bool casesensitive) const
{
        VariableTypes::Type type = GetType(arg1);
        VariableTypes::Type type2 = GetType(arg2);

        if (type != type2)
        {
                if (type == VariableTypes::Integer)
                {
                        if (type2 == VariableTypes::Integer64)
                            return CompareValues(static_cast<int64_t>(GetInteger(arg1)), GetInteger64(arg2));
                        else if (type2 == VariableTypes::Money)
                            return CompareValues(Blex::IntToMoney(GetInteger(arg1)), GetMoney(arg2));
                        else if (type2 == VariableTypes::Float)
                            return CompareValues(static_cast<F64>(GetInteger(arg1)), GetFloat(arg2));
                }
                else if (type == VariableTypes::Integer64)
                {
                        if (type2 == VariableTypes::Integer)
                            return CompareValues(GetInteger64(arg1), static_cast<int64_t>(GetInteger(arg2)));
                        else if (type2 == VariableTypes::Float)
                            return CompareValues(static_cast<F64>(GetInteger64(arg1)), GetFloat(arg2));
                }
                else if (type == VariableTypes::Money)
                {
                        if (type2 == VariableTypes::Integer)
                            return CompareValues(GetMoney(arg1), Blex::IntToMoney(GetInteger(arg2)));
                        else if (type2 == VariableTypes::Float)
                            return CompareValues(Blex::MoneyToFloat(GetMoney(arg1)), GetFloat(arg2));
                }
                else if (type == VariableTypes::Float)
                {
                        if (type2 == VariableTypes::Integer)
                            return CompareValues(GetFloat(arg1), static_cast<F64>(GetInteger(arg2)));
                        else if (type2 == VariableTypes::Integer64)
                            return CompareValues(GetFloat(arg1), static_cast<F64>(GetInteger64(arg2)));
                        else if (type2 == VariableTypes::Money)
                            return CompareValues(GetFloat(arg1), Blex::MoneyToFloat(GetMoney(arg2)));
                }

                ThrowError(Error::CannotConvertType, HareScript::GetTypeName(type).c_str(), HareScript::GetTypeName(type2).c_str());
        }

        return KnownTypeCompare(arg1, arg2, type, casesensitive);
}

// Pops arguments from the stack, returns compare result (nothing is put on the stack
int32_t StackMachine::KnownTypeCompare(VarId arg1, VarId arg2, VariableTypes::Type type, bool casesensitive) const
{
        switch (type)
        {
        case VariableTypes::Uninitialized:
            throw VMRuntimeError (Error::InternalError, "Encountered uninitialized type for compare");
        case VariableTypes::Table:
            throw VMRuntimeError (Error::CannotConvertType, HareScript::GetTypeName(VariableTypes::Table), HareScript::GetTypeName(VariableTypes::Table));
        case VariableTypes::Schema:
            throw VMRuntimeError (Error::CannotConvertType, HareScript::GetTypeName(VariableTypes::Schema), HareScript::GetTypeName(VariableTypes::Schema));

        case VariableTypes::Integer:
                {
                        int32_t val1 = GetInteger(arg1);
                        int32_t val2 = GetInteger(arg2);
                        return val1 == val2 ? 0 : ((val1 < val2) ? -1 : 1);
                }
        case VariableTypes::Integer64:
                {
                        int64_t val1 = GetInteger64(arg1);
                        int64_t val2 = GetInteger64(arg2);
                        return val1 == val2 ? 0 : ((val1 < val2) ? -1 : 1);
                }
        case VariableTypes::Money:
                {
                        int64_t val1 = GetMoney(arg1);
                        int64_t val2 = GetMoney(arg2);
                        return val1 == val2 ? 0 : ((val1 < val2) ? -1 : 1);
                }
        case VariableTypes::Float:
                {
                        F64 val1 = GetFloat(arg1);
                        F64 val2 = GetFloat(arg2);
                        return val1 == val2 ? 0 : ((val1 < val2) ? -1 : 1);
                }
        case VariableTypes::DateTime:
                {
                        Blex::DateTime val1 = GetDateTime(arg1);
                        Blex::DateTime val2 = GetDateTime(arg2);
                        return val1 == val2 ? 0 : ((val1 < val2) ? -1 : 1);
                }
        case VariableTypes::Boolean:
                {
                        bool val1 = GetBoolean(arg1);
                        bool val2 = GetBoolean(arg2);
                        return val1 == val2 ? 0 : ((val1 < val2) ? -1 : 1);
                }
        case VariableTypes::String:
                {
                        Blex::StringPair val1 = GetString(arg1);
                        Blex::StringPair val2 = GetString(arg2);
                        if (val1.begin == val2.begin && val1.end == val2.end)
                            return 0;
                        if (casesensitive)
                            return Blex::StrCompare(val1.begin, val1.end, val2.begin, val2.end);
                        else
                            return Blex::StrCaseCompare(val1.begin, val1.end, val2.begin, val2.end);
                }
        case VariableTypes::FunctionRecord:
                {
                        if (RecordSize(arg1) == 0 && RecordSize(arg2) == 0)
                            return 0; //equal
                        else
                            return 1; //unequal
                }
        case VariableTypes::Object:
                {
                        if (GetObjectId(arg1) == GetObjectId(arg2))
                            return 0; //equal
                        else
                            return 1; //unequal
                }
        case VariableTypes::WeakObject:
                {
                        if (GetObjectId(arg1) == GetObjectId(arg2))
                            return 0; //equal
                        else
                            return 1; //unequal
                }
        default:
                throw VMRuntimeError (Error::CompareNotAllowed, HareScript::GetTypeName(type));
        }
}

signed StackMachine::SearchElement(VarId list, VarId value, signed start)
{
        VariableTypes::Type list_type = GetType(list);

        if (! (list_type & VariableTypes::Array))
            ThrowError(Error::TypeNotArray, HareScript::GetTypeName(list_type).c_str());

        unsigned size = ArraySize(list);
        unsigned i = (start >= 0) ? start : 0;

        if (list_type == VariableTypes::VariantArray)
        {
                // Variant array: no way to know what is in there. Not an error to search for the wrong type.
                VariableTypes::Type type = GetType(value);

                for (; i < size; ++i)
                {
                        VarId compareto = ArrayElementGet(list, i);
                        if (CanCastTo(type, GetType(compareto)) && Compare(value, compareto, true) == 0) //match!
                            return i;
                }
        }
        else
        {
                VariableTypes::Type list_elt_type = ToNonArray(list_type);

                CastTo(value, list_elt_type);
                for (; i < size; ++i)
                    if (KnownTypeCompare(value, ArrayElementGet(list,i), list_elt_type, true) == 0) //match!
                        return i;
        }

        return -1;
}

signed StackMachine::SearchElementFromBack(VarId list, VarId value, signed start)
{
        VariableTypes::Type list_type = GetType(list);

        if (! (list_type & VariableTypes::Array))
            ThrowError(Error::TypeNotArray, HareScript::GetTypeName(list_type).c_str());

        signed size = ArraySize(list);
        signed i = (start < size) ? start : size - 1;

        if (list_type == VariableTypes::VariantArray)
        {
                // Variant array: no way to know what is in there. Not an error to search for the wrong type.
                VariableTypes::Type type = GetType(value);

                for (; i >= 0; --i)
                {
                        VarId compareto = ArrayElementGet(list, i);
                        if (CanCastTo(type, GetType(compareto)) && Compare(value, compareto, true) == 0) //match!
                            return i;
                }
        }
        else
        {
                VariableTypes::Type list_elt_type = ToNonArray(list_type);

                CastTo(value, list_elt_type);
                for (; i >= 0; --i)
                    if (KnownTypeCompare(value, ArrayElementGet(list,i), list_elt_type, true) == 0) //match!
                        return i;
        }

        return -1;
}

signed StackMachine::SearchElementNoCast(VarId list, VarId value, signed start) const
{
        VariableTypes::Type list_type = GetType(list);
        VariableTypes::Type valuetype = GetType(value);

        if (! (list_type & VariableTypes::Array))
            ThrowError(Error::TypeNotArray, HareScript::GetTypeName(list_type).c_str());

        VariableTypes::Type list_elt_type = ToNonArray(list_type);

        unsigned size = ArraySize(list);
        unsigned i = (start >= 0) ? start : 0;

        if (list_type == VariableTypes::VariantArray)
        {
                // Variant array: no way to know what is in there. Not an error to search for the wrong type.
                for (; i < size; ++i)
                {
                        VarId compareto = ArrayElementGet(list, i);
                        if (CanCastTo(valuetype, GetType(compareto)) && Compare(value, compareto, true) == 0) //match!
                            return i;
                }
        }
        else if (list_elt_type != valuetype)
        {
                // Make it look like we casted, but use an compare that is very casting-liberal
                if (!CanCastTo(valuetype, list_elt_type))
                    throw VMRuntimeError (Error::CannotConvertType, HareScript::GetTypeName(valuetype), HareScript::GetTypeName(list_elt_type));

                for (; i < size; ++i)
                {
                        VarId compareto = ArrayElementGet(list, i);
                        if (Compare(value, compareto, true) == 0) //match!
                            return i;
                }
        }
        else
        {
                for (; i < size; ++i)
                    if (KnownTypeCompare(value, ArrayElementGet(list,i), list_elt_type, true) == 0) //match!
                        return i;
        }

        return -1;
}

void StackMachine::InternalCopyFromOtherVM(VirtualMachine *dest_vm, VarId dest, VirtualMachine *source_vm, StackMachine &other, VarId source, ColumnNameMap &map, bool inside_vmgroup)
{
        VariableTypes::Type type = other.GetType(source);
        if (type == VariableTypes::Record || type == VariableTypes::FunctionRecord)
        {
                CopyRecordFromOtherVM(dest_vm, dest, source_vm, other, source, map, type, inside_vmgroup);
        }
        else if (type == VariableTypes::Object)
        {
                if (!other.ObjectExists(source))
                    ObjectInitializeDefault(dest);
                else
                {
                        HSVM_ObjectMarshallerPtr marshaller = other.ObjectGetMarshaller(source);
                        if (!marshaller)
                            ThrowInternalError("Cannot marshal variables of type OBJECT between VMs that have no marshalling function");

                        void *data = 0;
                        HSVM_ObjectRestorePtr restoreptr = 0;

                        if (!(*marshaller)(*source_vm, source, &data, &restoreptr, 0))
                            ThrowInternalError("The marshalling function of a variable of type OBJECT failed: could not create a marshalling packet");

                        if (!data || !restoreptr)
                            ThrowInternalError("The marshalling function of a variable of type OBJECT failed: no data or restore function returned");

                        if (!(*restoreptr)(*dest_vm, dest, data))
                            ThrowInternalError("The marshalling function of a variable of type OBJECT failed: restore failed");
                }
        }
        else if (type == VariableTypes::Blob && !inside_vmgroup)
        {
                //ADDME: Clean up code. Don't copy if the global blob manager owns this blob. See if we can copy without an intermediate buffer (won't the receiving blobmgr will have a buffer anwyay?)
                //Copy the blob to the other vm
                int deststream = HSVM_CreateStream (*dest_vm);
                int srcstream = HSVM_BlobOpen (*source_vm, source);

                char buf[8192];
                while(true)
                {
                        int bytesread = HSVM_BlobRead (*source_vm, srcstream, sizeof(buf), buf);
                        if(bytesread<=0)
                            break;
                        HSVM_PrintTo(*dest_vm, deststream, bytesread, buf);
                }
                HSVM_BlobClose(*source_vm, srcstream);
                HSVM_MakeBlobFromStream(*dest_vm, dest, deststream);
        }
        else if (type & VariableTypes::Array)
        {
                CopyArrayFromOtherVM(dest_vm, dest, source_vm, other, source, map, inside_vmgroup);
        }
        else
        {
                CopySimpleVariableFromOtherVarMem(dest, other, source);
        }
}

void StackMachine::CopyRecordFromOtherVM(VirtualMachine *dest_vm, VarId dest, VirtualMachine *source_vm, StackMachine &other, VarId source, ColumnNameMap &map, VariableTypes::Type type, bool inside_vmgroup)
{
        unsigned len = other.RecordSize(source);
        if (len == 0 && other.RecordNull(source) && type == VariableTypes::Record)
        {
                RecordInitializeNull(dest);
                return;
        }
        if (type == VariableTypes::Record)
            RecordInitializeEmpty(dest);
        else
            FunctionRecordInitializeEmpty(dest);

        for (unsigned idx = 0; idx < len; ++idx)
        {
                ColumnNameId other_name = other.RecordCellNameByNr(source, idx);
                ColumnNameMap::iterator it = map.find(other_name);
                if (it == map.end())
                    it = map.insert(std::make_pair(other_name, columnnamemapper.GetMapping(other.columnnamemapper.GetReverseMapping(other_name)))).first;

                VarId new_cell = RecordCellCreate(dest, it->second);
                InternalCopyFromOtherVM(dest_vm, new_cell, source_vm, other, other.RecordCellGetByName(source, other_name), map, inside_vmgroup);
        }
}

void StackMachine::CopyArrayFromOtherVM(VirtualMachine *dest_vm, VarId dest, VirtualMachine *source_vm, StackMachine &other, VarId source, ColumnNameMap &map, bool inside_vmgroup)
{
        VariableTypes::Type type = other.GetType(source);
        unsigned len = other.ArraySize(source);
        ArrayInitialize(dest, other.ArraySize(source), type);
        for (unsigned idx = 0; idx < len; ++idx)
            InternalCopyFromOtherVM(dest_vm, ArrayElementRef(dest, idx), source_vm, other, other.ArrayElementGet(source, idx), map, inside_vmgroup);
}

void StackMachine::CopyFromOtherVM(VirtualMachine *dest_vm, VarId dest, VirtualMachine *other, VarId source, bool inside_vmgroup)
{
        ColumnNameMap map;
        InternalCopyFromOtherVM(dest_vm, dest, other, other->GetStackMachine(), source, map, inside_vmgroup);
}

void StackMachine::ThrowIfFunctionPointersPresent(VarId var)
{
        VariableTypes::Type type = GetType(var);
        switch (type)
        {
        case VariableTypes::FunctionRecord:
            {
                    ThrowInternalError("Function pointer not allowed here");
            } break;
        case VariableTypes::Record:
            {
                    unsigned len = RecordSize(var);
                    for (unsigned idx = 0; idx < len; ++idx)
                    {
                            ColumnNameId nameid = RecordCellNameByNr(var, idx);
                            ThrowIfFunctionPointersPresent(RecordCellRefByName(var, nameid));
                    }
            } break;
        case VariableTypes::RecordArray:
        case VariableTypes::VariantArray:
        case VariableTypes::FunctionRecordArray:
            {
                    unsigned len = ArraySize(var);
                    for (unsigned idx = 0; idx < len; ++idx)
                        ThrowIfFunctionPointersPresent(ArrayElementRef(var, idx));
            } break;
        default: ;
        }
}

void StackMachine::CopyRecordFromObject(VarId record, VarId object)
{
        assert(record != object);
        RecordInitializeEmpty(record);
        for (unsigned idx = 0, length = ObjectSize(object); idx < length; ++idx)
        {
                ColumnNameId nameid = ObjectMemberNameByNr(object, idx);
                if (nameid != 0)
                    ObjectMemberCopy(object, nameid, true, RecordCellCreate(record, nameid));
        }
}

bool StackMachine::CNMapping::operator<(StackMachine::CNMapping const &rhs) const
{
        return Blex::StrCompare(mapping.begin, mapping.end, rhs.mapping.begin, rhs.mapping.end) < 0;
}

void StackMachine::CalculateHashInternal(Blex::Hasher *hasher, VarId var) const
{
        VariableTypes::Type type = GetType(var);
        hasher->Process(&type, 1);

        char buffer[8];

        switch (type)
        {
        case VariableTypes::Boolean:
            {
                    buffer[0] = GetBoolean(var);
                    hasher->Process(buffer, 1);
            } break;
        case VariableTypes::Integer:
            {
                    int32_t value = GetInteger(var);
                    Blex::PutLsb(buffer, value);
                    hasher->Process(buffer, 4);
            } break;
        case VariableTypes::Integer64:
            {
                    int64_t value = GetInteger64(var);
                    Blex::PutLsb(buffer, value);
                    hasher->Process(buffer, 8);
            } break;
        case VariableTypes::Money:
            {
                    int64_t value = GetMoney(var);
                    Blex::PutLsb(buffer, value);
                    hasher->Process(buffer, 8);
            } break;
        case VariableTypes::Float:
            {
                    F64 value = GetMoney(var);
                    Blex::PutLsb(buffer, value);
                    hasher->Process(buffer, 8);
            } break;
        case VariableTypes::DateTime:
            {
                    Blex::DateTime dt = GetDateTime(var);
                    Blex::PutLsb<uint32_t>(buffer, dt.GetDays());
                    Blex::PutLsb<uint32_t>(buffer + 4, dt.GetMsecs());
                    hasher->Process(buffer, 8);
            } break;
        case VariableTypes::String:
            {
                    Blex::StringPair pair = GetString(var);
                    Blex::PutLsb<uint32_t>(buffer, pair.size());
                    hasher->Process(buffer, 4);
                    hasher->Process(pair.begin, pair.end - pair.begin);
            } break;
        case VariableTypes::Record:
            {
                    buffer[0] = RecordNull(var);
                    hasher->Process(buffer, 1);
                    uint32_t len = RecordSize(var);
                    Blex::PutLsb(buffer, len);
                    hasher->Process(buffer, 4);

                    Blex::PodVector< CNMapping > cn_buffer;
                    cn_buffer.resize(len);

                    for (unsigned idx = 0; idx < len; ++idx)
                    {
                            CNMapping mapping;
                            mapping.name = RecordCellNameByNr(var, idx);
                            mapping.mapping = columnnamemapper.GetReverseMapping(mapping.name);
                            cn_buffer[idx] = mapping;
                    }
                    std::sort(cn_buffer.begin(), cn_buffer.end());
                    for (Blex::PodVector< CNMapping >::const_iterator it = cn_buffer.begin(); it != cn_buffer.end(); ++it)
                    {
                            Blex::PutLsb<uint32_t>(buffer, it->mapping.size());
                            hasher->Process(buffer, 4);
                            hasher->Process(it->mapping.begin, it->mapping.end - it->mapping.begin);
                            CalculateHashInternal(hasher, RecordCellGetByName(var, it->name));
                    }
            } break;

        case VariableTypes::BooleanArray:
        case VariableTypes::IntegerArray:
        case VariableTypes::Integer64Array:
        case VariableTypes::MoneyArray:
        case VariableTypes::FloatArray:
        case VariableTypes::DateTimeArray:
        case VariableTypes::StringArray:
        case VariableTypes::RecordArray:
        case VariableTypes::VariantArray:
            {
                uint32_t len = ArraySize(var);
                Blex::PutLsb(buffer, len);
                hasher->Process(buffer, 4);
                for (unsigned i = 0; i < len; ++i)
                    CalculateHashInternal(hasher, ArrayElementGet(var, i));
            } break;
        default:
            ThrowInternalError(("Cannot calculate a hash of variables of type " + GetTypeName(type)).c_str());
        }
}

std::string StackMachine::CalculateHash(VarId object, Blex::DateTime const *stamp) const
{
        Blex::SHA1 hash;
        CalculateHashInternal(&hash, object);

        if (stamp)
        {
                uint32_t daycount = stamp->GetDays();
                uint32_t msecscount = stamp->GetMsecs();
                hash.Process(&daycount, 4);
                hash.Process(&msecscount, 4);
        }

        uint8_t const *data = hash.Finalize();
        return std::string(data, data + 16);
}

} // End of namespace Harescript
