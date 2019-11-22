#ifndef blex_harescript_modules_pdf_objects
#define blex_harescript_modules_pdf_objects
//---------------------------------------------------------------------------
#include <stack>

namespace Parsers
{

namespace Adobe
{

namespace PDF
{
class Lexer;

enum object_type
{
        type_boolean,
        type_numeric,
        type_string,
        type_name,
        type_array,
        type_dictionary,
        type_stream,
        type_null,
        type_indirect,
        type_keyword
};

struct Object;
struct DictObject;
struct ArrayObject;
struct StreamObject;
typedef std::shared_ptr<Object> ObjectPtr;

struct Version
{
        Version(unsigned _major, unsigned _minor)
                : major_nr(_major)
                , minor_nr(_minor)
        {}

        Version(std::string const &version);

        unsigned major_nr;
        unsigned minor_nr;
};

inline bool operator< (const Version &v1, const Version& v2)
{
        return v1.major_nr < v2.major_nr || (v1.major_nr == v2.major_nr && v1.minor_nr < v2.minor_nr);
}

//A stream that can count the number of bytes written
class CountingStream : public Blex::Stream
{
        public:
        CountingStream(Blex::Stream &basestream)
        : Stream(basestream.DoSmallAccessesNeedBuffering())
        , basestream(basestream)
        , bytes(0)
        {
        }

        virtual std::size_t Read(void *buf,std::size_t maxbufsize)
        {
                std::size_t done = basestream.Read(buf,maxbufsize);
                bytes+=done;
                return done;
        }

        virtual bool EndOfStream()
        {
                return basestream.EndOfStream();
        }
        virtual std::size_t Write(void const *buf, std::size_t bufsize)
        {
                std::size_t done = basestream.Write(buf, bufsize);
                bytes+=done;
                return done;
        }

        Blex::FileOffset GetBytesDone() const
        {
                return bytes;
        }

        private:
        Blex::Stream &basestream;
        Blex::FileOffset bytes;
};

class PDFOutputStream
{
        private:
        struct ObjectStack
        {
                unsigned objectid;
                Blex::MemoryRWStream temp;
        };

        typedef std::shared_ptr<ObjectStack> ObjectStackPtr;

        struct ObjectInfo
        {
                ObjectInfo()
                {
                        position = 0;
                }
                Blex::FileOffset position;
        };

        std::stack<ObjectStackPtr> objstack;
        std::vector<ObjectInfo> objects;
        typedef std::map<Object const*, unsigned> IndirectObjectMap;
        IndirectObjectMap indirectobjectmap;
        CountingStream cs;

        public:
        PDFOutputStream(Blex::Stream &out);
        ~PDFOutputStream();
        void WriteDocument(DictObject const &root, DictObject *info, Version const &version);

        Blex::Stream &CurStream() { if(objstack.empty()) return cs; return objstack.top()->temp; }

        unsigned ReserveObject();
        void StartReservedObject(unsigned objnum);
        unsigned StartObject();
        unsigned EndObject();

        void WriteIndirectReference(unsigned object);
        unsigned LookupIndirectObject(Object const * address);
        void RegisterIndirectObject(unsigned object, Object const * address);
};

struct Object
{
        /** Type of this object */
        object_type type;

public:
        Object(object_type _type)
                : type(_type)
        {}

        virtual ~Object() = 0;

        /** Virtual functions, to be implemented by the descendend class */
        virtual object_type GetType() const;
        virtual bool GetBoolean() const;
        virtual int64_t GetNumericInt() const;
        virtual float GetNumericFloat() const;
        virtual std::string const &GetString() const;
        virtual std::string const &GetName() const;
        virtual ArrayObject const &GetArray() const;
        virtual DictObject const &GetDictionary() const;
        virtual StreamObject const &GetStream() const;
        virtual std::string const &GetKeyword() const;

