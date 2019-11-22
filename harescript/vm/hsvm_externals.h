#ifndef blex_webhare_harescript_hsvm_externals
#define blex_webhare_harescript_hsvm_externals

#include <blex/context.h>
#include "hsvm_constants.h"
#include "hsvm_columnnamemapper.h"
#include "hsvm_dllinterface.h"


namespace HareScript
{

class Externals;
class FileSystem;

typedef void (* BuiltinFunctionPtr)(VarId id, VirtualMachine *vm);
typedef void (* BuiltinMacroPtr)(VirtualMachine *vm);

/** Definition of a built-in function. At the moment it only includes the name
    and not the types. If synchronization difficulties between builtin-functions
    and the libraries in which their types are defined become a problem it can
    be built in. */
struct BuiltinFunctionDefinition
{
        /// Name of this function
        std::string name;

        enum Type
        {
        Macro,
        Function,
        CMacro,
        CFunction
        } type;

        /// function that must be called when this function is called from the VM
        BuiltinFunctionPtr function;

        /// function that must be called when this macro is called from the VM
        BuiltinMacroPtr macro;

        /// extern "C" function that must be called when this function is called from the VM
        HSVM_FunctionPtr function_c;

        /// extern "C" function that must be called when this macro is called from the VM
        HSVM_MacroPtr macro_c;

        BuiltinFunctionDefinition() {}
        BuiltinFunctionDefinition(std::string const &name, BuiltinMacroPtr ptr) : name(name), type(Macro), macro(ptr) {}
        BuiltinFunctionDefinition(std::string const &name, BuiltinFunctionPtr ptr) : name(name), type(Function), function(ptr) {}
        BuiltinFunctionDefinition(std::string const &name, HSVM_MacroPtr ptr, char) : name(name), type(CMacro), macro_c(ptr) {}
        BuiltinFunctionDefinition(std::string const &name, HSVM_FunctionPtr ptr, char) : name(name), type(CFunction), function_c(ptr) {}
};

/** This class keeps all registred builtin functions.
    This class is threadsafe */
class BLEXLIB_PUBLIC BuiltinFunctionsRegistrator
{
    private:
        typedef std::map<std::string, BuiltinFunctionDefinition> BuiltinFunctions;
        typedef Blex::InterlockedData<BuiltinFunctions, Blex::Mutex> LockedData;

        /// Protected list of all registred builtin functions
        LockedData lockeddata;

    public:
        BuiltinFunctionsRegistrator();

        ~BuiltinFunctionsRegistrator();

        /** Registers a builtin function
            @param definition Definition and pointer to builtin function */
        void RegisterBuiltinFunction(const BuiltinFunctionDefinition &definition);

        /** Returns pointer to builtin function with given definition
            @param funcname Function name */
        BuiltinFunctionDefinition const * GetBuiltinFunction(std::string const &funcname) const;
};

/** Manages loaded modules. Because registrations are permanent, and modules
    may hold cross-VM state, a module isn't unloaded unttil the DLMgr is shut down */
class DynamicLinkManager
{
    public:
        /** Bridge between WINAPI/__stdcall calling conventions and OUR functions...
            Could conditionally enable it only on win32, but we'll prolly tack
            on other data in the future anyway (eg, name of DLL responsible for
            this registration) */
        struct DynamicRegistration
        {
                unsigned context_id;
                HSVM_ConstructorPtr constructor;
                HSVM_DestructorPtr destructor;
                void *opaque_ptr;
        };

    private:

        static void* DynamicContext_Construct(void *dynreg_ptr);
        static void DynamicContext_Destruct(void *dynreg_ptr, void *context_ptr);


        struct ManagerList
        {
                std::set< DynamicLinkManager * > managers;
        };

        typedef Blex::InterlockedData< ManagerList, Blex::Mutex > LockedManagerList;
        static LockedManagerList managerlist;

        typedef std::map< std::string, void* > DataMap;

        struct State
        {
                State()
                : no_hsmod_unload(false)
                {
                }

                DataMap data;
                bool no_hsmod_unload;
        };
        typedef Blex::InterlockedData<State,Blex::Mutex> LockedState;
        LockedState state;

        ///Dynamic registrations. A list because we need to be able to take pointers.. We should only be accessing this when we have a lock on LockedState
        std::list<DynamicRegistration> dynamic_regs;

        ///Soft reset callbacks. May only be accessed when having a lock on State!
        std::vector< HSVM_SoftResetCallback > softresetcallbacks;

        ///Garbage collect callbacks. May only be accessed when having a lock on State!
        std::vector< HSVM_GarbageCollectionCallback > garbagecollectioncallbacks;

    public:
        DynamicLinkManager(FileSystem &filesystem, Externals &externals);
        ~DynamicLinkManager();

        FileSystem &filesystem;
        Externals &externals;

        std::pair<void*,Error::Codes> LoadHarescriptModule(std::string const &name, std::string *error);

        void AddReferences(std::vector<std::string> const &requested_links);

        void RegModuleContext(unsigned int context_id,
                                       void *opaque_ptr,
                                       HSVM_ConstructorPtr constructor,
                                       HSVM_DestructorPtr destructor);

        void RegSoftResetCallback(HSVM_SoftResetCallback callback);

        void RegGarbageCollectionCallback(HSVM_GarbageCollectionCallback callback);

        bool InvokeModuleRegistration(HSVM_ModuleEntryPointPtr entrypoint, void *context_ptr);

        //FIXME: Ugly hook for objects, their registration is now combined in the central context registration....
        bool GetRegistrationInfo(unsigned context_id, DynamicRegistration *receiver) const ;

        static void ExecuteSoftResetCallbacks();

        static void ExecuteGarbageCollectionCallbacks(HSVM *hsvm);


        void NoHSModUnload();
};

/** Class holding couplings to our 'external' data, such as registered functions
    and contexts. It will hold both the HareScript standard functions and
    database providers, as well as any externally supplied function */
class Externals
{
    public:
        Externals(FileSystem &filesystem);
        ~Externals();

        Blex::ContextRegistrator creg;

        ///central registry for built-in functions (anything with an ATTRIBUTES(EXTERNAL) qualifier)
        BuiltinFunctionsRegistrator bifreg;

        ColumnNames::GlobalMapper columnnamemapper;

        DynamicLinkManager linkmanager;

    private:
        Externals(const Externals&); //not implemented
        Externals& operator=(const Externals&); //not implemented
};

} //end namespace HareScript
#endif
