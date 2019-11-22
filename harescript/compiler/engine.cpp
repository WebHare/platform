#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include "engine.h"
#include "astcoder.h"
#include "compiler.h"
#include "symboltable.h"
#include "compiler.h"
#include "parser.h"
#include "../vm/errors.h"
#include "semanticcheck.h"
#include "opt_constantsarithmatic.h"
#include "opt_ast_shortcircuiter.h"
#include "astcomplexnodetranslator.h"
#include "sqltranslator.h"
#include "ilgenerator.h"
#include "illiveanalyzer.h"
#include "opt_blockmerger.h"
//#include "opt_il_loopinvariantcodemotion.h"
#include "opt_il_recordoptimizer.h"
#include "opt_il_deadcodeeliminator.h"
#include "opt_code_peephole.h"
#include "codegenerator.h"
#include "astvariableuseanalyzer.h"
#include "coderegisterallocator.h"
#include "codedebuginfobuilder.h"
#include "codeblocklinker.h"
#include "codelibrarywriter.h"

#include <blex/path.h>

std::string AppendLen(std::string str, unsigned a)
{
        while (str.size() < a)
           str += ' ';
        return str;
}

#define FASESTART(a) currentfase = a; if (debugoptions.show_timings) {currenttime = fasetimer.GetTotalTime(); fasetimer.Start(); std::cerr << AppendLen(a,30) << " ... ";}
#define FASEEND if (debugoptions.show_timings) {fasetimer.Stop();currenttime = fasetimer.GetTotalTime() - currenttime; std::cerr << "done in " << (currenttime * 0.000001) << " seconds" << std::endl;} \
        if (context.errorhandler.AnyErrors()) break;


namespace HareScript {
namespace Compiler {

//ast_dot_printer.h
void OutputASTNormal(CompilerContext &context, AST::Node *node, Blex::Stream &output, TypeStorage const &tstorage);
//ast_code_printer.h
void OutputASTCode(CompilerContext &context, AST::Module *module, Blex::Stream &output, TypeStorage const &tstorage, ASTVariabeleUseAnalyzer const *vuanalyzer);
//il_dot_printer.h
void PrintIntermediateStructure(CompilerContext &context, IL::Module *module, Blex::Stream &outfile, PrintType type, ILLiveAnalyzer*);
void PrintCodeStructure(CompilerContext &context, IL::Module *module, Blex::Stream &outfile, PrintType type, ILLiveAnalyzer&, CodeRegisterAllocator&, CodeGenerator&);

/// Internal compiler implementation
class EngineImpl
{
        DebugOptions debugoptions;

        public:
        EngineImpl();

        void SetDebugOptions(DebugOptions const &newoptions) { debugoptions = newoptions; }
        DebugOptions const & GetDebugOptions() { return debugoptions; }

        void Compile(Blex::ContextKeeper &keeper, std::string const &library, Blex::DateTime source_time, Blex::RandomStream &inlib, Blex::RandomStream &outlib, std::string const &nonwhpreload);
        std::vector<LoadlibInfo> GetLoadLibs(Blex::ContextKeeper &keeper, std::string const &uri, Blex::RandomStream &inlib, std::string const &nonwhpreload);

