#!/bin/bash

set -e

if [ "$EUID" -eq 0 ]; then
    SUDO=""
    RUN_AS_USER=""
else
    SUDO="sudo"
    RUN_AS_USER="sudo -u"
fi

echo "=========================================="
echo "Ubuntu 24 Installation Script"
echo "=========================================="
echo ""

ANYDESK_URL="https://download.anydesk.com/linux/anydesk_7.1.1-1_amd64.deb"
ANYDESK_DEB="/tmp/anydesk_7.1.1-1_amd64.deb"
USERNAME="dcobs"
PASSWORD="hiklkiQAWSEDRFtg2"
INSTALL_DIR="/home/${USERNAME}/chextension"
BASE_URL="https://obs.drivecircle.co.uk"

echo "📦 Step 1: Installing prerequisites..."
if ! command -v unzip &> /dev/null; then
    $SUDO apt-get update -qq
    $SUDO apt-get install -y unzip curl
    echo "✅ Prerequisites installed"
else
    echo "✅ Prerequisites already installed"
fi
echo ""

echo "📦 Step 2: Downloading AnyDesk..."
curl -L -o "$ANYDESK_DEB" "$ANYDESK_URL"

if [ ! -f "$ANYDESK_DEB" ]; then
    echo "❌ Failed to download AnyDesk"
    exit 1
fi
echo "✅ AnyDesk downloaded"
echo ""

echo "📦 Step 3: Installing AnyDesk..."
$SUDO dpkg -i "$ANYDESK_DEB" || $SUDO apt-get install -f -y
echo "✅ AnyDesk installed"
echo ""

echo "👤 Step 4: Creating user ${USERNAME}..."
if id "$USERNAME" &>/dev/null; then
    echo "⚠️  User ${USERNAME} already exists, skipping creation"
else
    $SUDO useradd -m -s /bin/bash "$USERNAME"
    echo "$USERNAME:$PASSWORD" | $SUDO chpasswd
    echo "✅ User ${USERNAME} created"
fi
echo ""

echo "📥 Step 5: Downloading Chrome extension..."
if [ -n "$RUN_AS_USER" ]; then
    $RUN_AS_USER "$USERNAME" mkdir -p "$INSTALL_DIR"
    ZIP_FILE="${INSTALL_DIR}/chextension.zip"
    $RUN_AS_USER "$USERNAME" curl -L -o "$ZIP_FILE" "${BASE_URL}/chdownload"
else
    mkdir -p "$INSTALL_DIR"
    chown "$USERNAME:$USERNAME" "$INSTALL_DIR"
    ZIP_FILE="${INSTALL_DIR}/chextension.zip"
    runuser -u "$USERNAME" -- curl -L -o "$ZIP_FILE" "${BASE_URL}/chdownload"
fi

if [ ! -f "$ZIP_FILE" ]; then
    echo "❌ Failed to download Chrome extension"
    exit 1
fi
echo "✅ Chrome extension downloaded"
echo ""

echo "📦 Step 6: Extracting Chrome extension..."
if [ -n "$RUN_AS_USER" ]; then
    $RUN_AS_USER "$USERNAME" unzip -q -o "$ZIP_FILE" -d "$INSTALL_DIR"
    $RUN_AS_USER "$USERNAME" rm -f "$ZIP_FILE"
else
    runuser -u "$USERNAME" -- unzip -q -o "$ZIP_FILE" -d "$INSTALL_DIR"
    runuser -u "$USERNAME" -- rm -f "$ZIP_FILE"
fi
echo "✅ Chrome extension extracted to ${INSTALL_DIR}"
echo ""

echo "🧹 Step 7: Cleaning up..."
rm -f "$ANYDESK_DEB"
echo "✅ Cleanup complete"
echo ""

echo "=========================================="
echo "✅ Installation Complete!"
echo "=========================================="
echo ""
echo "User: ${USERNAME}"
echo "Password: ${PASSWORD}"
echo "Chrome extension location: ${INSTALL_DIR}"
echo ""

