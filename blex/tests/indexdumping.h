#ifndef webhare_dbase_indextest_indexdumping
#define webhare_dbase_indextest_indexdumping

#include <blex/btree_filesystem.h>

void DisplayTree(Blex::Index::BtreeIndex::ReadSession &session);
void RawDisplayTree(Blex::Index::DBIndexFileSystem::Session &session, Blex::Index::BlockId id);
void DisplayBlockContents(Blex::Index::IndexBlock &b);

#endif
