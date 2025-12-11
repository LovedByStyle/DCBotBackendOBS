// ============================================
// Cancel Notifier - Independent Chrome Extension
// No backend dependency - fully self-contained
// ============================================

// Configuration
let config = {
    backendUrl: '',
    dvsaPassword: '',
    jitterMin: 0.8,
    jitterMax: 1.5,
    commonSettings: {},
    localClickStats: {
        clicks_today: 0,
        last_reset_date: null
    },
    lastStopTime: null,
    lastActiveTime: null,
    remainingTime: 0
};

// State
let isRunning = false;
let isPaused = false; // Pause state for controlled reloads (different from stop)
let refreshTimer = null;
let countdownTimer = null; // Background countdown timer
let nextClickTimeout = null; // Store timeout for next scheduled click
let cooldownAlertSent = false; // Track if cooldown alert has been sent
let pendingReserveLinks = []; // Store reserve links to click sequentially
let clickStats = {
    next_available: 0,
    previous_available: 0,
    next_week: 0,
    previous_week: 0,
    total: 0
};
let logs = [];
const MAX_LOGS = 1000;

// Load config and state from storage
chrome.storage.local.get(['config', 'isRunning', 'clickStats', 'logs'], (result) => {
    if (result.config) {
        config = { ...config, ...result.config };
        
        // Initialize local click stats if not present
        if (!config.localClickStats) {
            config.localClickStats = {
                clicks_today: 0,
                last_reset_date: null
            };
        }
        
        // Reset clicks if it's a new day
        const today = new Date().toDateString();
        if (config.localClickStats.last_reset_date !== today) {
            config.localClickStats.clicks_today = 0;
            config.localClickStats.last_reset_date = today;
            chrome.storage.local.set({ config: config });
        }
        
        console.log('Config loaded:', config);
    }
    if (result.isRunning !== undefined) {
        isRunning = result.isRunning;
        console.log('🔄 Background script startup - isRunning:', isRunning, 'remainingTime:', config.remainingTime);
        if (isRunning) {
            console.log('🔄 Session was running, resuming event-driven session...');
            startEventDrivenBot();
            
            // Also resume background countdown if there's remaining time
            if (config.remainingTime > 0) {
                console.log('⏰ Resuming background countdown with', config.remainingTime, 'seconds...');
                // Only start countdown if it's not already running
                if (!countdownTimer) {
                    startBackgroundCountdown();
                } else {
                    console.log('⏰ Countdown already running, not restarting');
                }
            } else {
                console.log('⚠️ No remaining time, not resuming countdown');
            }
        } else {
            console.log('🛑 Session was not running, not resuming anything');
        }
    }
    if (result.clickStats) {
        clickStats = result.clickStats;
        console.log('Click stats loaded:', clickStats);
    }
    if (result.logs) {
        logs = result.logs;
        console.log(`Loaded ${logs.length} logs from storage`);
    }
});

