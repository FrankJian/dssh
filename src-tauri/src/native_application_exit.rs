//! Bridge Cocoa terminate: (including Dock Quit) into the same two-phase guard.
//! AppKit owns the delegate; add only its previously absent optional callback.
use std::{
    ffi::{c_char, c_void},
    sync::{
        OnceLock,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::{AppHandle, Manager};

static APPLICATION: OnceLock<AppHandle> = OnceLock::new();
static PENDING: AtomicBool = AtomicBool::new(false);
type TerminateCallback = unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void) -> usize;
#[link(name = "objc")]
unsafe extern "C" {
    fn objc_getClass(name: *const c_char) -> *mut c_void;
    fn object_getClass(object: *mut c_void) -> *mut c_void;
    fn sel_registerName(name: *const c_char) -> *mut c_void;
    fn class_addMethod(
        class: *mut c_void,
        selector: *mut c_void,
        callback: TerminateCallback,
        types: *const c_char,
    ) -> i8;
    fn objc_msgSend(receiver: *mut c_void, selector: *mut c_void) -> *mut c_void;
}

// SAFETY: Called by AppKit on the main thread with the documented NSUInteger
// applicationShouldTerminate:(NSApplication *) ABI. No Objective-C object is retained.
unsafe extern "C" fn should_terminate(_: *mut c_void, _: *mut c_void, _: *mut c_void) -> usize {
    let Some(app) = APPLICATION.get() else {
        return 0;
    };
    if app
        .state::<crate::application_exit::ApplicationExit>()
        .allowed()
    {
        return 1;
    }
    PENDING.store(true, Ordering::SeqCst);
    crate::application_exit::ApplicationExit::request(app, 0);
    2 // NSTerminateLater: reply explicitly after every workbench has decided.
}

pub fn install(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    // Tauri setup runs on the AppKit main thread. These no-argument selectors
    // return borrowed objects; the existing delegate and every other method stay intact.
    let added = unsafe {
        let application = objc_msgSend(
            objc_getClass(c"NSApplication".as_ptr()),
            sel_registerName(c"sharedApplication".as_ptr()),
        );
        let delegate = objc_msgSend(application, sel_registerName(c"delegate".as_ptr()));
        !delegate.is_null()
            && class_addMethod(
                object_getClass(delegate),
                sel_registerName(c"applicationShouldTerminate:".as_ptr()),
                should_terminate,
                c"Q@:@".as_ptr(),
            ) != 0
    };
    if !added {
        return Err(std::io::Error::other("无法初始化系统退出保护。").into());
    }
    APPLICATION
        .set(app.clone())
        .map_err(|_| std::io::Error::other("系统退出保护已初始化。"))?;
    Ok(())
}

/// Return true when Cocoa is awaiting (and will receive) its termination reply.
pub fn finish(app: &AppHandle, approved: bool) -> bool {
    if !PENDING.swap(false, Ordering::SeqCst) {
        return false;
    }
    let application_handle = app.clone();
    app.run_on_main_thread(move || {
        if approved {
            application_handle
                .state::<crate::app::AppState>()
                .rdp
                .close_owner(None);
        }
        // SAFETY: AppKit requires this reply on the main thread. BOOL is signed
        // char on Intel and bool on ARM; both use a one-byte 0/1 argument here.
        unsafe {
            let application = objc_msgSend(
                objc_getClass(c"NSApplication".as_ptr()),
                sel_registerName(c"sharedApplication".as_ptr()),
            );
            let reply: unsafe extern "C" fn(*mut c_void, *mut c_void, i8) = std::mem::transmute(
                objc_msgSend as unsafe extern "C" fn(*mut c_void, *mut c_void) -> *mut c_void,
            );
            reply(
                application,
                sel_registerName(c"replyToApplicationShouldTerminate:".as_ptr()),
                i8::from(approved),
            );
        }
    })
    .is_ok()
}
