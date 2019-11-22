#ifndef blex_podvector
#define blex_podvector

#ifndef blex_blexlib
#include "blexlib.h"
#endif

namespace Blex
{

namespace Detail
{
BLEXLIB_PUBLIC void * PodVectorRealloc(void *buffer, void *staticbuffer, size_t oldsize, size_t newsize);
}

/** A non-initializng pod-only vector */
template < typename Pod >
 class PodVector
{
        protected:
        static const unsigned PreallocElements = 16;

        static_assert(std::is_pod< Pod >::value, "Blex::PodVector can only contain POD types");

        public:
        typedef std::size_t size_type;
        typedef Pod * iterator;
        typedef Pod const * const_iterator;
        typedef std::reverse_iterator< iterator > reverse_iterator;
        typedef Pod value_type;
        typedef Pod & reference;
        typedef Pod const & const_reference;

        PodVector()
        : buffer(NULL)
        , staticbuffer(NULL)
        , buffersize(0)
        , allocedsize(0)
        {
        }

        ~PodVector()
        {
                Detail::PodVectorRealloc(buffer, staticbuffer, allocedsize * sizeof(Pod), 0);
        }

        Pod& operator[](size_type pos)
        { return buffer[pos]; }
        Pod const& operator[](size_type pos) const
        { return buffer[pos]; }
        Pod& front()
        { return buffer[0]; }
        Pod const & front() const
        { return buffer[0]; }
        Pod & back()
        { return *(buffer + buffersize - 1); }
        Pod const & back() const
        { return *(buffer + buffersize - 1); }
        iterator begin()
        { return buffer; }
        const_iterator begin() const
        { return buffer; }
        iterator end()
        { return buffer + buffersize; }
        const_iterator end() const
        { return buffer + buffersize; }
        size_type size() const
        { return buffersize; }
        size_type capacity() const
        { return allocedsize; }
        reverse_iterator rbegin()
        { return reverse_iterator(end()); }
        reverse_iterator rend()
        { return reverse_iterator(begin()); }

        template < typename T > void assign(T const *range_start, T const *range_end)
        {
                size_type numelements = std::distance(range_start,range_end);
                resize(numelements);
                std::copy(range_start, range_end, buffer);
        }
        template < typename T > void insert(iterator position, T const *range_start, T const *range_end)
        {
                size_type numelements = std::distance(range_start,range_end);
                size_type originalsize = buffersize;
                size_type at = position - begin(); //reallocation may destroy 'position'

                resize(buffersize + numelements);
                //The (originalsize - at) elements at position must be moved to position+numelements
                if (at != originalsize)
                    memmove (begin() + at + numelements, begin() + at, (originalsize - at) * sizeof(Pod));
                std::copy(range_start, range_end, begin() + at);
        }
        void insert(iterator position, Pod const &newvalue)
        {
                size_type numelements = 1;
                size_type originalsize = buffersize;
                size_type at = position - begin(); //reallocation may destroy 'position'

                resize(buffersize + numelements);
                //The (originalsize - at) elements at position must be moved to position+numelements
                if (at != originalsize)
                    memmove (begin() + at + numelements, begin() + at, (originalsize - at) * sizeof(Pod));
                begin()[at] = newvalue;
        }
        //erase the range between 'start' and 'end'.
        void erase(iterator range_start, iterator range_end)
        {
                if(range_start!=range_end)
                {
                        //The elements between 'range_end' and 'end()' must be moved to 'range_start'
                        if (range_end != end())
                            memmove (range_start, range_end, (end() - range_end) * sizeof(Pod));
                        resize(buffersize - (range_end - range_start));
                }
        }
        void erase(iterator position)
        {
                if (position!=end())
                    erase(position, position+1);
        }
        void resize(size_type newsize)
        {
                if (newsize>allocedsize) //must (re)allocate
                    reserve_enlarge(newsize);
                else if (newsize < buffersize)
                    VALGRIND_MAKE_MEM_UNDEFINED(buffer + newsize, (buffersize - newsize) * sizeof(Pod));

                buffersize=newsize;
        }

        void reserve(size_type newsize)
        {
                if (newsize > allocedsize)
                    reserve_enlarge(newsize);
        }

        bool empty() const
        {
                return buffersize==0;
        }
        void clear()
        {
                resize(0);
        }
        void push_back(Pod const &toadd)
        {
                resize(buffersize + 1);
                end()[-1] = toadd;
        }
        Pod & push_back()
        {
                resize(buffersize + 1);
                return end()[-1];
        }
        void pop_back()
        {
                erase(end() - 1);
        }

        PodVector& operator=(PodVector const &src)
        {
                assign(src.begin(), src.end());
                return *this;
        }

        PodVector(PodVector const &src)
        : buffer(NULL)
        , staticbuffer(NULL)
        , buffersize(0)
        , allocedsize(0)
        {
                assign(src.begin(), src.end());
        }

        PodVector(const_iterator range_start, const_iterator range_limit)
        : buffer(NULL)
        , staticbuffer(NULL)
        , buffersize(0)
        , allocedsize(0)
        {
                assign(range_start, range_limit);
        }


        explicit PodVector(size_type initial_size)
        : buffer(NULL)
        , staticbuffer(NULL)
        , buffersize(0)
        , allocedsize(0)
        {
                resize(initial_size);
        }

        protected:
        Pod *buffer;
        Pod *staticbuffer;
        size_type buffersize;
        size_type allocedsize;

        void reserve_enlarge(size_type newsize);
};

template < typename Pod >
  void PodVector< Pod >::reserve_enlarge(PodVector::size_type newsize)
{
        if(newsize >= 0x7FFFFFFF)
            throw std::runtime_error("Trying to allocate a PodVector >2GB");

        //must remain exception-safe code!
        size_type suggested_new_size = allocedsize ? allocedsize : PreallocElements;
        while(suggested_new_size < newsize)
            suggested_new_size *= 2;

        buffer = static_cast< Pod * >(Detail::PodVectorRealloc(buffer, staticbuffer, allocedsize * sizeof(Pod), suggested_new_size * sizeof(Pod)));
        allocedsize = suggested_new_size;
}

/** A non-initializng pod-only vector, with 16 elements of static storage (use on stack to avoid allocations */
template < typename Pod, unsigned StaticBufferSize >
 class SemiStaticPodVector: public PodVector< Pod >
{
        public:
        SemiStaticPodVector()
        {
                this->buffer = this->staticbuffer = staticstorage;
                this->allocedsize = StaticBufferSize;
        }

        explicit SemiStaticPodVector(Blex::PodVector< Pod > const &src)
        {
                this->buffer = this->staticbuffer = staticstorage;
                this->allocedsize = StaticBufferSize;
                this->assign(src.begin(), src.end());
        }

        SemiStaticPodVector(typename PodVector< Pod >::const_iterator range_start, typename PodVector< Pod >::const_iterator range_limit)
        {
                this->buffer = this->staticbuffer = staticstorage;
                this->allocedsize = StaticBufferSize;
                this->assign(range_start, range_limit);
        }

        private:
        Pod staticstorage[StaticBufferSize];
};


} //end namespace Blex

#endif
