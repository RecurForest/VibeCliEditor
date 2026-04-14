use std::path::{Path, PathBuf};

pub fn path_to_string(path: &Path) -> String {
    strip_windows_verbatim_prefix(&path.to_string_lossy())
}

pub fn path_for_shell(path: &Path) -> PathBuf {
    PathBuf::from(path_to_string(path))
}

fn strip_windows_verbatim_prefix(value: &str) -> String {
    #[cfg(windows)]
    {
        const VERBATIM_DISK_PREFIX: &str = "\\\\?\\";
        const VERBATIM_UNC_PREFIX: &str = "\\\\?\\UNC\\";

        if let Some(stripped) = value.strip_prefix(VERBATIM_UNC_PREFIX) {
            return format!("\\\\{stripped}");
        }

        if let Some(stripped) = value.strip_prefix(VERBATIM_DISK_PREFIX) {
            return stripped.to_string();
        }
    }

    value.to_string()
}