// ============================================
// Message Handlers
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('📨 Message received:', message.action);

        switch (message.action) {
            case 'get_config':
                    sendResponse({
                        success: true,
                config: config,
                isRunning: isRunning,
                clickStats: clickStats,
                logs: logs
                });
                return true;
                
            case 'update_config':
            if (message.config) {
                config = { ...config, ...message.config };
                chrome.storage.local.set({ config: config }, () => {
                        if (chrome.runtime.lastError) {
                            console.log('Failed to save config:', chrome.runtime.lastError);
                            sendResponse({ success: false, error: chrome.runtime.lastError.message });
                        } else {
                            console.log('Config saved successfully');
                            sendResponse({ success: true });
                        }
                    });
                } else {
                    sendResponse({ success: false, error: 'No config provided' });
                }
                return true;
                
        case 'start_bot':
            startBot();
            sendResponse({ success: true });
            return true;

        case 'stop_bot':
            const skipAlertOnStop = message.skipAlert === true;
            stopBot(false, skipAlertOnStop); // false = manual stop, no cooldown needed
                sendResponse({ success: true });
                return true;
                
        case 'button_clicked':
            handleButtonClicked(message.buttonType);
                sendResponse({ success: true });
                return true;
                
            case 'slot_found':
            handleSlotFound(message.slotCount, message.period, message.source);
            sendResponse({ success: true });
            return true;

        case 'page_reload':
            handlePageReload(message.reason, message.clickCount, message.message);
            sendResponse({ success: true });
            return true;

        case 'hcaptcha_detected':
            handleHCaptchaDetected(message.sitekey, message.url, message.isReservation);
            sendResponse({ success: true });
            return true;

        case 'reservation_success':
            handleReservationSuccess(message.minutesRemaining, message.reservedCount, message.testCenter, message.slots);
                sendResponse({ success: true });
                return true;

        case 'slot_lost':
            handleSlotLost(message.locationInfo);
            sendResponse({ success: true });
            return true;

        case 'rate_limit_detected':
            handleRateLimitDetected(message.backoffSeconds);
            sendResponse({ success: true });
            return true;

        case 'captcha_detected':
            handleCaptchaDetected();
            sendResponse({ success: true });
            return true;

        case 'error15_detected':
            handleError15Detected();
            sendResponse({ success: true });
            return true;

        case 'update_remaining_time':
            config.remainingTime = message.remainingTime;
            chrome.storage.local.set({ config: config });
            sendResponse({ success: true });
            return true;
            
        case 'start_background_countdown':
            // Get fresh settings from the message
            if (message.maxRunningTime) {
                let shouldResetTime = false;

                // Check if enough time has passed since last activity (manual or auto stop)
                if (config.lastActiveTime) {
                    const lastActive = new Date(config.lastActiveTime);
                    const now = new Date();
                    const minutesPassed = (now - lastActive) / (1000 * 60);
                    const cooldownMinutes = config.commonSettings?.cooldown_time || 45;

                    if (minutesPassed > cooldownMinutes) {
                        console.log(`⏰ ${minutesPassed.toFixed(0)} minutes passed since last activity (cooldown: ${cooldownMinutes}m) - resetting to full time`);
                        shouldResetTime = true;
                        config.lastActiveTime = null; // Clear lastActiveTime
                        config.lastStopTime = null; // Clear lastStopTime
                    }
                }

                // Only reset remainingTime if it's 0 or undefined (fresh start) OR cooldown period passed
                if (!config.remainingTime || config.remainingTime <= 0 || shouldResetTime) {
                    config.remainingTime = message.maxRunningTime * 60; // Convert minutes to seconds
                    console.log(`⏰ Fresh start - using max running time: ${message.maxRunningTime} minutes (${config.remainingTime} seconds)`);
                } else {
                    console.log(`⏰ Resuming countdown with existing time: ${config.remainingTime} seconds`);
                }
                // Save the value to storage
                chrome.storage.local.set({ config: config });
            }
            startBackgroundCountdown();
            sendResponse({ success: true });
            return true;
            
        case 'get_remaining_time':
            // Return current remaining time from background script
            sendResponse({ remainingTime: config.remainingTime });
            return true;

        case 'pause_bot':
            // Pause clicking temporarily (for controlled page reloads)
            console.log('⏸️ Session paused (controlled reload)');
            isPaused = true;
            // Clear any pending click timeout
            if (nextClickTimeout) {
                clearTimeout(nextClickTimeout);
                nextClickTimeout = null;
            }
            logEvent('info', 'Session paused for controlled reload');
            sendResponse({ success: true });
            return true;

        case 'resume_bot':
            // Resume clicking after controlled page reload
            console.log('▶️ Session resumed (after controlled reload)');
            isPaused = false;
            // Immediately send next click command if session is still running
            if (isRunning) {
                sendRefreshCommand();
            }
            logEvent('info', 'Session resumed after controlled reload');
            sendResponse({ success: true });
            return true;

        case 'auto_start_after_reload':
            // Auto-resume session after search criteria refresh reload
            const skipAlertOnStart = message.skipAlert === true;
            console.log('🔄 Auto-resuming session after search criteria refresh');
            isPaused = false;
            isRunning = true;
            chrome.storage.local.set({ isRunning: true });
            updateIcon(true);

            // Resume countdown if we have remaining time and it's not already running
            if (config.remainingTime > 0 && !countdownTimer) {
                startBackgroundCountdown();
            }

            // IMPORTANT: Re-send deadline date to content script (it was lost during page reload!)
            chrome.tabs.query({ url: 'https://driver-services.dvsa.gov.uk/*' }, (tabs) => {
                if (tabs.length > 0) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        action: 'start',
                        deadlineDate: config.commonSettings?.deadline_date
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            console.log('Failed to reinitialize deadline date:', chrome.runtime.lastError.message);
                        } else {
                            console.log('✅ Deadline date reinitialized after reload');
                        }
                        // Send refresh command after deadline date is set
                        sendRefreshCommand();
                    });
                }
            });

            if (!skipAlertOnStart) {
                notifyBackendSessionStart();
            } else {
                console.log('⏭️ Skipping backend session start alert (controlled reload)');
            }
            logEvent('info', 'Session auto-resumed after search criteria refresh');
            sendResponse({ success: true });
            return true;

        case 'reserve_link_not_found':
            handleReserveLinkNotFound(message.slotLink, message.reason);
            sendResponse({ success: true });
            return true;

        case 'save_reserve_links':
            // Save reserve links to click sequentially
            pendingReserveLinks = message.links.slice(1); // Remove first link (already clicked)
            console.log(`📝 Saved ${pendingReserveLinks.length} pending reserve links`);
            sendResponse({ success: true });
            return true;

        case 'get_next_reserve_link':
            // Get next reserve link to click (after page reload)
            if (pendingReserveLinks.length > 0) {
                const nextLink = pendingReserveLinks.shift(); // Remove and return first link
                console.log(`🔗 Returning next reserve link (${pendingReserveLinks.length} remaining):`, nextLink);
                sendResponse({ success: true, link: nextLink, hasMore: pendingReserveLinks.length > 0 });
            } else {
                console.log('✅ No more pending reserve links');
                sendResponse({ success: false, link: null, hasMore: false });
            }
            return true;

            default:
            console.log('Unknown message action:', message.action);
                sendResponse({ success: false, error: 'Unknown action' });
                return true;
        }
});

