#include <ap/libwebhare/allincludes.h>


#include "dbase_types.h"
#include <blex/crypto.h>
#include <sstream>

#include "dbase_meta.h"
#include "../libwebhare/dbase.h"

namespace Database
{

std::ostream& operator <<(std::ostream &out, const Record &rec)
{
        uint32_t numb = rec.GetNumCells();
        for (uint32_t index = 0; index < numb; ++index)
        {
                ColumnId colid = rec.GetColumnIdByNum(index);
                out << std::dec;
                out << colid << " ";
                out << rec.GetCell(colid);
        }
        return out << std::dec;
}

std::ostream& operator <<(std::ostream &out, const Cell &cell)
{
        Blex::StringPair pair = cell.StringPair();

        out << std::hex;
        out.precision(2);
        uint32_t a = 0;
        for (const char* i = pair.begin; i!=pair.end; ++i)
        {
                out << static_cast<unsigned>(*i) << " ";
                ++a;
                if (a == 10)
                        break;
        }
        out << std::dec;

        out << "\"";
        for (const char* i = pair.begin; i!=pair.end; ++i)
                if ((*i < 32) || (*i < 0))
                        out << ".";
                else
                        out << static_cast<char>(*i);
        out << "\" ";
        if (cell.Size() == 4)
                out << "("<<cell.Integer()<<") ";
        return out;
}

std::ostream& operator <<(std::ostream &out, SearchRelationType data)
{
        switch (data)
        {
                case SearchSmaller:      return out << "<";
                case SearchSmallerEqual: return out << "<=";
                case SearchEqual:        return out << "=";
                case SearchBiggerEqual:  return out << ">=";
                case SearchBigger:       return out << ">";
                case SearchUnEqual:      return out << "!=";
                case SearchLike:         return out << "LIKE";
                case SearchIn:           return out << "IN";
                default:                 return out << "???";
        }
}

/** Is a cell, considering its type, considered to be empty or 'null' ? */
bool IsCellNull(Cell celldata, ColumnTypes celltype)
{
        if (celldata.Size() == 0)
            return true;

        switch (celltype)
        {
        case TInteger:
                return celldata.Integer()==0;
        case TBoolean:
                return celldata.Boolean()==false;
        case TBlob:
                return celldata.Blob()==0;
        case TMoney:
                return celldata.Money()==0;
        case TInteger64:
                return celldata.Integer64()==0;
        case TFloat:
                return celldata.Float()==0;
        case TDateTime:
                return celldata.DateTime().GetDays()==0 && celldata.DateTime().GetMsecs()==0;
        default:
                return false;
        }
}

bool IsCellEqual(Cell lhs, Cell rhs, ColumnTypes celltype)
{
        bool lhs_null = IsCellNull(lhs,celltype);
        bool rhs_null = IsCellNull(rhs,celltype);

        if (lhs_null && rhs_null)
            return true;
        if (lhs_null ^ rhs_null)
            return false;
        if(celltype == TBlob)
            return lhs.Blob() == rhs.Blob(); //work around legacy blobs with odd sizes

        //lhs_null = false && rhs_null = false
        return lhs.Size() == rhs.Size() && std::equal(lhs.Begin(),lhs.End(),rhs.Begin());
}

bool IsCellMatch(Cell lhs, Cell rhs, ColumnTypes coltype, SearchRelationType searchtype, bool case_sensitive)
{
        if (searchtype == SearchLike)
        {
                if (case_sensitive)
                    return Blex::StrLike(lhs.Begin(), lhs.End(), rhs.Begin(), rhs.End());
                else
                    return Blex::StrCaseLike(lhs.Begin(), lhs.End(), rhs.Begin(), rhs.End());
        }
        else if (searchtype == SearchIn)
        {
                // Don't allow IN for anything but integers!
                assert(coltype == TInteger);
                assert((rhs.Size() & 3) == 0);

                unsigned count = rhs.Size() / 4;
                uint8_t const *begin = rhs.Begin();
                int32_t to_find = lhs.Integer();
                while (count--)
                {
                        if (Blex::gets32lsb(begin) == to_find)
                            return true;
                        begin += 4;
                }
                return false;
        }

        int comparevalue; //-1: to_check < ourdata, 0: to_check == ourdata, 1: to_check > ourdata

        switch (coltype)
        {
        case TInteger:
                if (lhs.Integer() < rhs.Integer())
                    comparevalue=-1;
                else if (lhs.Integer() == rhs.Integer())
                    comparevalue=0;
                else
                    comparevalue=1;
                break;
        case TBoolean:
                if (lhs.Boolean() < rhs.Boolean())
                    comparevalue=-1;
                else if (lhs.Boolean() == rhs.Boolean())
                    comparevalue=0;
                else
                    comparevalue=1;
                break;
        case TBlob:
                if (lhs.Blob() < rhs.Blob())
                    comparevalue=-1;
                else if (lhs.Blob() == rhs.Blob())
                    comparevalue=0;
                else
                    comparevalue=1;
                break;
        case TDateTime:
                if (lhs.DateTime() < rhs.DateTime())
                    comparevalue=-1;
                else if (lhs.DateTime() == rhs.DateTime())
                    comparevalue=0;
                else
                    comparevalue=1;
                break;
        case TMoney:
                if (lhs.Money() < rhs.Money())
                    comparevalue=-1;
                else if (lhs.Money() == rhs.Money())
                    comparevalue=0;
                else
                    comparevalue=1;
                break;
        case TInteger64:
                if (lhs.Integer64() < rhs.Integer64())
                    comparevalue=-1;
                else if (lhs.Integer64() == rhs.Integer64())
                    comparevalue=0;
                else
                    comparevalue=1;
                break;
        case TFloat:
                if (lhs.Float() < rhs.Float())
                    comparevalue=-1;
                else if (lhs.Float() == rhs.Float())
                    comparevalue=0;
                else
                    comparevalue=1;
                break;
        case TText:
                if (case_sensitive) //check the minimal # of characters
                    comparevalue=Blex::StrCompare(lhs.Begin(),lhs.End(),rhs.Begin(),rhs.End());
                else
                    comparevalue=Blex::StrCaseCompare(lhs.Begin(),lhs.End(),rhs.Begin(),rhs.End());
                break;
        default:
                throw Exception(ErrorInternal,"Invalid equality type");
        }

        switch (searchtype)
        {
        case SearchSmaller:           return comparevalue<0;
        case SearchSmallerEqual:      return comparevalue<=0;
        case SearchEqual:             return comparevalue==0;
        case SearchBiggerEqual:       return comparevalue>=0;
        case SearchBigger:            return comparevalue>0;
        case SearchUnEqual:           return comparevalue!=0;
        default:                      throw Exception(ErrorInternal,"Invalid equality type");
        }
}

bool HasOnlyModified(Database::Record oldrec, Database::Record newrec, unsigned numcolids, Database::ColumnId const columnids[])
{
        //FIXME: Properly deal with NULL cells

        /* First: run though all cells in old, make sure no illegal modifications
                  of these cells appear in newrec or that they are even deleted! */
        unsigned numoldcells = oldrec.GetNumCells();
        for (unsigned i=0;i<numoldcells;++i)
        {
                //locate the cell in old
                Database::ColumnId colid = oldrec.GetColumnIdByNum(i);
                Database::Cell oldcell = oldrec.GetCell(colid);

                //are modifications permitted?
                if (std::find(columnids,columnids+numcolids,colid) != columnids+numcolids)
                    continue; //we don't care about this record, carry on!

                //locate the cell in new
                Database::Cell newcell = newrec.GetCell(colid);
                if (newcell.Exists())
                {
                        if (oldcell.Size()!=newcell.Size() || !std::equal(oldcell.Begin(),oldcell.End(),newcell.Begin()))
                            return false; //illegal modification!
                }
                else
                {
                        //FIXME: This is a satisfactory but very broken way of detecting NULL
                        for (const uint8_t *data=oldcell.Begin(); data != oldcell.End(); ++data)
                           if (*data != 0)
                             return false;
                }
        }

        /* Second: run though all cells in new, and make sure that no of the illegal
                   cells ia a newly added cell */
        unsigned numnewcells = newrec.GetNumCells();
        for (unsigned i=0;i<numnewcells;++i)
        {
                //locate the cell in new
                Database::ColumnId colid = newrec.GetColumnIdByNum(i);

                //are modifications permitted?
                if (std::find(columnids,columnids+numcolids,colid) != columnids+numcolids)
                    continue; //we don't care about this record, carry on!

                //make sure it's not a *new* cell (it's not appearing in old)
                if (!oldrec.GetCell(colid).Exists() )
                    return false; //illegal addition
        }
        return true; //nothing wrong
}


//////////////////////////////////////////////////////////////////////////////
//
// Descriptor
//
namespace Index {

Descriptor::Descriptor()
: num_indexed_columns(0)
, nonullstores(false)
{
}

void Descriptor::Initialize(TableId _table, ColumnId _firstcolumn, StorageType _storetype, ColumnTypes _coltype, unsigned _storesize, bool _nonullstores)
{
        table=_table;
        num_indexed_columns=1;
        columns[0]=_firstcolumn;
        storage[0]=_storetype;
        coltype[0]=_coltype;
        storesize[0]=_storesize;
        nonullstores=_nonullstores;
}

void Descriptor::Append(ColumnId _column, StorageType _storetype, ColumnTypes _coltype, unsigned _storesize)
{
        columns[num_indexed_columns]=_column;
        storage[num_indexed_columns]=_storetype;
        coltype[num_indexed_columns]=_coltype;
        storesize[num_indexed_columns]=_storesize;
        ++num_indexed_columns;
}


static const uint32_t DescriptorMagic = 0x65296124; //file magic id for descriptors
static const uint32_t DescriptorMagic2 = 0x65296125; //file magic id for descriptors

/** Read a descriptor from a file (throw a Database::Exception on failure)*/
void Descriptor::ReadFromStream(Blex::Stream &str)
{
        uint32_t header = str.ReadLsb<uint32_t>();
        if (header != DescriptorMagic && header != DescriptorMagic2)
            throw Exception(ErrorIO, "Invalid descriptor type");

        str.ReadLsb(&table);
        str.ReadLsb(&num_indexed_columns);
        if (num_indexed_columns > MaxCellsPerIndex)
            throw Exception(ErrorIO, "Invalid number of columns in descriptor");

        for (unsigned i=0;i<num_indexed_columns;++i)
        {
                str.ReadLsb(&columns[i]);
                storage[i]=static_cast<StorageType>(str.ReadLsb<uint32_t>());
                coltype[i]=static_cast<ColumnTypes>(str.ReadLsb<uint32_t>());
                storesize[i]=str.ReadLsb<uint32_t>();
        }

        if (header == DescriptorMagic2)
            nonullstores = str.ReadLsb<uint8_t>();
        else
            nonullstores = false;

        if (str.ReadLsb<uint32_t>() != header)
            throw Exception(ErrorIO, "Invalid descriptor terminator");
}

/** Write a descriptor to a file (throw a Database::Exception on failure)*/
void Descriptor::WriteToStream(Blex::Stream &str)
{
        str.WriteLsb<uint32_t>(DescriptorMagic2);

        str.WriteLsb(table);
        str.WriteLsb(num_indexed_columns);
        for (unsigned i=0;i<num_indexed_columns;++i)
        {
                str.WriteLsb(columns[i]);
                str.WriteLsb<uint32_t>(storage[i]);
                str.WriteLsb<uint32_t>(coltype[i]);
                str.WriteLsb<uint32_t>(storesize[i]);
        }
        str.WriteLsb< uint8_t >(nonullstores ? 1 : 0);
        str.WriteLsb(DescriptorMagic2);
}

std::string Descriptor::GetName() const
{
        std::ostringstream out;
        out << 'T' << table;
        if (nonullstores)
            out << ":nonullstores";
        out << ":{";
        for (unsigned i=0;i<num_indexed_columns;++i)
        {
                if (i>0)
                    out<< ',';

                switch(storage[i])
                {
                case StoreRaw:
                        out<< "raw:";
                        break;
                case StoreUppercase:
                        out<< "upp:";
                        break;
                case StoreS32:
                        out<< "s32:";
                        break;
                case StoreDateTime:
                        out<< "dt:";
                        break;
                }
                out<< columns[i] << "[" << storesize[i] << "]";
        }
        out << '}';

        return out.str();
}

} //end namespace Index

} //end namespace Database
