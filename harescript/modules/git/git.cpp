//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>
#include <blex/logfile.h>

//---------------------------------------------------------------------------

#include <harescript/vm/hsvm_dllinterface_blex.h>

#ifdef __clang__
  #pragma clang diagnostic ignored "-Wmissing-field-initializers"
#endif

#ifdef HAVE_LIBGIT

#include "git2.h"

namespace HareScript
{
namespace Git
{

template < typename Callback >
 class RAIIDestruct
{
    private:
        Callback destruct;
    public:
        RAIIDestruct(Callback f) : destruct(f) {}
        ~RAIIDestruct() { destruct(); }
};

template < typename Callback >
 RAIIDestruct< Callback > finally(Callback destruct)
{
        return RAIIDestruct< Callback >(destruct);
}

// structure of payload for callbacks
struct CallbackPayload
{
        CallbackPayload()
        : returned_credentials(false)
        {
        }

        bool returned_credentials;
};

// callback to provide credentials to connect to remote repositories
int cred_acquire_cb(git_cred** cred, const char */*url*/, const char *username_from_url, unsigned int /*allowed_types*/, void *payload)
{
        // Make sure we error out the second time this function is called, seen infinite loops on mac
        auto *typed_payload = static_cast< CallbackPayload * >(payload);
        if (typed_payload->returned_credentials)
            return GIT_EAUTH;

        // TODO: this only allows for ssh-agent authentication, so not very generic
        int ret = git_cred_ssh_key_from_agent(cred, username_from_url);
        typed_payload->returned_credentials = true;
        return ret;
}

void GetRepoInfo(HSVM *hsvm, HSVM_VariableId id_set)
{
        HSVM_ColumnId col_author = HSVM_GetColumnId(hsvm,"AUTHOR");
        //HSVM_ColumnId col_authoremail = HSVM_GetColumnId(hsvm,"AUTHOREMAIL");
        //HSVM_ColumnId col_authorname = HSVM_GetColumnId(hsvm,"AUTHORNAME");
        HSVM_ColumnId col_branch = HSVM_GetColumnId(hsvm,"BRANCH");
        HSVM_ColumnId col_commits = HSVM_GetColumnId(hsvm,"COMMITS");
        HSVM_ColumnId col_date = HSVM_GetColumnId(hsvm,"DATE");
        HSVM_ColumnId col_email = HSVM_GetColumnId(hsvm,"EMAIL");
        HSVM_ColumnId col_head_oid = HSVM_GetColumnId(hsvm,"HEAD_OID");
        HSVM_ColumnId col_message = HSVM_GetColumnId(hsvm,"MESSAGE");
        HSVM_ColumnId col_msg = HSVM_GetColumnId(hsvm,"MSG");
        HSVM_ColumnId col_name = HSVM_GetColumnId(hsvm,"NAME");
        HSVM_ColumnId col_id = HSVM_GetColumnId(hsvm,"ID");
        HSVM_ColumnId col_origin_oid = HSVM_GetColumnId(hsvm,"ORIGIN_OID");
        HSVM_ColumnId col_parents = HSVM_GetColumnId(hsvm,"PARENTS");
        HSVM_ColumnId col_remote_refs = HSVM_GetColumnId(hsvm,"REMOTE_REFS");
        HSVM_ColumnId col_remote_url = HSVM_GetColumnId(hsvm,"REMOTE_URL");
        //HSVM_ColumnId col_statuscode = HSVM_GetColumnId(hsvm,"STATUSCODE");
        HSVM_ColumnId col_status = HSVM_GetColumnId(hsvm,"STATUS");
        HSVM_ColumnId col_target = HSVM_GetColumnId(hsvm,"TARGET");
        //HSVM_ColumnId col_time = HSVM_GetColumnId(hsvm,"TIME");
        HSVM_ColumnId col_paths = HSVM_GetColumnId(hsvm,"PATHS");
        HSVM_ColumnId col_path = HSVM_GetColumnId(hsvm,"PATH");

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Record);

