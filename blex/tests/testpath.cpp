//---------------------------------------------------------------------------
#include <blex/blexlib.h>
#include <iostream>
#include <string>
#include <vector>
#include "../testing.h"

//---------------------------------------------------------------------------

#include "../socket.h"
#include "../pipestream.h"
#include "../zstream.h"
#include "../threads.h"
#include "../path.h"
#include <set>

extern std::string self_app;

std::set<std::string> ListDir(std::string const &path, std::string const &mask)
{
        std::set<std::string> names;
        for (Blex::Directory diritr(path, mask);diritr;++diritr)
            names.insert(diritr.CurrentFile());
        return names;
}
BLEX_TEST_FUNCTION(TestDirectories)
{
        std::string basepath = Blex::MergePath(Blex::Test::GetTempDir(),"pathtest");
        std::string subpath = Blex::MergePath(basepath,"subpath");

        //sanity check
        BLEX_TEST_CHECKEQUAL(true, Blex::PathStatus("/").IsDir());

        //create the basepath & subpath structure
        BLEX_TEST_CHECKEQUAL(false, Blex::PathStatus(basepath).Exists());
        BLEX_TEST_CHECKEQUAL(false, Blex::CreateDir(subpath,true));
        BLEX_TEST_CHECKEQUAL(true, Blex::PathIsAbsolute(subpath));
        BLEX_TEST_CHECKEQUAL(true, Blex::CreateDirRecursive(subpath,true));
        BLEX_TEST_CHECKEQUAL(false, Blex::CreateDir(subpath,true));
        BLEX_TEST_CHECKEQUAL(true, Blex::CreateDirRecursive(subpath,true));
        BLEX_TEST_CHECKEQUAL(true, Blex::PathStatus(subpath).Exists());
        BLEX_TEST_CHECKEQUAL(true, Blex::PathStatus(subpath).IsDir());
        BLEX_TEST_CHECKEQUAL(false, Blex::PathStatus(subpath).IsFile());

        BLEX_TEST_CHECKEQUAL(false, Blex::PathStatus(subpath + "/d/e/f/g/h/i").Exists());
        BLEX_TEST_CHECKEQUAL(true, Blex::CreateDirRecursive(subpath + "/d/e/f/g/h/i",true));
        BLEX_TEST_CHECKEQUAL(true, Blex::PathStatus(subpath + "/d/e/f/g/h/i").IsDir());
        BLEX_TEST_CHECKEQUAL(true, Blex::RemoveDirRecursive(subpath + "/d"));
        BLEX_TEST_CHECKEQUAL(false, Blex::PathStatus(subpath + "/d/e/f/g/h/i").Exists());

        //create a few subdirs: A1, Euro (with an Euro-sign for the E)
        BLEX_TEST_CHECKEQUAL(true, Blex::CreateDir(Blex::MergePath(subpath,"A1"),true));
        BLEX_TEST_CHECKEQUAL(true, Blex::CreateDir(Blex::MergePath(subpath,"A2"),true));
        BLEX_TEST_CHECKEQUAL(false, Blex::CreateDir(Blex::MergePath(subpath,"A1"),true));

        //test the directory iterator
        std::set<std::string> names;
        names = ListDir(subpath,"*");
        BLEX_TEST_CHECKEQUAL(2, names.size());
        BLEX_TEST_CHECKEQUAL(1, names.count("A1"));
        BLEX_TEST_CHECKEQUAL(1, names.count("A2"));

        names = ListDir(subpath,"A?");
        BLEX_TEST_CHECKEQUAL(2, names.size());
        BLEX_TEST_CHECKEQUAL(1, names.count("A1"));
        BLEX_TEST_CHECKEQUAL(1, names.count("A2"));

        //test unicode support:
        BLEX_TEST_CHECKEQUAL(true, Blex::CreateDir(Blex::MergePath(subpath,"\xE2\x82\xACuro"),true));
        BLEX_TEST_CHECKEQUAL(false, Blex::CreateDir(Blex::MergePath(subpath,"\xE2\x82\xACuro"),true));
        names = ListDir(subpath,"*uro");
        BLEX_TEST_CHECKEQUAL(1, names.size());
        BLEX_TEST_CHECKEQUAL(1, names.count("\xE2\x82\xACuro"));

        //create a few files
        std::string filename_b = Blex::MergePath(subpath,"b.Txt");
        std::string filename_c = Blex::MergePath(subpath,"c.Txt");

        std::unique_ptr<Blex::FileStream> fs;
        fs.reset(Blex::FileStream::OpenWrite(filename_b,true,false,Blex::FilePermissions::PublicRead));
        BLEX_TEST_CHECK(fs.get());
        fs.reset(Blex::FileStream::OpenWrite(filename_c,true,false,Blex::FilePermissions::PublicRead));
        BLEX_TEST_CHECK(fs.get());
        fs.reset();

        //Make sure the iterator finds these files
        names = ListDir(subpath,"*.Txt");

        BLEX_TEST_CHECKEQUAL(2, names.size());
        BLEX_TEST_CHECKEQUAL(1, names.count("b.Txt"));
        BLEX_TEST_CHECKEQUAL(1, names.count("c.Txt"));
}

