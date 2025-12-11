#!/bin/bash

# DVSA Control Center - Installation Script for CentOS
# Run this on your VPS

echo "=========================================="
echo "DVSA Control Center - Installation"
echo "=========================================="
echo ""

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    echo "⚠️  Please don't run as root. Run as regular user."
    exit 1
fi

# Check OS
if [ ! -f /etc/centos-release ]; then
    echo "⚠️  This script is for CentOS. Detected different OS."
    read -p "Continue anyway? (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo "📦 Step 1: Installing Node.js..."
curl -sL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs

# Verify Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js installation failed"
    exit 1
fi

NODE_VERSION=$(node --version)
echo "✅ Node.js installed: $NODE_VERSION"
echo ""

echo "📦 Step 2: Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ npm install failed"
    exit 1
fi
echo "✅ Dependencies installed"
echo ""

echo "🔧 Step 3: Setting up environment..."
if [ ! -f .env ]; then
    cp .env.example .env
    echo "✅ Created .env file"
    echo ""
    echo "⚠️  IMPORTANT: Edit .env file with your settings:"
    echo "   nano .env"
    echo ""
    echo "   You need to add:"
    echo "   - TELEGRAM_TOKEN (from @BotFather)"
    echo "   - TELEGRAM_CHAT_ID (from @userinfobot)"
    echo ""
else
    echo "✅ .env already exists"
fi

echo "🔥 Step 4: Setting up PM2..."
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
    echo "✅ PM2 installed"
else
    echo "✅ PM2 already installed"
fi
echo ""

echo "🔒 Step 5: Configuring firewall..."
sudo firewall-cmd --permanent --add-port=3000/tcp 2>/dev/null
sudo firewall-cmd --reload 2>/dev/null
echo "✅ Port 3000 opened"
echo ""

echo "=========================================="
echo "✅ Installation Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Configure Telegram:"
echo "   nano .env"
echo ""
echo "2. Start the server:"
echo "   npm start"
echo ""
echo "   OR for production:"
echo "   pm2 start server.js --name dvsa-control"
echo "   pm2 save"
echo "   pm2 startup"
echo ""
echo "3. Access dashboard:"
echo "   http://$(hostname -I | awk '{print $1}'):3000"
echo ""
echo "4. Install Chrome extension on your laptop"
echo ""
echo "📖 Read QUICKSTART.md for detailed instructions"
echo ""
