// DOM Elements
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const lastUpdateDiv = document.getElementById('lastUpdate');
const clickProgressSection = document.getElementById('clickProgressSection');
const progressFill = document.getElementById('progressFill');
const currentClicks = document.getElementById('currentClicks');
const maxClicks = document.getElementById('maxClicks');

// Backend URLs to try (in order)
const BACKEND_URLS = [
    'http://localhost:3000',
    'https://obs.drivecircle.co.uk'
];

// State
let commonSettings = {};
let connectedBackendUrl = '';
let localClickStats = {
    clicks_today: 0,
    last_reset_date: null
};
let countdownTimer = null;
let remainingTime = 0; // seconds
let lastStopTime = null; // When session was last stopped
let maxRunningTimeMinutes = 20; // Default, will be updated from settings
let cooldownTimeMinutes = 45; // Default, will be updated from settings
let maxClicksValue = 9500; // Default, will be updated from settings

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'countdown_completed') {
        console.log('⏰ Countdown completed message received from background');
        // Update UI to show countdown alert
        if (countdownTimer) {
            clearInterval(countdownTimer);
            countdownTimer = null;
        }
        remainingTime = 0;
        updateLEDDisplay();
        updateBotStatus(false, false);
        showCountdownAlert();
        sendResponse({ received: true });
    }
    return true;
});

// Helper function to hide loading and show main UI
let uiShown = false;
function showMainUI() {
    if (uiShown) return; // Only show once
    uiShown = true;

    const loadingOverlay = document.getElementById('loadingOverlay');
    const mainContainer = document.getElementById('mainContainer');

    if (mainContainer) {
        mainContainer.style.visibility = 'visible';
        // Small delay to ensure DOM is ready
        setTimeout(() => {
            mainContainer.style.opacity = '1';
        }, 10);
    }
    if (loadingOverlay) {
        setTimeout(() => {
            loadingOverlay.style.display = 'none';
        }, 100);
    }
}

// Fallback: Show UI after 300ms even if config doesn't load
setTimeout(() => {
    showMainUI();
}, 300);

// Load saved state
chrome.runtime.sendMessage({ action: 'get_config' }, (response) => {
    if (response && response.config) {
        const { config, isRunning } = response;

        if (config.backendUrl) {
            connectedBackendUrl = config.backendUrl;
            lastUpdateDiv.textContent = `Connected to: ${connectedBackendUrl}`;
            lastUpdateDiv.style.color = '#48bb78';
        }

        // Load local click stats
        if (config.localClickStats) {
            localClickStats = config.localClickStats;
            // Reset if it's a new day
            const today = new Date().toDateString();
            if (localClickStats.last_reset_date !== today) {
                localClickStats.clicks_today = 0;
                localClickStats.last_reset_date = today;
            }
                updateProgressBar();
        }

        if (config.commonSettings) {
            commonSettings = config.commonSettings;
            maxRunningTimeMinutes = config.commonSettings.max_running_time || 20;
            cooldownTimeMinutes = config.commonSettings.cooldown_time || 45;
            maxClicksValue = config.commonSettings.max_clicks || 9500;
            maxClicks.textContent = maxClicksValue;
        }

        // Load persisted clock state
        if (config.lastStopTime) {
            lastStopTime = new Date(config.lastStopTime);
        }
        if (config.remainingTime && !isNaN(config.remainingTime)) {
            remainingTime = config.remainingTime;
            console.log(`🔄 Loaded remainingTime from config: ${remainingTime} seconds`);
        } else {
            remainingTime = 0;
            console.log('⚠️ No valid remainingTime in config, setting to 0');
        }

        // If session is running, fetch current remaining time from background script FIRST
        if (isRunning) {
            console.log('🔄 Session is running, fetching current remaining time from background...');
            chrome.runtime.sendMessage({ action: 'get_remaining_time' }, (response) => {
                console.log('🔄 Background response:', response);
                if (response && response.remainingTime !== undefined) {
                    remainingTime = response.remainingTime;
                    console.log(`🔄 Synced remaining time from background: ${remainingTime} seconds`);
                    showLEDClock();
                    updateLEDDisplay();
                    
                    // Don't start a new countdown - just sync with background
                    console.log('🔄 Popup will sync with background countdown, not start its own');
                    
                    // Start periodic sync with background script
                    startBackgroundSync();
                } else {
                    console.log('⚠️ No valid remaining time from background');
                }
                
                // Update button state AFTER getting background response
                // Pass isSyncing=true to prevent countdown reset
                updateBotStatus(isRunning, true);
            });
        } else {
            console.log('🛑 Session is not running, not fetching remaining time');
            // Update button state immediately for stopped session
            updateBotStatus(isRunning, false);
            
            // If session is not running but we have remaining time, show the clock
            if (remainingTime > 0) {
                showLEDClock();
                updateLEDDisplay();
            }
        }
        
        // If session is not running and no remaining time, show countdown alert
        if (!isRunning && remainingTime <= 0) {
            showCountdownAlert();
        }
        
        // Check if in cooldown period when popup opens
        // IMPORTANT: Only show cooldown notification if session completed full running time (remainingTime = 0)
        if (!isRunning && lastStopTime && remainingTime <= 0) {
            const now = new Date();
            const timeSinceStop = (now.getTime() - lastStopTime.getTime()) / (1000 * 60); // minutes
            const cooldownTimeRequired = cooldownTimeMinutes;

            if (timeSinceStop < cooldownTimeRequired) {
                const remainingCooldownTime = cooldownTimeRequired - timeSinceStop;
                const remainingMinutes = Math.ceil(remainingCooldownTime);
                showNotification(`😴 Session complete, need to take a break! Try again in ${remainingMinutes} minutes.`, 'info');
            }
        }
    }

    // IMPORTANT: Always show UI after config is loaded (even if config is empty)
    showMainUI();
});

