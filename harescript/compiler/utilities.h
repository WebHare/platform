#ifndef blex_webhare_compiler_utilities
#define blex_webhare_compiler_utilities

#include <iterator>
#include <algorithm>

namespace Utilities
{

// -----------------------------------------------------------------------------
// -- Functors
//

// Returns first item of pair
template <class A, class B>
 struct pair_first : public std::unary_function< std::pair<A, B>, A >
{
        A operator() (std::pair<A, B> const &pair) const  { return pair.first; }
};

// Returns second item of pair
template <class A, class B>
 struct pair_second : public std::unary_function< std::pair<A, B>, B >
{
        B operator() (std::pair<A, B> const &pair) const { return pair.second; }
};

// -----------------------------------------------------------------------------
// Inserters
//
// Inserter for associative containers
template <class Container>
 class associative_insert_iterator : public std::iterator <std::output_iterator_tag, void, void, void, void>
{
    protected:
        typedef associative_insert_iterator<Container> IteratorType;
        Container *container;
    public:
        explicit associative_insert_iterator(Container &c) : container(&c) {}
        IteratorType & operator =(typename Container::value_type const &value)
        {
                container->insert(value);
                return *this;
        }
        IteratorType & operator *() { return *this; }
        IteratorType & operator ++() { return *this; }
        IteratorType & operator ++(int) { return *this; }
};

template <class Container>
 inline associative_insert_iterator<Container>
  associative_inserter(Container &c)
{
        return associative_insert_iterator<Container>(c);
}

// -----------------------------------------------------------------------------
// -- Functors
//
template <class A>
 std::vector<A> merge_vectors(const std::vector<A> &a1, const std::vector<A> &a2)
{
        std::vector<A> a(a1);
        a.insert(a.back(),a2.begin(), a2.end());
        return a;
}

template <class A>
 std::set<A> make_set(const A &a1)
{
        std::set<A> a;
        a.insert(a1);
        return a;
}
template <class A>
 std::set<A> make_set(const A &a1, const A &a2)
{
        std::set<A> a;
        a.insert(a1);
        a.insert(a2);
        return a;
}

template <class A>
 std::set<A> merge_sets(const std::set<A> &a1, const std::set<A> &a2)
{
        std::set<A> a(a1);
        a.insert(a2.begin(), a2.end());
        return a;
}

// -----------------------------------------------------------------------------
// -- Algorithms
//

/** Returns wether two sorted ranges intersect.
    Both forms return true if two elements in different ranges are
    equal (according to the used predicate).

    The caller has to ensure that both ranges are sorted to the same sorting
    criterion on entry.

    Complexity: linear (at most 2*(numberOfElements1 + numberOfElements2) - 1 comparisons */

template <class InputIterator1, class InputIterator2>
 bool intersects(InputIterator1 begin1, InputIterator1 end1,
                InputIterator2 begin2, InputIterator2 end2)
{
        while (begin1 != end1 && begin2 != end2)
        {
                if (*begin1 < *begin2)
                    ++begin1;
                else if (*begin2 < *begin1)
                    ++begin2;
                else
                    return true;
        }
        return false;
}

template <class InputIterator1, class InputIterator2, class Compare>
 bool intersects(InputIterator1 begin1, InputIterator1 end1,
                InputIterator1 begin2, InputIterator1 end2, Compare cmp)
{
        while (begin1 != end1 && begin2 != end2)
        {
                if (cmp(*begin1, *begin2))
                    ++begin1;
                else if (cmp(*begin2, *begin1))
                    ++begin2;
                else
                    return true;
        }
        return false;
}

template <class Container1, class Container2>
 void append_all_from(Container1 &add_to, Container2 const &data)
{
        std::copy(data.begin(), data.end(), associative_inserter(add_to));
}

template < class A, class B >
 auto switch_map(std::map< A, B > const &map)
{
        std::multimap< B, A > result;
        for (auto &itr: map)
            result.insert(std::make_pair(itr.second, itr.first));
        return result;
}

template <typename T>
 struct reversion_wrapper { T& iterable; };

template <typename T>
 auto begin (reversion_wrapper<T> w) { return std::rbegin(w.iterable); }

template <typename T>
 auto end (reversion_wrapper<T> w) { return std::rend(w.iterable); }

template <typename T>
 reversion_wrapper<T> reverse_range(T&& iterable) { return { iterable }; }


} // end of namespace utilities


#endif