        HSVM_VariableId var_status = HSVM_RecordCreate(hsvm, id_set, col_status);
        HSVM_VariableId var_msg = HSVM_RecordCreate(hsvm, id_set, col_msg);
        HSVM_VariableId var_branch = HSVM_RecordCreate(hsvm, id_set, col_branch);
        HSVM_VariableId var_head_oid = HSVM_RecordCreate(hsvm, id_set, col_head_oid);
        HSVM_VariableId var_origin_oid = HSVM_RecordCreate(hsvm, id_set, col_origin_oid);
        HSVM_VariableId var_remote_refs = HSVM_RecordCreate(hsvm, id_set, col_remote_refs);
        HSVM_VariableId var_remote_url = HSVM_RecordCreate(hsvm, id_set, col_remote_url);
        HSVM_VariableId var_commits = HSVM_RecordCreate(hsvm, id_set, col_commits);
        HSVM_VariableId var_paths = HSVM_RecordCreate(hsvm, id_set, col_paths);

        HSVM_StringSetSTD(hsvm, var_status, "error");
        HSVM_StringSetSTD(hsvm, var_msg, "");
        HSVM_StringSetSTD(hsvm, var_branch, "");
        HSVM_StringSetSTD(hsvm, var_head_oid, "");
        HSVM_StringSetSTD(hsvm, var_origin_oid, "");
        HSVM_StringSetSTD(hsvm, var_remote_url, "");
        HSVM_SetDefault(hsvm, var_remote_refs, HSVM_VAR_RecordArray);
        HSVM_SetDefault(hsvm, var_commits, HSVM_VAR_RecordArray);
        HSVM_SetDefault(hsvm, var_paths, HSVM_VAR_RecordArray);

        std::string repopath = HSVM_StringGetSTD(hsvm, HSVM_Arg(0));
        bool query_remote = HSVM_BooleanGet(hsvm, HSVM_Arg(1));
        int ret = 1;

        git_repository *repo;
        ret = git_repository_open(&repo, repopath.c_str());
        auto free_repo = finally([repo] { git_repository_free(repo); });
        if (ret)
        {
                HSVM_StringSetSTD(hsvm, var_msg, "Could not open repository");
                return;
        }

        git_reference *head_reference = nullptr;
        ret = git_repository_head(&head_reference, repo);
        auto free_head_reference = finally([ head_reference ] { git_reference_free(head_reference); });
        if (ret)
        {
                HSVM_StringSetSTD(hsvm, var_msg, "Could not get HEAD reference");
                return;
        }

        const char *branch = git_reference_shorthand(head_reference);
        HSVM_StringSetSTD(hsvm, var_branch, branch ? branch : "");

        git_oid const *head_commit_oid = git_reference_target(head_reference);
        if (!head_commit_oid)
        {
                HSVM_StringSetSTD(hsvm, var_msg, "Head is a symbolic reference");
                return;
        }

        char out[41];
        out[40] = '\0';
        git_oid_fmt(out, head_commit_oid);
        HSVM_StringSetSTD(hsvm, var_head_oid, out);

        if (branch != std::string("HEAD"))
        {
                git_reference *remote_commit = nullptr;
                ret = git_branch_lookup(&remote_commit, repo, (std::string("origin/") + branch).c_str(), GIT_BRANCH_REMOTE);
                auto free_remote_commit = finally([ remote_commit  ] { git_reference_free(remote_commit); });
                if (!ret)
                {
                        git_oid const *remote_commit_oid = git_reference_target(remote_commit);
                        if (!remote_commit_oid)
                        {
                                HSVM_StringSetSTD(hsvm, var_msg, "Remote branch is a symbolic reference");
                                return;
                        }

                        git_oid_fmt(out, remote_commit_oid);
                        HSVM_StringSetSTD(hsvm, var_origin_oid, out);
                }
        }