// Try to fetch settings from a backend URL
async function tryFetchSettingsFromBackend(url) {
    try {
        const settingsResponse = await fetch(`${url}/api/settings/common`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });

        if (!settingsResponse.ok) {
            throw new Error(`HTTP ${settingsResponse.status}`);
        }

        const settingsData = await settingsResponse.json();

        if (!settingsData.success) {
            throw new Error('Invalid settings response');
        }

        return {
            success: true,
            url: url,
            settings: settingsData.settings
        };
    } catch (error) {
        console.log(`Failed to connect to ${url}:`, error.message);
        return { success: false, url: url, error: error.message };
    }
}

startBtn.addEventListener('click', async () => {
    // Get config first
    chrome.runtime.sendMessage({ action: 'get_config' }, async (response) => {
        if (!response || !response.config) {
            showNotification('Failed to get configuration', 'error');
        return;
    }
        
        const config = response.config;

    // Check if DVSA site tab exists
    const tabs = await new Promise((resolve) => {
        chrome.tabs.query({}, (tabs) => {
            resolve(tabs);
        });
    });

    const dvsaTab = tabs.find(tab => tab.url && tab.url.includes('driver-services.dvsa.gov.uk'));
    
    if (!dvsaTab) {
        showNotification('❌ No DVSA site tab found. Please open driver-services.dvsa.gov.uk first', 'error');
        return;
    }

    // Check if click limit reached
    const today = new Date().toDateString();
    if (localClickStats.last_reset_date !== today) {
        localClickStats.clicks_today = 0;
        localClickStats.last_reset_date = today;
    }
    
    if (localClickStats.clicks_today >= maxClicksValue) {
        showNotification(`Max click limit reached (${localClickStats.clicks_today}/${maxClicksValue})! Please wait until tomorrow.`, 'error');
        return;
    }

    // Check DVSA tab count BEFORE starting
    const dvsaTabs = await new Promise((resolve) => {
        chrome.tabs.query({ url: 'https://driver-services.dvsa.gov.uk/*' }, (tabs) => {
            resolve(tabs);
        });
    });

    if (dvsaTabs.length === 0) {
        showNotification('❌ No DVSA tab found. Please open driver-services.dvsa.gov.uk first', 'error');
        return;
    }

    if (dvsaTabs.length > 1) {
        showNotification(`❌ Multiple DVSA tabs detected (${dvsaTabs.length} tabs). Please close extra tabs and keep only ONE DVSA tab open.`, 'error');
        return;
    }

    // Fetch latest common settings from server
    showNotification('Fetching latest settings...', 'info');
    
    let settingsResult = null;
    for (const url of BACKEND_URLS) {
        try {
            const settingsResponse = await fetch(`${url}/api/settings/common`, {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });

            if (settingsResponse.ok) {
                const settingsData = await settingsResponse.json();
                if (settingsData.success) {
                    settingsResult = settingsData.settings;
                    connectedBackendUrl = url;
                    break;
                }
            }
        } catch (error) {
            console.log(`Failed to fetch settings from ${url}:`, error.message);
        }
    }

    if (!settingsResult) {
        showNotification('⚠️ Using cached settings (could not fetch latest)', 'info');
    } else {
        // Update cached settings
        commonSettings = settingsResult;
        maxRunningTimeMinutes = settingsResult.max_running_time || 20;
        cooldownTimeMinutes = settingsResult.cooldown_time || 45;
            
            maxClicksValue = settingsResult.max_clicks || 9500;
            maxClicks.textContent = maxClicksValue;
        
        chrome.runtime.sendMessage({
            action: 'update_config',
            config: {
                backendUrl: connectedBackendUrl,
                commonSettings: settingsResult,
                jitterMin: settingsResult.jitter_min || 0.8,
                    jitterMax: settingsResult.jitter_max || 1.5
            }
        });
        showNotification('✅ Latest settings loaded', 'success');
    }

    // Check cooldown period before starting
    if (!checkCooldownPeriod()) {
            return; // Cooldown validation failed, don't start session
    }

        // Start the session
    chrome.runtime.sendMessage({ action: 'start_bot' }, (response) => {
        if (response && response.success) {
            // Check if we should reset the countdown based on cooldown period
            const shouldResetClock = checkBreakTime();

            if (shouldResetClock) {
                // Cooldown period passed - reset to full time
                console.log('⏰ Cooldown period passed - resetting to full time');
                remainingTime = 0; // Reset so background will use fresh maxRunningTime
                lastStopTime = null;
                chrome.runtime.sendMessage({
                    action: 'update_config',
                    config: {
                        remainingTime: 0,
                        lastStopTime: null
                    }
                });
            } else {
                // Resume from remaining time
                console.log(`⏰ Resuming from remaining time: ${remainingTime} seconds`);
                // Clear lastStopTime since we're resuming
                lastStopTime = null;
                chrome.runtime.sendMessage({
                    action: 'update_config',
                    config: { lastStopTime: null }
                });
            }

                showNotification('Session started!', 'success');
                hideCountdownAlert(); // Hide alert when session starts
                updateBotStatus(true, false); // isSyncing=false because we're actually starting the session
            // Start background countdown (will use remainingTime or reset based on above logic)
            chrome.runtime.sendMessage({
                action: 'start_background_countdown',
                maxRunningTime: maxRunningTimeMinutes
            });
        } else {
                showNotification(response?.error || 'Failed to start session', 'error');
        }
        });
    });
});

