mod commands;
mod git;
mod models;

use git::RepoManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(RepoManager::new())
        .invoke_handler(tauri::generate_handler![
            commands::repo::open_repo,
            commands::log::get_log,
            commands::log::get_commit_detail,
            commands::branch::get_branches,
            commands::branch::create_branch,
            commands::branch::checkout_branch,
            commands::branch::delete_branch,
            commands::branch::rename_branch,
            commands::commit::get_status,
            commands::commit::stage_file,
            commands::commit::unstage_file,
            commands::commit::stage_all,
            commands::commit::unstage_all,
            commands::commit::commit,
            commands::diff::get_commit_files,
            commands::diff::get_commit_diff,
            commands::diff::get_file_diff,
            commands::diff::compare_commits,
            commands::diff::get_file_content,
            commands::stash::get_stash_list,
            commands::stash::stash_save,
            commands::stash::stash_apply,
            commands::stash::stash_pop,
            commands::stash::stash_drop,
            commands::remote::push_remote,
            commands::remote::pull_remote,
            commands::remote::fetch_remote,
            commands::remote::fetch_all,
            commands::remote::get_remotes,
            commands::blame::get_blame,
            commands::merge::merge_branch,
            commands::merge::rebase_branch,
            commands::merge::cherry_pick,
            commands::merge::get_conflict_files,
            commands::merge::get_conflict_content,
            commands::merge::resolve_conflict,
            commands::merge::clone_repo,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
