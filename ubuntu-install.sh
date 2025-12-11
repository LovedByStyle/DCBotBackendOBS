#!/bin/bash

set -e

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
    apt-get update -qq
    apt-get install -y unzip curl
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
dpkg -i "$ANYDESK_DEB" || apt-get install -f -y
echo "✅ AnyDesk installed"
echo ""

echo "👤 Step 4: Creating user ${USERNAME}..."
if id "$USERNAME" &>/dev/null; then
    echo "⚠️  User ${USERNAME} already exists, skipping creation"
else
    useradd -m -s /bin/bash "$USERNAME"
    echo "$USERNAME:$PASSWORD" | chpasswd
    echo "✅ User ${USERNAME} created"
fi
echo ""

echo "📥 Step 5: Downloading Chrome extension..."
mkdir -p "$INSTALL_DIR"
chown "$USERNAME:$USERNAME" "$INSTALL_DIR"
ZIP_FILE="${INSTALL_DIR}/chextension.zip"
runuser -u "$USERNAME" -- curl -L -o "$ZIP_FILE" "${BASE_URL}/chdownload"

if [ ! -f "$ZIP_FILE" ]; then
    echo "❌ Failed to download Chrome extension"
    exit 1
fi
echo "✅ Chrome extension downloaded"
echo ""

echo "📦 Step 6: Extracting Chrome extension..."
runuser -u "$USERNAME" -- unzip -q -o "$ZIP_FILE" -d "$INSTALL_DIR"
runuser -u "$USERNAME" -- rm -f "$ZIP_FILE"
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

