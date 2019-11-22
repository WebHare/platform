#ifndef blex_objectowner
#define blex_objectowner

#ifndef blex_blexlib
#include "blexlib.h"
#endif

#include <vector>
#include <algorithm>

namespace Blex
{

/** ObjectOwner, holder for dynamically allocated objects.

ObjectOwner implements an exception-safe 'owning' container for dynamic objects
which can be used when it is necessary to store objects 'by pointer' in normal
STL containers, but working with shared_ptr is considered impractical or
clumsy.

ObjectOwner will guarantee destruction of all pointers given to it, and offers
an exception-safe Adopt() function which will guarantee that the object is
either added to its internal list, or destroyed. This helps prevent resource leaks */
template<class ObjectType> class ObjectOwner
{
    private:
        typedef std::vector<ObjectType*> ObjectList;

        ObjectList objects;

        ObjectOwner& operator=(ObjectOwner const &); //not implemented
        ObjectOwner(ObjectOwner const &); //not implemented

    public:
        typedef typename ObjectList::const_iterator const_iterator;
        typedef typename ObjectList::const_reverse_iterator const_reverse_iterator;

        typedef typename ObjectList::iterator iterator;
        typedef typename ObjectList::reverse_iterator reverse_iterator;

        ObjectOwner()
        {
        }

        /** Destruct class and free all owned objects */
        ~ObjectOwner()
        {
                clear();
        }

        /** Clear all owned objects */
        void clear();

        /** Add the object to our internal list, or at least guarantee that
            it will be destroyed */
        template <class A> A* Adopt(A* ptr);

        /** Get the size of our internal list */
        std::size_t size() const
        {
                return objects.size();
        }
        bool empty() const
        {
                return objects.empty();
        }

        /** Reserve space in the internal list */
        void reserve(std::size_t reservesize)
        {
                objects.reserve(reservesize);
        }

        ObjectType const* operator[](int pos) const    { return objects[pos];};
        ObjectType *operator[](int pos)               { return objects[pos];};

        const_iterator begin() const { return objects.begin(); }
        const_iterator end() const   { return objects.end(); }
        iterator       begin()       { return objects.begin(); }
        iterator       end()         { return objects.end(); }

        const_reverse_iterator rbegin() const { return objects.rbegin(); }
        const_reverse_iterator rend() const   { return objects.rend(); }
        reverse_iterator       rbegin()       { return objects.rbegin(); }
        reverse_iterator       rend()         { return objects.rend(); }
};

template<class ObjectType> void ObjectOwner<ObjectType>::clear()
{
        typename ObjectList::const_iterator listend=objects.end();
        typename ObjectList::const_iterator listitr=objects.begin();
        while (listitr!=listend)
        {
                delete *listitr;
                ++listitr;
        }
        objects.clear();
}

/** Generic objectowner is a class that automatically destroys owned objects
    upon destruction or request. This owner can own all types of objects,
    while ObjectOwner can own objects of only one type. It does not
    require owned objects to have a virtual destructor or share a common base class.

    GenericOwner offers no facilities to release individual pointers, and
    won't show its contents due to potential type-unsafety */
class BLEXLIB_PUBLIC GenericOwner
{
    public:
        // Pointer to a function that destroys a class when given a pointer to it.
        typedef void (*Destructor)(void*);

    private:
        // Non-copyable
        GenericOwner(const GenericOwner &) = delete;
        GenericOwner& operator =(const GenericOwner &) = delete;


        /** Object that keeps a pointer to an object, and a pointer to a function that can destroy that type of object
            when given it's pointer */
        struct ObjData
        {
                ObjData(void * ptr, Destructor destr) : ptr(ptr), destr(destr) {}
                void Destroy() { destr(ptr); }
                void * ptr;                     ///< Pointer to object
                Destructor destr;               ///< Function that destroys such an object
        };

        /// List of managed objects
        std::vector<ObjData> list;


    public:
        /** Clears the list of objects, and kills them all */
        void Clear()
        {
                std::for_each(list.begin(), list.end(), std::bind(&ObjData::Destroy, std::placeholders::_1));
                list.clear();
        }

        /** Reserves size in internal list
            @param size Number of objects to reserve room for */
        void Reserve(unsigned size)
        {
                list.reserve(size);
        }

        /** Returns number of owned objects
            @return Number of objects */
        unsigned Size() const
        {
                return list.size();
        }

        /** Transfers ownership, and responsability for destruction to this class
            @param ptr Pointer to class that must be owned by this class */
        template <class A> A* Adopt(A* ptr);

        /** Constructor, creates an empty generic owner */
        GenericOwner()
        {
        }

        /** Destructor, destroys all owned objects */
        ~GenericOwner()
        {
                Clear();
        }
};

namespace Detail
{

template <class A >
 struct DestructorConstructor
{
  static void DestructAny(void *a)
 {
         delete static_cast<A*>(a);
 }
};

} //end namespace Detail

///////////////////////////////////////////////////////////////////////////////
// Implementation of the templates
template <class ObjectType>
  template <class A> A* ObjectOwner<ObjectType>::Adopt(A* ptr)
{
        try
        {
                objects.push_back(ptr);
                return ptr;
        }
        catch (...)
        {
                delete ptr;
                throw;
        }
}

template <class A> A* GenericOwner::Adopt(A* ptr)
{
        try
        {
                list.push_back(ObjData( (void *)ptr, (GenericOwner::Destructor)&Detail::DestructorConstructor<A>::DestructAny));
                return ptr;
        }
        catch (...)
        {
                delete ptr;
                throw;
        }
}

} //end namespace Blex
#endif