// ============================================
// Session Control Functions
// ============================================

async function startBot() {
    isRunning = true;
    chrome.storage.local.set({ isRunning: true });
    updateIcon(true);
    startEventDrivenBot();
    startBackgroundCountdown();
    notifyBackendSessionStart();
    logEvent('info', 'Session started', { timestamp: new Date().toISOString() });
}

async function stopBot(completedFullDuration = false, skipAlert = false) {
    isRunning = false;
    chrome.storage.local.set({ isRunning: false });
    updateIcon(false);
    stopEventDrivenBot();
    stopBackgroundCountdown();

    // Always track last active time (for both manual and auto stops)
    config.lastActiveTime = new Date().toISOString();

    // Only set lastStopTime if session completed full duration (cooldown needed)
    // If user stopped early, don't set lastStopTime (no cooldown)
    if (completedFullDuration) {
        console.log('⏰ Session completed full duration - setting lastStopTime for cooldown');
        config.lastStopTime = new Date().toISOString();
    } else {
        console.log('⏸️ Session stopped manually - NOT setting lastStopTime (no cooldown needed)');
    }

    chrome.storage.local.set({ config: config });

    if (!skipAlert) {
        notifyBackendSessionEnd(clickStats.total);
    } else {
        console.log('⏭️ Skipping backend session end alert (controlled reload)');
    }

    logEvent('info', 'Session stopped', {
        timestamp: new Date().toISOString(),
        completedFullDuration: completedFullDuration,
        remainingTime: config.remainingTime
    });
}

// ============================================
// Background Countdown Timer
// ============================================

