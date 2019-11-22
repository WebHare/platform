#ifndef blex_context
#define blex_context

#ifndef blex_threads
#include "threads.h"
#endif

#include <map>

namespace Blex
{
namespace Test
{
void TestTheKeeper();
} //end namespace Blex::Test


class ContextRegistrator;
class ContextKeeper;
template <class ContextData, unsigned contextid, typename CreateParameter>
 class Context;

/** The ContextRegistrator registers functions for automatic creation and destruction
    of contexts. Use preferrably only through the Context class, to avoid type errors!

    This object is threadsafe. */
class BLEXLIB_PUBLIC ContextRegistrator
{
    public:
        /// Function that creates a plugin context
        typedef void *(*CreateContextFunc)(void *);

        /// Function that destroys a plugin context
        typedef void (*DestroyContextFunc)(void*, void *external_context);

        /// Construct the registrator
        ContextRegistrator();

        /// Destruct the registrator
        ~ContextRegistrator();

        /** Add context support for contexts with a specific id
            @param id Id of context-type
            @param create Function that creates the context (must return a pointer)
            @param destroy Function destroys the pointer
            @param extra_parameter Parameter to create function */
        void RegisterContext(unsigned id, CreateContextFunc create, DestroyContextFunc destroy, void const *extra_parameter);

        /** Creates an allocated pluggable context.
            @param id Id of context
            @return Newly created context (NULL if this no context with this id was registered) */
        void* CreateContext(unsigned id) const;

        /** Free an allocated external context.
            @param Id Id of context
            @param contextptr Context to destroy */
        void FreeContext(unsigned id, void *contextptr) const;

    private:
        struct ExternalContextType
        {
                CreateContextFunc createfunc;
                DestroyContextFunc destroyfunc;
                void *extra_parameter;

                ExternalContextType(CreateContextFunc const &_createfunc, DestroyContextFunc const &_destroyfunc, void const *_extra_parameter)
                {
                        createfunc = _createfunc;
                        destroyfunc = _destroyfunc;
                        extra_parameter = const_cast<void *>(_extra_parameter);
                }
        };

        typedef std::map< unsigned, ExternalContextType > ExternalContextTypes;

        typedef Blex::InterlockedData< ExternalContextTypes, Blex::Mutex > LockedData;

        /// List of registered external context-types
        LockedData lockeddata;

        template <class ContextData, unsigned contextid, typename CreateParameter>
           friend class Context;
};

/** The keeper object gives access to contexts. Use preferrably only through the
    Context class, to avoid type errors!

    It has ownership of all its contexts, a copy of the object has no objects.

    This object is threadsafe only when calls are serialized.  */
class BLEXLIB_PUBLIC ContextKeeper
{
    public:
        /** Creates the keeper
            @param registrator Registrator that keeps creation/destruction info for
                   contexts */
        explicit ContextKeeper(ContextRegistrator const &registrator);

        ~ContextKeeper();

        /** Destroys all objects in this keeper */
        void Reset();

        /** Get a context, constructing it if necessary.
            @param id Id of the context to lookup
            @param autocreate Automatically create the context if it didn't exist yet
            @return pointer to the specified context, or NULL if the context
                    hasn't been added (and also not registered) */
        void * GetContext(unsigned id, bool autocreate);

        /** Get a context, if not return NULL */
        void const * GetConstContext(unsigned id) const;

        /** Swaps contents with other context keeper; they must have the same
            ContextRegistrator */
        void Swap(ContextKeeper &rhs);

        /** Get the context registrator for this keeper */
        ContextRegistrator const& GetRegistrator() const { return registrator; }

    private:
        // Private copy constructor, no copying!
        ContextKeeper(ContextKeeper const &registrator);

        struct RegisteredContext
        {
                unsigned id;
                void *ptr;
        };

        /** Adds a context to the keeper.
            @param id Id of the plugin to register
            @param ptr Pointer to the the plugin context (which will be returned
                       by GetPluggedInContext calls) */
        void AddContext(unsigned id, void *ptr);

        /** Removes a context from the keeper.
            @param id Id of the plugin to register */
        void RemoveContext(unsigned id);

        RegisteredContext * FindContext(unsigned id);
        RegisteredContext const * FindContext(unsigned id) const;

        ContextRegistrator const &registrator;

        // List if currently registered contexts
        std::vector<RegisteredContext> contexts;

        template <class ContextData, unsigned contextid, typename CreateParameter>
         friend class Context;

        friend void ::Blex::Test::TestTheKeeper();
};

template <class ContextData, unsigned contextid>
 class ConstContext;

/** Class om het gebruik van pluggable contexts wat schoner te houden, zonder
    type-casts bij het aanvragen van de context.
    Alleen contextdata met een constructor zonder argumenten kan worden opgeslagen

    Definitions:
      struct MyContextData {...};
      typedef PluggableContext < MyContextData, MyContextId > MyContext;
    Registration:
      MyContext::Register(registrator)
    Requesting context:
      MyContext context(mediator)

    Using context:
      MyContextData can be accessed with *context and context->, just as if
      PluggableContext is a pointer to a MyContextData structure */
template <class ContextData, unsigned contextid, typename CreateParameter>
 class Context
{
    private:
        ContextData* data;

        static void * Create(void *param) { return new ContextData(static_cast<CreateParameter *>(param)); }
        static void Destroy(void*, void *data) { delete static_cast<ContextData*>(data); }

    public:
        static const int id = contextid;

        /// Associated read-only context class
        typedef Blex::ConstContext< ContextData, contextid > ConstContext;

        /** Constructs the context object */
        explicit Context(ContextKeeper& keeper)
        {
                data = reinterpret_cast<ContextData*>(keeper.GetContext(id, true));
                assert(data);
        }

        /** Registers the context data type with a registrator
            @registrator Registrator to register this data type with */
        static void Register(ContextRegistrator& registrator, CreateParameter *param)
        {
                registrator.RegisterContext(id, Create, Destroy, param);
        }

        ContextData & operator*() { return *data; }
        ContextData * operator->() { return data; }
        ContextData const & operator*() const { return *data; }
        ContextData const * operator->() const { return data; }
};

template <class ContextData, unsigned contextid>
 class Context<ContextData, contextid, void>
{
    private:
        ContextData* data;

        static void * Create(void *) { return new ContextData; }
        static void Destroy(void*, void *data) { delete static_cast<ContextData*>(data); }

    public:
        static const int id = contextid;

        /// Associated read-only context class
        typedef Blex::ConstContext< ContextData, contextid > ConstContext;

        /** Constructs the context object */
        explicit Context(ContextKeeper& keeper)
        {
                data = reinterpret_cast<ContextData*>(keeper.GetContext(id, true));
                assert(data);
        }

        /** Registers the context data type with a registrator
            @registrator Registrator to register this data type with */
        static void Register(ContextRegistrator& registrator)
        {
                registrator.RegisterContext(id, Create, Destroy, NULL);
        }

        ContextData & operator*() { return *data; }
        ContextData * operator->() { return data; }
};

/** Class that offers read-only access to a context. It works along the same
    line as Context does. */
template <class ContextData, unsigned contextid>
 class ConstContext
{
    private:
        ContextData const *data;

    public:
        static const int id = contextid;

        /** Constructs the context object */
        explicit ConstContext(ContextKeeper const & keeper)
        {
                data = reinterpret_cast<ContextData const *>(keeper.GetConstContext(id));
                assert(data);
        }

        ContextData const & operator*() const { return *data; }
        ContextData const * operator->() const { return data; }
};


} // End of namespace Blex

#endif
