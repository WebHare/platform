//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

#include "baselibs.h"
#include <blex/decimalfloat.h>
#include "hsvm_context.h"
#include <cmath>
#include <cerrno>
#include "hsvm_dllinterface_blex.h"

#define __STDC_FORMAT_MACROS
#include <inttypes.h>

//---------------------------------------------------------------------------
//
// This library adds backend support functions for various HareScript types
//
//---------------------------------------------------------------------------
namespace HareScript {

void GetVMStackTrace(VirtualMachine *vm, HSVM_VariableId var_stacktrace, VirtualMachine *testvm, bool full);
void GetVMLibraries(VirtualMachine *vm, HSVM_VariableId var_resultlibs, VirtualMachine *testvm);

namespace Baselibs {

//---------------------------------------------------------------------------
//
// DateTime functions
//
//---------------------------------------------------------------------------
void HS_CreateDateTimeFromDM(VarId id_set, VirtualMachine *vm)
{
        HSVM_DateTimeSet(*vm, id_set, HSVM_IntegerGet(*vm, HSVM_Arg(0)), HSVM_IntegerGet(*vm, HSVM_Arg(1)));
}
void HS_GetHareDateDays(VarId id_set, VirtualMachine *vm)
{
        int days, msecs;
        HSVM_DateTimeGet(*vm, HSVM_Arg(0), &days, &msecs);
        HSVM_IntegerSet(*vm, id_set, days);
}
void HS_GetHareDateMsecs(VarId id_set, VirtualMachine *vm)
{
        int days, msecs;
        HSVM_DateTimeGet(*vm, HSVM_Arg(0), &days, &msecs);
        HSVM_IntegerSet(*vm, id_set, msecs);
}

void HS_ServerDateTime(VarId id_set, VirtualMachine *vm)
{
        Blex::DateTime now = Blex::DateTime::Now();
        HSVM_DateTimeSet(*vm, id_set, now.GetDays(), now.GetMsecs());
}


//---------------------------------------------------------------------------
//
// RECORD functions
//
//---------------------------------------------------------------------------

void CellInsert(VarId id_set,VirtualMachine *vm)
{
        //Copy the source record first.
        vm->GetStackMachine().MoveFrom(id_set, HSVM_Arg(0));

        //Resolve the name to a number
        Blex::StringPair str = vm->GetStackMachine().GetString(HSVM_Arg(1));
        ColumnNameId nameid = vm->columnnamemapper.GetMapping( str.size(), str.begin);

        if (str.size() == 0)
            throw VMRuntimeError(Error::ExpectedColumnName);

        vm->GetStackMachine().MoveFrom(vm->GetStackMachine().RecordCellCreateExclusive(id_set, nameid), HSVM_Arg(2));
}

void CellUpdate(VarId id_set,VirtualMachine *vm)
{
        //Copy the source record first.
        HSVM_CopyFrom(*vm, id_set, HSVM_Arg(0));

        //Resolve the name to a number
        Blex::StringPair str = vm->GetStackMachine().GetString(HSVM_Arg(1));
        ColumnNameId nameid= vm->columnnamemapper.GetMapping( str.size(), str.begin);

        if (vm->GetStackMachine().RecordNull(HSVM_Arg(0)))
        {
                std::string columnname = str.stl_str();
                Blex::ToUppercase(columnname.begin(), columnname.end());
                throw VMRuntimeError(Error::RecordDoesNotExist, columnname);
        }

        //Get its varid
        VarId cellid = vm->GetStackMachine().RecordCellRefByName(HSVM_Arg(0),nameid);
        if (!cellid)
        {
                std::string columnname = str.stl_str();
                Blex::ToUppercase(columnname.begin(), columnname.end());
                vm->GetStackMachine().RecordThrowCellNotFound(HSVM_Arg(0), columnname);
        }

        int lhtype = HSVM_GetType(*vm, cellid);
        int rhtype = HSVM_GetType(*vm, HSVM_Arg(2));

        if (lhtype == rhtype)
            ;//do nothing
        else if (  (lhtype == HSVM_VAR_Record && rhtype == HSVM_VAR_RecordArray)
                || (lhtype == HSVM_VAR_Integer64 && rhtype == HSVM_VAR_Integer)
                || (lhtype == HSVM_VAR_Money && rhtype == HSVM_VAR_Integer)
                || (lhtype == HSVM_VAR_Float && rhtype == HSVM_VAR_Integer)
                || (lhtype == HSVM_VAR_Float && rhtype == HSVM_VAR_Integer64)
                || (lhtype == HSVM_VAR_Float && rhtype == HSVM_VAR_Money))
            vm->GetStackMachine().CastTo(HSVM_Arg(2), (VariableTypes::Type)lhtype);
        else
            throw VMRuntimeError (Error::CannotConvertType, HareScript::GetTypeName((VariableTypes::Type)rhtype), HareScript::GetTypeName((VariableTypes::Type)lhtype));

        HSVM_CopyFrom(*vm, cellid, HSVM_Arg(2)); // set new value
        HSVM_CopyFrom(*vm, id_set, HSVM_Arg(0)); // return modified record
}

void GetCell(VarId id_set,VirtualMachine *vm)
{
        //Resolve the name to a number
        Blex::StringPair str = vm->GetStackMachine().GetString(HSVM_Arg(1));
        ColumnNameId nameid = vm->columnnamemapper.GetMapping( str.size(), str.begin);

        if (vm->GetStackMachine().RecordNull(HSVM_Arg(0)))
        {
                std::string columnname = str.stl_str();
                Blex::ToUppercase(columnname.begin(), columnname.end());
                throw VMRuntimeError(Error::RecordDoesNotExist, columnname);
        }

        //Get the record!
        if (!vm->GetStackMachine().RecordCellCopyByName(HSVM_Arg(0),nameid,id_set))
        {
                std::string columnname = str.stl_str();
                Blex::ToUppercase(columnname.begin(), columnname.end());
                vm->GetStackMachine().RecordThrowCellNotFound(HSVM_Arg(0), columnname);
        }
}

void CellExists(VarId id_set,VirtualMachine *vm)
{
        //Resolve the name to a number
        Blex::StringPair str = vm->GetStackMachine().GetString(HSVM_Arg(1));
        ColumnNameId nameid= vm->columnnamemapper.GetMapping( str.size(), str.begin);

        //Get the record!
        vm->GetStackMachine().SetBoolean(id_set, vm->GetStackMachine().RecordCellExists(HSVM_Arg(0),nameid));
}

void CellDelete(VarId id_set,VirtualMachine *vm)
{
        //Copy the source record first.
        StackMachine &stackm = vm->GetStackMachine();
        stackm.MoveFrom(id_set, HSVM_Arg(0));
        //Resolve the name to a number
        Blex::StringPair str = vm->GetStackMachine().GetString(HSVM_Arg(1));
        ColumnNameId nameid= vm->columnnamemapper.GetMapping( str.size(), str.begin);

        if (!vm->GetStackMachine().RecordNull(id_set))
            vm->GetStackMachine().RecordCellDelete(id_set, nameid);
}

void RecordExists(VarId id_set, VirtualMachine *vm)
{
        vm->GetStackMachine().CastTo(HSVM_Arg(0), VariableTypes::Record);
        vm->GetStackMachine().SetBoolean(id_set, vm->GetStackMachine().RecordNull(HSVM_Arg(0))==false);
}

//---------------------------------------------------------------------------
//
// SCALAR functions
//
//---------------------------------------------------------------------------
void ToString(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();
        char buffer[100]={0}; //initialize to all zeroes

        int32_t conversion_base=stackm.GetInteger(HSVM_Arg(1));
        if (conversion_base<2||conversion_base>36)
            throw VMRuntimeError(Error::RadixOutOfRange, "2", "36");

        int64_t val = stackm.GetInteger64(HSVM_Arg(0));
        if(conversion_base==10)
            Blex::EncodeNumber(val ,conversion_base,buffer);
        else
            Blex::EncodeNumber(static_cast<uint64_t>(val),conversion_base,buffer);

        vm->GetStackMachine().SetString(id_set,buffer,buffer+strlen(buffer));
}

/** MoneyToString: This internal function returns the string value of the
    internal Money value, so additional formatting (e.g. adding decimal point)
    still has to be done. */
void HS_MoneyToString(VarId id_set, VirtualMachine *vm)
{
        char buffer[100]={0}; //initialize to all zeroes
        Blex::EncodeNumber<int64_t>(vm->GetStackMachine().GetMoney(HSVM_Arg(0)), 10, buffer);
        vm->GetStackMachine().SetString(id_set,buffer,buffer+strlen(buffer));
}

void HS_FloatToString(VarId id_set, VirtualMachine *vm)
{
        int32_t decimals = HSVM_IntegerGet(*vm, HSVM_Arg(1));
        if (decimals < 0 || decimals > 20)
            throw VMRuntimeError(Error::DecimalsOutOfRange, "0", "20");

        double val = vm->GetStackMachine().GetFloat(HSVM_Arg(0));
        bool neg = false;
        int pointpos = 1;
        if (val != 0)
        {
                //check if it's negative
                neg = val < 0;
                if (neg)
                    val = -val;

                //round up the number
                val += (5 / Blex::FloatPow10(decimals+1.0));

                //get position of the decimal point
                double logval = std::log10(val);
                pointpos = std::floor(logval) + 1;
        }

        std::string buffer;
        if (neg)
            buffer = "-";

        if (pointpos < 15)
        {
                uint64_t intval = std::floor(val);
                val = (val - intval) * 10;

                Blex::EncodeNumber(intval, 10, std::back_inserter(buffer));
                pointpos = 0;
        }
        else
            val = val / Blex::FloatPow10(pointpos - 1);

        for (int i = 0; i < decimals+pointpos; ++i)
        {
                if (i == pointpos)
                    buffer += ".";
                //get one digit (there is only one digit before the decimal point)
                int decimal = std::floor(val);
                //add digit to output
                Blex::EncodeNumber(decimal, 10, std::back_inserter(buffer));
                //shift next digit before the decimal point
                val = (val-decimal)*10;
        }

        // pointpos can be too high due to rounding, check for that
        if (pointpos > 1 && buffer[neg?1:0] == '0')
            buffer.erase(neg?1:0, 1);

        vm->GetStackMachine().SetSTLString(id_set,buffer);

/* old implementation which somtimes caused access violations
        char formatstr[10]={0}; //initialize to all zeroes
                                //max length will be 6 (e.g. "%.20lf")
        std::sprintf(formatstr, "%%.%lilf", decimals);

        char buffer[100]={0}; //initialize to all zeroes
        snprintf(buffer, 100, formatstr, val);
*/
}

void HS_StringToFloat(VarId id_set, VirtualMachine *vm)
{
        Blex::DecimalFloat value;
        Blex::StringPair val;

        HSVM_StringGet(*vm, HSVM_Arg(0), &val.begin, &val.end);

        bool negate = false;
        if (val.begin != val.end && *val.begin == '-')
        {
                negate = true;
                ++val.begin;
        }
        else if (val.begin != val.end && *val.begin == '+')
        {
                ++val.begin;
        }

        const char *finish = val.end;
        Blex::DecimalFloat::ParseResult res = value.ParseNumberString(val.begin, val.end, 0, &finish);
        if (negate)
            value.Negate();
        if (val.begin != val.end && (res == Blex::DecimalFloat::PR_FloatingPoint || res == Blex::DecimalFloat::PR_Integer) && finish == val.end && value.ConvertableToFloat())
            HSVM_FloatSet(*vm, id_set, value.ToFloat());
        else
            HSVM_CopyFrom(*vm, id_set, HSVM_Arg(1));
}

void ToInteger(VarId id_set, VirtualMachine *vm)
{
        Blex::StringPair str = vm->GetStackMachine().GetString(HSVM_Arg(0));
        int32_t default_value = HSVM_IntegerGet(*vm, HSVM_Arg(1));
        int32_t conversion_base = HSVM_IntegerGet(*vm, HSVM_Arg(2));

        if (conversion_base<2||conversion_base>36)
            throw VMRuntimeError(Error::RadixOutOfRange, "2", "36");

        if (str.begin!=str.end)
        {
                std::pair <int32_t, char const * > retval = Blex::DecodeSignedNumber<int32_t>(str.begin,str.end,conversion_base);

                //if endptr doesn't point to a \0, the string was illegal
                HSVM_IntegerSet(*vm, id_set,retval.second == str.end ? retval.first : default_value);
        }
        else
        {
                HSVM_IntegerSet(*vm, id_set,default_value);
        }
}

void ToInteger64(VarId id_set, VirtualMachine *vm)
{
        Blex::StringPair str = vm->GetStackMachine().GetString(HSVM_Arg(0));
        int64_t defval = HSVM_Integer64Get(*vm, HSVM_Arg(1));
        int32_t conversion_base = HSVM_IntegerGet(*vm, HSVM_Arg(2));

        if (conversion_base<2||conversion_base>36)
            throw VMRuntimeError(Error::RadixOutOfRange, "2", "36");

        if (str.begin!=str.end)
        {
                std::pair <int64_t, char const * > retval = Blex::DecodeSignedNumber<int64_t>(str.begin,str.end,conversion_base);

                //if endptr doesn't point to a \0, the string was illegal
                if (retval.second == str.end)
                {
                        HSVM_Integer64Set(*vm, id_set, retval.first);
                }
                else
                    HSVM_Integer64Set(*vm, id_set, defval);
        }
        else
        {
                HSVM_Integer64Set(*vm, id_set, defval);
        }
}
/** INTEGER ToInteger(VARIANT val) : casts val to type INTEGER, when val is of type MONEY, INTEGER64 or FLOAT.
    No overflow checking is performed */
void HS_ToInteger(VarId id_set, VirtualMachine *vm)
{
        int type=HSVM_GetType(*vm, HSVM_Arg(0));
        if (type == VariableTypes::Money)
            HSVM_IntegerSet(*vm, id_set, static_cast<int32_t>(vm->GetStackMachine().GetMoney(HSVM_Arg(0))/100000));
        else if (type == VariableTypes::Integer64)
            HSVM_IntegerSet(*vm, id_set, static_cast<int32_t>(vm->GetStackMachine().GetInteger64(HSVM_Arg(0))));
        else if (type == VariableTypes::Float)
            HSVM_IntegerSet(*vm, id_set, static_cast<int32_t>(vm->GetStackMachine().GetFloat(HSVM_Arg(0))));
        else
            throw VMRuntimeError (Error::CannotConvertType, HareScript::GetTypeName((VariableTypes::Type)type), HareScript::GetTypeName(VariableTypes::Integer));
}

/** MONEY ToMoney(VARIANT val) : casts val to type MONEY, when val is of type INTEGER or FLOAT.
    When casting from FLOAT to MONEY, no overflow checking is performed */
void HS_ToMoney(VarId id_set, VirtualMachine *vm)
{
        int type=HSVM_GetType(*vm, HSVM_Arg(0));
        if (type == VariableTypes::Integer)
            vm->GetStackMachine().SetMoney(id_set, Blex::IntToMoney(HSVM_IntegerGet(*vm, HSVM_Arg(0))));
        else if (type == VariableTypes::Float)
            vm->GetStackMachine().SetMoney(id_set, static_cast<int64_t>(floor(vm->GetStackMachine().GetFloat(HSVM_Arg(0))*100000)));
        else
            throw VMRuntimeError (Error::CannotConvertType, HareScript::GetTypeName((VariableTypes::Type)type), HareScript::GetTypeName(VariableTypes::Money));
}

/** FLOAT ToFloat(VARIANT val) : casts val to type FLOAT, when val is of type INTEGER or MONEY */
void HS_ToFloat(VarId id_set, VirtualMachine *vm)
{
        int type=HSVM_GetType(*vm, HSVM_Arg(0));
        if (type == VariableTypes::Integer)
            vm->GetStackMachine().SetFloat(id_set, static_cast<F64>(HSVM_IntegerGet(*vm, HSVM_Arg(0))));
        else if (type == VariableTypes::Integer64)
            vm->GetStackMachine().SetFloat(id_set, static_cast<F64>(vm->GetStackMachine().GetInteger64(HSVM_Arg(0))));
        else if (type == VariableTypes::Money)
            vm->GetStackMachine().SetFloat(id_set, Blex::MoneyToFloat(vm->GetStackMachine().GetMoney(HSVM_Arg(0))));
        else
            throw VMRuntimeError (Error::CannotConvertType, HareScript::GetTypeName((VariableTypes::Type)type), HareScript::GetTypeName(VariableTypes::Float));
}

void HS_GetRawMoney(VarId id_set, VirtualMachine *vm)
{
        HSVM_Integer64Set(*vm, id_set, HSVM_MoneyGet(*vm, HSVM_Arg(0)));
}

void HS_SetRawMoney(VarId id_set, VirtualMachine *vm)
{
        HSVM_MoneySet(*vm, id_set, HSVM_Integer64Get(*vm, HSVM_Arg(0)));
}

//---------------------------------------------------------------------------
//
// Float functions
//
//---------------------------------------------------------------------------
/** FLOAT Floor(FLOAT val) : returns the largest integer not greater than val */
void Floor(VarId id_set, VirtualMachine *vm)
{
        vm->GetStackMachine().SetFloat(id_set,floor(vm->GetStackMachine().GetFloat(HSVM_Arg(0))));
}

/** FLOAT Sqrt(FLOAT val) : returns the square root of val */
void Sqrt(VarId id_set, VirtualMachine *vm)
{
        double val = vm->GetStackMachine().GetFloat(HSVM_Arg(0));
        if (val < 0)
            throw VMRuntimeError(Error::SqrtNotNegative);
        else
            vm->GetStackMachine().SetFloat(id_set,sqrt(val));
}

/** FLOAT Pow(FLOAT val, FLOAT exp) : calculates val to the power of exp */
void Pow(VarId id_set, VirtualMachine *vm)
{
        double val = vm->GetStackMachine().GetFloat(HSVM_Arg(0));
        double exp = vm->GetStackMachine().GetFloat(HSVM_Arg(1));
        errno = 0;
        if ((val == 0 && exp <= 0) || (val < 0 && exp != floor(exp)))
            throw VMRuntimeError(Error::ArgumentNotInDomain, "POW");
        else
            vm->GetStackMachine().SetFloat(id_set,pow(val,exp));
        if (errno == ERANGE)
            throw VMRuntimeError(Error::FloatingPointOverflow);
        else if (errno != 0)
            throw VMRuntimeError(Error::InternalError, "Math error in POW");
}

/** FLOAT Cos(FLOAT val) : returns the cosine of val */
void Cos(VarId id_set, VirtualMachine *vm)
{
        vm->GetStackMachine().SetFloat(id_set,cos(vm->GetStackMachine().GetFloat(HSVM_Arg(0))));
}

/** FLOAT Sin(FLOAT val) : returns the sine of val */
void Sin(VarId id_set, VirtualMachine *vm)
{
        vm->GetStackMachine().SetFloat(id_set,sin(vm->GetStackMachine().GetFloat(HSVM_Arg(0))));
}

/** FLOAT Tan(FLOAT val) : returns the tangent of val */
void Tan(VarId id_set, VirtualMachine *vm)
{
        vm->GetStackMachine().SetFloat(id_set,tan(vm->GetStackMachine().GetFloat(HSVM_Arg(0))));
}

/** FLOAT ACos(FLOAT val) : returns the arc cosine of val */
void ACos(VarId id_set, VirtualMachine *vm)
{
        double val = vm->GetStackMachine().GetFloat(HSVM_Arg(0));
        if (val < -1 || val > 1)
            throw VMRuntimeError(Error::ArgumentNotInDomain, "ACOS");
        else
            vm->GetStackMachine().SetFloat(id_set,acos(val));
}

/** FLOAT ASin(FLOAT val) : returns the arc sine of val */
void ASin(VarId id_set, VirtualMachine *vm)
{
        double val = vm->GetStackMachine().GetFloat(HSVM_Arg(0));
        if (val < -1 || val > 1)
            throw VMRuntimeError(Error::ArgumentNotInDomain, "ASIN");
        else
            vm->GetStackMachine().SetFloat(id_set,asin(val));
}

/** FLOAT ATan(FLOAT val) : returns the arc tangent of val */
void ATan(VarId id_set, VirtualMachine *vm)
{
        double val = vm->GetStackMachine().GetFloat(HSVM_Arg(0));
        vm->GetStackMachine().SetFloat(id_set,atan(val));
}

/** FLOAT ATan2(FLOAT val1, FLOAT val2) : returns the arc tangent of val1/val2 */
void ATan2(VarId id_set, VirtualMachine *vm)
{
        double val1 = vm->GetStackMachine().GetFloat(HSVM_Arg(0));
        double val2 = vm->GetStackMachine().GetFloat(HSVM_Arg(1));
        if (val1 == 0 && val2 == 0)
            throw VMRuntimeError(Error::ArgumentNotInDomain, "ATAN2");
        else
            vm->GetStackMachine().SetFloat(id_set,atan2(val1,val2));
}

/** FLOAT CosH(FLOAT val) : returns the hyperbolic cosine of val */
void CosH(VarId id_set, VirtualMachine *vm)
{
        errno = 0;
        vm->GetStackMachine().SetFloat(id_set,cosh(vm->GetStackMachine().GetFloat(HSVM_Arg(0))));
        if (errno == ERANGE)
            throw VMRuntimeError(Error::FloatingPointOverflow);
        else if (errno != 0)
            throw VMRuntimeError(Error::InternalError, "Math error in COSH");
}

/** FLOAT SinH(FLOAT val) : returns the hyperbolic sine of val */
void SinH(VarId id_set, VirtualMachine *vm)
{
        errno = 0;
        vm->GetStackMachine().SetFloat(id_set,sinh(vm->GetStackMachine().GetFloat(HSVM_Arg(0))));
        if (errno == ERANGE)
            throw VMRuntimeError(Error::FloatingPointOverflow);
        else if (errno != 0)
            throw VMRuntimeError(Error::InternalError, "Math error in SINH");
}

/** FLOAT TanH(FLOAT val) : returns the hyperbolic tangent of val */
void TanH(VarId id_set, VirtualMachine *vm)
{
        errno = 0;
        vm->GetStackMachine().SetFloat(id_set,tanh(vm->GetStackMachine().GetFloat(HSVM_Arg(0))));
}

/** FLOAT Exp(FLOAT val) : returns the exponentional of val, with base e */
void Exp(VarId id_set, VirtualMachine *vm)
{
        errno = 0;
        vm->GetStackMachine().SetFloat(id_set,exp(vm->GetStackMachine().GetFloat(HSVM_Arg(0))));
        if (errno == ERANGE)
            throw VMRuntimeError(Error::FloatingPointOverflow);
        else if (errno != 0)
            throw VMRuntimeError(Error::InternalError, "Math error in EXP");
}

/** FLOAT Log(FLOAT val) : returns the natural logarithm of val */
void Log(VarId id_set, VirtualMachine *vm)
{
        double val = vm->GetStackMachine().GetFloat(HSVM_Arg(0));
        if (val <= 0)
            throw VMRuntimeError(Error::LogNotNegative);
        else
            vm->GetStackMachine().SetFloat(id_set,log(val));
}

/** FLOAT Log10(FLOAT val) : returns the logarithm of val, with base 10 */
void Log10(VarId id_set, VirtualMachine *vm)
{
        double val = vm->GetStackMachine().GetFloat(HSVM_Arg(0));
        if (val <= 0)
            throw VMRuntimeError(Error::LogNotNegative);
        else
            vm->GetStackMachine().SetFloat(id_set,log10(val));
}

/** FLOAT ModF(FLOAT val) : returns the value, splitted into an integral and a fractional part */
void ModF(VarId id_set, VirtualMachine *vm)
{
        double val = vm->GetStackMachine().GetFloat(HSVM_Arg(0));
        double integral;
        val = modf(val, &integral);

        // Create the return RECORD
        vm->GetStackMachine().RecordInitializeEmpty(id_set);
        VarId value = vm->GetStackMachine().RecordCellCreate(id_set, vm->columnnamemapper.GetMapping("INTPART"));
        vm->GetStackMachine().SetFloat(value, integral);
        value = vm->GetStackMachine().RecordCellCreate(id_set, vm->columnnamemapper.GetMapping("FRACPART"));
        vm->GetStackMachine().SetFloat(value, val);
}

/** FLOAT FrExp(FLOAT val) : returns the value, splitted into a mantissa and an exponent part */
void FrExp(VarId id_set, VirtualMachine *vm)
{
        double val = vm->GetStackMachine().GetFloat(HSVM_Arg(0));
        int exp;
        val = frexp(val, &exp);

        // Create the return RECORD
        vm->GetStackMachine().RecordInitializeEmpty(id_set);
        VarId value = vm->GetStackMachine().RecordCellCreate(id_set, vm->columnnamemapper.GetMapping("MANTISSA"));
        vm->GetStackMachine().SetFloat(value, val);
        value = vm->GetStackMachine().RecordCellCreate(id_set, vm->columnnamemapper.GetMapping("EXPONENT"));
        HSVM_IntegerSet(*vm, value, int32_t(exp));
}

/** FLOAT FMod(FLOAT val1, FLOAT val2) : returns the remainder of val1/val2 */
void FMod(VarId id_set, VirtualMachine *vm)
{
        double val2 = vm->GetStackMachine().GetFloat(HSVM_Arg(1));
        if (val2 == 0)
            throw VMRuntimeError(Error::DivisionByZero);
        else
            vm->GetStackMachine().SetFloat(id_set,fmod(vm->GetStackMachine().GetFloat(HSVM_Arg(0)),val2));
}

/** FLOAT LdExp(FLOAT mant, INTEGER exp) : calculates mant * pow(2, exp) */
void LdExp(VarId id_set, VirtualMachine *vm)
{
        errno = 0;
        vm->GetStackMachine().SetFloat(id_set,ldexp(vm->GetStackMachine().GetFloat(HSVM_Arg(0)),HSVM_IntegerGet(*vm, HSVM_Arg(1))));
        if (errno == ERANGE)
            throw VMRuntimeError(Error::FloatingPointOverflow);
        else if (errno != 0)
            throw VMRuntimeError(Error::InternalError, "Math error in EXP");
}

template <typename type> type MyAbs(type value) { if (value < 0) return -value; else return value; }

/** VARIANT Abs(VARIANT value) : calculates absolute value of 'value' */
void Abs(VarId id_set, VirtualMachine *vm)
{
        switch (HSVM_GetType(*vm, HSVM_Arg(0)))
        {
        case VariableTypes::Integer:
                HSVM_IntegerSet(*vm, id_set, MyAbs(HSVM_IntegerGet(*vm, HSVM_Arg(0)))); break;
        case VariableTypes::Integer64:
                HSVM_Integer64Set(*vm, id_set, MyAbs(HSVM_Integer64Get(*vm, HSVM_Arg(0)))); break;
        case VariableTypes::Money:
                vm->GetStackMachine().SetMoney(id_set, MyAbs(vm->GetStackMachine().GetMoney(HSVM_Arg(0)))); break;
        case VariableTypes::Float:
                vm->GetStackMachine().SetFloat(id_set, MyAbs(vm->GetStackMachine().GetFloat(HSVM_Arg(0)))); break;
        default:
            throw VMRuntimeError(Error::ExpectedNumeric, HareScript::GetTypeName((VariableTypes::Type)HSVM_GetType(*vm, HSVM_Arg(0))));
        }
}

/** INTEGER HS_TypeID(VARIANT expr) : returns type of expr */
void HS_TypeId(VarId id_set, VirtualMachine *vm)
{
        HSVM_IntegerSet(*vm, id_set, HSVM_GetType(*vm, HSVM_Arg(0)));
}

void HS_GetRecordCellList(VarId id_set, VirtualMachine *vm)
{
        StackMachine &varmem = vm->GetStackMachine();

        varmem.ArrayInitialize(id_set, 0, VariableTypes::RecordArray);
        for (unsigned i = 0; i < varmem.RecordSize(HSVM_Arg(0)); ++i)
        {
                ColumnNameId cellname = varmem.RecordCellNameByNr(HSVM_Arg(0), i);

                VarId newrecord = varmem.ArrayElementAppend(id_set);
                varmem.RecordInitializeEmpty(newrecord);

                Blex::StringPair name = vm->columnnamemapper.GetReverseMapping(cellname);
                varmem.SetString( varmem.RecordCellCreate(newrecord, vm->cn_cache.col_name), name.begin, name.end);
                varmem.MoveFrom( varmem.RecordCellCreate(newrecord, vm->cn_cache.col_value), varmem.RecordCellRefByName(HSVM_Arg (0), cellname));
        }
}

void HS_MakeDateFromText(VarId id_set, VirtualMachine *vm)
{
        Blex::StringPair str = vm->GetStackMachine().GetString(HSVM_Arg(0));
        Blex::DateTime the_date = Blex::DateTime::FromText(str.begin, str.end);
        HSVM_DateTimeSet(*vm, id_set, the_date.GetDays(), the_date.GetMsecs());
}

namespace
{

//yr:   the year to start counting from
//counts days from first year
//1->365 etc
int32_t ScalarYearsToDays(int32_t yr)
{
        yr = yr - 1;
        return (yr * 365) + (yr / 4) - (yr / 100) + (yr / 400);
}

//checks if a year is a leap year
//yr:           the year to check (e.g. 1800, 1900 are no leap, 2000 is, 1904, 1908 etc are.)
//return:       true, if the year is a leapyear, false otherwise
bool IsLeapYear(int32_t yr)
{
        return (yr % 400 == 0) || ((yr % 4 == 0) && (yr % 100 != 0));
}

int32_t GetYearLength(int32_t year)
{
        return IsLeapYear(year) ? 366 : 365;
}

int32_t CalculateWeek(int32_t dayofyear, int32_t dayofweek, int32_t year)
{
        // Calculate place of the thursday in the week (year in which the thursday falls is the year that 'owns' that week)
        dayofyear = dayofyear + (4-dayofweek);

        // Out of range (bottom)? Calc the day of year for the previous year
        if (dayofyear < 1)
            dayofyear = dayofyear + GetYearLength(year-1);
        else
        {
                int32_t yearlength = GetYearLength(year);

                // Out of range (top)? Calc the day of year for the next year
                if (dayofyear > yearlength)
                    dayofyear = dayofyear - yearlength;
        }

        // Make the day of year 0-based, and then we can divide by 7, yielding the number of thursdays
        // before the current one, and that's the weeknr - 1.
        return ((dayofyear - 1) / 7) + 1;
}


static int32_t month_length_leap[] = { 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31, 0 };
static int32_t month_length_nonleap[] = { 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31, 0 };

struct UnpackedDateTime
{
        int32_t year;
        int32_t month;
        int32_t week;
        int32_t yearofweek;
        int32_t dayofyear;
        int32_t dayofmonth;
        int32_t dayofweek;
        int32_t hour;
        int32_t minute;
        int32_t second;
        int32_t msecond;
};

bool UnpackDateTime(Blex::DateTime const &date, UnpackedDateTime *result)
{
        if (date == Blex::DateTime::Invalid())
            return false;

        int32_t daycount = date.GetDays();
        int32_t msecondcount = date.GetMsecs();

        int32_t year = ((daycount/146097)       *400) //400 years take 146097 days
                          +(((daycount%146097)/36524)*100) //100 years take 36524 days inside a period of 400 years (eg 1601-2000)
                          +(((daycount%146097%36524) /1461) *4);  //4 years take 3*365+1 days inside a period of 100 years (eg 1701-1800)
        year = year + (daycount%146097%36524%1461+364)/365;


        int32_t dayofyear = daycount - ScalarYearsToDays(year);
        int32_t dayofmonth = dayofyear;
        int32_t month = 1;

        int32_t *monthlengths = IsLeapYear(year) ? month_length_leap : month_length_nonleap;
        while (true)
        {
                int32_t monthlength = *(monthlengths++);
                if (monthlength && dayofmonth > monthlength)
                {
                        dayofmonth -= monthlength;
                        ++month;
                }
                else
                    break;
        }

        int32_t dayofweek = (daycount - 1) % 7 + 1;
        int32_t week = CalculateWeek(dayofyear, dayofweek, year);
        int32_t yearofweek = year;

        if ((month < 7) != (week < 27)) // If the month does not agree with the weeknr, do a correction
            yearofweek = yearofweek + (month < 7 ? -1 : 1);

        result->year = year;
        result->month = month;
        result->week = week;
        result->yearofweek = yearofweek;
        result->dayofyear = dayofyear;
        result->dayofmonth = dayofmonth;
        result->dayofweek = dayofweek;
        result->hour = msecondcount/(1000*60*60);
        result->minute = (msecondcount%(1000*60*60)) / (1000*60);
        result->second = (msecondcount%(1000*60)) / (1000);
        result->msecond = msecondcount%1000;
        return true;
}

void AddDateText(Blex::StringPair const &datetexts, unsigned nr, std::string *result)
{
        auto itr = datetexts.begin;
        auto limit = std::find(itr, datetexts.end, ';');
        while (nr--)
        {
                if (limit == datetexts.end)
                    return;

                // INV: *limit == ';'
                itr = limit;
                limit = std::find(++itr, datetexts.end, ';');
        }

        result->append(itr, limit);
}

void FormatPart(Blex::DateTime date, UnpackedDateTime const &unpacked, bool removezeroes, bool untruncated, char c, Blex::StringPair const &datetexts, std::string *result)
{
        switch (c)
        {
            case 'a':       AddDateText(datetexts, 32 + unpacked.dayofweek, result); break; //dayofweek name, abbreviated
            case 'A':       AddDateText(datetexts, 13 + unpacked.dayofweek, result); break; //dayofweek name, full
            case 'b':       AddDateText(datetexts, 20 + unpacked.month, result); break; //month name, abbreviated
            case 'B':       AddDateText(datetexts, 1 + unpacked.month, result); break; //month name
            case 'C':       Blex::EncodeNumber((unpacked.year + 1) / 100, 10, std::back_inserter(*result)); break; //century number
            case 'd':       { //day of month
                                    if (!removezeroes && unpacked.dayofmonth < 10)
                                        result->push_back('0');
                                    Blex::EncodeNumber(unpacked.dayofmonth, 10, std::back_inserter(*result));
                            } break;
            case 'H':       { //hour of the day (24 hours format)
                                    int hours = unpacked.hour;
                                    if(untruncated)
                                        hours += (date.GetDays() - 1) * 24;

                                    if (!removezeroes && hours < 10)
                                        result->push_back('0');
                                    Blex::EncodeNumber(hours, 10, std::back_inserter(*result));
                            } break;
            case 'I':       { //hour of the day (12 hours format)
                                    int32_t hour = unpacked.hour % 12;
                                    if (hour == 0)
                                        hour = 12;
                                    if (!removezeroes && hour < 10)
                                        result->push_back('0');
                                    Blex::EncodeNumber(hour, 10, std::back_inserter(*result));
                            } break;
            case 'j':       { //day of the year (three-digit)
                                    if (!removezeroes && unpacked.dayofyear < 100)
                                        result->push_back('0');
                                    if (!removezeroes && unpacked.dayofyear < 10)
                                        result->push_back('0');
                                    Blex::EncodeNumber(unpacked.dayofyear, 10, std::back_inserter(*result));
                            } break;
            case 'M':       { //two digit minute
                                    if (!removezeroes && unpacked.minute < 10)
                                        result->push_back('0');
                                    Blex::EncodeNumber(unpacked.minute, 10, std::back_inserter(*result));
                            } break;
            case 'm':       { //two digit month
                                    if (!removezeroes && unpacked.month < 10)
                                        result->push_back('0');
                                    Blex::EncodeNumber(unpacked.month, 10, std::back_inserter(*result));
                            } break;
            case 'p':       AddDateText(datetexts, unpacked.hour >= 0 && unpacked.hour <= 11 ? 0 : 1, result); break; //am/pm
            case 'Q':       { //millisecond (three-digit)
                                    if (!removezeroes && unpacked.msecond < 100)
                                        result->push_back('0');
                                    if (!removezeroes && unpacked.msecond < 10)
                                        result->push_back('0');
                                    Blex::EncodeNumber(unpacked.msecond, 10, std::back_inserter(*result));
                            } break;
            case 'S':       { //two digit second
                                    if (!removezeroes && unpacked.second < 10)
                                        result->push_back('0');
                                    Blex::EncodeNumber(unpacked.second, 10, std::back_inserter(*result));
                            } break;
            case 'V':       { //week number
                                    if (!removezeroes && unpacked.week < 10)
                                        result->push_back('0');
                                    Blex::EncodeNumber(unpacked.week, 10, std::back_inserter(*result));
                            } break;
            case 'Y':       { //year, with century
                                    if (!removezeroes && unpacked.year < 1000)
                                        result->push_back('0');
                                    if (!removezeroes && unpacked.year < 100)
                                        result->push_back('0');
                                    if (!removezeroes && unpacked.year < 10)
                                        result->push_back('0');
                                    Blex::EncodeNumber(unpacked.year, 10, std::back_inserter(*result));
                            } break;
            case 'y':       { //year, without century
                                    int32_t year = unpacked.year % 100;
                                    if (!removezeroes && year < 10)
                                        result->push_back('0');
                                    Blex::EncodeNumber(year, 10, std::back_inserter(*result));
                            } break;
             default:       result->push_back(c); break;
        }
}

static char langcode_nl[] = "NL";
static char langcode_de[] = "DE";
static char langcode_fr[] = "FR";
static char langcode_jp[] = "JP";

static char datetexts_nl[] = "am;pm;januari;februari;maart;april;mei;juni;juli;augustus;september;oktober;november;december;maandag;dinsdag;woensdag;donderdag;vrijdag;zaterdag;zondag;jan;feb;mrt;apr;mei;jun;jul;aug;sep;okt;nov;dec;ma;di;wo;do;vr;za;zo";
static char datetexts_de[] = "am;pm;Januar;Februar;März;April;Mai;Juni;Juli;August;September;Oktober;November;Dezember;Montag;Dienstag;Mittwoch;Donnerstag;Freitag;Samstag;Sonntag;Jan.;Febr.;März;Apr.;Mai;Juni;Juli;Aug.;Sept.;Okt.;Nov.;Dez.;Mo;Di;Mi;Do;Fr;Sa;So";
static char datetexts_fr[] = "am;pm;Janvier;Février;Mars;Avril;Mai;Juin;Juillet;Août;Septembre;Octobre;Novembre;Décembre;Lundi;Mardi;Mercredi;Jeudi;Vendredi;Samedi;Dimanche;Janv;Févr;Mars;Avril;Mai;Juin;Juil;Août;Sept;Oct;Nov;Déc;Lun;Mar;Mer;Jeu;Ven;Sam;Dim";
static char datetexts_en[] = "am;pm;January;February;March;April;May;June;July;August;September;October;November;December;Monday;Tuesday;Wednesday;Thursday;Friday;Saturday;Sunday;Jan;Feb;Mar;Apr;May;Jun;Jul;Aug;Sep;Oct;Nov;Dec;Mon;Tue;Wed;Thu;Fri;Sat;Sun";

static Blex::Mutex jpmutex;
static char datetexts_jp_b64[] = "5Y2I5YmNO+WNiOW+jDvvvJHmnIg777yS5pyIO++8k+aciDvvvJTmnIg777yV5pyIO++8luaciDvvvJfmnIg777yY5pyIO++8meaciDvvvJHvvJDmnIg777yR77yR5pyIO++8ke+8kuaciDvmnIjmm5zml6U754Gr5puc5pelO+awtOabnOaXpTvmnKjmm5zml6U76YeR5puc5pelO+Wcn+abnOaXpTvml6Xmm5zml6U777yR5pyIO++8kuaciDvvvJPmnIg777yU5pyIO++8leaciDvvvJbmnIg777yX5pyIO++8mOaciDvvvJnmnIg777yR77yQ5pyIO++8ke+8keaciDvvvJHvvJLmnIg75pyIO+eBqzvmsLQ75pyoO+mHkTvlnJ875pel";
static std::string datetexts_jp;

Blex::StringPair GetLanguageDateTimeStrings(Blex::StringPair datetexts)
{

        if (Blex::StrCaseCompare< const char * >(datetexts.begin, datetexts.end, langcode_nl, langcode_nl + 2) == 0)
            return Blex::StringPair::FromStringConstant(datetexts_nl);
        if (Blex::StrCaseCompare< const char * >(datetexts.begin, datetexts.end, langcode_de, langcode_de + 2) == 0)
            return Blex::StringPair::FromStringConstant(datetexts_de);
        if (Blex::StrCaseCompare< const char * >(datetexts.begin, datetexts.end, langcode_fr, langcode_fr + 2) == 0)
            return Blex::StringPair::FromStringConstant(datetexts_fr);
        if (Blex::StrCaseCompare< const char * >(datetexts.begin, datetexts.end, langcode_jp, langcode_jp + 2) == 0)
        {
                Blex::Mutex::AutoLock lock(jpmutex);
                if (datetexts_jp.empty())
                {
                        Blex::StringPair source = Blex::StringPair::FromStringConstant(datetexts_jp_b64);
                        Blex::DecodeBase64(source.begin, source.end, std::back_inserter(datetexts_jp));
                        return Blex::StringPair(datetexts_jp.begin(), datetexts_jp.end());
                }
        }
        return Blex::StringPair::FromStringConstant(datetexts_en);
}

} // end of anonymous namespace

void HS_UnpackDateTime(VarId id_set, VirtualMachine *vm)
{
        StackMachine &varmem = vm->GetStackMachine();
        varmem.InitVariable(id_set, VariableTypes::Record);

        Blex::DateTime date = varmem.GetDateTime(HSVM_Arg(0));
        if (date == Blex::DateTime::Invalid())
            return;

        UnpackedDateTime result;
        UnpackDateTime(date, &result);

        varmem.SetInteger(varmem.RecordCellCreate(id_set, vm->cn_cache.col_year), result.year);
        varmem.SetInteger(varmem.RecordCellCreate(id_set, vm->cn_cache.col_month), result.month);
        varmem.SetInteger(varmem.RecordCellCreate(id_set, vm->cn_cache.col_week), result.week);
        varmem.SetInteger(varmem.RecordCellCreate(id_set, vm->cn_cache.col_yearofweek), result.yearofweek);
        varmem.SetInteger(varmem.RecordCellCreate(id_set, vm->cn_cache.col_dayofyear), result.dayofyear);
        varmem.SetInteger(varmem.RecordCellCreate(id_set, vm->cn_cache.col_dayofmonth), result.dayofmonth);
        varmem.SetInteger(varmem.RecordCellCreate(id_set, vm->cn_cache.col_dayofweek), result.dayofweek);
        varmem.SetInteger(varmem.RecordCellCreate(id_set, vm->cn_cache.col_hour), result.hour);
        varmem.SetInteger(varmem.RecordCellCreate(id_set, vm->cn_cache.col_minute), result.minute);
        varmem.SetInteger(varmem.RecordCellCreate(id_set, vm->cn_cache.col_second), result.second);
        varmem.SetInteger(varmem.RecordCellCreate(id_set, vm->cn_cache.col_msecond), result.msecond);
}

void HS_FormatDateTime(VarId id_set, VirtualMachine *vm) // STRING formatstring, DATETIME date, STRING datetexts
{
        StackMachine &varmem = vm->GetStackMachine();

        Blex::StringPair formatstring = varmem.GetString(HSVM_Arg(0));
        Blex::DateTime date = varmem.GetDateTime(HSVM_Arg(1));
        Blex::StringPair datetexts = varmem.GetString(HSVM_Arg(2));

        varmem.InitVariable(id_set, VariableTypes::String);
        if (date == Blex::DateTime::Max() || date == Blex::DateTime::Invalid())
            return;

        if (std::find(datetexts.begin, datetexts.end, ';') == datetexts.end)
            datetexts = GetLanguageDateTimeStrings(datetexts);

        UnpackedDateTime unpacked;
        UnpackDateTime(date, &unpacked);

        std::string result;
        for (auto itr = formatstring.begin; itr != formatstring.end;)
        {
                char c = *(itr++);
                if (c != '%')
                    result.push_back(c);
                else
                {
                        if (itr == formatstring.end)
                            break;

                        bool removezeroes = false;
                        bool untruncated = false;
                        c = *(itr++);

                        //Is this a 'remove zeros' type?
                        if (c == '#')
                        {
                                if (itr == formatstring.end)
                                    break;

                                removezeroes = true;
                                c = *(itr++);
                        }

                        if (c == '&')
                        {
                                if (itr == formatstring.end)
                                    break;

                                untruncated = true;
                                c = *(itr++);
                        }

                        FormatPart(date, unpacked, removezeroes, untruncated, c, datetexts, &result);
                }
        }

        varmem.SetSTLString(id_set, result);
}

void ObjectExists(VarId id_set,VirtualMachine *vm)
{
        HSVM_BooleanSet(*vm, id_set, vm->GetStackMachine().ObjectExists(HSVM_Arg(0)));
}

void ObjectMemberExists(VarId id_set,VirtualMachine *vm)
{
        Blex::StringPair str = vm->GetStackMachine().GetString(HSVM_Arg(1));
        ColumnNameId nameid= vm->columnnamemapper.GetMapping( str.size(), str.begin);

        HSVM_BooleanSet(*vm, id_set, HSVM_ObjectMemberExists(*vm, HSVM_Arg(0), nameid));
}

/*
void ObjectBindMethod(VarId id_set,VirtualMachine *vm)
{
        vm->GetStackMachine().BindFunctionPointerToObject(HSVM_Arg(0), HSVM_Arg(1));
        HSVM_CopyFrom(*vm, id_set, HSVM_Arg(0));
}*/

void ObjectMemberInsert(VarId id_set,VirtualMachine *vm)
{
        Blex::StringPair str = vm->GetStackMachine().GetString(HSVM_Arg(1));
        ColumnNameId nameid = vm->columnnamemapper.GetMapping( str.size(), str.begin);

        HSVM_ObjectMemberInsert(*vm, HSVM_Arg(0), nameid, HSVM_Arg(3), HSVM_BooleanGet(*vm, HSVM_Arg(2)), false);
        HSVM_CopyFrom(*vm, id_set, HSVM_Arg(0));
}

void ObjectGetMember(VarId id_set,VirtualMachine *vm) //OBJECT obj, STRING membername
{
        Blex::StringPair str = vm->GetStackMachine().GetString(HSVM_Arg(1));
        ColumnNameId nameid = vm->columnnamemapper.GetMapping( str.size(), str.begin);

        HSVM_ObjectMemberCopy(*vm, HSVM_Arg(0), nameid, id_set, false);
}
void ObjectGetMemberType(VarId id_set,VirtualMachine *vm) //OBJECT obj, STRING membername
{
        Blex::StringPair str = vm->GetStackMachine().GetString(HSVM_Arg(1));
        ColumnNameId nameid = vm->columnnamemapper.GetMapping( str.size(), str.begin);

        int type = HSVM_ObjectMemberType(*vm, HSVM_Arg(0), nameid, false);
        const char *result = "";
        switch (type)
        {
        case 0: result = "NONE"; break;
        case 1: result = "VARIABLE"; break;
        case 2: result = "FUNCTION"; break;
        case 3: result = "PROPERTY"; break;
        case 4: result = "PRIVATE"; break;
        };
        const char *end = result + strlen(result);

        HSVM_StringSet(*vm, id_set, result, end);
}

void ObjectGetMemberPrivate(VarId id_set,VirtualMachine *vm) //OBJECT obj, STRING membername
{
        Blex::StringPair str = vm->GetStackMachine().GetString(HSVM_Arg(1));
        ColumnNameId nameid = vm->columnnamemapper.GetMapping( str.size(), str.begin);

        if (vm->GetObjectInternalProtected(HSVM_Arg(0)))
            throw VMRuntimeError(Error::CannotAccessProtectedObjectType);

        HSVM_ObjectMemberCopy(*vm, HSVM_Arg(0), nameid, id_set, true);
}

void ObjectSetMember(VirtualMachine *vm) //OBJECT obj, STRING membername, VARIANT value
{
        Blex::StringPair str = vm->GetStackMachine().GetString(HSVM_Arg(1));
        ColumnNameId nameid = vm->columnnamemapper.GetMapping( str.size(), str.begin);

        HSVM_ObjectMemberSet(*vm, HSVM_Arg(0), nameid, HSVM_Arg(2), false);
}

void ObjectSetMemberPrivate(VirtualMachine *vm) //OBJECT obj, STRING membername, VARIANT value
{
        Blex::StringPair str = vm->GetStackMachine().GetString(HSVM_Arg(1));
        ColumnNameId nameid = vm->columnnamemapper.GetMapping( str.size(), str.begin);

        if (vm->GetObjectInternalProtected(HSVM_Arg(0)))
            throw VMRuntimeError(Error::CannotAccessProtectedObjectType);

        HSVM_ObjectMemberSet(*vm, HSVM_Arg(0), nameid, HSVM_Arg(2), true);
}

void ObjectDeleteMember(VarId id_set,VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        Blex::StringPair str = stackm.GetString(HSVM_Arg(1));
        ColumnNameId nameid = vm->columnnamemapper.GetMapping(str.size(), str.begin);

        HSVM_ObjectMemberDelete(*vm, HSVM_Arg(0), nameid, false);
        HSVM_CopyFrom(*vm, id_set, HSVM_Arg(0));
}

void DebugCopyObjectToRecord(VarId id_set,VirtualMachine *vm)
{
        vm->GetStackMachine().CopyRecordFromObject(id_set, HSVM_Arg(0));
}

void DebugFunctionPTRToRecord(VarId id_set, VirtualMachine *vm)
{
        StackMachine &varmem = vm->GetStackMachine();
        varmem.CopyFrom(id_set, HSVM_Arg(0));
        varmem.DEBUG_FunctionRecordToRecord(id_set);

        HSVM_ColumnId col_function = HSVM_GetColumnId(*vm, "FUNCTION");
        HSVM_ColumnId col_lib = HSVM_GetColumnId(*vm, "LIBRARY");

        HSVM_VariableId v_lib = HSVM_RecordCreate(*vm, id_set, col_lib);
        HSVM_VariableId v_func = HSVM_RecordCreate(*vm, id_set, col_function);

        HSVM_StringSet(*vm, v_lib, 0, 0);
        HSVM_StringSet(*vm, v_func, 0, 0);

        VarId functionptr = HSVM_Arg(0);

        if (HSVM_RecordLength(*vm, functionptr) == 0)
            return;

        HSVM_ColumnId col_functionid = HSVM_GetColumnId(*vm, "FUNCTIONID");
        HSVM_ColumnId col_libid = HSVM_GetColumnId(*vm, "LIBID");
        HSVM_ColumnId col_vm = HSVM_GetColumnId(*vm, "VM");

        VirtualMachine *remote_vm = varmem.GetVMRef(HSVM_RecordGetRef(*vm, id_set, col_vm));
        if (remote_vm != vm)
            return;

        LibraryId libid = HSVM_IntegerGet(*vm, HSVM_RecordGetRef(*vm, id_set, col_libid));
        int32_t functionid = HSVM_IntegerGet(*vm, HSVM_RecordGetRef(*vm, id_set, col_functionid));

        Library const *lib = vm->GetLibraryLoader().GetWHLibraryById(libid);
        if (!lib)
            return;

        // Check a little
        LinkedLibrary::ResolvedFunctionDefList const &deflist = lib->GetLinkedLibrary().functiondefs;
        if (functionid >= (signed)deflist.size())
            return;

        HSVM_StringSetSTD(*vm, v_lib, lib->GetLibURI());
        HSVM_StringSetSTD(*vm, v_func, lib->GetWrappedLibrary().linkinfo.GetNameStr(deflist[functionid].def->name_index));
}

void ObjectGetObjectId(VarId id_set, VirtualMachine *vm)
{
        HSVM_IntegerSet(*vm, id_set, vm->GetStackMachine().GetObjectId(HSVM_Arg(0)));
}

void MakeEmptyObject(VarId id_set,VirtualMachine *vm)
{
        vm->GetStackMachine().ObjectInitializeEmpty(id_set);
}

void GetObjectTypeName(VarId id_set,VirtualMachine *vm)
{
        std::string name = vm->GetObjectTypeName(HSVM_Arg(0));
        vm->GetStackMachine().SetSTLString(id_set, name);
}

void GetObjectExtendNames(VarId id_set,VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        std::vector< std::string > objecttype_names;
        vm->GetObjectExtendNames(HSVM_Arg(0), &objecttype_names);

        stackm.InitVariable(id_set, VariableTypes::StringArray);
        for (std::vector< std::string >::const_iterator it = objecttype_names.begin(); it != objecttype_names.end(); ++it)
        {
                VarId name = stackm.ArrayElementAppend(id_set);
                stackm.SetSTLString(name, *it);
        }
}

void GetObjectMethodPtr(VarId id_set, VirtualMachine *vm)
{
        // PUBLIC FUNCTION PTR FUNCTION GetObjectMethodPtr(OBJECT obj, STRING membername) __ATTRIBUTES__(EXTERNAL, EXECUTESHARESCRIPT);

        StackMachine &stackm = vm->GetStackMachine();
        Marshaller marshaller(vm, MarshalMode::DataOnly);

        Blex::StringPair str = stackm.GetString(HSVM_Arg(1));
        ColumnNameId nameid = vm->columnnamemapper.GetMapping(str.size(), str.begin);

        LinkedLibrary::ObjectVTableEntry const *entry = vm->ResolveVTableEntry(HSVM_Arg(0), nameid);
        if (!entry || entry->type != ObjectCellType::Method) // ADDME: different error for members/properties
        {
//                HSVM_SetDefault(*vm, id_set, HSVM_VAR_FunctionPtr);

                vm->ObjectMemberCopy(HSVM_Arg(0), nameid, /*this_access=*/false, id_set);
                stackm.CastTo(id_set, VariableTypes::FunctionRecord);

                return;
                throw VMRuntimeError(Error::MemberDoesNotExist, vm->columnnamemapper.GetReverseMapping(nameid).stl_str());
        }
        // ADDME: we already have the entry: this can be done quicker...
        if (!vm->ObjectMemberAccessible(HSVM_Arg(0), nameid, false))
            throw VMRuntimeError(Error::PrivateMemberOnlyThroughThis);

        FunctionDef const *funcdef = entry->method->def;
        bool is_vararg = funcdef->flags & FunctionFlags::VarArg;

        stackm.InitVariable(id_set, VariableTypes::FunctionRecord);

        stackm.SetInteger(stackm.RecordCellCreate(id_set, vm->cn_cache.col_libid), entry->method->lib->GetId());
        stackm.SetInteger(stackm.RecordCellCreate(id_set, vm->cn_cache.col_functionid), entry->method->id);
        stackm.SetVMRef  (stackm.RecordCellCreate(id_set, vm->cn_cache.col_vm), vm);
        stackm.SetInteger(stackm.RecordCellCreate(id_set, vm->cn_cache.col_returntype), funcdef->resulttype);
        stackm.SetInteger(stackm.RecordCellCreate(id_set, vm->cn_cache.col_excessargstype), is_vararg ? ToNonArray(funcdef->parameters.back().type) : 0);
        stackm.SetInteger(stackm.RecordCellCreate(id_set, vm->cn_cache.col_firstunusedsource), funcdef->parameters.size() - is_vararg); // first parameter is bound immediately
        VarId parameters = stackm.RecordCellCreate(id_set, vm->cn_cache.col_parameters);
        stackm.InitVariable(parameters, VariableTypes::RecordArray);

        ColumnNameId col_source = vm->cn_cache.col_source;
        ColumnNameId col_value = vm->cn_cache.col_value;
        ColumnNameId col_type = vm->cn_cache.col_type;

        for (unsigned idx = 0, end = funcdef->parameters.size() - is_vararg; idx < end; ++idx)
        {
                FunctionDef::Parameter const &parameter = funcdef->parameters[idx];
                VarId param = stackm.ArrayElementAppend(parameters);
                stackm.InitVariable(param, VariableTypes::Record);

                // Set the type
                stackm.SetInteger(stackm.RecordCellCreate(param, col_type), parameter.type);

                // Set the source and the default value (if present). For param 0, auto-bind to the object.
                if (idx == 0)
                {
                        stackm.SetInteger(stackm.RecordCellCreate(param, col_source), 0);
                        stackm.CopyFrom(stackm.RecordCellCreate(param, col_value), HSVM_Arg(0));
                }
                else if (parameter.defaultid != -1)
                {
                        // Default present
                        stackm.SetInteger(stackm.RecordCellCreate(param, col_source), -idx); // INV: idx != 0
                        marshaller.SetLibraryColumnNameDecoder(&entry->method->lib->GetLinkedLibrary().resolvedcolumnnames);
                        WrappedLibrary const &wlib = entry->method->lib->GetWrappedLibrary();
                        uint8_t const *buf = wlib.GetConstantBuffer(parameter.defaultid);
                        uint8_t const *limit = buf + wlib.GetConstantBufferLength(parameter.defaultid);
                        marshaller.Read(stackm.RecordCellCreate(param, col_value), buf, limit);
                }
                else
                    stackm.SetInteger(stackm.RecordCellCreate(param, col_source), idx); // INV: idx != 0
        }
}

void MakeObjectPublic(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();
        stackm.ObjectSetReferencePrivilegeStatus(HSVM_Arg(0), false);
        stackm.CopyFrom(id_set, HSVM_Arg(0));
}

void MakeObjectPrivate(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();
        stackm.ObjectSetReferencePrivilegeStatus(HSVM_Arg(0), true);
        stackm.CopyFrom(id_set, HSVM_Arg(0));
}

void IsObjectPublic(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();
        stackm.SetBoolean(id_set, !stackm.ObjectIsPrivilegedReference(HSVM_Arg(0)));
}

void DescribeObjectStructure(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        stackm.InitVariable(id_set, VariableTypes::Record);

        Blex::SemiStaticPodVector< LinkedLibrary::LinkedObjectDef const *, 16 > objdefs;
        if (!vm->GetObjectDefinitions(HSVM_Arg(0), &objdefs))
            return;

        HSVM_VariableId members =   stackm.RecordCellCreate(id_set, vm->columnnamemapper.GetMapping("MEMBERS"));
        HSVM_VariableId methods =   stackm.RecordCellCreate(id_set, vm->columnnamemapper.GetMapping("METHODS"));
        HSVM_VariableId properties = stackm.RecordCellCreate(id_set, vm->columnnamemapper.GetMapping("PROPERTIES"));
        HSVM_VariableId isstatic =   stackm.RecordCellCreate(id_set, vm->columnnamemapper.GetMapping("ISSTATIC"));

        stackm.InitVariable(members, VariableTypes::RecordArray);
        stackm.InitVariable(methods, VariableTypes::RecordArray);
        stackm.InitVariable(properties, VariableTypes::RecordArray);

        ObjectTypeDefinition const *type = static_cast< ObjectTypeDefinition const * >(stackm.ObjectGetTypeDescriptor(HSVM_Arg(0)));
        stackm.SetBoolean(isstatic, type->objdefs.back()->def->flags & ObjectTypeFlags::Static);

        std::map< ColumnNameId, LinkedLibrary::ObjectVTableEntry const * > final_entries;

        for (Blex::PodVector< LinkedLibrary::LinkedObjectDef const * >::iterator it = objdefs.begin(); it != objdefs.end(); ++it)
        {
                for (Blex::PodVector< LinkedLibrary::ObjectVTableEntry >::const_iterator eit = (*it)->entries.begin(); eit != (*it)->entries.end(); ++eit)
                {
                        LinkedLibrary::ObjectVTableEntry const *&vtableentry = final_entries[eit->nameid];
                        if (!vtableentry)
                            vtableentry = &*eit;
                }
        }

        ColumnNameId col_name = vm->columnnamemapper.GetMapping("NAME");
        ColumnNameId col_type = vm->columnnamemapper.GetMapping("TYPE");
        ColumnNameId col_is_public = vm->columnnamemapper.GetMapping("IS_PUBLIC");
        ColumnNameId col_getter = vm->columnnamemapper.GetMapping("GETTER");
        ColumnNameId col_setter = vm->columnnamemapper.GetMapping("SETTER");

        bool also_internals = HSVM_BooleanGet(*vm, HSVM_Arg(1));

        for (std::map< ColumnNameId, LinkedLibrary::ObjectVTableEntry const * >::iterator it = final_entries.begin(); it != final_entries.end(); ++it)
        {
                LinkedLibrary::ObjectVTableEntry const &entry = *it->second;

                // ADDME: we already have the entry: this can be done quicker...
                if (!also_internals && !vm->ObjectMemberAccessible(HSVM_Arg(0), entry.nameid, false))
                    continue;

                VarId newrecord = 0;
                switch (entry.type)
                {
                case ObjectCellType::Member:
                    {
                            newrecord = stackm.ArrayElementAppend(members);
                            stackm.RecordInitializeEmpty(newrecord);

                            stackm.SetInteger(stackm.RecordCellCreate(newrecord, col_type), entry.var_type);
                    } break;
                case ObjectCellType::Method:
                    {
                            newrecord = stackm.ArrayElementAppend(methods);
                            stackm.RecordInitializeEmpty(newrecord);
                    } break;
                case ObjectCellType::Property:
                    {
                            newrecord = stackm.ArrayElementAppend(properties);
                            stackm.RecordInitializeEmpty(newrecord);

                            if (also_internals)
                            {
                                    Blex::StringPair getter_name;
                                    if (entry.getter_nameid)
                                        getter_name = vm->columnnamemapper.GetReverseMapping(entry.getter_nameid);
                                    else
                                        getter_name = Blex::StringPair::ConstructEmpty();
                                    stackm.SetString(stackm.RecordCellCreate(newrecord, col_getter), getter_name);

                                    Blex::StringPair setter_name;
                                    if (entry.setter_nameid)
                                        setter_name = vm->columnnamemapper.GetReverseMapping(entry.setter_nameid);
                                    else
                                        setter_name = Blex::StringPair::ConstructEmpty();
                                    stackm.SetString(stackm.RecordCellCreate(newrecord, col_setter), setter_name);
                            }
                    } break;
                case ObjectCellType::Unknown:
                    {
                            // Next item
                            continue;
                    }
                }

                Blex::StringPair name = vm->columnnamemapper.GetReverseMapping(entry.nameid);

                stackm.SetString(stackm.RecordCellCreate(newrecord, col_name), name);
                stackm.SetBoolean(stackm.RecordCellCreate(newrecord, col_is_public), !entry.is_private);
        }
}

void WeakObjectExists(VarId id_set,VirtualMachine *vm)
{
        HSVM_BooleanSet(*vm, id_set, vm->GetStackMachine().WeakObjectExists(HSVM_Arg(0)));
}

void HS_GetTypeName(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();
        stackm.SetSTLString(id_set, HareScript::GetTypeName(static_cast< VariableTypes::Type >(stackm.GetInteger(HSVM_Arg(0)))));
}

void CollectGarbage(VirtualMachine *vm)
{
        vm->GetStackMachine().CollectObjects();

        DynamicLinkManager::ExecuteGarbageCollectionCallbacks(*vm);
}

std::string GetGlobalVariableName(VirtualMachine *vm, VarId id_set)
{
        StackMachine &stackm = vm->GetStackMachine();

        std::string name;

        // Returns libraryid / var offset
        std::pair< unsigned, unsigned > mapping = stackm.LookupMapping(id_set);

        if (mapping.first)
        {
                LibraryLoader const &loader = vm->GetLibraryLoader();

                Library const *lib = loader.GetWHLibraryById(mapping.first);
                if (lib)
                {
                        LinkedLibrary const &llib = lib->GetLinkedLibrary();
                        for (LinkedLibrary::ResolvedVariableDefList::const_iterator it = llib.variabledefs.begin(); it != llib.variabledefs.end(); ++it)
                            if (it->def->globallocation == mapping.second && it->lib == lib)
                            {
                                    name = lib->GetWrappedLibrary().linkinfo.GetNameStr(it->def->name_index);
                                    name += " (" + lib->GetLibURI() + ")";
                            }
                }
        }

        return name;
}

std::string DebugGetWebTypeName(VirtualMachine *vm, VarId id_set, bool want_varname)
{
        StackMachine &stackm = vm->GetStackMachine();

        std::string name;
        if (want_varname)
            name = GetGlobalVariableName(vm, id_set);

        if (stackm.GetType(id_set) == VariableTypes::Object)
        {
                if (name.empty())
                    name = vm->GetObjectTypeName(id_set);
                else
                {
                        std::string objname = vm->GetObjectTypeName(id_set);
                        if (!objname.empty())
                            name = objname + " (" + name + ")";
                }
        }
        return name;
}

void EncodeObjectWeb(VirtualMachine *source_vm, VirtualMachine *vm, VarId id_set, bool included_unreferenced)
{
        StackMachine &source_stackm = source_vm->GetStackMachine();
        StackMachine &stackm = vm->GetStackMachine();

        std::vector< ObjectLink > links;
        source_stackm.GetObjectLinks(&links, std::bind(&DebugGetWebTypeName, source_vm, std::placeholders::_1, std::placeholders::_2), included_unreferenced);

        stackm.InitVariable(id_set, VariableTypes::RecordArray);
//        unsigned size = links.size();
        for (unsigned idx = 0, end = links.size(); idx < end; ++idx)
        {
                VarId rec = stackm.ArrayElementAppend(id_set);
                stackm.RecordInitializeEmpty(rec);
                stackm.SetInteger(stackm.RecordCellCreate(rec, vm->columnnamemapper.GetMapping("SOURCE_VAR")), links[idx].source_var);
                stackm.SetInteger(stackm.RecordCellCreate(rec, vm->columnnamemapper.GetMapping("SOURCE_OBJ")), links[idx].source_obj);
                stackm.SetSTLString(stackm.RecordCellCreate(rec, vm->columnnamemapper.GetMapping("SOURCE_TYPE")), links[idx].source_type);
                if (links[idx].source_cell)
                    stackm.SetSTLString(stackm.RecordCellCreate(rec, vm->columnnamemapper.GetMapping("SOURCE_NAME")), source_vm->columnnamemapper.GetReverseMapping(links[idx].source_cell).stl_str());
                else
                    stackm.SetSTLString(stackm.RecordCellCreate(rec, vm->columnnamemapper.GetMapping("SOURCE_NAME")), links[idx].source_name);
                stackm.SetSTLString(stackm.RecordCellCreate(rec, vm->columnnamemapper.GetMapping("DEST_TYPE")), links[idx].dest_type);
                stackm.SetInteger(stackm.RecordCellCreate(rec, vm->columnnamemapper.GetMapping("DEST_OBJ")), links[idx].dest_obj);
                stackm.SetInteger(stackm.RecordCellCreate(rec, vm->columnnamemapper.GetMapping("TOTAL_ELTS")), links[idx].total_elts);
                stackm.SetMoney(stackm.RecordCellCreate(rec, vm->columnnamemapper.GetMapping("TOTAL_SSIZE")), links[idx].total_ssize * 100000);
        }
}

void DebugGetObjectWeb(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();
        EncodeObjectWeb(vm, vm, id_set, stackm.GetBoolean(HSVM_Arg(0)));
}

void EncodeBlobReferences(VirtualMachine *source_vm, VirtualMachine *vm, VarId id_set, bool included_unreferenced)
{
        StackMachine &source_stackm = source_vm->GetStackMachine();
        StackMachine &stackm = vm->GetStackMachine();

        std::vector< BlobReference > refs;
        source_stackm.GetBlobReferences(&refs, std::bind(&DebugGetWebTypeName, source_vm, std::placeholders::_1, std::placeholders::_2), included_unreferenced);

        stackm.InitVariable(id_set, VariableTypes::Record);
        VarId items = stackm.RecordCellCreate(id_set, vm->columnnamemapper.GetMapping("ITEMS"));
        stackm.InitVariable(items, VariableTypes::RecordArray);
        for (auto &ref: refs)
        {
                VarId rec = stackm.ArrayElementAppend(items);
                stackm.RecordInitializeEmpty(rec);
                stackm.SetInteger(stackm.RecordCellCreate(rec, vm->columnnamemapper.GetMapping("SOURCE_VAR")), ref.source_var);
                stackm.SetSTLString(stackm.RecordCellCreate(rec, vm->columnnamemapper.GetMapping("SOURCE_NAME")), ref.source_name);
                stackm.SetSTLString(stackm.RecordCellCreate(rec, vm->columnnamemapper.GetMapping("SOURCE_TYPE")), ref.source_type);
                stackm.SetSTLString(stackm.RecordCellCreate(rec, vm->columnnamemapper.GetMapping("PATH")), ref.path);
                stackm.SetSTLString(stackm.RecordCellCreate(rec, vm->columnnamemapper.GetMapping("DESCRIPTION")), ref.description);
                stackm.SetInteger64(stackm.RecordCellCreate(rec, vm->columnnamemapper.GetMapping("LENGTH")), ref.length);
        }

        VarId var_stacktrace = stackm.RecordCellCreate(id_set, vm->cn_cache.col_stacktrace);
        GetVMStackTrace(vm, var_stacktrace, source_vm, true);

        VarId var_resultlibs = stackm.RecordCellCreate(id_set, vm->columnnamemapper.GetMapping("LIBRARIES"));
        GetVMLibraries(vm, var_resultlibs, source_vm);
}

void DebugGetBlobReferences(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();
        EncodeBlobReferences(vm, vm, id_set, stackm.GetBoolean(HSVM_Arg(0)));
}

void ObjectMatchesOUID(VarId id_set, VirtualMachine *vm)
{
        std::string ouid = HSVM_StringGetSTD(*vm, HSVM_Arg(1));
        HSVM_BooleanSet(*vm, id_set, vm->ObjectHasExtendUid(HSVM_Arg(0), ouid));
}




//---------------------------------------------------------------------------
//
// Type functions registration
//
//---------------------------------------------------------------------------

void InitTypes(BuiltinFunctionsRegistrator &bifreg)
{
        // Date time functions
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_CREATEDATETIMEFROMDM::D:II",HS_CreateDateTimeFromDM));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETDAYCOUNT::I:D",HS_GetHareDateDays));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETMSECONDCOUNT::I:D",HS_GetHareDateMsecs));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETCURRENTDATETIME::D:",HS_ServerDateTime));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("MAKEDATEFROMTEXT::D:S",HS_MakeDateFromText));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("UNPACKDATETIME::R:D",HS_UnpackDateTime));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("FORMATDATETIME::S:SDS", HS_FormatDateTime));

        // Record functions
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("CELLDELETE::R:RS",CellDelete));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("CELLINSERT::R:RSV",CellInsert));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("CELLUPDATE::R:RSV",CellUpdate));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("CELLEXISTS::B:RS",CellExists));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETCELL::V:RS",GetCell));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("RECORDEXISTS::B:R",RecordExists));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("UNPACKRECORD::RA:R",HS_GetRecordCellList));

