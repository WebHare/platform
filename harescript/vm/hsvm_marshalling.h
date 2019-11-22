#ifndef blex_webhare_harescript_hsvm_marshalling
#define blex_webhare_harescript_hsvm_marshalling

#include <blex/datetime.h>
#include <blex/unicode.h>
#include <blex/podvector.h>

#include "hsvm_dllinterface.h"
#include "hsvm_dllinterface_blex.h"
#include "hsvm_blobinterface.h"

#include <unordered_map>

namespace HareScript
{

class StackMachine;
class VirtualMachine;


/** Types of data that will be marshalled
    For packets, the blobs are stored in the global blob manager, otherwise they
    are encoded in the datastream.
*/
namespace MarshalMode
{
enum Type
{
        /** Marshal only simple data (no non-default blobs, objects or function ptrs)
        */
        SimpleOnly,

        /** Marshal simple types and blobs (no non-default objects or function ptrs)
        */
        DataOnly,

        /** Marshal simple types, blobs and clonable objects. Only packet mode is allowed. Non-
          default function ptrs are not allowed (used for caching)
        */
        AllClonable,

        /** Marshal simple types, blobs and objects. Only packet mode is allowed. Non-
          default function ptrs are not allowed.
        */
        All
};
} // End of namespace MarshalMode



/** Base class for object marshal data
*/
struct ObjectMarshalData
{
        ObjectMarshalData() : restorefunc(0) {}
        ~ObjectMarshalData();

        void *data;
        HSVM_ObjectRestorePtr restorefunc;
        HSVM_ObjectClonePtr clonefunc;
        HSVM_VariableId varid;

        ObjectMarshalData(ObjectMarshalData const &) = delete;
        ObjectMarshalData& operator=(ObjectMarshalData const &) = delete;
};

class Marshaller;

/** Class for extended marshalling (marshalling with blobs and objects)
*/
class BLEXLIB_PUBLIC MarshalPacket
{
    public:
        ~MarshalPacket();

        /// Returns whether any objects are present
        bool AnyObjects() { return !objects.empty(); }

        /// Returns whether any objects are present
        bool AnyBlobs() { return !blobs.empty(); }

        /** Tries to clone the packet (fails when any objects are present)
            @param copy Filled with new clone
            @return Whether a clone could be made
        */
        bool TryClone(std::unique_ptr< MarshalPacket > *copy) const;

        /** Stores raw data (throws if objects or blobs are present)
            @param target
        */
        void WriteToPodVector(Blex::PodVector< uint8_t > *target, GlobalBlobManager *blobmgr);

        /** Reads raw data
            @param target
        */
        void Read(uint8_t const *start, uint8_t const *end, GlobalBlobManager *blobmgr);

    private:
        void Reset();

        /// Data about a single blob
        class BlobData
        {
                BlobData(BlobData const &rhs) = delete;
                BlobData & operator=(BlobData const &rhs) = delete;

            public:
                BlobData() = default;
                std::shared_ptr< GlobalBlob > blob;
                Blex::FileOffset length;
        };

        /** List of blobs referenced in the data
        */
        std::vector< std::shared_ptr< BlobData > > blobs;

        /** List of object references
        */
        std::vector< std::shared_ptr< ObjectMarshalData > > objects;

        /** List of columns
        */
        Blex::PodVector< uint8_t > columndata;

        /** Raw data
        */
        Blex::PodVector< uint8_t > data;

        friend class Marshaller;
};


/** Interface for encoding columns into a library
*/
class MarshallerLibraryColumnEncoderItf
{
    public:
        virtual ~MarshallerLibraryColumnEncoderItf();
        virtual uint32_t EncodeColumn(ColumnNameId nameid) = 0;
};


class BLEXLIB_PUBLIC Marshaller
{
    private:
        /// VM (not needed in mode FIXME: fill in)
        VirtualMachine *vm;

        /// Stackmachine
        StackMachine &stackm;

        /// Marshalling mode
        MarshalMode::Type mode;

        Blex::FileOffset data_size;
        unsigned blobcount;
        bool largeblobs;
        Blex::PodVector< ColumnNameId > columns;
        Blex::PodVector< Blex::StringPair > strings;
        std::unique_ptr< std::unordered_map< ColumnNameId, unsigned > > columnmap;
        bool use_library_column_list;

        std::vector< ColumnNameId > const *library_column_list;
        std::function< uint32_t(ColumnNameId) > library_column_encoder;

        // Packets are destroyed at destruction time
        std::list< MarshalPacket * > packets;

    public:
        Marshaller(VirtualMachine *vm, MarshalMode::Type mode);
        Marshaller(StackMachine &stackm, MarshalMode::Type mode);
        ~Marshaller();

        /// Calculate the result size of raw marshalling data of a variable
        Blex::FileOffset Analyze(VarId var);

        /** Write out the raw marshalling data to a datastore
            Calculate the size needed with Analyze
        */
        void Write(VarId var, uint8_t *begin, uint8_t *limit);

        /** Writes the marshalling data to a vector (equivalent to an Analyze,
            vector resize and a Write
        */
        void WriteToVector(VarId var, std::vector< uint8_t > *dest);

        /** Writes the marshalling data to a vector (equivalent to an Analyze,
            vector resize and a Write
        */
        void WriteToPodVector(VarId var, Blex::PodVector< uint8_t > *dest);

        /** Creates an advanced marshalling packet and fills it
            Caller gets ownership of the structure.
        */
        MarshalPacket * WriteToNewPacket(VarId var);

        /** Read raw data into a variable
        */
        inline void Read(VarId var, uint8_t const *begin, uint8_t const *limit)
        {
                ReadInternal(var, begin, limit, 0);
        }

        void ReadFromVector(VarId var, std::vector< uint8_t > const &data);
        void ReadFromVector(VarId var, Blex::PodVector< uint8_t > const &data);

        void ReadMarshalPacket(VarId var, std::unique_ptr< MarshalPacket > *packet);

        /// Set the current library column name decoder
        void SetLibraryColumnNameDecoder(std::vector< ColumnNameId > const *_library_column_list)
        {
                library_column_list = _library_column_list;
        }

        /// Set the current library column name encoder
        void SetLibraryColumnNameEncoder(std::function< uint32_t(ColumnNameId) > const &_library_column_encoder)
        {
                library_column_encoder = _library_column_encoder;
        }

    private:

        // If a type has a fixed length, this function returns it, else 0
        static unsigned FixedVariableLength(VariableTypes::Type type);

        Blex::FileOffset AnalyzeInternal(VarId var, bool to_packet);

        Blex::FileOffset CalculateVarLength(VarId var, bool to_packet);

        void WriteInternal(VarId var, uint8_t *begin, uint8_t *limit, MarshalPacket *packet);

        uint8_t* MarshalWriteInternal(VarId var, uint8_t *ptr, MarshalPacket *packet);
        uint8_t const * MarshalReadInternal(VarId var, VariableTypes::Type type, uint8_t const *ptr, size_t remainingsize, Blex::PodVector< ColumnNameId > const &nameids, MarshalPacket *packet);
        void ReadInternal(VarId var, uint8_t const *begin, uint8_t const *limit, MarshalPacket *packet);
        void ReadColumnData(uint8_t const **ptr, size_t *size, Blex::PodVector< ColumnNameId > *nameids);
        void WritePacketColumns(MarshalPacket *packet);
};

} // End of namespace HareScript

#endif
