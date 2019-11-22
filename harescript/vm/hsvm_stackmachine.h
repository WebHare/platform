#ifndef blex_webhare_harescript_hsvm_stackmachine
#define blex_webhare_harescript_hsvm_stackmachine

#include "hsvm_varmemory.h"
#include <blex/crypto.h>

namespace HareScript
{

/** Contains a VarMemory, and all common stack operations */
class BLEXLIB_PUBLIC StackMachine : public VarMemory
{
    private:
        VariableTypes::Type PromoteNumbers();
        VariableTypes::Type PromoteIntegers();

        typedef std::map<ColumnNameId, ColumnNameId> ColumnNameMap;
        void InternalCopyFromOtherVM(VirtualMachine *current, VarId dest, VirtualMachine *other_vm, StackMachine &other, VarId source, ColumnNameMap &map, bool inside_vmgroup);
        void CopyRecordFromOtherVM(VirtualMachine *current, VarId dest, VirtualMachine *other_vm, StackMachine &other, VarId source, ColumnNameMap &map, VariableTypes::Type type, bool inside_vmgroup);
        void CopyArrayFromOtherVM(VirtualMachine *current, VarId dest, VirtualMachine *other_vm, StackMachine &other, VarId source, ColumnNameMap &map, bool inside_vmgroup);

        struct CNMapping
        {
                ColumnNameId name;
                Blex::StringPair mapping;

                bool operator<(StackMachine::CNMapping const &rhs) const;
        };

        void CalculateHashInternal(Blex::Hasher *hasher, VarId var) const;

    public:
        explicit StackMachine(ColumnNames::LocalMapper &columnnamemapper);
        ~StackMachine();
        void Reset();

        // Stack operation: pops arguments from stack, pushes result. On error, parameters are left on the stack
        void Stack_Arith_Add();
        void Stack_Arith_Sub();
        void Stack_Arith_Mul();
        void Stack_Arith_Div();
        void Stack_Arith_Mod();
        void Stack_Arith_Neg();

        void Stack_String_Merge();

        void Stack_Bool_And();
        void Stack_Bool_Or();
        void Stack_Bool_Xor();
        void Stack_Bool_Not();

        void Stack_Bit_And();
        void Stack_Bit_Or();
        void Stack_Bit_Xor();
        void Stack_Bit_Neg();
        void Stack_Bit_ShiftLeft();
        void Stack_Bit_ShiftRight();

        void Stack_Concat();
        void Stack_In();
        void Stack_Like();

        void Stack_TestDefault(bool negate);

        // Pops argument, returns casted. On error, nothing is left on the stack
        void Stack_CastTo(VariableTypes::Type newtype);
        void Stack_ForcedCastTo(VariableTypes::Type newtype);

        void CastTo(VarId var, VariableTypes::Type newtype);
        void ForcedCastTo(VarId var, VariableTypes::Type newtype);
        bool Like(VarId arg1, VarId arg2, bool casesensitive) const;

        /** Searches element in a list
            @param list List to search in
            @param value Value to search for. Record arrays are cst to a record
            @param start Start position
            @return Position of found element, or -1 if not found */
        signed SearchElement(VarId list, VarId value, signed start);

        /** Searches element in a list, backwards.
            @param list List to search in
            @param value Value to search for. Record arrays are cst to a record
            @param start Start position
            @return Position of found element, or -1 if not found */
        signed SearchElementFromBack(VarId list, VarId value, signed start);

        /** Searches element in a list; but won't try to cast the value (make it an exact match)
            @param list List to search in
            @param value Value to search for. Record arrays are cst to a record
            @param start Start position
            @return Position of found element, or -1 if not found */
        signed SearchElementNoCast(VarId list, VarId value, signed start) const;

        /** Compares two variables with each other, promoting numbers if necessary.
            No modifying operation will be executed
            @param lhs Left hand variable
            @param rhs Right hand variable
            @param casesensitive Set to false to execute case insensitive compare (only for strings)
            @return -1 if lhs < rhs, 1 if lhs > rhs, 0 if equal */
        int32_t Compare(VarId lhs, VarId rhs, bool casesensitive) const;

        /** Compares two variables that are both of a known type. No modifying
            operation will be executed
            @param lhs Left hand variable
            @param rhs Right hand variable
            @param casesensitive Set to false to execute case insensitive compare (only for strings)
            @return -1 if lhs < rhs, 1 if lhs > rhs, 0 if equal */
        int32_t KnownTypeCompare(VarId lhs, VarId rhs, VariableTypes::Type type, bool casesensitive) const;

/*        unsigned MarshalCalculateLength(VarId var);
        void MarshalWrite(VarId var, uint8_t *ptr);
        void MarshalRead(VirtualMachine *vm,VarId var, uint8_t const *ptr);

        void MarshalToVector(VarId var, std::vector<uint8_t> *dest);
        void MarshalFromVector(VirtualMachine *vm,VarId var, std::vector<uint8_t> const &src);*/

        void ThrowIfFunctionPointersPresent(VarId var);

        void CopyFromOtherVM(VirtualMachine *current, VarId dest, VirtualMachine *other, VarId source, bool inside_vmgroup);

        // Create record copy of an object (pre: record != object)
        void CopyRecordFromObject(VarId record, VarId object);

        std::string CalculateHash(VarId object, Blex::DateTime const *stamp) const;
};

} // End of namespace Harescript

#endif // Sentry
