fn main() {
    // Cargo otherwise has no dependency edge from the build script to the
    // platform icon sources. Re-run Tauri's build integration when they
    // change so development restarts and bundles do not retain a stale Dock /
    // Start Menu icon.
    println!("cargo:rerun-if-changed=icons/icon.icns");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build()
}
