#include <drawlib/drawlibv2/allincludes.h>

#include <algorithm>
#include <random>
#include "bitmap.h"
#include "kmeansquantize.h"

namespace DrawLib
{

namespace
{
struct PixelData
{
        uint8_t r;
        uint8_t g;
        uint8_t b;

        float mindistsq;
        int32_t best;
        int32_t lastbest;
};

struct Cluster
{
        float r, g, b;
        uint32_t n;

        void assign(float _r, float _g, float _b, uint32_t _n)
        {
                r = _r;
                g = _g;
                b = _b;
                n = _n;
        }
};

void UpdateNearestCluster(std::vector< PixelData > *pixeldata, Cluster cl, uint32_t id)
{
        for (auto &pixel: *pixeldata)
        {
                float diff_r = pixel.r - cl.r;
                float diff_g = pixel.g - cl.g;
                float diff_b = pixel.b - cl.b;

                // Using https://en.wikipedia.org/wiki/Color_difference cheap approximation
                float distsq = 2 * diff_r * diff_r  + 4 * diff_g * diff_g + 3 * diff_b  * diff_b;
                if (pixel.mindistsq > distsq)
                {
                        pixel.mindistsq = distsq;
                        pixel.best = id;
                }
        }
}

} // end of anonymous namespace

std::vector< Pixel32 > BLEXLIB_PUBLIC KMeansQuantize(Bitmap32 const &bitmap, uint32_t clustercount, uint8_t minimum_alpha, int32_t max_iters, float initialpoint)
{
        /* This quantizer uses the k-means algorithm, with maximin initialization.

            It chooses one of the colors at random as starting cluster, then repeats picking the colors that lie furthest from
            the existing clusters as next clusters. (inspired by kmeans++, except that it just picks the furthest, instead of
            picking random with the distance as probability factor)

            Then, the normal k-means algorithm starts: in every round, the new value of a cluster center is the average
            of all colors that are closest to that cluster. The algorithm stops when no point changes cluster, or max iterations
            has been reached.

            The clusters are sorted on the number of their points, descending. So, the first color can be used as the dominant color.
            When testing this visually, it looked like 10 iterations was enough for dominant color determination.
        */
        std::vector< PixelData > pixeldata(bitmap.GetHeight() * bitmap.GetWidth());

        auto itr = pixeldata.begin();
        for(unsigned int y=0; y<bitmap.GetHeight(); y++)
        {
                const Scanline32 &scanlineptr = bitmap.GetScanline32(y);
                for(unsigned int x=0; x<bitmap.GetWidth(); x++)
                {
                        const Pixel32 pixel = scanlineptr.Pixel(x);
                        if (pixel.GetA() >= minimum_alpha)
                        {
                                itr->r = pixel.GetR();
                                itr->g = pixel.GetG();
                                itr->b = pixel.GetB();
                                itr->mindistsq = std::numeric_limits<float>::max();
                                itr->best = -1;
                                itr->lastbest = -1;
                                ++itr;
                        }
                }
        }

        pixeldata.erase(itr, pixeldata.end());
        if (pixeldata.empty())
            return std::vector< Pixel32 >();

        uint32_t initial;
        if (initialpoint >= 0 && initialpoint < 1)
            initial = initialpoint * pixeldata.size();
        else
        {
                std::random_device rd;
                std::default_random_engine generator(rd());
                std::uniform_int_distribution<int> distribution(0, pixeldata.size() - 1);
                initial = distribution(generator);  // generates number in the range 0..pixeldata.size() - 1
        }

        std::vector< Cluster > clusters(1);

        PixelData const &initial_pixel = pixeldata[initial];
        clusters[0].r = initial_pixel.r;
        clusters[0].g = initial_pixel.g;
        clusters[0].b = initial_pixel.b;
        clusters[0].n = 0;

        UpdateNearestCluster(&pixeldata, clusters[0], 0);

        // kmeans++ like init (just used furthest element)
        for (uint32_t i = 1; i < clustercount; ++i)
        {
                auto itr = std::max_element(pixeldata.begin(), pixeldata.end(), [] (auto lhs, auto rhs) { return lhs.mindistsq < rhs.mindistsq; });
                if (itr->mindistsq == 0)
                    break;

                Cluster cluster;
                cluster.r = itr->r;
                cluster.g = itr->g;
                cluster.b = itr->b;
                cluster.n = 0;
                clusters.push_back(cluster);

                UpdateNearestCluster(&pixeldata, clusters[i], i);
        }

        for (int32_t round = 0;; ++round)
        {
                // 1000 rounds as max, don't want to cause a hang
                if ((max_iters > 0 && round >= max_iters) || round >= 1000)
                    break;

                for (auto &cluster: clusters)
                {
                        cluster.r = 0;
                        cluster.g = 0;
                        cluster.b = 0;
                        cluster.n = 0;
                }

                for (auto &ptx: pixeldata)
                {
                        auto &cluster = clusters[ptx.best];
                        cluster.r += ptx.r;
                        cluster.g += ptx.g;
                        cluster.b += ptx.b;
                        ++cluster.n;

                        ptx.mindistsq = std::numeric_limits<float>::max();
                        ptx.lastbest = ptx.best;
                        ptx.best = -1;
                }

                // sort on pixel count, descending. Remove clusters without elements
                std::sort(clusters.begin(), clusters.end(), [] (auto lhs, auto rhs) { return lhs.n > rhs.n; });
                auto firstzero = std::find_if(clusters.begin(), clusters.end(), [] (auto lhs) { return lhs.n == 0; });
                clusters.erase(firstzero, clusters.end());

                unsigned clnr = 0;
                for (auto &cluster: clusters)
                {
                        cluster.r /= cluster.n;
                        cluster.g /= cluster.n;
                        cluster.b /= cluster.n;

                        UpdateNearestCluster(&pixeldata, cluster, clnr++);
                }

                bool anychange = false;
                for (auto &ptx: pixeldata)
                {
                        if (ptx.lastbest != ptx.best)
                        {
                               anychange = true;
                               break;
                        }
                }
                if (!anychange)
                    break;
        }

        std::vector< Pixel32 > result;
        for (auto const &cluster: clusters)
            result.push_back(Pixel32(std::floor(cluster.r), std::floor(cluster.g), std::floor(cluster.b)));

        return result;
}

} // end of namespace Drawlib
