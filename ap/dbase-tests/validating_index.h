#ifndef webhare_dbase_indextest_validating_index
#define webhare_dbase_indextest_validating_index

#include <blex/btree_filesystem.h>
#include <ap/dbserver/dbase_types.h>

enum FillType
{
        FillMinimum,
        FillSequential,
        FillReversedSequential,
        FillEqual,
        FillRandom,
        FillMaximum
};


template <typename DataType> class ValidatingIndex;

/** An entry to insert into an index */
template <typename DataType> struct IndexEntry
{
        IndexEntry(DataType const &data, uint32_t recordid, bool is_in_index = false)
        : data(data)
        , recordid(recordid)
        , is_in_index(is_in_index)
        {
        }

        IndexEntry() : is_in_index(false)
        {
        }

        inline DataType const &GetData() const { return data; }
        inline Database::RecordId const &GetRecordId() const { return recordid; }

        inline uint8_t const *GetDataPtr() const;
        inline uint8_t const *GetOrgDataPtr() const { return GetDataPtr(); }
        inline unsigned GetDataSize() const;

        bool operator<(IndexEntry<DataType> const &rhs) const
        {
                if (data<rhs.data)
                    return true;
                else if (data==rhs.data && recordid<rhs.recordid)
                    return true;
                else
                    return false;
        }

        bool operator ==(const IndexEntry<DataType> &rhs) const
        {
                return (data == rhs.data) && (recordid == rhs.recordid);
        }
        bool operator !=(const IndexEntry<DataType> &rhs) const
        {
                return !(*this == rhs);
        }

        private:
        DataType data;
        Database::RecordId recordid;
        bool is_in_index;

        friend class ValidatingIndex<DataType>;
};

/** An entry to insert into an index */
template <> struct IndexEntry<int32_t>
{
        IndexEntry(int32_t _data, uint32_t recordid, bool is_in_index = false)
        : recordid(recordid)
        , is_in_index(is_in_index)
        {
                StoreData(_data);
        }

        IndexEntry() : is_in_index(false)
        {
        }

        void StoreData(int32_t _data) { Blex::putu32msb(data,_data+0x80000000); Blex::putu32lsb(orgdata,_data); }

        inline int32_t GetData() const { return Blex::getu32msb(data)-0x80000000; }
        inline Database::RecordId const &GetRecordId() const { return recordid; }

        inline uint8_t const *GetDataPtr() const { return data; }
        inline uint8_t const *GetOrgDataPtr() const { return orgdata; }
        inline unsigned GetDataSize() const { return 4; }

        bool operator<(IndexEntry<int32_t> const &rhs) const
        {
                if (GetData()<rhs.GetData())
                    return true;
                else if (GetData()==rhs.GetData() && recordid<rhs.recordid)
                    return true;
                else
                    return false;
        }

        bool operator ==(const IndexEntry<int32_t> &rhs) const
        {
                return GetData()==rhs.GetData() && recordid == rhs.recordid;
        }
        bool operator !=(const IndexEntry<int32_t> &rhs) const
        {
                return !(*this == rhs);
        }

        private:
        uint8_t data[4];
        uint8_t orgdata[4];
        Database::RecordId recordid;
        bool is_in_index;

        friend class ValidatingIndex<int32_t>;
};

/** The index tester implementes all functionality needed to run tests on
    an index and keep its shadow up to date, but doesn't do any testing
    itself */
template <typename DataType> class ValidatingIndex
{
        public:

        typedef IndexEntry < DataType > EntryType;
        typedef std::vector< EntryType > DataVector;
        typedef std::set   < EntryType > DataSet;

        Database::Index::Descriptor descriptor;

        // New index
        ValidatingIndex(Blex::Index::BtreeIndex& _index, Database::Index::Descriptor const &desc)
        : index(_index)
        , descriptor(desc)
        {
        }

        // Existing index. Fill with data it should contain
        ValidatingIndex(Blex::Index::BtreeIndex& _index, Database::Index::Descriptor const &desc, std::vector< EntryType > const &source_data)
        : index(_index)
        , source_data(source_data)
        , descriptor(desc)
        {
                for (typename DataVector::const_iterator it = source_data.begin(); it != source_data.end(); ++it)
                    if (it->is_in_index)
                        shadow_index.insert(*it);
        }

        void Insert(unsigned which)
        {
                source_data[which].is_in_index=true;
                IndexBlockEntryContainer container;
                container.ConstructDataEntry(source_data[which].GetDataPtr(),
                                 source_data[which].GetDataSize(),
                                 source_data[which].GetRecordId());
                index.InsertData2(container);
                shadow_index.insert(source_data[which]);
        }

        void Delete(unsigned which)
        {
                source_data[which].is_in_index=false;
                Blex::Index::IndexBlockEntryContainer container;
                container.ConstructDataEntry(source_data[which].GetDataPtr(),
                                 source_data[which].GetDataSize(),
                                 source_data[which].GetRecordId());
                index.DeleteData2(container);
                shadow_index.erase(source_data[which]);
        }

        unsigned GetNumEntries() const
        {
                return source_data.size();
        }

        unsigned GetRandomEntry() const
        {
                return static_cast<unsigned>(static_cast<double>(source_data.size())*rand()/(RAND_MAX+1.0));
        }

        bool IsInIndex(unsigned number) const
        {
                return source_data[number].is_in_index;
        }

        void Validate();
        void FillRecords(unsigned howmany, FillType fill_data, FillType fill_record);
        void ShuffleRecords();

        void SetDataSet(const DataVector& vector);

        private:
        void SpecificFillRecords(unsigned howmany, FillType fill_data, FillType fill_record);

        Blex::Index::BtreeIndex& index;

        ///The data available to insert into and delete from the index
        DataVector source_data;

        ///A shadow copy of the index, used to validate the index contents
        DataSet shadow_index;

        public:
        const DataSet& GetShadowIndex()
        {
                return shadow_index;
        }

        const DataVector& GetSourceData()
        {
                return source_data;
        }

        Blex::Index::BtreeIndex& GetIndex()
        {
                return index;
        }
};

template<> inline uint8_t const *IndexEntry<std::string>::GetDataPtr() const
{
        return reinterpret_cast<uint8_t const*>(&data[0]);
}
template<> inline uint8_t const *IndexEntry<bool>::GetDataPtr() const
{
        return reinterpret_cast<uint8_t const*>(&data);
}
template<> inline unsigned IndexEntry<std::string>::GetDataSize() const
{
        return data.size();
}
template<> inline unsigned IndexEntry<bool>::GetDataSize() const
{
        return 1;
}

template <typename TestType> std::ostream& operator <<(std::ostream &out, const IndexEntry<TestType> &dr)
{
        return out << dr.GetData() << " (" << dr.GetRecordId() << ")";
}


#endif
