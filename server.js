require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const Database = require('./lib/database');
const AlertCenter = require('./lib/alertCenter');

const app = express();

// Configuration
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/dvsa-bot';

// Initialize database
const db = new Database(MONGODB_URI);

// Initialize AlertCenter (will be set after loading settings)
let alertCenter = null;


// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ============================================
// UI Routes
// ============================================

app.get('/', (req, res) => {
    res.render('unified-dashboard');
});

app.get('/settings', (req, res) => {
    res.redirect('/');
});

app.get('/accounts', (req, res) => {
    res.redirect('/');
});

// ============================================
// API Routes - Common Settings
// ============================================

app.get('/api/settings/common', async (req, res) => {
    try {
        const settings = await db.getCommonSettings();
        res.json({ success: true, settings });
    } catch (error) {
        console.error(`GET /api/settings/common error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to get settings' });
    }
});

app.post('/api/settings/common', async (req, res) => {
    try {
        const { jitter_min, jitter_max, max_clicks, max_running_time, cooldown_time, deadline_date } = req.body;

        const settings = await db.updateCommonSettings({
            jitter_min: jitter_min || 0.8,
            jitter_max: jitter_max || 1.5,
            max_clicks: max_clicks || 9500,
            max_running_time: max_running_time !== undefined ? max_running_time : 20,
            cooldown_time: cooldown_time || 45,
            deadline_date: deadline_date ? new Date(deadline_date) : null
        });

        console.log('Common settings updated');
        res.json({ success: true, settings });
    } catch (error) {
        console.error(`POST /api/settings/common error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to update settings' });
    }
});


// ============================================
// Bot Session API Routes
// ============================================


// Start bot session
app.post('/api/bot/start-session', async (req, res) => {
    try {
        console.log('Session started');
        
        // Send alert if AlertCenter is initialized
        if (alertCenter) {
            const settings = await db.getCommonSettings();
            const maxRunningTime = settings.max_running_time || 20;
            
            const message = `🚀 Session started!\n\n⏰ Max Running Time: ${maxRunningTime} minutes\n✅ Actively searching for slots`;
            
            try {
                await alertCenter.telegram.sendMessage(`🚀 Session Started\n\n${message}`);
                await alertCenter.discord.sendMessage(message, '🚀 Session Started');
            } catch (alertError) {
                console.error(`Failed to send session start alert: ${alertError.message}`);
            }
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error(`POST /api/bot/start-session error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to start bot session' });
    }
});

// End bot session
app.post('/api/bot/end-session', async (req, res) => {
    try {
        const { clicks_count } = req.body;
        
        console.log('Session ended');
        
        // Send alert if AlertCenter is initialized
        if (alertCenter) {
            const settings = await db.getCommonSettings();
            const cooldownMinutes = settings.cooldown_time || 45;
            
            const message = `😴 Session complete, taking a break!\n\n⏰ Cooldown: ${cooldownMinutes} minutes\n🔄 Switch to another Chrome profile to continue`;
            
            try {
                await alertCenter.telegram.sendMessage(`😴 Session Complete\n\n${message}`);
                await alertCenter.discord.sendMessage(message, '😴 Session Complete');
            } catch (alertError) {
                console.error(`Failed to send session end alert: ${alertError.message}`);
            }
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error(`POST /api/bot/end-session error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to end bot session' });
    }
});

// Reservation success notification
app.post('/api/bot/reservation-success', async (req, res) => {
    try {
        const { minutesRemaining, reservedCount, testCenter, slots } = req.body;
        
        console.log(`Reservation success: ${reservedCount} slot(s), ${minutesRemaining} minutes remaining`);
        
        // Send alert if AlertCenter is initialized
        if (alertCenter) {
            try {
                await alertCenter.notifyReservationSuccess(testCenter || 'Unknown', slots || [], minutesRemaining, reservedCount);
            } catch (alertError) {
                console.error(`Failed to send reservation success alert: ${alertError.message}`);
            }
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error(`POST /api/bot/reservation-success error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to send reservation success notification' });
    }
});

// Slot lost notification
app.post('/api/bot/slot-lost', async (req, res) => {
    try {
        const { locationInfo } = req.body;
        
        console.log(`Slot lost: ${locationInfo}`);
        
        // Send alert if AlertCenter is initialized
        if (alertCenter) {
            try {
                await alertCenter.notifySlotLost(locationInfo);
            } catch (alertError) {
                console.error(`Failed to send slot lost alert: ${alertError.message}`);
            }
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error(`POST /api/bot/slot-lost error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to send slot lost notification' });
    }
});

// ============================================
// Test Message Endpoint
// ============================================

app.post('/api/settings/test-message', async (req, res) => {
    try {
        if (!alertCenter) {
            return res.status(400).json({ 
                success: false, 
                message: 'AlertCenter not initialized. Check your .env configuration.' 
            });
        }

        const testMessage = '🧪 Test message from DVSA Control Center\n\nThis is a test to verify all notification channels are working correctly.';

        const results = {
            telegram: false,
            discord: false,
            whatsapp: false
        };

        // Send to Telegram
        try {
            await alertCenter.telegram.sendMessage(`🧪 Test Message\n\n${testMessage}`);
            results.telegram = true;
        } catch (error) {
            console.error(`Telegram test failed: ${error.message}`);
        }

        // Send to Discord
        try {
            await alertCenter.discord.sendMessage(testMessage, '🧪 Test Message');
            results.discord = true;
        } catch (error) {
            console.error(`Discord test failed: ${error.message}`);
        }

        // Send to WhatsApp
        try {
            await alertCenter.whatsapp.sendMessage('Test message: All channels working');
            results.whatsapp = true;
        } catch (error) {
            console.error(`WhatsApp test failed: ${error.message}`);
        }

        const successCount = Object.values(results).filter(Boolean).length;
        const totalChannels = Object.keys(results).length;

        console.log(`Test message sent: ${successCount}/${totalChannels} channels successful`);

        res.json({ 
            success: true, 
            message: `Test message sent to ${successCount}/${totalChannels} channels`,
            results: results
        });
    } catch (error) {
        console.error(`POST /api/settings/test-message error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to send test message' });
    }
});

// ============================================
// Health Check Endpoints
// ============================================

app.get('/health', (req, res) => {
    const healthData = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.version,
        environment: process.env.NODE_ENV || 'development'
    };

    console.log(`Health check requested from ${req.ip}`);
    res.status(200).json(healthData);
});

app.get('/ping', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString()
    });
});

// ============================================
// Chrome Extension Download
// ============================================

app.get('/chdownload', (req, res) => {
    const chextensionPath = path.join(__dirname, 'public', 'chextension');
    
    // Check if directory exists
    if (!fs.existsSync(chextensionPath)) {
        return res.status(404).json({ success: false, message: 'Chrome extension directory not found' });
    }

    // Set response headers for zip download
    const zipFileName = `chextension-${Date.now()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);

    // Create archiver instance
    const archive = archiver('zip', {
        zlib: { level: 9 }
    });

    // Handle archive errors
    archive.on('error', (err) => {
        console.error('Archive error:', err);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Failed to create zip file' });
        }
    });

    // Pipe archive data to response
    archive.pipe(res);

    // Add directory to archive (recursively)
    archive.directory(chextensionPath, false);

    // Finalize the archive
    archive.finalize();
});

// ============================================
// Ubuntu Installation Endpoint
// ============================================

app.get('/install', async (req, res) => {
    try {
        const scriptPath = path.join(__dirname, 'ubuntu-install.sh');
        
        if (!fs.existsSync(scriptPath)) {
            return res.status(404).json({ 
                success: false, 
                message: 'Installation script not found' 
            });
        }

        fs.chmodSync(scriptPath, '755');

        console.log('Starting Ubuntu installation...');
        
        res.status(200).json({ 
            success: true, 
            message: 'Installation started. Check server logs for progress.' 
        });

        execAsync(`bash ${scriptPath}`, {
            maxBuffer: 1024 * 1024 * 10,
            timeout: 300000
        })
        .then(({ stdout, stderr }) => {
            console.log('Installation completed successfully');
            console.log(stdout);
            if (stderr) {
                console.error('Installation stderr:', stderr);
            }
        })
        .catch((error) => {
            console.error('Installation failed:', error.message);
            if (error.stdout) console.log('stdout:', error.stdout);
            if (error.stderr) console.error('stderr:', error.stderr);
        });

    } catch (error) {
        console.error(`GET /install error: ${error.message}`);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to start installation' 
        });
    }
});

// ============================================
// Error Handling
// ============================================

app.use((req, res) => {
    res.status(404).json({ success: false, message: 'Not found' });
});

app.use((err, req, res, next) => {
    console.error(`Unhandled error: ${err.message}`);
    res.status(500).json({ success: false, message: 'Internal server error' });
});

// ============================================
// Graceful Shutdown
// ============================================

process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    db.close();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    db.close();
    process.exit(0);
});

// ============================================
// Session Monitoring
// ============================================


// ============================================
// Start Server
// ============================================

async function startServer() {
    try {
        // Connect to MongoDB
        await db.connect();
        console.log('Database connected successfully');

        // Initialize AlertCenter with .env variables
        const telegramToken = process.env.TELEGRAM_TOKEN || '';
        const telegramChatId = process.env.TELEGRAM_CHAT_ID || '';
        const discordWebhook = process.env.DISCORD_WEBHOOK || '';
        const whatsappInstanceId = process.env.WHATSAPP_INSTANCE_ID || '';
        const whatsappApiToken = process.env.WHATSAPP_API_TOKEN || '';
        const whatsappChatId = process.env.WHATSAPP_CHAT_ID || '';
        
        alertCenter = new AlertCenter(
            telegramToken,
            telegramChatId,
            discordWebhook,
            whatsappInstanceId,
            whatsappApiToken,
            whatsappChatId
        );
        console.log('AlertCenter initialized from .env');

        // Start HTTP server only if not on Vercel (Vercel handles the server)
        if (!process.env.VERCEL) {
            app.listen(PORT, '0.0.0.0', () => {
                console.log(`DVSA Bot Backend running on port ${PORT}`);
                console.log(`Dashboard: http://localhost:${PORT}`);
            });
        }
    } catch (error) {
        console.error(`Failed to start server: ${error.message}`);
        process.exit(1);
    }
}

// Initialize server (for both Vercel and local)
startServer().catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});

// Export app for Vercel
module.exports = app;
