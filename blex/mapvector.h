#ifndef blex_mapvector
#define blex_mapvector

#include <functional>

#ifndef blex_blexlib
#include "blexlib.h"
#endif

namespace Blex
{

/** MapVector is a std::map like class, but uses a vector as its storage container instead
    of a binary tree.

    The major differences, when compared to a similair std::map
    - No allocator template argument
    - Slightly faster lookups because all data is stored in a vector
    - Slightly slower insertions if all data is inserted at the end
    - O(1) insertions if data is inserted at the end using PushBack
    - More than O(N) complexity if data is inserted in the middle
    - Template-d find() and lower_bound()
    - Insert and PushBack invalidate all iterators
*/

template <class Key, class Data, class Compare = std::less<Key> > class MapVector
{
        public:
        typedef Compare compare_type;
        typedef Key key_type;
        typedef typename std::pair<Key,Data> value_type;
        typedef typename std::pair<Key,Data> const const_value_type;
        typedef typename std::vector<value_type> ValueStore;
        typedef typename ValueStore::iterator iterator;
        typedef typename ValueStore::const_iterator const_iterator;

        private:
        template <class Comp> class InternalLess
        {
                public:
                InternalLess()
                {
                }

                explicit InternalLess(Comp &_comp) : comp(_comp)
                {
                }

                template <class KeyType>
                  bool operator()(value_type const &lhs, KeyType const &rhs)
                { return comp(lhs.first,rhs); }

                template <class KeyType>
                  bool operator()(KeyType const &lhs,value_type const &rhs)
                { return comp(lhs,rhs.first); }

                private:
                Comp comp;
        };

        InternalLess<compare_type> comp;

        ValueStore themap;

        public:
        MapVector()
        {
        }

        explicit MapVector(compare_type& _comp) : comp(InternalLess<compare_type>(_comp))
        {
        }

        iterator Begin()               { return themap.begin(); }
        const_iterator Begin() const   { return themap.begin(); }
        iterator End()                 { return themap.end(); }
        const_iterator End() const     { return themap.end(); }

        unsigned Size() const          { return themap.size(); }
        unsigned Empty() const         { return themap.empty(); }

        value_type & Back()            { return themap.back(); }
        value_type const & Back() const { return themap.back(); }

        template <class KeyType> const_iterator LowerBound(KeyType const &key) const
        {
                return std::lower_bound(Begin(),End(),key,comp);
        }
        template <class KeyType> iterator LowerBound(KeyType const &key)
        {
                return std::lower_bound(Begin(),End(),key,comp);
        }
        template <class KeyType> const_iterator UpperBound(KeyType const &key) const
        {
                return std::upper_bound(Begin(),End(),key,comp);
        }
        template <class KeyType> iterator UpperBound(KeyType const &key)
        {
                return std::upper_bound(Begin(),End(),key,comp);
        }
        template <class KeyType> const_iterator Find(KeyType const &key) const
        {
                return BinaryFind(Begin(),End(),key,comp);
        }
        template <class KeyType> iterator Find(KeyType const &key)
        {
                return BinaryFind(Begin(),End(),key,comp);
        }

        /** Insert an element into the map
            @param value Key,data pair to insert
            @return first: iterator where data is/would be inserted. second: if insertion was succesful (not a dupe)
        */
        std::pair<iterator, bool> Insert(const_value_type &value)
        {
                //Find position
                iterator insertpos = LowerBound(value.first);

                //Is it a duplicate key?
                if (insertpos != End() && !comp(value.first,*insertpos))
                    return std::make_pair(insertpos,false);

                //Calculate position (insert will invalidate iterator)
                unsigned posnumber = insertpos - Begin();
                themap.insert(insertpos,value);
                return std::make_pair(Begin() + posnumber,true);
        }

        /** Delete an element from the map
            @param key Key to delete
            @return true if the item was succesfully deleted, false otherwise */
        template <class KeyType> bool Delete(KeyType const &key)
        {
                //Find key
                iterator deletepos = Find(key);
                if (deletepos == End())
                    return false;

                themap.erase(deletepos);
                return true;
        }

        /** Insert an element at the end of the map. If the element doesn't
            belong at the end of the map, the MapVector is corrupted
            @param value Key,data pair to insert
        */
        void PushBack(const_value_type &value)
        {
                themap.push_back(value);
        }

        /** Removes the element at the end of the map.
        */
        void PopBack()
        {
                themap.pop_back();
        }

        /** Clear the entire vector */
        void Clear()
        {
                themap.clear();
        }
};

/** MapVector is a std::map like class, but uses a vector as its storage container instead
    of a binary tree.

    The major differences, when compared to a similair std::map
    - No allocator template argument
    - Slightly faster lookups because all data is stored in a vector
    - Slightly slower insertions if all data is inserted at the end
    - O(1) insertions if data is inserted at the end using PushBack
    - More than O(N) complexity if data is inserted in the middle
    - Template-d find() and lower_bound()
    - Insert and PushBack invalidate all iterators
*/

template <class Key, class Data, class KeyCompare = std::less<Key>, class DataCompare = std::less<Data> > class MultiMapVector
{
        public:
        typedef KeyCompare key_compare;
        typedef Key key_type;
        typedef Data mapped_type;
        typedef DataCompare mapped_compare;
        typedef typename std::pair<Key,Data> value_type;
        typedef typename std::pair<Key,Data> const const_value_type;
        typedef typename std::vector<value_type> ValueStore;
        typedef typename ValueStore::iterator iterator;
        typedef typename ValueStore::const_iterator const_iterator;

        private:
        template <class KeyComp, class DataComp> class InternalLess
        {
                public:
                InternalLess()
                {
                }

                explicit InternalLess(KeyComp &_kcomp, DataComp &_dcomp)
                : kcomp(_kcomp)
                , dcomp(_dcomp)
                {
                }

                template <class KeyType>
                  bool operator()(value_type const &lhs, KeyType const &rhs)
                { return kcomp(lhs.first,rhs); }

                template <class KeyType>
                  bool operator()(KeyType const &lhs,value_type const &rhs)
                { return kcomp(lhs,rhs.first); }

                bool operator()(value_type const &lhs,value_type const &rhs)
                {
                        if (kcomp(lhs.first, rhs.first)) // Key smaller? Return true.
                            return true;
                        else if (!kcomp(rhs.first, lhs.first)) // Key equal? Compare data.
                          return dcomp(lhs.second, rhs.second);
                        return false;
                }

                private:
                KeyComp kcomp;
                DataComp dcomp;
        };

        InternalLess<key_compare, mapped_compare> comp;

        ValueStore themap;

        public:
        MultiMapVector()
        {
        }

        explicit MultiMapVector(key_compare& _kcomp, mapped_compare& _dcomp) : comp(InternalLess<key_compare, mapped_compare>(_kcomp, _dcomp))
        {
        }

        iterator Begin()               { return themap.begin(); }
        const_iterator Begin() const   { return themap.begin(); }
        iterator End()                 { return themap.end(); }
        const_iterator End() const     { return themap.end(); }

        unsigned Size() const          { return themap.size(); }

        template <class KeyType> const_iterator LowerBound(KeyType const &key) const
        {
                return std::lower_bound(Begin(),End(),key,comp);
        }
        template <class KeyType> iterator LowerBound(KeyType const &key)
        {
                return std::lower_bound(Begin(),End(),key,comp);
        }
        template <class KeyType> const_iterator UpperBound(KeyType const &key) const
        {
                return std::upper_bound(Begin(),End(),key,comp);
        }
        template <class KeyType> iterator UpperBound(KeyType const &key)
        {
                return std::upper_bound(Begin(),End(),key,comp);
        }
        template <class KeyType> std::pair<const_iterator,const_iterator> EqualRange(KeyType const &key) const
        {
                return std::make_pair(LowerBound(key), UpperBound(key));
        }
        template <class KeyType> std::pair<iterator, iterator> EqualRange(KeyType const &key)
        {
                return std::make_pair(LowerBound(key), UpperBound(key));
        }
        template <class KeyType> const_iterator Find(KeyType const &key) const
        {
                return BinaryFind(Begin(),End(),key,comp);
        }
        template <class KeyType> const_iterator Find(const_value_type &value) const
        {
                return BinaryFind(Begin(),End(),value,comp);
        }
        template <class KeyType> iterator Find(KeyType const &key)
        {
                return BinaryFind(Begin(),End(),key,comp);
        }

        /** Insert an element into the map
            @param value Key,data pair to insert
            @return first: iterator where data is/would be inserted. second: if insertion was succesful (not a dupe)
        */
        std::pair<iterator, bool> Insert(const_value_type &value)
        {
                //Find position
                iterator insertpos = LowerBound(value);

                //Is it a duplicate key?
                if (insertpos != End() && !comp(value,*insertpos))
                    return std::make_pair(insertpos,false);

                //Calculate position (insert will invalidate iterator)
                unsigned posnumber = insertpos - Begin();
                themap.insert(insertpos,value);
                return std::make_pair(Begin() + posnumber,true);
        }

        /** Delete an element from the map
            @param value Value to delete
            @return true if the item was succesfully deleted, false otherwise */
        bool Delete(const_value_type &value)
        {
                return Delete(Find(value));
        }

        /** Delete an element from the map
            @param deletepos Iterator pointing to element that is to be deleted
            @return true if the item was succesfully deleted, false otherwise */
        bool Delete(iterator const &deletepos)
        {
                if (deletepos == End())
                    return false;

                themap.erase(deletepos);
                return true;
        }

        /** Insert an element at the end of the map. If the element doesn't
            belong at the end of the map, the MapVector is corrupted
            @param value Key,data pair to insert
        */
        void PushBack(const_value_type &value)
        {
                themap.push_back(value);
        }

        /** Clear the entire vector */
        void Clear()
        {
                themap.clear();
        }
};

} //end namespace Blex

#endif
