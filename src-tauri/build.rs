fn main() {
    // Cargo otherwise has no dependency edge from the build script to the
    // platform icon sources. Re-run Tauri's build integration when they
    // change so development restarts and bundles do not retain a stale Dock /
    // Start Menu icon.
    println!("cargo:rerun-if-changed=icons/icon.icns");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=Info.plist");
    println!("cargo:rerun-if-changed=windows-app-manifest.xml");

    // tauri-build 2.6.3 embeds the manifest through bin-only resources. Library
    // test harnesses then load comctl32 v5 and fail before main (0xc0000139).
    // Let MSVC embed the same manifest in every final target instead. Disable
    // only Tauri's resource manifest to avoid a duplicate RT_MANIFEST; its icon
    // and version resources are still generated normally.
    // https://github.com/tauri-apps/tauri/issues/13419
    let windows_msvc = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    if windows_msvc {
        let manifest = std::path::PathBuf::from(
            std::env::var_os("CARGO_MANIFEST_DIR").expect("Cargo must provide CARGO_MANIFEST_DIR"),
        )
        .join("windows-app-manifest.xml");
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
        tauri_build::try_build(
            tauri_build::Attributes::new()
                .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest()),
        )
        .expect("failed to build Tauri resources");
    } else {
        tauri_build::build();
    }
}
