/*
KWin Script Application Switcher - PATCHED VERSION
(C) 2022 Natalie Clarius <natalie_clarius@yahoo.de>
GNU General Public License v3.0

Patches by RedBearAK:
- Fixed initialization bug that disrupts stacking order on script startup
- Preserves relative stacking order within application groups when raising
*/

///////////////////////
// initialization
///////////////////////

// const debugMode = readConfig("debugMode", true);
const debugMode = readConfig("debugMode", false);

function debug(...args) {
    if (debugMode) { console.debug("applicationswitcher:", ...args); }
}
debug("initializing");

// Detect KDE version
const isKDE6 = typeof workspace.windowList === 'function';

function isAppOnCurrentDesktopKDE6(window) {
    return window &&
    (window.desktops && window.desktops.includes(workspace.currentDesktop)) ||
    (window.desktops && window.desktops.length === 0);
}

function isAppOnCurrentDesktopKDE5(window) {
    return window &&
    (window.x11DesktopIds && window.x11DesktopIds.includes(workspace.currentDesktop)) ||
    (window.x11DesktopIds && window.x11DesktopIds.length === 0);
}

let activeWindow;
let windowList;
let connectWindowActivated;
let setActiveWindow;
let isAppOnCurrentDesktop;

// Set up aliases to abstract away the API differences between KDE 5 and KDE 6
if (isKDE6) {
    activeWindow                = () => workspace.activeWindow;
    windowList                  = () => workspace.windowList();
    connectWindowActivated      = (handler) => workspace.windowActivated.connect(handler);
    setActiveWindow             = (window) => { workspace.activeWindow = window; };
    isAppOnCurrentDesktop       = isAppOnCurrentDesktopKDE6
} else {
    activeWindow                = () => workspace.activeClient;
    windowList                  = () => workspace.clientList();
    connectWindowActivated      = (handler) => workspace.clientActivated.connect(handler);
    setActiveWindow             = (window) => { workspace.activeClient = window; };
    isAppOnCurrentDesktop       = isAppOnCurrentDesktopKDE5
}

///////////////////////
// special applications to ignore
///////////////////////

const ignoredApps = ["plasmashell", "org.kde.plasmashell", // desktop shell
                     "krunner", "org.kde.krunner", // KRunner
                     "kwin_wayland", // lock screen
                     "org.kde.ksmserver-logout-greeter", // logout screen
                     "ksplashqml" // login splash screen
                    ];


///////////////////////
// get application a window belongs to
///////////////////////

// "dolphin"
function getApp(current) {
    if (!current || typeof current.resourceClass !== 'string') return "";
    return String(current.resourceClass).toLowerCase();
}


///////////////////////
// keep track of active application (to check whether app has been switched)
///////////////////////

// "dolphin"
var prevActiveApp = ""

// PATCHED: Initialize properly to avoid spurious app switches on startup
function initializePrevActiveApp() {
    try {
        const active = activeWindow();
        if (active) {
            let app = getApp(active);
            if (app && app !== "") {
                prevActiveApp = app;
                debug("initialized with active app:", prevActiveApp);
                return;
            }
        }
    } catch (err) {
        debug("error getting active window during initialization:", err);
    }
    
    // Fallback: use sentinel value that won't match any real app
    prevActiveApp = "__KWIN_SCRIPT_INITIALIZING__";
    debug("no active window on startup, using sentinel");
}

// set previously active application for recently activated window
function setPrevActiveApp(current) {
    if (!current) return;
    prevActiveApp = getApp(current);
}

// get previously active application
function getPrevActiveApp() {
    return prevActiveApp;
}


///////////////////////
// keep track of windows belonging to same application in order of activation
///////////////////////

// {"dolphin": [oldest window, ..., most recent window], "konsole": ...}
var appGroups = {};

// compute app groups for initially present windows
try {
    let initialWindows = windowList();
    if (Array.isArray(initialWindows)) {
        initialWindows.forEach(window => updateAppGroups(window));
        debug("initialized", Object.keys(appGroups).length, "app groups");
    } else {
        debug("warning: windowList() did not return an array");
    }
} catch (err) {
    debug("error initializing app groups:", err);
}

