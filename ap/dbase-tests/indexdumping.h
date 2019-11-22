#ifndef webhare_dbase_indextest_indexdumping
#define webhare_dbase_indextest_indexdumping

#include <blex/btree_filesystem.h>

/*inline std::ostream& operator <<(std::ostream &out, const Blex::Index::IndexBlockEntry &e)
{
        out << "CBID: ";
        if ( e.GetChildBlockId() == uint32_t(-1))
           out << "N/A ";
        else
           out << e.GetChildBlockId() << " ";

        if (e.IsEOB())
        {
                out << "END OF BLOCK ";
        }
        else
        {
                out << "RecID: " << e.GetRecordId() << " ";
                out << "tdata: '" << std::string(reinterpret_cast<const char *>(e.GetData()), e.GetDataLength()) << "' ";
                out << "length " << e.GetDataLength() << " ";
        }
        out << "(len: " << e.GetEntryLength() << ")";

        return out;
}
*/

void DisplayTree(Blex::Index::BtreeIndex::ReadSession &session);
void RawDisplayTree(Blex::Index::DBIndexFileSystem::Session &session, Blex::Index::BlockId id);
void DisplayBlockContents(Blex::Index::IndexBlock &b);

#endif