        virtual void WriteObject(PDFOutputStream &outstream) const = 0;
};

struct BooleanObject
        : public Object
{
        BooleanObject() : Object(type_boolean), value(false) { }
        bool value;

        virtual bool GetBoolean() const;
        virtual void WriteObject(PDFOutputStream &outstream) const;
};

typedef std::shared_ptr<BooleanObject> BooleanObjectPtr;

struct NumObject
        : public Object
{
        NumObject() : Object(type_numeric), num_type(num_int)
        {
                value.int_value = 0;
        }
        NumObject(int64_t val) : Object(type_numeric), num_type(num_int)
        {
                value.int_value=val;
        }

        enum { num_int, num_float } num_type;
        union
        {
                int64_t int_value;
                float float_value;
        } value;

        virtual int64_t GetNumericInt() const;
        virtual float GetNumericFloat()const;
        virtual void WriteObject(PDFOutputStream &outstream) const;
};

typedef std::shared_ptr<NumObject> NumObjectPtr;

struct StringObject
        : public Object
{
        StringObject() : Object(type_string) {}
        std::string value;

        virtual std::string const& GetString() const;
        virtual void WriteObject(PDFOutputStream &outstream) const;
};

typedef std::shared_ptr<StringObject> StringObjectPtr;

struct KeywordObject
        : public Object
{
        KeywordObject() : Object(type_keyword) {}
        std::string value;

        virtual std::string const &GetKeyword() const;
        virtual void WriteObject(PDFOutputStream &outstream) const;
};

typedef std::shared_ptr<KeywordObject> KeywordObjectPtr;

struct NameObject
        : public Object
{
        NameObject() : Object(type_name) {}
        NameObject(std::string const &value) : Object(type_name), value(value) { }
        std::string value;

        virtual std::string const& GetName() const;
        virtual void WriteObject(PDFOutputStream &outstream) const;
};

typedef std::shared_ptr<NameObject> NameObjectPtr;

struct NullObject
        : public Object
{
        NullObject() : Object(type_null) {}
        virtual void WriteObject(PDFOutputStream &outstream) const;
};

typedef std::shared_ptr<NullObject> NullObjectPtr;

struct IndirectObject : public Object
{
        Lexer &lexer;
        std::pair<uint32_t, uint32_t> value;
        mutable ObjectPtr cache_indirect_object;
        ObjectPtr const& GetIndirectObject() const;

public:
        IndirectObject(Lexer &lexer, uint32_t first, uint32_t second)
                : Object(type_indirect)
                , lexer(lexer)
                , value(first,second)
        {}

        virtual object_type GetType() const;
        virtual bool GetBoolean() const;
        virtual int64_t GetNumericInt() const;
        virtual float GetNumericFloat() const;
        virtual std::string const& GetString() const;
        virtual std::string const& GetName() const;
        virtual ArrayObject const&GetArray() const;
        virtual DictObject const& GetDictionary() const;
        virtual StreamObject const &GetStream() const;
        virtual std::string const& GetKeyword() const;
        virtual void WriteObject(PDFOutputStream &outstream) const;
};

typedef std::shared_ptr<IndirectObject> IndirectObjectPtr;

struct DictObject
        : public Object
{
public:
        typedef std::map<std::string, ObjectPtr> RawMap;

private:
        friend class Lexer;
        RawMap value;

public:
        DictObject() : Object(type_dictionary) {}

        /** Check if a specified key exists */
        bool KeyExists(std::string key) const;

        Object const& operator [] (std::string const &key) const;

        DictObject const& GetDictionary() const;

        RawMap const& GetRawMap() const { return value; }

        virtual void WriteObject(PDFOutputStream &outstream) const;
};

typedef std::shared_ptr<DictObject> DictObjectPtr;

struct ArrayObject
        : public Object
{
        friend class Lexer;
        std::vector<ObjectPtr> value;

public:
        ArrayObject() : Object(type_array) {}

        /** Get the array length */
        unsigned GetLength() const;

        /** Add object to arary */
        void PushBack(ObjectPtr const &obj) { value.push_back(obj); }

        Object const& operator [] (unsigned idx) const;

        virtual ArrayObject const& GetArray() const;
        virtual void WriteObject(PDFOutputStream &outstream) const;
};

typedef std::shared_ptr<ArrayObject> ArrayObjectPtr;

struct StreamObject
        : public Object
{
        DictObjectPtr dict;
        int objnum, objgen;

        std::string filekey;

        Blex::RandomStream *input_stream;
        Blex::FileOffset input_offset, input_end_offset;

        Lexer &lexer;

public:
        StreamObject(Lexer &lexer)
                : Object(type_stream)
                , lexer(lexer)
        {}

        StreamObject const &GetStream() const;
        DictObject const &GetDictionary() const { return *dict; }

        std::shared_ptr<Blex::Stream> GetData(std::vector<std::string> *filters) const;
        std::shared_ptr<Blex::Stream> GetUncompressedData() const;
        virtual void WriteObject(PDFOutputStream &outstream) const;

        friend class Lexer;
};

typedef std::shared_ptr<StreamObject> StreamObjectPtr;

std::ostream& operator<<(std::ostream &out, Object const& object);

}

}

}

//---------------------------------------------------------------------------
#endif