        {
                git_remote *remote = nullptr;
                ret = git_remote_lookup(&remote, repo, "origin");
                auto free_remote = finally([ remote ] { git_remote_free(remote); });
                if (!ret)
                {
                        HSVM_StringSetSTD(hsvm, var_remote_url, git_remote_url(remote));

                        if (query_remote)
                        {
                                CallbackPayload payload;
                                git_remote_callbacks callbacks = GIT_REMOTE_CALLBACKS_INIT;
                                callbacks.credentials = cred_acquire_cb;
                                callbacks.payload = &payload;

                                HSVM_StringSetSTD(hsvm, var_remote_url, git_remote_url(remote));
#if LIBGIT2_VER_MAJOR >= 1
                                ret = git_remote_connect(remote, GIT_DIRECTION_FETCH, &callbacks, 0, nullptr);
#elif LIBGIT2_VER_MINOR < 24
                                ret = git_remote_connect(remote, GIT_DIRECTION_FETCH, &callbacks);
#elif LIBGIT2_VER_MINOR < 25
                                ret = git_remote_connect(remote, GIT_DIRECTION_FETCH, &callbacks, 0);
#else
                                ret = git_remote_connect(remote, GIT_DIRECTION_FETCH, &callbacks, 0, nullptr);
#endif
                                if (!ret)
                                {
                                        const git_remote_head **refs;
                                        size_t refs_len;

                                        ret = git_remote_ls(&refs, &refs_len, remote);
                                        if (!ret)
                                        {
                                                for (unsigned i = 0; i < refs_len; i++)
                                                {
                                                        git_oid_fmt(out, &refs[i]->oid);

                                                        HSVM_VariableId elt = HSVM_ArrayAppend(hsvm, var_remote_refs);

                                                        HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, elt, col_id), out);
                                                        HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, elt, col_name), refs[i]->name);
                                                        HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, elt, col_target), refs[i]->symref_target ? refs[i]->symref_target : "");
                                                }
                                        }
                                }
                        }
                }
        }

        {
                git_status_options opts = GIT_STATUS_OPTIONS_INIT;

                opts.show  = GIT_STATUS_SHOW_INDEX_AND_WORKDIR;
                opts.flags = GIT_STATUS_OPT_INCLUDE_UNTRACKED |
                    GIT_STATUS_OPT_RECURSE_UNTRACKED_DIRS |
                    GIT_STATUS_OPT_SORT_CASE_SENSITIVELY;

                git_status_list *status = nullptr;
                ret = git_status_list_new(&status, repo, &opts);
                auto free_status = finally([ status ] { git_status_list_free(status); });
                if (ret)
                {
                        HSVM_StringSetSTD(hsvm, var_msg, "Could not get status");
                        return;
                }

                size_t count = git_status_list_entrycount(status);

                for (unsigned i = 0; i < count; ++i)
                {
                        git_status_entry const *s = git_status_byindex(status, i);

                        const char *path = nullptr;

                        // Ignore unchanged files
                        if (s->status == GIT_STATUS_CURRENT)
                            continue;

                        if (!s->index_to_workdir)
                            continue;

                        if (s->index_to_workdir->old_file.path)
                            path = s->index_to_workdir->old_file.path;
                        else
                            path = s->index_to_workdir->new_file.path;

                        HSVM_VariableId elt = HSVM_ArrayAppend(hsvm, var_paths);
                        //HSVM_IntegerSet(hsvm, HSVM_RecordCreate(hsvm, elt, col_statuscode), s->status);
                        HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, elt, col_path), path);

                        HSVM_VariableId var_status = HSVM_RecordCreate(hsvm, elt, col_status);
                        HSVM_SetDefault(hsvm, var_status, HSVM_VAR_StringArray);

                        if (s->status & GIT_STATUS_INDEX_NEW) HSVM_StringSetSTD(hsvm, HSVM_ArrayAppend(hsvm, var_status), "INDEX_NEW");
                        if (s->status & GIT_STATUS_INDEX_MODIFIED) HSVM_StringSetSTD(hsvm, HSVM_ArrayAppend(hsvm, var_status), "INDEX_MODIFIED");
                        if (s->status & GIT_STATUS_INDEX_DELETED) HSVM_StringSetSTD(hsvm, HSVM_ArrayAppend(hsvm, var_status), "INDEX_DELETED");
                        if (s->status & GIT_STATUS_INDEX_RENAMED) HSVM_StringSetSTD(hsvm, HSVM_ArrayAppend(hsvm, var_status), "INDEX_RENAMED");
                        if (s->status & GIT_STATUS_INDEX_TYPECHANGE) HSVM_StringSetSTD(hsvm, HSVM_ArrayAppend(hsvm, var_status), "INDEX_TYPECHANGE");
                        if (s->status & GIT_STATUS_WT_NEW) HSVM_StringSetSTD(hsvm, HSVM_ArrayAppend(hsvm, var_status), "WT_NEW");
                        if (s->status & GIT_STATUS_WT_MODIFIED) HSVM_StringSetSTD(hsvm, HSVM_ArrayAppend(hsvm, var_status), "WT_MODIFIED");
                        if (s->status & GIT_STATUS_WT_DELETED) HSVM_StringSetSTD(hsvm, HSVM_ArrayAppend(hsvm, var_status), "WT_DELETED");
                        if (s->status & GIT_STATUS_WT_TYPECHANGE) HSVM_StringSetSTD(hsvm, HSVM_ArrayAppend(hsvm, var_status), "WT_TYPECHANGE");
                        if (s->status & GIT_STATUS_WT_RENAMED) HSVM_StringSetSTD(hsvm, HSVM_ArrayAppend(hsvm, var_status), "WT_RENAMED");
                        if (s->status & GIT_STATUS_WT_UNREADABLE) HSVM_StringSetSTD(hsvm, HSVM_ArrayAppend(hsvm, var_status), "WT_UNREADABLE");
                        if (s->status & GIT_STATUS_IGNORED) HSVM_StringSetSTD(hsvm, HSVM_ArrayAppend(hsvm, var_status), "IGNORED");
                        if (s->status & GIT_STATUS_CONFLICTED) HSVM_StringSetSTD(hsvm, HSVM_ArrayAppend(hsvm, var_status), "CONFLICTED");
                }
        }

        {
                git_revwalk *revwalk = nullptr;
                ret = git_revwalk_new(&revwalk, repo);
                auto free_revwalk = finally([ revwalk ] { git_revwalk_free(revwalk); });
                if (ret)
                {
                        HSVM_StringSetSTD(hsvm, var_msg, "Could not create revwalk");
                        return;
                }

                ret = git_revwalk_push(revwalk, head_commit_oid);
                if (ret)
                {
                        HSVM_StringSetSTD(hsvm, var_msg, "Could not push head to revwalk");
                        return;
                }

                git_revwalk_sorting(revwalk, GIT_SORT_TOPOLOGICAL);

                for (unsigned i = 0; i < 1000; ++i)
                {
                        git_oid revoid;
                        ret = git_revwalk_next(&revoid, revwalk);
                        if (ret)
                            break;

                        git_oid_fmt(out, &revoid);
                        std::string rev_commit_sha = out;

                        git_commit *rev_commit = nullptr;
                        ret = git_commit_lookup(&rev_commit, repo, &revoid);
                        if (ret)
                        {
                                HSVM_StringSetSTD(hsvm, var_msg, "Could not find commit from revwalk");
                                return;
                        }

                        auto free_rev_commit = finally([ rev_commit  ] { git_commit_free(rev_commit); });

                        HSVM_VariableId elt = HSVM_ArrayAppend(hsvm, var_commits);
                        HSVM_VariableId parents = HSVM_RecordCreate(hsvm, elt, col_parents);
                        HSVM_SetDefault(hsvm, parents, HSVM_VAR_StringArray);

                        unsigned int parentcount = git_commit_parentcount(rev_commit);
                        for (unsigned p = 0; p < parentcount; ++p)
                        {
                                  git_oid const *commit_parent_id = git_commit_parent_id(rev_commit, p);
                                  git_oid_fmt(out, commit_parent_id);
                                  HSVM_StringSetSTD(hsvm, HSVM_ArrayAppend(hsvm, parents), out);
                        }

                        git_time_t time = git_commit_time(rev_commit);
                        git_signature const *author = git_commit_author(rev_commit);

                        HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, elt, col_id), rev_commit_sha);
                        HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, elt, col_message), git_commit_message(rev_commit));
                        HSVM_DateTimeSetTimeT(hsvm, HSVM_RecordCreate(hsvm, elt, col_date), time);
                        HSVM_VariableId var_author = HSVM_RecordCreate(hsvm, elt, col_author);
                        HSVM_SetDefault(hsvm, var_author, HSVM_VAR_Record);
                        HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, var_author, col_name), author->name);
                        HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, var_author, col_email), author->email);
                }
        }

        HSVM_StringSetSTD(hsvm, var_status, "ok");
}

} // End of namespace Git
} // End of namespace Harescript

#else

namespace HareScript
{
namespace Git
{

void GetRepoInfo(HSVM *hsvm, HSVM_VariableId id_set)
{
        HSVM_ColumnId col_status = HSVM_GetColumnId(hsvm,"STATUS");
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Record);
        HSVM_VariableId var_status = HSVM_RecordCreate(hsvm, id_set, col_status);
        HSVM_StringSetSTD(hsvm, var_status, "error");
}

} // End of namespace Git
} // End of namespace Harescript

#endif

//---------------------------------------------------------------------------

extern "C" {

BLEXLIB_PUBLIC int HSVM_ModuleEntryPoint(HSVM_RegData *regdata,void*)
{
#ifdef HAVE_LIBGIT
        git_libgit2_init();
#endif

        HSVM_RegisterFunction(regdata, "GETGITREPOINFO:WH_GIT:R:SB", HareScript::Git::GetRepoInfo);
        return 1;
}

} //end extern "C"