function startBackgroundCountdown() {
    console.log('⏰ Starting background countdown...');

    // Reset cooldown alert flag for new session
    cooldownAlertSent = false;

    // Check if countdown is already running
    if (countdownTimer) {
        console.log('⏰ Countdown already running, not restarting');
        return;
    }
    
    // Clear any existing timer
    if (countdownTimer) {
        clearInterval(countdownTimer);
    }
    
    // Use the remainingTime that was already set by the message (fresh from server)
    console.log(`⏰ Starting countdown with ${config.remainingTime} seconds remaining`);
    
    // Save to storage
    chrome.storage.local.set({ config: config });
    
    // Log that we're starting the timer
    console.log('⏰ Background countdown timer started, will run independently of popup');
    
    // Start countdown timer
    countdownTimer = setInterval(() => {
        if (config.remainingTime > 0) {
            config.remainingTime--;
            console.log(`Background countdown: ${config.remainingTime} seconds remaining`);

            // Save to storage
            chrome.storage.local.set({ config: config });

            // Note: Session complete alert will be sent by backend when session ends
            if (config.remainingTime <= 10 && !cooldownAlertSent) {
                console.log('⏰ Session ending soon - backend will send alert');
                cooldownAlertSent = true;
            }

            if (config.remainingTime <= 0) {
                console.log('⏰ Background countdown completed - stopping session');
                stopBot(true); // true = completed full duration, cooldown needed

                // Notify popup to show countdown alert (if popup is open)
                chrome.runtime.sendMessage({ action: 'countdown_completed' }, (response) => {
                    // Suppress error if popup is closed
                    if (chrome.runtime.lastError) {
                        console.log('Popup is closed, countdown alert will show when popup reopens');
                    }
                });
            }
        } else {
            // No time remaining, stop the timer
            stopBackgroundCountdown();
        }
    }, 1000);
}

function stopBackgroundCountdown() {
    console.log('⏰ Stopping background countdown...');
    if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
    }
}

function sendSessionStartAlerts() {
    // Alerts are now sent by backend from .env
}

function sendSessionCompleteAlerts() {
    // Alerts are now sent by backend from .env
}

// ============================================
// Auto-Refresh Timer
// ============================================

function startEventDrivenBot() {
    checkContentScriptReady();
}

function checkContentScriptReady() {
    chrome.tabs.query({ url: 'https://driver-services.dvsa.gov.uk/*' }, (tabs) => {
        if (tabs.length === 0) {
            return;
        }

        const tab = tabs[0];
        try {
            chrome.tabs.sendMessage(tab.id, { action: 'ping' }, (response) => {
                if (chrome.runtime.lastError) {
                    setTimeout(() => {
                        if (isRunning) {
                            checkContentScriptReady();
                        }
                    }, 2000);
                } else {
                    // Initialize content script with deadline date before first refresh
                    chrome.tabs.sendMessage(tab.id, {
                        action: 'start',
                        deadlineDate: config.commonSettings?.deadline_date
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            console.log('Failed to initialize content script:', chrome.runtime.lastError.message);
                        } else {
                            console.log('Content script initialized with deadline date:', config.commonSettings?.deadline_date);
                        }
                        // Start refreshing regardless
                        sendRefreshCommand();
                    });
                }
            });
        } catch (error) {
            // Silent error handling
        }
    });
}

function stopEventDrivenBot() {
    // Clear pending click timeout
    if (nextClickTimeout) {
        clearTimeout(nextClickTimeout);
        nextClickTimeout = null;
    }
}

// Handle response from content script and schedule next click
function handleClickResponse(response, customBackoffSeconds = null) {
    if (!isRunning || isPaused) {
        return;
    }

    // Clear any existing scheduled click first
    if (nextClickTimeout) {
        clearTimeout(nextClickTimeout);
        nextClickTimeout = null;
    }

    let delayMs;

    // If custom backoff is specified (e.g., rate limit), use it
    if (customBackoffSeconds !== null) {
        delayMs = customBackoffSeconds * 1000;
    } else {
        // Generate random jitter between min and max
        const jitter = Math.random() * (config.jitterMax - config.jitterMin) + config.jitterMin;
        delayMs = Math.round(jitter * 1000);
    }

    // Schedule next click after delay and store timeout ID
    nextClickTimeout = setTimeout(() => {
        nextClickTimeout = null; // Clear reference after execution
        if (isRunning && !isPaused) {
            sendRefreshCommand();
        }
    }, delayMs);
}

