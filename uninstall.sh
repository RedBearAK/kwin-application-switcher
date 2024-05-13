#!/usr/bin/env bash


# This is a script to remove an installed KWin script matching a script found in the current folder

exit_w_error() {
    local msg="$1"
    echo -e "\nERROR: ${msg} \nExiting...\n"
    exit 1
}

unload_script() {
    echo "Attempting to unload KWin script '${script_name}' prior to removal."

    local success=0

    if command -v qdbus &> /dev/null; then
        qdbus org.kde.KWin /KWin unloadScript "${script_name}"
        success=$?
    elif command -v gdbus &> /dev/null; then
        gdbus call --session --dest org.kde.KWin --object-path /KWin \
                    --method org.kde.KWin.unloadScript "${script_name}"
        success=$?
    elif command -v dbus-send &> /dev/null; then
        dbus-send --session --type=method_call --dest=org.kde.KWin /KWin \
                    org.kde.KWin.unloadScript string:"${script_name}"
        success=$?
    else
        echo "No available D-Bus utility to unload the KWin script."
        echo "You may need to log out to remove the KWin script from memory."
        success=1  # Indicates failure to unload due to lack of tools
    fi


    if [[ $success -eq 0 ]]; then
        echo "Successfully unloaded the KWin script."
    else
        echo "ERROR: Failed to unload the KWin script. Look for an error displayed above."
        echo "Uninstalling the script now may leave it active in memory until you log out."
        read -r -p "Continue with uninstalling the script files anyway? [y/N]: " response
        case $response in
            [Yy]* )
                echo "Proceeding with removal. The KWin script might still be active in memory."
                ;;
            * )
                echo "Try to unload the script manually from GUI KWin Scripts settings panel."
                exit_w_error "Run this script again to uninstall, or click trash icon in GUI and Apply."
                ;;
        esac
    fi
}

remove_w_kpackagetool6() {
    if ! command -v kpackagetool6 &> /dev/null; then
        exit_w_error "The 'kpackagetool6' command is missing. Cannot remove KWin script."
    else
        echo "Removing '${script_name}' KWin script."
        kpackagetool6 --type=${script_type} --remove "${script_name}"
    fi
}

remove_w_kpackagetool5() {
    if ! command -v kpackagetool5 &> /dev/null; then
        exit_w_error "The 'kpackagetool5' command is missing. Cannot remove KWin script."
    else
        echo "Removing '${script_name}' KWin script."
        kpackagetool5 --type=${script_type} --remove "${script_name}"
    fi
}

KDE_ver=${KDE_SESSION_VERSION:-0}   # Default to zero value if environment variable not set
script_type="KWin/Script"
script_name=""


if [ -f "./metadata.json" ]; then
    script_name=$(grep -oP '"Id":\s*"[^"]*' ./metadata.json | grep -oP '[^"]*$')
elif [ -f "./metadata.desktop" ]; then
    script_name=$(grep '^X-KDE-PluginInfo-Name=' ./metadata.desktop | cut -d '=' -f2)
else
    exit_w_error "No suitable metadata file found. Unable to get script name."
fi


if [[ $KDE_ver -eq 0 ]]; then
    echo "KDE_SESSION_VERSION environment variable was not set."
    exit_w_error "Cannot remove '${script_name}' KWin script."
elif [[ $KDE_ver -eq 6 ]]; then
    unload_script
    if ! remove_w_kpackagetool6; then
        exit_w_error "Problem while removing '${script_name}' KWin script."
    fi
    echo "KWin script '${script_name}' was removed."
elif [[ ${KDE_ver} -eq 5 ]]; then
    unload_script
    if ! remove_w_kpackagetool5; then
        exit_w_error "Problem while removing '${script_name}' KWin script."
    fi
    echo "KWin script '${script_name}' was removed."
else
    echo "KDE_SESSION_VERSION had a value, but that value was unrecognized: '${KDE_ver}'"
    exit_w_error "This script is meant to run only on KDE 5 or 6."
fi


sleep 0.5

# We need to gracefully cascade through common D-Bus utils to 
# find one that is available to use for the KWin reconfigure 
# command. Sometimes 'qdbus' is not available.

# Array of command names of common D-Bus utilities
dbus_commands=("qdbus" "gdbus" "dbus-send")

reconfigure_w_qdbus() {
    qdbus org.kde.KWin /KWin reconfigure
}

reconfigure_w_gdbus() {
    gdbus call --session --dest org.kde.KWin --object-path /KWin --method org.kde.KWin.reconfigure
}

reconfigure_w_dbus_send() {
    dbus-send --session --type=method_call --dest=org.kde.KWin /KWin org.kde.KWin.reconfigure
}

# Iterate through the dbus_commands array
for cmd in "${dbus_commands[@]}"; do
    if command -v "${cmd}" &> /dev/null; then
        # Call the corresponding function based on the command
        echo "Refreshing KWin configuration."
        case "$cmd" in
            qdbus)              reconfigure_w_qdbus &> /dev/null;;
            gdbus)              reconfigure_w_gdbus &> /dev/null ;;
            dbus-send)          reconfigure_w_dbus_send &> /dev/null ;;
        esac
        sleep 0.5
        # Break out of the loop once a command is found and executed
        break
    fi
done

echo "Finished removing KWin script: '${script_name}'"