// Stop Session button
stopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'stop_bot' }, (response) => {
        if (response && response.success) {
            // Note: lastStopTime is managed by background.js based on whether
            // session completed full duration or was stopped manually
            console.log(`Session stopped by user - remaining time: ${remainingTime}`);
            showNotification('Session stopped!', 'success');
            updateBotStatus(false, false);
        } else {
            showNotification('Failed to stop session', 'error');
        }
    });
});



// Update bot status UI
// Removed duplicate function - using the main one below

// Show notification
function showNotification(message, type) {
    // Remove any existing notifications first
    const existingNotifications = document.querySelectorAll('.notification');
    existingNotifications.forEach(notif => notif.remove());
    
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.className = 'notification';
    
    // Set background color based on type
    let backgroundColor;
    if (type === 'success') {
        backgroundColor = '#48bb78';
    } else if (type === 'error') {
        backgroundColor = '#f56565';
    } else if (type === 'info') {
        backgroundColor = '#4299e1';
    } else {
        backgroundColor = '#718096';
    }
    
    notification.style.cssText = `
        position: fixed;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        padding: 12px 20px;
        background: ${backgroundColor};
        color: white;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 1000;
        opacity: 0;
        transition: opacity 0.3s ease;
        max-width: 90%;
        text-align: center;
    `;

    document.body.appendChild(notification);

    // Fade in
    setTimeout(() => {
        notification.style.opacity = '1';
    }, 10);

    // Fade out and remove
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 300);
    }, 2500);
}

