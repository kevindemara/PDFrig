// Intentionally no renderer-supplied URL, file, verb, parameters or working directory.
const PROFILE_URL: &str = "https://github.com/kevindemara";

fn open_fixed_profile(open: impl FnOnce(&[u16], &[u16]) -> isize) -> Result<(), &'static str> {
    let verb = "open\0".encode_utf16().collect::<Vec<_>>();
    let url = PROFILE_URL.encode_utf16().chain([0]).collect::<Vec<_>>();
    if open(&verb, &url) > 32 {
        Ok(())
    } else {
        Err("NATIVE_PROFILE_OPEN_FAILED")
    }
}

// Synchronous Tauri commands run on the UI thread, where WebView2 initializes COM.
#[tauri::command]
pub fn open_developer_profile() -> Result<(), &'static str> {
    #[cfg(windows)]
    {
        use std::ptr::null;
        use std::ptr::null_mut;
        use windows_sys::Win32::UI::Shell::ShellExecuteW;

        open_fixed_profile(|verb, url| {
            // SAFETY: both owned strings are NUL-terminated and live through the call.
            // No executable, shell arguments, elevation verb or caller-controlled input.
            unsafe {
                ShellExecuteW(null_mut(), verb.as_ptr(), url.as_ptr(), null(), null(), 1) as isize
            }
        })
    }
    #[cfg(not(windows))]
    Err("NATIVE_PROFILE_OPEN_FAILED")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_only_the_fixed_https_profile_with_the_open_verb() {
        assert_eq!(
            open_fixed_profile(|verb, url| {
                assert_eq!(String::from_utf16_lossy(verb), "open\0");
                assert_eq!(
                    String::from_utf16_lossy(url),
                    "https://github.com/kevindemara\0"
                );
                33
            }),
            Ok(())
        );
    }

    #[test]
    fn shell_failures_return_only_a_safe_error_code() {
        for code in [0, 2, 5, 31, 32] {
            assert_eq!(
                open_fixed_profile(|_, _| code),
                Err("NATIVE_PROFILE_OPEN_FAILED")
            );
        }
    }
}
