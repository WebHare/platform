#include <blex/blexlib.h>
#include "podvector.h"
#include <sys/mman.h>
#include <cstdlib>

namespace Blex
{
namespace Detail
{

namespace
{

inline size_t round_to_page(size_t size)
{
      return (size + 4095) & -4096LL;
}

} // End of anonymous namespace

static const uint64_t large_alloc_threshold = 2048 * 1024;

void *PodVectorRealloc(void *buffer, void *staticbuffer, size_t oldsize, size_t newsize)
{
        // Only use mmap code on linux & darwin
        if (newsize >= large_alloc_threshold)
        {
                // resize over big alloc limit
                if (oldsize >= large_alloc_threshold)
                {
#if defined(PLATFORM_LINUX)
                        void *newbuffer = mremap(buffer, round_to_page(oldsize), round_to_page(newsize), MREMAP_MAYMOVE);
//                        Blex::ErrStream() << "Resizing large buffer from large " << oldsize << " " << buffer << " to large " << newsize << ": " << newbuffer;
                        if (newbuffer == MAP_FAILED)
                            throw std::bad_alloc();
#else
                        // No mremap on darwin. Allocate new mapping + copy.
                        void *newbuffer = mmap(buffer, round_to_page(newsize), PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, 0, 0);
//                        Blex::ErrStream() << "Resizing large buffer from large " << oldsize << " " << buffer << " to large " << newsize << ": " << newbuffer;
                        if (newbuffer == MAP_FAILED)
                            throw std::bad_alloc();

                        memcpy(newbuffer, buffer, oldsize);
                        munmap(buffer, round_to_page(oldsize));
#endif
                        return newbuffer;
                }
                else
                {
                        void *newbuffer = mmap(0, round_to_page(newsize), PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, 0, 0);
//                        Blex::ErrStream() << "Upgrading buffer from small " << oldsize << " to large " << newsize << ", result: " << newbuffer;
                        if (newbuffer == MAP_FAILED)
                            throw std::bad_alloc();

                        if (buffer)
                        {
                                memcpy(newbuffer, buffer, oldsize);
                                if (buffer != staticbuffer)
                                    std::free(buffer);
                        }
                        return newbuffer;
                }
        }
        if (oldsize >= large_alloc_threshold)
        {
                // INV: newsize < oldsize
                void *newbuffer(0);
                if (newsize)
                {
                        // resize below big alloc limit
                        newbuffer = malloc(newsize);
                        if (!newbuffer)
                            throw std::bad_alloc();

                        memcpy(newbuffer, buffer, newsize);
                }

//                Blex::ErrStream() << "Downgrading from large " << oldsize << " " << buffer << " to small " << newsize << ", result: " << newbuffer;
                munmap(buffer, round_to_page(oldsize));
                return newbuffer;
        }

        if (!newsize)
        {
//                Blex::ErrStream() << "Free small buffer " << oldsize << " to small " << newsize;
                if (buffer && buffer != staticbuffer)
                    std::free(buffer);
                return 0;
        }

//        Blex::ErrStream() << "Resize small buffer " << oldsize << " to small " << newsize;
        if (buffer)
        {
                if (buffer == staticbuffer)
                {
                        void *newbuffer = malloc(newsize);
                        if (!newbuffer)
                            throw std::bad_alloc();

                        memcpy(newbuffer, buffer, oldsize);
                        return newbuffer;
                }
                else
                {
                        void *newbuffer = realloc(buffer, newsize);
                        if (!newbuffer)
                            throw std::bad_alloc();

                        return newbuffer;
                }
        }
        else
        {
                void *newbuffer = malloc(newsize);
                if (!newbuffer)
                    throw std::bad_alloc();

                return newbuffer;
        }
}

} // End of namespace Detail
} // End of namespace Blex