// Update click stats from background
function updateClickStats() {
    chrome.runtime.sendMessage({ action: 'get_config' }, (response) => {
        if (response && response.config && response.config.localClickStats) {
            const today = new Date().toDateString();
            localClickStats = response.config.localClickStats;
            
            // Reset if it's a new day
            if (localClickStats.last_reset_date !== today) {
                localClickStats.clicks_today = 0;
                localClickStats.last_reset_date = today;
            }
            
            updateProgressBar();
        }
    });
}

// Update progress bar display
function updateProgressBar() {
    const progressPercent = Math.min((localClickStats.clicks_today / maxClicksValue) * 100, 100);
    
    // Update progress bar
    progressFill.style.width = `${progressPercent}%`;
    
    // Update color based on progress
    progressFill.classList.remove('warning', 'danger');
    if (progressPercent >= 90) {
        progressFill.classList.add('danger');
    } else if (progressPercent >= 70) {
        progressFill.classList.add('warning');
    }
    
    // Update text
    currentClicks.textContent = localClickStats.clicks_today;
    maxClicks.textContent = maxClicksValue;
}

// Periodically update click stats
setInterval(() => {
    updateClickStats();
}, 2000);

// LED Clock Functions
function showLEDClock() {
    const countdownSection = document.getElementById('countdownSection');
    countdownSection.style.display = 'flex';
}

function hideLEDClock() {
    const countdownSection = document.getElementById('countdownSection');
    countdownSection.style.display = 'none';
    if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
    }
}

function startCountdown(minutes) {
    console.log(`Starting countdown for ${minutes} minutes`);
    remainingTime = minutes * 60; // Convert to seconds
    console.log(`Initial remaining time: ${remainingTime} seconds`);
    showLEDClock();
    updateLEDDisplay();

    // Send initial time to background script
    chrome.runtime.sendMessage({
        action: 'update_remaining_time',
        remainingTime: remainingTime
    });

    // Start a display-only timer that syncs with background
    countdownTimer = setInterval(() => {
        // Get current time from background script
        chrome.runtime.sendMessage({ action: 'get_config' }, (response) => {
            if (response && response.config && response.config.remainingTime !== undefined) {
                remainingTime = response.config.remainingTime;
                updateLEDDisplay();

                if (remainingTime <= 0) {
                    clearInterval(countdownTimer);
                    countdownTimer = null;
                    updateBotStatus(false, false);
                    showCountdownAlert();
                }
            }
        });
    }, 1000);
}

function resumeCountdown() {
    console.log(`Resuming countdown with ${remainingTime} seconds remaining`);
    updateLEDDisplay();

    // Start a display-only timer that syncs with background
    countdownTimer = setInterval(() => {
        // Get current time from background script
        chrome.runtime.sendMessage({ action: 'get_config' }, (response) => {
            if (response && response.config && response.config.remainingTime !== undefined) {
                remainingTime = response.config.remainingTime;
                updateLEDDisplay();

                if (remainingTime <= 0) {
                    clearInterval(countdownTimer);
                    countdownTimer = null;
                    updateBotStatus(false, false);
                    showCountdownAlert();
                }
            }
        });
    }, 1000);
}

