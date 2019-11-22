#ifndef drawlib_octree_h
#define drawlib_octree_h

#include <blex/blexlib.h>
#include <vector>
#include "drawlib_v2_types.h"
#include <list>
#include <deque>

namespace DrawLib
{

class Palette
{
public:
        Pixel32 entries[256];
        unsigned int TotalColors;
};

/** Counts the number of occurences of a colour in a picture
    An empty tree will always generate the color (0,0,0) and palette index=0. */

class BLEXLIB_PUBLIC Octree
{
public:
        /** Constructor */
        Octree();
        ~Octree();

        ///How many nodes to fit in a node pool?
        static const unsigned NodesPerPool = 2048;

        /** Insert a colour into the octree. */
        void AddColor(const Pixel32 & mypixel, uint32_t occurences)
        {
                AddColor2Tree(MyTree, mypixel,occurences);
        }

        /** Get the total number of colors in the original bitmap */
        unsigned long GetTotalColors() const;

        /** returns the number of colors in palette..
            @return number of colours, or -1 if there are too many colours */
        int BuildPalette(Palette &mypalette);

        uint8_t LookupColor(Pixel32 mypixel) const;

private:

        class Node
        {
        public:
                Node();

                bool IsLeaf();
                int  AssignPaletteIndex(Palette *pal, int index);

                unsigned long count;
                unsigned long r,g,b;
                unsigned char palindex;
                Node *child[8];
        };


        void AddColor2Tree(Octree::Node *Treenode, const Pixel32 & color, uint32_t occurences);
        bool ReduceThisTree(Node *Treenode);
        uint8_t   GetLinList(Node *Treenode);

        unsigned long TotalColors;
        unsigned long RedCol;


        std::vector<Node*> reduciblenodes;

        ///A node pool is a holder of nodes, speeding up (de) allocation
        struct NodePool
        {
                Node nodes[NodesPerPool];
        };
        std::list<NodePool> nodepools;

        void AllocateNewPool();

        Node * AllocateNode();

        unsigned left_in_pool;

        Node *MyTree;

        static bool LessNode(const Node* s1, const Node* s2);
};

}
#endif