BLEX_TEST_FUNCTION(TestPath)
{
        BLEX_TEST_CHECKEQUAL(std::string("a/b/filename"), Blex::StripExtensionFromPath("a/b/filename.ext"));
        BLEX_TEST_CHECKEQUAL(std::string("a.b/filename"), Blex::StripExtensionFromPath("a.b/filename"));
        BLEX_TEST_CHECKEQUAL(std::string("filename.ext/"), Blex::StripExtensionFromPath("filename.ext/"));
        BLEX_TEST_CHECKEQUAL(std::string("filename.ext"), Blex::StripExtensionFromPath("filename.ext."));
        BLEX_TEST_CHECKEQUAL(std::string(".ext"), Blex::StripExtensionFromPath(".ext."));
        BLEX_TEST_CHECKEQUAL(std::string(""), Blex::StripExtensionFromPath(".ext"));
        BLEX_TEST_CHECKEQUAL(std::string(""), Blex::StripExtensionFromPath("."));
        BLEX_TEST_CHECKEQUAL(std::string(""), Blex::StripExtensionFromPath(""));

        BLEX_TEST_CHECKEQUAL(std::string(""), Blex::GetExtensionFromPath(""));
        BLEX_TEST_CHECKEQUAL(std::string(".b"), Blex::GetExtensionFromPath("a.b"));
        BLEX_TEST_CHECKEQUAL(std::string(""), Blex::GetExtensionFromPath("a.b/c"));
        BLEX_TEST_CHECKEQUAL(std::string(".d"), Blex::GetExtensionFromPath("a.b/c.d"));
        BLEX_TEST_CHECKEQUAL(std::string(".g"), Blex::GetExtensionFromPath("d.e.f.g"));
        BLEX_TEST_CHECKEQUAL(std::string(".df"), Blex::GetExtensionFromPath("..df"));
        BLEX_TEST_CHECKEQUAL(std::string("."), Blex::GetExtensionFromPath(".."));

        BLEX_TEST_CHECKEQUAL(std::string(""), Blex::GetNameFromPath(""));
        BLEX_TEST_CHECKEQUAL(std::string("d"), Blex::GetNameFromPath("a/b/c/d"));
        BLEX_TEST_CHECKEQUAL(std::string("def"), Blex::GetNameFromPath("/def"));
        BLEX_TEST_CHECKEQUAL(std::string(""), Blex::GetNameFromPath("a/b/c/"));

        BLEX_TEST_CHECKEQUAL(std::string("simpl/path"), Blex::CollapsePathString("simpl/path"));
        BLEX_TEST_CHECKEQUAL(std::string(""),           Blex::CollapsePathString("."));
        BLEX_TEST_CHECKEQUAL(std::string(""),           Blex::CollapsePathString(".."));

        BLEX_TEST_CHECKEQUAL(std::string("/"),          Blex::CollapsePathString("/.."));
        BLEX_TEST_CHECKEQUAL(std::string("/"),          Blex::CollapsePathString("/../"));
        BLEX_TEST_CHECKEQUAL(std::string("/"),          Blex::CollapsePathString("/../",true));
        BLEX_TEST_CHECKEQUAL(std::string(""),           Blex::CollapsePathString("../"));
        BLEX_TEST_CHECKEQUAL(std::string("/"),          Blex::CollapsePathString("../",true));
        BLEX_TEST_CHECKEQUAL(std::string("a/b"),        Blex::CollapsePathString("a//b"));
        BLEX_TEST_CHECKEQUAL(std::string("a/b"),        Blex::CollapsePathString("a/./b"));
        BLEX_TEST_CHECKEQUAL(std::string("a/b"),        Blex::CollapsePathString("./a/b/"));
        BLEX_TEST_CHECKEQUAL(std::string("a/b/"),       Blex::CollapsePathString("./a/b/",true));
        BLEX_TEST_CHECKEQUAL(std::string("/a/b"),       Blex::CollapsePathString("/a/b/."));
        BLEX_TEST_CHECKEQUAL(std::string("/a/b"),       Blex::CollapsePathString("/a/b/.",true));
        BLEX_TEST_CHECKEQUAL(std::string("a/b"),        Blex::CollapsePathString("a/b/."));
        BLEX_TEST_CHECKEQUAL(std::string("/a/c/d"),     Blex::CollapsePathString("/a/b/../c//d/"));
        BLEX_TEST_CHECKEQUAL(std::string("f"),          Blex::CollapsePathString("b/../c/d/../../e/../../f"));
        BLEX_TEST_CHECKEQUAL(std::string("/f"),         Blex::CollapsePathString("/b/../c///d/../../e/../../f/"));
        BLEX_TEST_CHECKEQUAL(std::string("f"),          Blex::CollapsePathString("../b/../c/d/..///../e/../../f/"));
        BLEX_TEST_CHECKEQUAL(std::string("/"),          Blex::CollapsePathString("/"));
        BLEX_TEST_CHECKEQUAL(std::string("/"),          Blex::CollapsePathString("//"));
        BLEX_TEST_CHECKEQUAL(std::string("/"),          Blex::CollapsePathString("/."));
        BLEX_TEST_CHECKEQUAL(std::string(""),           Blex::CollapsePathString("./"));
        BLEX_TEST_CHECKEQUAL(std::string("/"),          Blex::CollapsePathString("/./"));
        BLEX_TEST_CHECKEQUAL(std::string("/a/b"),       Blex::CollapsePathString("/a/b/./"));
        BLEX_TEST_CHECKEQUAL(std::string("/a/b/c"),     Blex::CollapsePathString("//a/b/c/"));
        BLEX_TEST_CHECKEQUAL(std::string("A:/b/c/d"),   Blex::CollapsePathString("A:/b/c/d/"));
        BLEX_TEST_CHECKEQUAL(std::string("A:b/c/d"),    Blex::CollapsePathString("A:b/c/d/"));
        BLEX_TEST_CHECKEQUAL(std::string("A:/b/c/d"),   Blex::CollapsePathString("A:///b/c/d/"));
        BLEX_TEST_CHECKEQUAL(std::string("b/c/d"),      Blex::CollapsePathString("A:/../b/c/d/"));
        BLEX_TEST_CHECKEQUAL(std::string("b/c/d"),      Blex::CollapsePathString("A:/../b/c/d/"));
        BLEX_TEST_CHECKEQUAL(std::string("/bunny/b/c"), Blex::CollapsePathString("//bunny/b-lex/../b/c/"));
        BLEX_TEST_CHECKEQUAL(std::string("/bunny/b/c"), Blex::CollapsePathString("//bunny///b-lex/../b/c/"));
        BLEX_TEST_CHECKEQUAL(std::string("/bunny/b/c"), Blex::CollapsePathString("////bunny///b-lex/../b/c/"));

// Test path navigation
        std::string currentdir = Blex::GetCurrentDir();
        BLEX_TEST_CHECK(Blex::ChangeDir(currentdir));

        BLEX_TEST_CHECKEQUAL(currentdir, Blex::GetCurrentDir());

        BLEX_TEST_CHECK(Blex::PathIsAbsolute(Blex::GetCurrentDir()));

        BLEX_TEST_CHECKEQUAL(false, Blex::PathIsAbsolute(""));

        //test mergepath
         BLEX_TEST_CHECKEQUAL(std::string("company.txt"),Blex::MergePath("",Blex::MergePath("/","company.txt")));
         BLEX_TEST_CHECKEQUAL(std::string("/company.txt"),Blex::MergePath("/",Blex::MergePath("","company.txt")));
         BLEX_TEST_CHECKEQUAL(std::string("company.txt"),Blex::MergePath("",Blex::MergePath("","company.txt")));
         BLEX_TEST_CHECKEQUAL(std::string("/a/b/c"),Blex::MergePath("/a/b//","////c"));
         BLEX_TEST_CHECKEQUAL(std::string("a/b/c"),Blex::MergePath("a/b//","////c"));
         BLEX_TEST_CHECKEQUAL(std::string("/"),Blex::MergePath("/","/"));
         BLEX_TEST_CHECKEQUAL(std::string(""),Blex::MergePath("","/"));
}

