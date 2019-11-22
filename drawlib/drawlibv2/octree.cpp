// ----------------------------------------------------------------
// Octree Color Quantization Method (Modified)
// File Author: Roman Podobedov
// Email: romka@ut.ee
// Romka Graphics: www.ut.ee/~romka
// For comments, see Graphics Gems vol. I, pp. 287-296
// ----------------------------------------------------------------

#include <drawlib/drawlibv2/allincludes.h>


#include <algorithm>
#include "octree.h"

namespace DrawLib
{

void Octree::AllocateNewPool()
{
        nodepools.push_back(NodePool());
        left_in_pool=NodesPerPool;
}

inline Octree::Node * Octree::AllocateNode()
{
        if (left_in_pool == 0)
            AllocateNewPool();

        return &nodepools.back().nodes[NodesPerPool - left_in_pool--];
}

inline bool Octree::LessNode(const Node* s1, const Node* s2)
{
        return (s1->count < s2->count);
}


bool Octree::Node::IsLeaf()
{
        for(int i=0; i<8; i++)
        {
                if (child[i]!=0) return false;
        }
        return true;
}

int Octree::Node::AssignPaletteIndex(Palette *mypal, int index)
{
        if (IsLeaf())
        {
                // ASSIGN THE CURRENT INDEX TO THE OCTREE NODE
                palindex = index;
                if (count!=0)
                {
                        mypal->entries[index].SetRGBA(r/count, g/count, b/count, 255);
                }
                else
                {
                        mypal->entries[index].SetRGBA(0, 0, 0, 255);
                }
                index++;
        }
        else
        {
                for(int i=0; i<8; i++)
                {
                        if (child[i]!=0)
                        {
                                index = child[i]->AssignPaletteIndex(mypal, index);
                        }
                }
        }
        return index;
}



void Octree::AddColor2Tree(Octree::Node *Treenode, const Pixel32 & color, uint32_t occurences)
{
// Add new color to octree
        int k, index;
  for (k=7; k>=0; k--)
  {
    index = ((color.GetR()>>k)&1)*4+((color.GetG()>>k)&1)*2+((color.GetB()>>k)&1);
    if (Treenode->child[index] == NULL)
    {
      // Create node
      Treenode->child[index] = AllocateNode();
    }
    if (k == 0)
    {
        if (Treenode->child[index]->count == 0)
                TotalColors++;
        Treenode->child[index]->count += occurences;
        Treenode->child[index]->r += occurences*color.GetR();  //maybe, this isn't even needed.. why
        Treenode->child[index]->g += occurences*color.GetG();  //multiply if you divide later?
        Treenode->child[index]->b += occurences*color.GetB();
        return;
    }
    Treenode->count+= occurences;
    Treenode = Treenode->child[index];
  }
}

uint8_t Octree::GetLinList(Node *Treenode)
{
// Return: 0 - if node
//         1 - if leaf
  uint8_t i;
  uint8_t flag;

  flag = 1;
  for (i=0; i<8; i++)
  {
    if (Treenode->child[i] != NULL)
    {
      flag = 0;
      // if this node as a leaf has a child,
      // add it to the list!
      if (GetLinList(Treenode->child[i]))
      {
        reduciblenodes.push_back(Treenode);
        break;
      }
    }
  }
  return flag;
}

unsigned long Octree::GetTotalColors() const
{
        return TotalColors;
}


uint8_t Octree::LookupColor(Pixel32 mypixel) const
{
        Node *mynode = MyTree;
        int index;
        for (int k=7; k>=0; k--)
        {
                index = ((mypixel.GetR()>>k)&1)*4+((mypixel.GetG()>>k)&1)*2+((mypixel.GetB()>>k)&1);
                if (mynode->child[index] == NULL)
                {
                        return mynode->palindex;
                }
                else mynode = mynode->child[index];
        }
        return mynode->palindex;
}

bool Octree::ReduceThisTree(Node *Treenode)
{
        int i, j, listc;
        bool bailflag = false;
        Node *tn;

        // haha - check if we're already in the clear...
        if (TotalColors <= RedCol)
                return true;

        for (i=0; (i<8) && (bailflag==false); i++)
        {
                // build a list of reducible nodes!
                reduciblenodes.clear();
                GetLinList(Treenode);
                // sort the list!
                std::sort(reduciblenodes.begin(), reduciblenodes.end(), LessNode);

                int listsize = reduciblenodes.size();
                listc = 0;
                // while there are reducible nodes in the list do...
                while ((listc<listsize) && (bailflag==false))
                {
                        tn = reduciblenodes[listc++];   // get the octree node!
                        tn->count = 0;
                        // add all the children of this node together!
                        for (j=0; j<8; j++)
                                if (tn->child[j] != NULL)
                                {
                                        tn->count += tn->child[j]->count;
                                        tn->r += tn->child[j]->r;
                                        tn->g += tn->child[j]->g;
                                        tn->b += tn->child[j]->b;
                                        tn->child[j] = NULL;
                                        TotalColors--;
                                }
                        TotalColors++;
                        if (TotalColors <= RedCol)
                        {
                                bailflag = true;
                                break;
                        }
                }
        }
        reduciblenodes.clear();
        return true;
}

int Octree::BuildPalette(Palette &mypalette)
{
        RedCol = 255;
        if (ReduceThisTree(MyTree)==false) return -1;
        // walk the tree to find the palette!
        int maxindex = MyTree->AssignPaletteIndex(&mypalette, 0);
        mypalette.TotalColors = maxindex;
        return maxindex;
}

Octree::Octree()
{
        left_in_pool = 0;

        MyTree = AllocateNode();
        TotalColors = 0;
}

Octree::~Octree()
{
}

 Octree::Node::Node()
{
        count=0; r=0; g=0; b=0;
        for(int i=0; i<8; i++)
            child[i] = NULL;
        palindex = 0;
}

} //end namespace DrawLib
