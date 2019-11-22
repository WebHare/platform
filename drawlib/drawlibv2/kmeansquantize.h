#ifndef drawlib_kmeansquantize_h
#define drawlib_kmeansquantize_h

#include <blex/blexlib.h>
#include <vector>
#include "drawlib_v2_types.h"
#include <list>
#include <deque>

namespace DrawLib
{

/** Quantize the bitmap using k-means.
    @param bitmap
    @param clustercount Maximum number of clusters to return
    @param minimum_alpha Ignore pixels with alpha lower than this value
    @param max_iters Maximum nr of iterations for k-means algorithm
    @param initialpoint Initial point to choose (negative to use random)
*/
std::vector< Pixel32 > BLEXLIB_PUBLIC KMeansQuantize(Bitmap32 const &bitmap, uint32_t clustercount, uint8_t minimum_alpha, int32_t max_iters = -1, float initialpoint = -1);

} // end of namespace DrawLib

#endif // end of #ifdef drawlib_kmeansquantize_h
