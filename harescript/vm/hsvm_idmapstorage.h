#ifndef blex_harescript_vm_idmapstorage
#define blex_harescript_vm_idmapstorage
//---------------------------------------------------------------------------

namespace HareScript
{

/** IdMapStorage stores data, and returns an id to access it
    Warning: id's are NOT recycled. Don't use more that 2^31 id's. */
template <class StoredClass>
 class IdMapStorage
{
    private:
        typedef std::map<int32_t, StoredClass> TheMap;
        TheMap storage;
        unsigned counter;
        unsigned mincounter;

    public:
        IdMapStorage() : counter(1), mincounter(1)
        {
        }

        typedef StoredClass value_type;

        class iterator
        {
            private:
                typename TheMap::iterator it;
                iterator(typename TheMap::iterator _it) : it(_it) {}
            public:
                iterator & operator ++() { ++it; return *this; };
                iterator operator ++(int) { iterator temp = *this; ++it; return temp; };
                bool operator ==(iterator const &rhs) const { return it == rhs.it; }
                bool operator !=(iterator const &rhs) const { return it != rhs.it; }
                StoredClass & operator *() { return it->second; }
                StoredClass * operator ->() { return &it->second; }
                signed GetId() { return it->first; }
                friend class IdMapStorage;
        };
        iterator begin() { return iterator(storage.begin()); }
        iterator end() { return iterator(storage.end()); }

        /// Set the minimum id given out from now on
        void SetMinimumId(unsigned minid);

        /** Returns pointer to stored class with given id. */
        StoredClass * Get(unsigned id); //nothrow()

        /** Returns const pointer to stored class with given id. */
        StoredClass const * Get(unsigned id) const; //nothrow()

        /** Stores a storedclass object, returns an id unequal to 0. The operation either succeeds, or
            nothing is done at all */
        unsigned Set(StoredClass const &);

        /** Stores a storedclass object, returns an id unequal to 0. The operation either succeeds, or
            nothing is done at all */
        unsigned Set(StoredClass &&);

        /** Stores a stored class object with the specified id. The operation either succeeds, or nothing is done at all
            If storage is already in use, 0 is returned. */
        unsigned SetAs(StoredClass const &, unsigned id);

        /** Stores a stored class object with the specified id. The operation either succeeds, or nothing is done at all
            If storage is already in use, 0 is returned. */
        unsigned SetAs(StoredClass &&, unsigned id);

        /** Erases the storedclass object with id 'id' */
        void Erase(unsigned id);

        /** Erases the storedclass object where iterator it points to */
        void Erase(iterator it);

        /** Returns the number of stored elements */
        unsigned Size() const;

        /** Removes all elements */
        void Clear();
};

template <class StoredClass>
 void IdMapStorage<StoredClass>::SetMinimumId(unsigned minid)
{
        mincounter = std::max(1U, minid);
        if (counter < minid)
            counter = minid;
}

template <class StoredClass>
 StoredClass * IdMapStorage<StoredClass>::Get(unsigned id)
{
        typename TheMap::iterator it = storage.find(id);
        if (it != storage.end())
            return &it->second;
        else
            return 0;
}

template <class StoredClass>
 StoredClass const * IdMapStorage<StoredClass>::Get(unsigned id) const
{
        typename TheMap::const_iterator it = storage.find(id);
        if (it != storage.end())
            return &it->second;
        else
            return 0;
}

template <class StoredClass>
 void IdMapStorage<StoredClass>::Erase(unsigned id)
{
        storage.erase(id);
}

template <class StoredClass>
 void IdMapStorage<StoredClass>::Erase(iterator it)
{
        storage.erase(it.it);
}

template <class StoredClass>
 void IdMapStorage<StoredClass>::Clear()
{
        storage.clear();
}

template <class StoredClass>
 unsigned IdMapStorage<StoredClass>::Size() const
{
        return storage.size();
}

template <class StoredClass>
 unsigned IdMapStorage<StoredClass>::Set(StoredClass const &tostore)
{
        return Set(StoredClass(tostore));
}

template <class StoredClass>
 unsigned IdMapStorage<StoredClass>::Set(StoredClass &&tostore)
{
        while (storage.find(counter)!=storage.end())
        {
                // Wrap around at int32_t boundaries
                if (++counter >= (1U << 31))
                    counter = mincounter;
        }

        storage.insert(std::make_pair(counter, std::move(tostore)));
        unsigned retval = counter;

        // Increase the counter for optimization
        if (++counter >= (1U << 31))
            counter = mincounter;

        return retval;
}

template <class StoredClass>
 unsigned IdMapStorage<StoredClass>::SetAs(StoredClass const &tostore, unsigned id)
{
    return SetAs(StoredClass(tostore), id);
}

template <class StoredClass>
 unsigned IdMapStorage<StoredClass>::SetAs(StoredClass &&tostore, unsigned id)
{
        typename TheMap::iterator it = storage.find(id);
        if (it != storage.end())
            return 0;
        storage.insert(std::make_pair(id, std::move(tostore)));
        return id;
}


} // End of namespace HareScript

#endif