//        // Casting function
//        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_GENERALCAST",HS_GeneralCast));

        // Scalar functions
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("TOSTRING::S:6I",ToString));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("TOINTEGER::I:SII",ToInteger));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("TOINTEGER64::6:S6I",ToInteger64));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_TOINTEGER::I:V",HS_ToInteger));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_TOMONEY::M:V",HS_ToMoney));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_TOFLOAT::F:V",HS_ToFloat));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_MONEYTOSTRING::S:M",HS_MoneyToString));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_FLOATTOSTRING::S:FI",HS_FloatToString));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_STRINGTOFLOAT::F:SF",HS_StringToFloat));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_GETRAWMONEY::6:M",HS_GetRawMoney));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SETRAWMONEY::M:6",HS_SetRawMoney));

        // Blob functions

        // Floating point functions
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("FLOOR::F:F",Floor));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SQRT::F:F",Sqrt));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("POW::F:FF",Pow));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("COS::F:F",Cos));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SIN::F:F",Sin));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("TAN::F:F",Tan));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ACOS::F:F",ACos));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ASIN::F:F",ASin));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ATAN::F:F",ATan));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ATAN2::F:FF",ATan2));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("COSH::F:F",CosH));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SINH::F:F",SinH));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("TANH::F:F",TanH));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("EXP::F:F",Exp));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("LOG::F:F",Log));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("LOG10::F:F",Log10));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("MODF::R:F",ModF));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("FREXP::R:F",FrExp));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("FMOD::F:FF",FMod));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("LDEXP::F:FI",LdExp));

        // Other functions
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ABS::V:V",Abs));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_TYPEID::I:V",HS_TypeId));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__INTERNAL_DEBUGFUNCTIONPTRTORECORD::R:P", DebugFunctionPTRToRecord));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("OBJECTEXISTS::B:O",ObjectExists));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("MAKEEMPTYOBJECT::O:",MakeEmptyObject));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("MEMBERINSERT::O:OSBV", ObjectMemberInsert));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("MEMBERDELETE::O:OS", ObjectDeleteMember));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("MEMBEREXISTS::B:OS", ObjectMemberExists));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETMEMBER::V:OS", ObjectGetMember));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETMEMBERTYPE::S:OS", ObjectGetMemberType));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("MEMBERUPDATE:::OSV", ObjectSetMember));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETOBJECTTYPENAME::S:O", GetObjectTypeName));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETOBJECTEXTENDNAMES::SA:O", GetObjectExtendNames));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("WEAKOBJECTEXISTS::B:W",WeakObjectExists));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETTYPENAME::S:I", HS_GetTypeName));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__INTERNAL_GETOBJECTID::I:O", ObjectGetObjectId));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__INTERNAL_DEBUGCOPYOBJECTTORECORD::R:O", DebugCopyObjectToRecord));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__INTERNAL_DEBUGGETOBJECTWEB::RA:B", DebugGetObjectWeb));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__INTERNAL_DEBUGGETBLOBREFERENCES::R:B", DebugGetBlobReferences));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_GETPRIVATEMEMBER::V:OS", ObjectGetMemberPrivate));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SETPRIVATEMEMBER:::OSV", ObjectSetMemberPrivate));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETOBJECTMETHODPTR::P:OS", GetObjectMethodPtr));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("MAKEOBJECTPUBLIC::O:O", MakeObjectPublic));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ISOBJECTPUBLIC::B:O", IsObjectPublic));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__INTERNAL_DESCRIBEOBJECTSTRUCTURE::R:OB", DescribeObjectStructure));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_INTERNAL_MAKEOBJECTREFERENCEPRIVILEGED::O:O", MakeObjectPrivate));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("COLLECTGARBAGE:::", CollectGarbage));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_OBJECTMATCHESOUID::B:OS", ObjectMatchesOUID));
}


} // End of namespace Baselibs
} // End of namespace HareScript

