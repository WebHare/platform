#ifndef blex_harescript_vm_hsvm_sqllib
#define blex_harescript_vm_hsvm_sqllib
//---------------------------------------------------------------------------

#include <blex/context.h>

#include "hsvm_sqlinterface.h"

namespace HareScript
{

class BuiltinFunctionsRegistrator;

class HSBindDef
{
    public:
        HSBindDef(std::string const &_dbasename, SQLLib::DatabaseTransactionDriverInterface *_driver) : dbasename(_dbasename), driver(_driver), typeinfo(0) { }
        HSBindDef() : driver(nullptr), typeinfo(0) { }

        std::string dbasename;
        SQLLib::DatabaseTransactionDriverInterface *driver;
        int32_t typeinfo;

        bool operator <(HSBindDef const &rhs) const
        {
                if (dbasename != rhs.dbasename)
                    return dbasename < rhs.dbasename;
                else if (driver != rhs.driver)
                    return driver < rhs.driver;
                return typeinfo < rhs.typeinfo;
        }
};

class BLEXLIB_PUBLIC SQLSupport
{
        VirtualMachine *vm;

    public:
        SQLSupport(VirtualMachine *vm);

        ~SQLSupport();

        /// Destroys all owned transactions
        void Cleanup();

        /** Registers all builtin functions, and context needed for SQL execution*/
        static void Register(BuiltinFunctionsRegistrator &bifreg, Blex::ContextRegistrator &creg);

        /** Registers a transaction in the SQLLib. Takes ownership of trans, also when throwing.
            @param trans Transaction to register
            @return Id uniquely (within this vm) identifying this transaction */
        unsigned RegisterTransaction(std::unique_ptr< SQLLib::DatabaseTransactionDriverInterface > &&trans, unsigned rebind_to = 0);

        /** Returns the transaction that belongs to an id
            @param transid Id of transaction
            @return Transaction (0 if it does not exist) */
        SQLLib::DatabaseTransactionDriverInterface * GetTransaction(unsigned transid);

        /** Invalidates all tables bound to an transaction; but does not destroy it.
            @param trans Transaction */
        void InvalidateTransaction(SQLLib::DatabaseTransactionDriverInterface *trans);

        /** Immediately deletes transaction.
            @param trans Transaction */
        void DeleteTransaction(unsigned transid);

        /** Extracts a registration from the SQLLib. Does not invalidate the table bindings, so make sure
            you restore it before using any bindings! (FIXME: replace bindings with dummy itf?)
        */
        void ExtractTransaction(unsigned id, std::unique_ptr< SQLLib::DatabaseTransactionDriverInterface > *trans);

        /** Returns the name and a transaction givenn a binding id. throws if error or not found.
            @param binding Id, returned by BindName
            @return Name of bound name and transaction */
        HSBindDef GetBindingInfo(unsigned binding);

        int32_t RegisterTypeInfo(DBTypeInfo const &typeinfo);
        void UnregisterTypeInfo(int32_t id);
        DBTypeInfo const * GetTypeInfoById(int32_t id);

    private:
        void RebindTransaction(std::unique_ptr< SQLLib::DatabaseTransactionDriverInterface > *trans_ref, std::unique_ptr< SQLLib::DatabaseTransactionDriverInterface > &&new_trans);

        std::map< int32_t, std::shared_ptr< DBTypeInfo > > custom_typeinfos;
};

} // End of namespace HareScript

//---------------------------------------------------------------------------
#endif