function sendRefreshCommand() {
    // Don't send commands if session is paused
    if (isPaused) {
        console.log('⏸️ Session is paused, skipping refresh command');
        return;
    }

    chrome.tabs.query({ url: 'https://driver-services.dvsa.gov.uk/*' }, (tabs) => {
        if (tabs.length === 0) {
            return;
        }

        const tab = tabs[0];
        try {
        chrome.tabs.sendMessage(tab.id, {
            action: 'refresh',
            timestamp: Date.now()
        }, (response) => {
                if (chrome.runtime.lastError) {
                    chrome.tabs.get(tab.id, (tabInfo) => {
                        if (chrome.runtime.lastError) {
                            return;
                        }
                        setTimeout(() => {
                            if (isRunning && !isPaused) {
                                sendRefreshCommand();
                            }
                        }, 3000);
                    });
                } else if (response) {
                    handleClickResponse(response);
                }
            });
        } catch (error) {
            // Silent error handling
        }
    });
}

// ============================================
// Event Handlers
// ============================================

async function handleButtonClicked(buttonType) {
    console.log(`🖱️ Button clicked: ${buttonType}`);

    // Update click stats
    if (clickStats[buttonType] !== undefined) {
        clickStats[buttonType]++;
        clickStats.total++;

        // Save to storage
        chrome.storage.local.set({ clickStats: clickStats });

        logEvent('info', `Button clicked: ${buttonType}`, {
            buttonType: buttonType,
            totalClicks: clickStats.total
        });

        // Reset daily clicks if it's a new day
        const today = new Date().toDateString();
        if (config.localClickStats.last_reset_date !== today) {
            config.localClickStats.clicks_today = 0;
            config.localClickStats.last_reset_date = today;
        }

        // Increment local click counter
        config.localClickStats.clicks_today++;
                        chrome.storage.local.set({ config: config });

        // Get max clicks from settings
        const maxClicks = config.commonSettings?.max_clicks || 9500;

        // Check if max clicks reached
        if (config.localClickStats.clicks_today >= maxClicks) {
            // Alerts are now sent by backend from .env
            stopBot(false);
        }
    }
}

function handleSlotFound(slotCount, period, source) {
    console.log(`🎯 SLOT FOUND! Count: ${slotCount}, Period: ${period}, Source: ${source}`);

    logEvent('success', `Slot found: ${slotCount} slot(s)`, {
        slotCount: slotCount,
        period: period,
        source: source
    });

    // Alerts are now sent by backend from .env
}

function handlePageReload(reason, clickCount, message) {
    console.log(`🔄 Page reload: ${reason}, Click count: ${clickCount}`);
    logEvent('info', message, { reason: reason, clickCount: clickCount });
}

function handleHCaptchaDetected(sitekey, url, isReservation) {
    console.log(`🔐 hCaptcha detected - Reservation: ${isReservation}`);

    logEvent('warning', isReservation ? 'hCaptcha detected during reservation' : 'hCaptcha detected', {
        sitekey: sitekey,
        url: url,
        isReservation: isReservation
    });

    if (isReservation) {
        // Alerts are now sent by backend from .env
    }
}

async function handleReservationSuccess(minutesRemaining, reservedCount, testCenter, slots) {
    console.log(`🎉 RESERVATION SUCCESS! Minutes remaining: ${minutesRemaining}`);

    // Stop timer immediately - slot secured, mission accomplished!
    stopBackgroundCountdown();
    console.log('⏰ Bot timer stopped - slot secured');

    logEvent('success', 'Test slot booked successfully', {
        minutesRemaining: minutesRemaining,
        reservedCount: reservedCount,
        testCenter: testCenter,
        slots: slots
    });

    // Notify backend for alerts (WhatsApp, Telegram, Discord)
    if (config.backendUrl) {
        try {
            await fetch(`${config.backendUrl}/api/bot/reservation-success`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    minutesRemaining: minutesRemaining,
                    reservedCount: reservedCount,
                    testCenter: testCenter || 'Unknown',
                    slots: slots || []
                })
            });
        } catch (error) {
            console.log('Failed to notify backend of reservation success:', error);
        }
    }

    // Stop the session completely
    stopBot(false);
}

async function handleSlotLost(locationInfo) {
    console.log(`⚠️ SLOT LOST! Location: ${locationInfo}`);

    logEvent('warning', 'Slot lost - no slots secured', {
        locationInfo: locationInfo
    });

    // Notify backend for alerts (Telegram, Discord)
    if (config.backendUrl) {
        try {
            await fetch(`${config.backendUrl}/api/bot/slot-lost`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    locationInfo: locationInfo
                })
            });
        } catch (error) {
            console.log('Failed to notify backend of slot lost:', error);
        }
    }
}

