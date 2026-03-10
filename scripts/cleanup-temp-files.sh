#!/bin/bash

# Script to clean up leaked temporary files from the securebuild service
# This should be run to clean up files that were leaked before the fix

TEMP_DIR="/tmp"
CLEANED_COUNT=0

echo "Cleaning up leaked temporary files in $TEMP_DIR..."

# Clean up apkindex-*.tar.gz files (from GetAPKIndex and GetAPK functions)
for file in "$TEMP_DIR"/apkindex-*.tar.gz; do
    if [ -f "$file" ]; then
        echo "Removing leaked apkindex file: $file"
        rm -f "$file"
        ((CLEANED_COUNT++))
    fi
done

# Clean up apk-index-*.tar.gz files (from AddAPKToIndex function)
for file in "$TEMP_DIR"/apk-index-*.tar.gz; do
    if [ -f "$file" ]; then
        echo "Removing leaked apk-index file: $file"
        rm -f "$file"
        ((CLEANED_COUNT++))
    fi
done

# Clean up package* files (from test-package.go processRemoteFile function)
# Be careful to only remove files that match the pattern from our leak
for file in "$TEMP_DIR"/package[0-9]*; do
    if [ -f "$file" ]; then
        # Check if it's really a temp file (no extension and numeric suffix)
        basename_file=$(basename "$file")
        if [[ "$basename_file" =~ ^package[0-9]+$ ]]; then
            echo "Removing leaked package file: $file"
            rm -f "$file"
            ((CLEANED_COUNT++))
        fi
    fi
done

# Clean up pkginfo-*.json files (from builder build.go)
for file in "$TEMP_DIR"/pkginfo-*.json; do
    if [ -f "$file" ]; then
        echo "Removing leaked pkginfo file: $file"
        rm -f "$file"
        ((CLEANED_COUNT++))
    fi
done

# Clean up builder_key* files (from start-ssh-session.go)
for file in "$TEMP_DIR"/builder_key*; do
    if [ -f "$file" ]; then
        echo "Removing leaked builder key file: $file"
        rm -f "$file"
        ((CLEANED_COUNT++))
    fi
done

echo "Cleanup completed. Removed $CLEANED_COUNT leaked temporary files."

if [ $CLEANED_COUNT -eq 0 ]; then
    echo "No leaked temporary files found."
else
    echo "Note: These files were leaked due to improper cleanup in the application."
    echo "This issue has been fixed in the latest code changes."
fi