        CompilerContext context;
        SymbolTable symboltable;
};

EngineImpl::EngineImpl()
: symboltable(context)
{
        context.symboltable = &symboltable;
}

void EngineImpl::Compile(Blex::ContextKeeper &keeper, std::string const &library, Blex::DateTime source_time, Blex::RandomStream &inlib, Blex::RandomStream &outlib, std::string const &nonwhpreload)
{
        context.Reset();
        context.keeper = &keeper;
        context.currentlibrary = library;
        context.nonwhpreload = nonwhpreload;

        HareScript::Compiler::AstCoder coder(context, library);
        context.errorhandler.SetCurrentFile(library);

        std::vector<uint8_t> buffer;
        unsigned file_length = inlib.GetFileLength();
        buffer.resize(file_length + 1);
        inlib.DirectRead(0, &buffer[0], file_length);
        *(buffer.end() - 1) = 0;

        Blex::FastTimer timer;
        Blex::FastTimer fasetimer;
        uint64_t currenttime = 0;
        timer.Start();

        HareScript::Compiler::Parser parser(&buffer[0], buffer.size(), context, symboltable, coder );
        TypeStorage typestorage;
        SemanticChecker checker(typestorage, coder, context);
        Opt_ConstantsArithmatic::Opt_ConstantsArithmatic opt_constarithm(&coder, typestorage, context);
        Opt_AST_ShortCircuiter::Opt_AST_ShortCircuiter opt_ast_shortcirc(&coder, typestorage, context);
        SQLTranslator translator(context, &coder, typestorage, checker);
        ASTComplexNodeTranslator complexnodetranslator(context, &coder, typestorage, checker, opt_constarithm);
        ASTVariabeleUseAnalyzer vuanalyzer(context);
        ILGenerator ilgenerator(context, typestorage);
        ILLiveAnalyzer liveanalyser;
        Opt_BlockMerger blockmerger(context);
        CodeGenerator generator(context);
        CodeRegisterAllocator callocator(context);
        OptCodePeephole peephole(context, generator, vuanalyzer);
        CodeDebugInfoBuilder cdebuginfobuilder(context);
        CodeBlockLinker cblinker(context, &cdebuginfobuilder);
        CodeLibraryWriter lwriter(context);

//        OptILLoopInvariantCodeMotion opt_il_loopinvariantcodemotion(liveanalyser);
        OptILRecordOptimizer opt_il_recordoptimizer(context);
        OptILDeadCodeEliminator opt_il_deadcodeeliminator(context, liveanalyser);

        Node* topnode;

        std::string currentfase;

        if (debugoptions.show_files)
            std::cerr << "Compiling " << library << std::endl;

        do
        {
                FASESTART("Parsing");
                try
                {
                        parser.ParseHareScriptFile();
                }
                catch (VMRuntimeError &e)
                {
                        if (e.filename.empty())
                            e.filename = library;
                        throw;
                }
                FASEEND;

                topnode = coder.GetRoot();

                if (debugoptions.generate_dots)
                {
                        std::unique_ptr< Blex::FileStream > file;
                        file.reset(Blex::FileStream::OpenRW(Blex::MergePath(debugoptions.dots_dir, "01-after-parse.txt"), true, false, Blex::FilePermissions::PublicRead ));
                        if (!file.get()) throw std::runtime_error("Could not create lst output file");
                        file->SetFileLength(0);

                        FASESTART("Printing AST");
                        OutputASTCode(context, coder.GetRoot(), *file, typestorage, 0);
                        FASEEND;
                }//*/

                FASESTART("Semantic checking");
                checker.CheckObjectMembers();                   // Required
                checker.Visit(topnode, false);                  // Required
                FASEEND;

                if (debugoptions.generate_dots)
                {
                        std::unique_ptr< Blex::FileStream > file;
                        file.reset(Blex::FileStream::OpenRW(Blex::MergePath(debugoptions.dots_dir, "02-after-sc-1.txt"), true, false, Blex::FilePermissions::PublicRead ));
                        if (!file.get()) throw std::runtime_error("Could not create lst output file");
                        file->SetFileLength(0);

                        FASESTART("Printing AST");
                        OutputASTCode(context, coder.GetRoot(), *file, typestorage, 0);
                        FASEEND;
                }//*/

                if (debugoptions.generate_dots)
                {
                        std::unique_ptr< Blex::FileStream > file;
                        file.reset(Blex::FileStream::OpenRW(Blex::MergePath(debugoptions.dots_dir, "02-after-sc-1.dot"), true, false, Blex::FilePermissions::PublicRead ));
                        if (!file.get()) throw std::runtime_error("Could not create dot output file");
                        file->SetFileLength(0);

                        FASESTART("Printing AST - dot");
                        OutputASTNormal(context, coder.GetRoot(), *file, typestorage);
                        FASEEND;
                }//*/


                FASESTART("AST constant arithmatic");
                opt_constarithm.Execute(topnode);               // Required
                FASEEND;

                if (debugoptions.generate_dots)
                {
                        std::unique_ptr< Blex::FileStream > file;
                        file.reset(Blex::FileStream::OpenRW(Blex::MergePath(debugoptions.dots_dir, "03-after-ca.txt"), true, false, Blex::FilePermissions::PublicRead ));
                        if (!file.get()) throw std::runtime_error("Could not create lst output file");
                        file->SetFileLength(0);

                        FASESTART("Printing AST");
                        OutputASTCode(context, coder.GetRoot(), *file, typestorage, 0);
                        FASEEND;
                }//*/

                FASESTART("AST SQL translation");
                checker.Visit(topnode, false);                  // Required for SQL support
                translator.Execute(topnode);
                FASEEND;

                if (debugoptions.generate_dots)
                {
                        std::unique_ptr< Blex::FileStream > file;
                        file.reset(Blex::FileStream::OpenRW(Blex::MergePath(debugoptions.dots_dir, "04-after-sql.txt"), true, false, Blex::FilePermissions::PublicRead ));
                        if (!file.get()) throw std::runtime_error("Could not create lst output file");
                        file->SetFileLength(0);

                        FASESTART("Printing AST");
                        OutputASTCode(context, coder.GetRoot(), *file, typestorage, 0);
                        FASEEND;
                }//*/

                FASESTART("Semantic check (after SQL)");
                checker.Visit(topnode, false);                  // Required after SQL translation
                FASEEND;

                FASESTART("AST constant arithmatic");
                opt_constarithm.Execute(topnode);               // Required
                FASEEND;

                if (debugoptions.generate_dots)
                {
                        std::unique_ptr< Blex::FileStream > file;
                        file.reset(Blex::FileStream::OpenRW(Blex::MergePath(debugoptions.dots_dir, "05-after-ca2.txt"), true, false, Blex::FilePermissions::PublicRead ));
                        if (!file.get()) throw std::runtime_error("Could not create lst output file");
                        file->SetFileLength(0);

                        FASESTART("Printing AST");
                        OutputASTCode(context, coder.GetRoot(), *file, typestorage, 0);
                        FASEEND;
                }//*/

                FASESTART("AST complex node translator");
                complexnodetranslator.Execute(topnode);         // Required
                FASEEND;

                if (debugoptions.generate_dots)
                {
                        std::unique_ptr< Blex::FileStream > file;
                        file.reset(Blex::FileStream::OpenRW(Blex::MergePath(debugoptions.dots_dir, "06-after-complex-trans.txt"), true, false, Blex::FilePermissions::PublicRead ));
                        if (!file.get()) throw std::runtime_error("Could not create lst output file");
                        file->SetFileLength(0);

                        FASESTART("Printing AST");
                        OutputASTCode(context, coder.GetRoot(), *file, typestorage, 0);
                        FASEEND;
                }//*/

                FASESTART("AST short circuit evaluator");
                opt_ast_shortcirc.Execute(topnode);
                FASEEND;

                if (debugoptions.generate_dots)
                {
                        std::unique_ptr< Blex::FileStream > file;
                        file.reset(Blex::FileStream::OpenRW(Blex::MergePath(debugoptions.dots_dir, "07-after-shortcircuit.txt"), true, false, Blex::FilePermissions::PublicRead ));
                        if (!file.get()) throw std::runtime_error("Could not create lst output file");
                        file->SetFileLength(0);

                        FASESTART("Printing AST");
                        OutputASTCode(context, coder.GetRoot(), *file, typestorage, 0);
                        FASEEND;
                }//*/

                if (debugoptions.generate_dots)
                {
                        std::unique_ptr< Blex::FileStream > file;
                        file.reset(Blex::FileStream::OpenRW(Blex::MergePath(debugoptions.dots_dir, "08-after-shortcircuit.dot"), true, false, Blex::FilePermissions::PublicRead ));
                        if (!file.get()) throw std::runtime_error("Could not create dot output file");
                        file->SetFileLength(0);

                        FASESTART("Printing AST - dot");
                        OutputASTNormal(context, coder.GetRoot(), *file, typestorage);
                        FASEEND;
                }//*/

                FASESTART("Symantic checking, again");
                checker.Visit(topnode, false);                  // Required before variable use analysing and IL generating, after last op-step
                FASEEND;

/*                        if (output_ast_normal)
                {
                        FASESTART("Printing AST");
                        OutputASTNormal(coder.GetRoot(), *output_ast_normal, typestorage);
                        FASEEND;
                }//*/

                FASESTART("AST variable use analyzing");
                vuanalyzer.Execute(coder.GetRoot());
                FASEEND;

                if (debugoptions.generate_dots)
                {
                        std::unique_ptr< Blex::FileStream > file;
                        file.reset(Blex::FileStream::OpenRW(Blex::MergePath(debugoptions.dots_dir, "09-after-vua.txt"), true, false, Blex::FilePermissions::PublicRead ));
                        if (!file.get()) throw std::runtime_error("Could not create lst output file");
                        file->SetFileLength(0);

                        FASESTART("Printing AST");
                        OutputASTCode(context, coder.GetRoot(), *file, typestorage, &vuanalyzer);
                        FASEEND;
                }//*/

                if (debugoptions.generate_dots)
                {
                        std::unique_ptr< Blex::FileStream > file;
                        file.reset(Blex::FileStream::OpenRW(Blex::MergePath(debugoptions.dots_dir, "10-after-vua.dot"), true, false, Blex::FilePermissions::PublicRead ));
                        if (!file.get()) throw std::runtime_error("Could not create dot output file");
                        file->SetFileLength(0);

                        FASESTART("Printing AST");
                        OutputASTNormal(context, coder.GetRoot(), *file, typestorage);
                        FASEEND;
                }//*/

                FASESTART("IL generating");
                IL::Module *module = 0;
                ilgenerator.Execute(module, coder.GetRoot(), &vuanalyzer);
                FASEEND;

                if (debugoptions.generate_dots)
                {
                        FASESTART("Printing IL");
                        std::unique_ptr< Blex::FileStream > file;
                        file.reset(Blex::FileStream::OpenRW(Blex::MergePath(debugoptions.dots_dir, "11-generated-il.dot"), true, false, Blex::FilePermissions::PublicRead ));
                        if (!file.get()) throw std::runtime_error("Could not create dot output file");
                        file->SetFileLength(0);

                        PrintIntermediateStructure(context, module, *file, PrintNormal, 0);
                        FASEEND;
                }

                FASESTART("Live analyzing");
                liveanalyser.Execute(module);
                FASEEND;

//                        if (print_code)
//                        {
//                                FASESTART("Printing IL");
//                                PrintIntermediateStructure(context, module, *print_code, PrintNormal, &liveanalyser);
//                                FASEEND;
//                        }

//                FASESTART("Loop invariant code motion");
//                opt_il_loopinvariantcodemotion.Execute(module);
//                FASEEND;

                if (debugoptions.generate_dots)
                {
                        std::unique_ptr< Blex::FileStream > file;
                        file.reset(Blex::FileStream::OpenRW(Blex::MergePath(debugoptions.dots_dir, "12-after-la-1.dot"), true, false, Blex::FilePermissions::PublicRead ));
                        if (!file.get()) throw std::runtime_error("Could not create dot output file");
                        file->SetFileLength(0);

                        FASESTART("Printing IL");
                        PrintIntermediateStructure(context, module, *file, PrintNormal, &liveanalyser);
                        FASEEND;
                }

                FASESTART("Record optimizer");
                opt_il_recordoptimizer.Execute(module);
                FASEEND;

#ifdef DEBUG
                if (debugoptions.generate_dots)
                {
                        std::unique_ptr< Blex::FileStream > file;
                        file.reset(Blex::FileStream::OpenRW(Blex::MergePath(debugoptions.dots_dir, "13-after-ro.dot"), true, false, Blex::FilePermissions::PublicRead ));
                        if (!file.get()) throw std::runtime_error("Could not create dot output file");
                        file->SetFileLength(0);

                        FASESTART("Printing IL");
                        PrintIntermediateStructure(context, module, *file, PrintNormal, &liveanalyser);
                        FASEEND;
                }
#endif

                FASESTART("Dead code eliminator");
                opt_il_deadcodeeliminator.Execute(module);
                FASEEND;

#ifdef DEBUG
                if (debugoptions.generate_dots)
                {
                        std::unique_ptr< Blex::FileStream > file;
                        file.reset(Blex::FileStream::OpenRW(Blex::MergePath(debugoptions.dots_dir, "14-after-dce.dot"), true, false, Blex::FilePermissions::PublicRead ));
                        if (!file.get()) throw std::runtime_error("Could not create dot output file");
                        file->SetFileLength(0);

                        FASESTART("Printing IL");
                        PrintIntermediateStructure(context, module, *file, PrintNormal, &liveanalyser);
                        FASEEND;
                }
#endif

                FASESTART("OPT Merging blocks");
                blockmerger.Execute(module);
                FASEEND;

                FASESTART("Live analyzing");
                liveanalyser.Execute(module);
                FASEEND;

#ifdef DEBUG
                if (debugoptions.generate_dots)
                {
                        std::unique_ptr< Blex::FileStream > file;
                        file.reset(Blex::FileStream::OpenRW(Blex::MergePath(debugoptions.dots_dir, "15-after-bm.dot"), true, false, Blex::FilePermissions::PublicRead ));
                        if (!file.get()) throw std::runtime_error("Could not create dot output file");
                        file->SetFileLength(0);

                        FASESTART("Printing IL");
                        PrintIntermediateStructure(context, module, *file, PrintNormal, &liveanalyser);
                        FASEEND;
                }
                if (debugoptions.generate_dots)
                {
                        std::unique_ptr< Blex::FileStream > file;
                        file.reset(Blex::FileStream::OpenRW(Blex::MergePath(debugoptions.dots_dir, "15-after-bm_dom.dot"), true, false, Blex::FilePermissions::PublicRead ));
                        if (!file.get()) throw std::runtime_error("Could not create dot output file");
                        file->SetFileLength(0);

                        FASESTART("Printing IL - dominator tree");
                        PrintIntermediateStructure(context, module, *file, PrintDominator, &liveanalyser);
                        FASEEND;
                }
#endif

                FASESTART("Code generating");
                generator.Execute(module, &liveanalyser);
                //ildotprinter.RegisterCodeGenerator(&generator);
                FASEEND;

#ifdef DEBUG
                if (debugoptions.generate_dots)
                {
                        std::unique_ptr< Blex::FileStream > file;
                        file.reset(Blex::FileStream::OpenRW(Blex::MergePath(debugoptions.dots_dir, "16-after-codegen.dot"), true, false, Blex::FilePermissions::PublicRead ));
                        if (!file.get()) throw std::runtime_error("Could not create dot output file");
                        file->SetFileLength(0);

                        FASESTART("Printing code");
                        PrintCodeStructure(context, module, *file, PrintNormal, liveanalyser, callocator, generator);
//                        ildotprinter.PrintStructure(module, "z:/1/compiler/il.dot", ILDotPrinter::Code, ILDotPrinter::Dominator);
                        FASEEND;
                }
#endif

                FASESTART("Peephole");
                peephole.Execute(module);
                //ildotprinter.RegisterRegisterAllocator(&callocator);
                FASEEND;

                #ifdef DEBUG
                if (debugoptions.generate_dots)
                {
                        std::unique_ptr< Blex::FileStream > file;
                        file.reset(Blex::FileStream::OpenRW(Blex::MergePath(debugoptions.dots_dir, "17-after-peephole.dot"), true, false, Blex::FilePermissions::PublicRead ));
                        if (!file.get()) throw std::runtime_error("Could not create dot output file");
                        file->SetFileLength(0);

                        FASESTART("Printing code");
                        PrintCodeStructure(context, module, *file, PrintNormal, liveanalyser, callocator, generator);
//                        ildotprinter.PrintStructure(module, "z:/1/compiler/il.dot", ILDotPrinter::Code, ILDotPrinter::Dominator);
                        FASEEND;
                }
#endif

                FASESTART("Register allocating");
                callocator.Execute(module, &liveanalyser, &generator);
                //ildotprinter.RegisterRegisterAllocator(&callocator);
                FASEEND;

#ifdef DEBUG
                if (debugoptions.generate_dots)
                {
                        std::unique_ptr< Blex::FileStream > file;
                        file.reset(Blex::FileStream::OpenRW(Blex::MergePath(debugoptions.dots_dir, "18-after-ra.dot"), true, false, Blex::FilePermissions::PublicRead ));
                        if (!file.get()) throw std::runtime_error("Could not create dot output file");
                        file->SetFileLength(0);

                        FASESTART("Printing code");
                        PrintCodeStructure(context, module, *file, PrintNormal, liveanalyser, callocator, generator);
        //                ildotprinter.PrintStructure(module, "z:/1/compiler/il.dot", ILDotPrinter::Code, ILDotPrinter::Dominator);
                        FASEEND;
                }
#endif

//                if (print_intermediate)
//                {
//                        FASESTART("Printing code");
//                        PrintCodeStructure(context, module, *print_intermediate, PrintNormal, liveanalyser, callocator, generator);
//        //                ildotprinter.PrintStructure(module, "z:/1/compiler/il.dot", ILDotPrinter::Code, ILDotPrinter::Dominator);
//                        FASEEND;
//                }

                FASESTART("Block linking");
                cblinker.Execute(module, &generator, &callocator);
                FASEEND;

#ifdef DEBUG
                if (debugoptions.generate_dots)
                {
                        std::unique_ptr< Blex::FileStream > file;
                        file.reset(Blex::FileStream::OpenRW(Blex::MergePath(debugoptions.dots_dir, "19-after-bl.dot"), true, false, Blex::FilePermissions::PublicRead ));
                        if (!file.get()) throw std::runtime_error("Could not create dot output file");
                        file->SetFileLength(0);

                        FASESTART("Printing code");
                        PrintCodeStructure(context, module, *file, PrintNormal, liveanalyser, callocator, generator);
        //                ildotprinter.PrintStructure(module, "z:/1/compiler/il.dot", ILDotPrinter::Code, ILDotPrinter::Dominator);
                        FASEEND;
                }
#endif

                FASESTART("Writing library");
                lwriter.Execute(module, &cblinker, &callocator, library, source_time, outlib);
                FASEEND;

                context.owner.Clear();
        }
        while (false);

        if (debugoptions.show_timings)
            std::cerr << std::endl;

        timer.Stop();

        //ADDME? std::cerr << parser.lexer.GetLineNumber() << " lines compiled in " << timer.GetTotalTime() * 0.000001 << " seconds" <<std::endl;
}

std::vector<LoadlibInfo> EngineImpl::GetLoadLibs(Blex::ContextKeeper &keeper, std::string const &uri, Blex::RandomStream &inlib, std::string const &nonwhpreload)
{
        context.Reset();
        context.keeper = &keeper;
        context.currentlibrary = uri;
        context.nonwhpreload = nonwhpreload;

        HareScript::Compiler::AstCoder coder(context, uri);
        context.errorhandler.SetCurrentFile(uri);

        std::vector<uint8_t> buffer;
        unsigned file_length = inlib.GetFileLength();
        buffer.resize(file_length + 1);
        inlib.DirectRead(0, &buffer[0], file_length);
        *(buffer.end() - 1) = 0;

        std::vector<LoadlibInfo> loadlibs;

        HareScript::Compiler::Parser parser(&buffer[0], buffer.size(), context, symboltable, coder );

        std::vector<LoadlibInfo> parserloadlibs = parser.GetLoadLibs();
        std::copy(parserloadlibs.begin(), parserloadlibs.end(), std::back_inserter(loadlibs));

        return loadlibs;
}


Engine::Engine(FileSystem &filesystem, std::string const &nonwhpreload)
: filesystem(filesystem)
, impl(NULL)
, nonwhpreload(nonwhpreload)
{
        std::unique_ptr<EngineImpl> impl_ptr(new EngineImpl);

        impl_ptr->context.filesystem = &filesystem;
        impl_ptr->context.marshaller.reset(new Marshaller(impl_ptr->context.stackm, MarshalMode::SimpleOnly));

        impl=impl_ptr.release();
}

Engine::~Engine()
{
        delete impl;
}

void Engine::Compile(Blex::ContextKeeper &keeper, std::string const &library, Blex::DateTime source_time, Blex::RandomStream &inlib, Blex::RandomStream &outlib)
{
        impl->Compile(keeper, library, source_time, inlib, outlib, nonwhpreload);
}

std::vector<LoadlibInfo> Engine::GetLoadLibs(Blex::ContextKeeper &keeper, std::string const &library, Blex::RandomStream &inlib)
{
        return impl->GetLoadLibs(keeper, library, inlib, nonwhpreload);
}

ErrorHandler & Engine::GetErrorHandler()
{
        return impl->context.errorhandler;
}

void Engine::SetDebugOptions(DebugOptions const &options)
{
        impl->SetDebugOptions(options);
}

DebugOptions const & Engine::GetDebugOptions()
{
        return impl->GetDebugOptions();
}

} //end namespace Compiler
} //end namespace HareScript