BLEX_TEST_FUNCTION(TestMoveFile)
{
        std::unique_ptr<Blex::FileStream> filestr;
        std::string filename = Blex::CreateTempName(Blex::MergePath(Blex::Test::GetTempDir(),"movefiletest"));

        //Create the real file
        filestr.reset(Blex::FileStream::OpenWrite(filename,true,false,Blex::FilePermissions::PublicRead));
        BLEX_TEST_CHECK(filestr.get() != NULL);
        filestr.reset();

        //Now try to movepath the file
        std::string newfilename = filename + "_new";
        BLEX_TEST_CHECKEQUAL(true, Blex::MovePath(filename,newfilename));
        BLEX_TEST_CHECKEQUAL(false, Blex::PathStatus(filename).IsFile());
        BLEX_TEST_CHECKEQUAL(true, Blex::PathStatus(newfilename).IsFile());

        //Create the file again
        filestr.reset(Blex::FileStream::OpenWrite(filename,true,false,Blex::FilePermissions::PublicRead));
        BLEX_TEST_CHECK(filestr.get() != NULL);
        filestr.reset();

        //Now try to movepath the new file back (thus overwriting the old file)
        BLEX_TEST_CHECKEQUAL(true, Blex::MovePath(newfilename,filename));
        BLEX_TEST_CHECKEQUAL(false, Blex::PathStatus(newfilename).IsFile());
        BLEX_TEST_CHECKEQUAL(true, Blex::PathStatus(filename).IsFile());
}

