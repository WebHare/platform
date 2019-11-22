#ifndef blex_webhare_harescript_hsvm_columnnamemapper
#define blex_webhare_harescript_hsvm_columnnamemapper

#include <blex/mapvector.h>
#include "hsvm_constants.h"

namespace HareScript
{

namespace ColumnNames
{

typedef Blex::MapVector< Blex::StringPair, ColumnNameId, Blex::StrLess< Blex::StringPair > > Mappings;
typedef Blex::MapVector< ColumnNameId, Blex::StringPair > ReverseMappings;

struct MappingData
{
        Mappings map;
        ReverseMappings rmap;
};

class BLEXLIB_PUBLIC GlobalMapper
{
    private:
        struct Data
        {
                /// Counter for new ids
                unsigned currentcounter;

                /// Stable storage for column names (ADDME: don't use strings, but coalesce in large char arrays)
                std::deque< std::string > strings;

                /// Master list of mappings
                MappingData mappings;

                typedef std::map< unsigned, std::shared_ptr< MappingData > > LocalCache;

                /** Cache for data local mappers
                    Map size -> cache, largest cache is handed out first, smallest cache is discarded first
                */
                LocalCache local_cache;

                /// Number of allocated (and not released) copies
                unsigned copies_in_use;

                Data() : currentcounter(1), copies_in_use(0) {}
        };
        typedef Blex::InterlockedData<Data, Blex::Mutex> LockedData;

        LockedData data;

    public:

        /// Constructor
        GlobalMapper();

        /** Retrieves a copy of all mappings of a global mapper
            @param data Mapping that will be filled with the master data
        */
        void GetDataCopy(MappingData *data) const;

        /** Allocate (prefilled) local mapping data
            @param ptr Pointer which will get a new mappingdata structure
        */
        void AllocateMappingCopy(std::shared_ptr< MappingData > *ptr);

        /** Free (prefilled) local mapping data
            @param ptr Pointer which will get a new mappingdata structure
        */
        void ReleaseMappingCopy(std::shared_ptr< MappingData > *ptr);

        /** Retrieves a mapping (creates one if neccessary)
            @param name Name of the column.
            @param stored Will be filled by a the name, which can be referred to as long as the globalmapper exists.
            @return Id corresponding with name (unique per GlobalMapper)
        */
        ColumnNameId GetMapping(Blex::StringPair const &name, Blex::StringPair *stored);

        /** Retrieves a reverse mapping (creates one if neccessary)
            @param id Id corresponding with a name
            @return name that corresponds with
        */
        Blex::StringPair GetReverseMapping(ColumnNameId id);
};

class BLEXLIB_PUBLIC LocalMapper
{
    private:
        GlobalMapper &globalmapper;

        /// Local mapping copy
        std::shared_ptr< MappingData > localmapping;

        LocalMapper(LocalMapper const &);
        LocalMapper &operator=(LocalMapper const &);

    public:

        /// Constructor
        explicit LocalMapper(GlobalMapper& globalmapper);

        ~LocalMapper();

        /** Retrieves a mapping (creates one if neccessary)
            @param name Name of column
            @return Id corresponding with name (unique per globalColumnNameMapper)
        */
        ColumnNameId GetMapping(const char *name);

        /** Retrieves a mapping (creates one if neccessary)
            @param name Name of column
            @return Id corresponding with name (unique per globalColumnNameMapper)
        */
        ColumnNameId GetMapping(Blex::StringPair const &name)
        { return GetMapping(name.size(), name.begin); }

        /** Retrieves a mapping (creates one if neccessary)
            @param name Name of column
            @return Id corresponding with name (unique per globalColumnNameMapper)
        */
        ColumnNameId GetMapping(std::string_view name)
        { return GetMapping(name.size(), &name[0]); }

        /** Retrieves a mapping (creates one if neccessary)
            @param name Name of column
            @return Id corresponding with name (unique per globalColumnNameMapper)
        */
        ColumnNameId GetMapping(std::string const &name)
        { return GetMapping(name.size(), &name[0]); }

        /** Retrieves a mapping (creates one if neccessary)
            @param name Name of column
            @param namelen Length of column name
            @param namebegin Begin of column name, which must be in upperacse
            @return Id corresponding with name (unique per globalColumnNameMapper)
        */
        ColumnNameId GetMapping(unsigned namelen, char const * namebegin);

        /** Retrieves a reverse mapping (creates one if neccessary)
            @param id Id corresponding with a name
            @return name that corresponds with the id
        */
        Blex::StringPair GetReverseMapping(ColumnNameId id);
};

} // End of namespace ColumnNames
} // End of namespace HareScript

#endif // sentry