function startBackgroundSync() {
    console.log('🔄 Starting background sync timer...');
    
    // Clear any existing sync timer
    if (countdownTimer) {
        clearInterval(countdownTimer);
    }
    
    // Start a display-only timer that syncs with background
    countdownTimer = setInterval(() => {
        // Get current time from background script
        chrome.runtime.sendMessage({ action: 'get_remaining_time' }, (response) => {
            if (response && response.remainingTime !== undefined) {
                remainingTime = response.remainingTime;
                updateLEDDisplay();
                
                if (remainingTime <= 0) {
                    clearInterval(countdownTimer);
                    countdownTimer = null;
                    showCountdownAlert();
                }
            }
        });
    }, 1000);
}

function checkBreakTime() {
    // IMPORTANT: Only check break time if session completed full running time (remainingTime = 0)
    // If session was stopped early (remainingTime > 0), always reset clock to remaining time
    if (remainingTime > 0) {
        console.log('Session was stopped early - NOT resetting clock, will resume from remaining time');
        return false; // Resume clock, don't reset
    }

    if (!lastStopTime) {
        console.log('No previous stop time - resetting clock');
        return true; // Reset clock
    }

    const now = new Date();
    const timeSinceStop = (now.getTime() - lastStopTime.getTime()) / (1000 * 60); // minutes
    const cooldownTimeRequired = cooldownTimeMinutes;

    console.log(`Time since last stop: ${timeSinceStop.toFixed(1)} minutes, cooldown required: ${cooldownTimeRequired} minutes`);

    if (timeSinceStop >= cooldownTimeRequired) {
        console.log('Enough cooldown time has passed - resetting clock');
        return true; // Reset clock
    } else {
        const remainingCooldownTime = cooldownTimeRequired - timeSinceStop;
        console.log(`Not enough cooldown time - need ${remainingCooldownTime.toFixed(1)} more minutes`);
        return false; // Resume clock
    }
}

function checkCooldownPeriod() {
    console.log('🔍 Cooldown check - lastStopTime:', lastStopTime);
    console.log('🔍 Cooldown check - remainingTime:', remainingTime);
    console.log('🔍 Cooldown check - cooldownTimeMinutes:', cooldownTimeMinutes);

    // IMPORTANT: Only enforce cooldown if session completed full running time (remainingTime = 0)
    // If session was stopped early (remainingTime > 0), allow immediate restart
    if (remainingTime > 0) {
        console.log('✅ Session was stopped early - remaining time exists - no cooldown required');
        return true; // No cooldown needed if session didn't complete full duration
    }

    if (!lastStopTime) {
        console.log('✅ No previous stop time - cooldown check passed');
        return true; // No cooldown needed
    }

    const now = new Date();
    const timeSinceStop = (now.getTime() - lastStopTime.getTime()) / (1000 * 60); // minutes
    const cooldownTimeRequired = cooldownTimeMinutes;

    console.log('🔍 Time since stop:', timeSinceStop.toFixed(1), 'minutes');
    console.log('🔍 Cooldown required:', cooldownTimeRequired, 'minutes');

    if (timeSinceStop < cooldownTimeRequired) {
        const remainingCooldownTime = cooldownTimeRequired - timeSinceStop;
        const remainingMinutes = Math.ceil(remainingCooldownTime);
        console.log('❌ Cooldown not met - remaining:', remainingMinutes, 'minutes');
        showNotification(`⏰ Cooldown period active! Please wait ${remainingMinutes} more minutes before starting the session.`, 'error');
        return false; // Cooldown not met
    }

    console.log('✅ Cooldown period passed');
    return true; // Cooldown period passed
}

function showCountdownAlert() {
    const countdownAlert = document.getElementById('countdownAlert');
    if (countdownAlert) {
        countdownAlert.style.display = 'block';
    }
}

function hideCountdownAlert() {
    const countdownAlert = document.getElementById('countdownAlert');
    if (countdownAlert) {
        countdownAlert.style.display = 'none';
    }
}