/* FIXME enable on linux, but locks only affect other processes there
BLEX_TEST_FUNCTION(TestFileLock)
{
        static const char test_text[]="The quick brown fox jumped over the lazy dog";
        std::unique_ptr<Blex::FileStream> first_handle, second_handle;
        std::string filename = Blex::CreateTempName(Blex::MergePath(Blex::Test::GetTempDir(),"filestreamtest"));

        //Create the real file
        first_handle.reset(Blex::FileStream::OpenWrite(filename,true,false,Blex::FilePermissions::PublicRead));
        BLEX_TEST_CHECK(first_handle.get() != NULL);
        BLEX_TEST_CHECK(first_handle->WriteString(test_text));

        //And another handle
        second_handle.reset(Blex::FileStream::OpenWrite(filename,false,false,Blex::FilePermissions::PublicRead));
        BLEX_TEST_CHECK(second_handle.get() != NULL);

        //Lock the first byte
        std::unique_ptr<Blex::FileStream::Lock> first_lock, second_lock;

        first_lock.reset(first_handle->LockRegion(0, sizeof(test_text)));
        BLEX_TEST_CHECK(first_lock.get() != NULL);

        BLEX_TEST_CHECK(!second_handle->WriteString(test_text));
        BLEX_TEST_CHECK(!second_handle->LockRegion(0, sizeof(test_text)));
}
#endif */

BLEX_TEST_FUNCTION(TestLongPaths)
{
        std::string alongname = "this_\xCE\xBA\xE1\xBD\xB9\xCF\x83\xCE\xBC\xCE\xB5_is_a_long_name_about_200_characters_long_with_a_unicode_char_at_the_start_so_that_we_can_properly_test_the_translation_functions_when_using_nonparsed_paths";

        std::string basepath = Blex::MergePath(Blex::Test::GetTempDir(), alongname);
        BLEX_TEST_CHECK(Blex::CreateDir(basepath,true));
        std::string deeperpath = Blex::MergePath(basepath, "2_" + alongname);
        BLEX_TEST_CHECK(Blex::CreateDir(deeperpath,true));
//        std::string filename = Blex::CreateTempName(Blex::MergePath(Blex::Test::GetTempDir(),"modtimetest"));
}