// update app groups with given window
function updateAppGroups(current) {
    if (!current) return;
    
    let app = getApp(current);
    if (!app) {
        debug("warning: window has no app identifier, skipping");
        return;
    }
    
    if (!appGroups[app]) {
        appGroups[app] = [];
    }
    
    // Ensure appGroups[app] is an array before filtering
    if (!Array.isArray(appGroups[app])) {
        debug("warning: appGroups[" + app + "] is not an array, resetting");
        appGroups[app] = [];
    }
    
    appGroups[app] = appGroups[app].filter(window => window && window != current);
    appGroups[app].push(current);
    
    if (Array.isArray(appGroups[app])) {
        debug("updating app group", appGroups[app].map(window =>
            window && window.caption ? window.caption : "undefined window"
        ));
    }
}

function isAppOnCurrentActivity(window) {
    if (!window) return false;
    try {
        return (window.activities && window.activities.includes(workspace.currentActivity)) ||
                (window.activities && window.activities.length === 0);
    } catch (err) {
        debug("error checking activity for window:", err);
        return false;
    }
}

function getFilterConditions(window) {
    try {
        return window && !window.minimized && 
                isAppOnCurrentDesktop(window) && isAppOnCurrentActivity(window);
    } catch (err) {
        debug("error in filter conditions:", err);
        return false;
    }
}

// return other visible windows of same application as given window
function getAppGroup(current) {
    if (!current) return [];

    let app = getApp(current);
    if (!app || !appGroups[app]) return [];

    let unfilteredAppGroup = appGroups[app];
    
    if (!Array.isArray(unfilteredAppGroup)) return [];
    
    debug("unfiltered app group", unfilteredAppGroup.map(window =>
        window && window.caption ? window.caption : "undefined window"));

    let appGroup = unfilteredAppGroup.filter(getFilterConditions);

    debug("filtered app group", appGroup.map(window =>
        window && window.caption ? window.caption : "undefined window"
    ));
    return appGroup;
}


///////////////////////
// main
///////////////////////

// when client is activated, auto-raise other windows of the same application
function onWindowActivated(active) {
    try {
        if (!active) return;
        debug("---------");
        debug("activated", active.caption);
        debug("app", getApp(active));
        // abort if application is ignored
        if (ignoredApps.includes(getApp(active))) {
            debug("ignored");
            return;
        }
        updateAppGroups(active);

        // if application was switched
        debug("previous app", getPrevActiveApp());
        if (getApp(active) != getPrevActiveApp()) {
            debug("app switched");
            setPrevActiveApp(active);
            
            // PATCHED: Get app windows and sort by stacking order to preserve relative positions
            let appWindows = getAppGroup(active);
            
            // Guard: ensure we have an array with windows
            if (!Array.isArray(appWindows) || appWindows.length === 0) {
                debug("no app windows to raise");
                return;
            }
            
            // Guard: verify all windows have stackingOrder property before sorting
            let hasStackingOrder = appWindows.every(window => 
                window && typeof window.stackingOrder === 'number'
            );
            
            if (hasStackingOrder) {
                try {
                    // Sort by current stacking order (lower numbers = lower in stack)
                    appWindows.sort((a, b) => a.stackingOrder - b.stackingOrder);
                    debug("raising", appWindows.length, "windows in stacking order");
                } catch (err) {
                    debug("error sorting by stacking order:", err, "- raising in default order");
                }
            } else {
                debug("stackingOrder not available on all windows - raising in default order");
            }
            
            // auto-raise other windows of same application
            for (let window of appWindows) {
                if (window) {
                    try {
                        if (hasStackingOrder) {
                            debug("auto-raising", window.caption, "at stack position", window.stackingOrder);
                        } else {
                            debug("auto-raising", window.caption);
                        }
                        setActiveWindow(window);
                    } catch (err) {
                        debug("error raising window", window.caption, ":", err);
                    }
                }
            }
        }
    } catch (err) {
        debug("error in onWindowActivated:", err);
    }
}

connectWindowActivated(onWindowActivated);

// PATCHED: Initialize after all functions are defined and abstractions are set up
try {
    initializePrevActiveApp();
} catch (err) {
    debug("error during initialization:", err);
    // Set safe default
    prevActiveApp = "__KWIN_SCRIPT_INITIALIZING__";
}

debug("script initialization complete");

// End of file #