function updateLEDDisplay() {
    // Validate remainingTime
    if (isNaN(remainingTime) || remainingTime === undefined || remainingTime === null) {
        console.log('⚠️ remainingTime is invalid:', remainingTime);
        remainingTime = 0;
    }
    
    // If countdown is 0, hide clock and show alert
    if (remainingTime <= 0) {
        hideLEDClock();
        showCountdownAlert();
        return;
    }
    
    const minutes = Math.floor(remainingTime / 60);
    const seconds = remainingTime % 60;
    
    const minutesTens = Math.floor(minutes / 10);
    const minutesOnes = minutes % 10;
    const secondsTens = Math.floor(seconds / 10);
    const secondsOnes = seconds % 10;
    
    // Update LED digits with animation
    updateLEDDigit('led-minutes-tens', minutesTens);
    updateLEDDigit('led-minutes-ones', minutesOnes);
    updateLEDDigit('led-seconds-tens', secondsTens);
    updateLEDDigit('led-seconds-ones', secondsOnes);
    
    // Update label - always show "Remaining Time"
    const countdownLabel = document.querySelector('.countdown-label');
    countdownLabel.textContent = 'Remaining Time';
}

function updateLEDDigit(elementId, value) {
    const element = document.getElementById(elementId);
    if (element.textContent !== value.toString()) {
        element.classList.add('changing');
        element.textContent = value;
        setTimeout(() => {
            element.classList.remove('changing');
        }, 300);
    }
}

// Update session status to show/hide LED clock
function updateBotStatus(running, isSyncing = false) {
    if (running) {
        startBtn.style.display = 'none';
        stopBtn.style.display = 'flex';

        // Hide countdown alert when session starts
        hideCountdownAlert();

        // Only check break time and reset countdown if NOT syncing with background
        if (!isSyncing) {
            // Check if we should reset or resume the clock
            const shouldResetClock = checkBreakTime();

            if (shouldResetClock) {
                // Reset to full time
                console.log(`🔧 Session started - resetting clock to ${maxRunningTimeMinutes} minutes`);
                console.log(`🔧 Settings loaded: max_running_time = ${maxRunningTimeMinutes}`);
                startCountdown(maxRunningTimeMinutes);
            } else {
                // Resume from where we left off
                console.log(`Session started - resuming clock with ${remainingTime} seconds remaining`);
                if (remainingTime > 0) {
                    showLEDClock();
                    resumeCountdown();
                } else {
                    startCountdown(maxRunningTimeMinutes);
                }
            }
        } else {
            // When syncing, countdown is already managed by startBackgroundSync()
            console.log('🔄 Syncing mode - not resetting countdown, using background timer');
        }
    } else {
        startBtn.style.display = 'flex';
        stopBtn.style.display = 'none';
        // Stop the countdown but keep clock visible
        if (countdownTimer) {
            console.log('🔍 Clearing countdownTimer in updateBotStatus(false)');
            clearInterval(countdownTimer);
            countdownTimer = null;
            console.log('🔍 countdownTimer set to null');
        }

        // Don't set lastStopTime here - this is just the popup opening, not an actual session stop
        // lastStopTime should only be set when the user actually stops the session
        console.log(`Session status: stopped, remaining time: ${remainingTime} seconds`);

        // Update the LED display to show "Remaining Time" instead of "Running Time"
        updateLEDDisplay();
    }
}

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideDown {
        from {
            transform: translate(-50%, -100%);
            opacity: 0;
        }
        to {
            transform: translate(-50%, 0);
            opacity: 1;
        }
    }

    @keyframes slideUp {
        from {
            transform: translate(-50%, 0);
            opacity: 1;
        }
        to {
            transform: translate(-50%, -100%);
            opacity: 0;
        }
    }

    .btn-success {
        background-color: #48bb78;
        color: white;
    }

    .btn-success:hover {
        background-color: #38a169;
    }
`;
document.head.appendChild(style);