// ============================================
// Error Handlers
// ============================================

function handleRateLimitDetected(backoffSeconds) {
    // IMPORTANT: Clear any pending clicks immediately
    if (nextClickTimeout) {
        clearTimeout(nextClickTimeout);
        nextClickTimeout = null;
    }

    logEvent('warning', 'Rate limit detected', { backoffSeconds: backoffSeconds });
    // Alerts are now sent by backend from .env

    // Schedule next click after backoff
    handleClickResponse(null, backoffSeconds);
}

function handleCaptchaDetected() {
    // IMPORTANT: Clear any pending clicks immediately
    if (nextClickTimeout) {
        clearTimeout(nextClickTimeout);
        nextClickTimeout = null;
    }

    logEvent('error', 'Captcha detected - session stopped');
    // Alerts are now sent by backend from .env

    // Stop the session completely
    stopBot(false);
}

function handleError15Detected() {
    logEvent('error', 'Error 15 - session stopped');
    // Alerts are now sent by backend from .env
    stopBot(false);
}

function handleReserveLinkNotFound(slotLink, reason) {
    console.log('⚠️ Slot already taken:', reason);

    logEvent('warning', 'Slot already taken by someone else', {
        slotLink: slotLink,
        reason: reason
    });

    // Alerts are now sent by backend from .env
}

// ============================================
// Alert Functions - Removed (now handled by backend from .env)
// ============================================

// ============================================
// Backend Notification Functions
// ============================================

async function notifyBackendSessionStart() {
    if (!config.backendUrl) {
        console.log('Backend not configured - skipping session start notification');
        return;
    }

    try {
        const response = await fetch(`${config.backendUrl}/api/bot/start-session`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });

        if (response.ok) {
            console.log('✅ Backend notified: session started');
        } else {
            const error = await response.text();
            console.log('❌ Backend session start error:', error);
        }
    } catch (error) {
        console.log('❌ Backend session start error:', error);
    }
}

async function notifyBackendSessionEnd(clicksCount = 0) {
    if (!config.backendUrl) {
        console.log('Backend not configured - skipping session end notification');
        return;
    }

    try {
        const response = await fetch(`${config.backendUrl}/api/bot/end-session`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                clicks_count: clicksCount
            })
        });

        if (response.ok) {
            console.log('✅ Backend notified: session ended');
        } else {
            const error = await response.text();
            console.log('❌ Backend session end error:', error);
        }
    } catch (error) {
        console.log('❌ Backend session end error:', error);
    }
}

// ============================================
// Logging Functions
// ============================================

function logEvent(level, message, data = {}) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        level: level,
        message: message,
        data: data
    };

    logs.unshift(logEntry); // Add to beginning

    // Keep only last MAX_LOGS entries
    if (logs.length > MAX_LOGS) {
        logs = logs.slice(0, MAX_LOGS);
    }

    // Save to storage
    chrome.storage.local.set({ logs: logs });

    console.log(`[${level.toUpperCase()}] ${message}`, data);
}

// ============================================
// Icon Management
// ============================================

function updateIcon(running) {
    const iconPath = running ? 'icons/icon48.png' : 'icons/icon16.png';
    chrome.action.setIcon({ path: iconPath });

    if (running) {
        // Show green badge when bot is running (empty text = small green dot)
        chrome.action.setBadgeText({ text: ' ' }); // Single space creates a small badge
        chrome.action.setBadgeBackgroundColor({ color: '#00ff00' }); // Bright green color
        chrome.action.setTitle({ title: 'Cancel Notifier - Running' });
    } else {
        // Clear badge when bot is stopped
        chrome.action.setBadgeText({ text: '' });
        chrome.action.setTitle({ title: 'Cancel Notifier - Stopped' });
    }
}

// ============================================
// Cleanup on Shutdown
// ============================================

chrome.runtime.onSuspend.addListener(() => {
    if (refreshTimer) {
        clearInterval(refreshTimer);
    }
});

console.log('✅ Cancel Notifier background script loaded (independent mode)');
