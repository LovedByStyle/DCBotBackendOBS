// DVSA Page Interaction Script

// Event-driven session system - no state management needed

// ⚠️ CRITICAL: Only run in top frame, not iframes
if (window.top !== window.self) {
    throw new Error('Content script should only run in top frame');
}

// Listen for messages from XHR hook
window.addEventListener('message', (event) => {
    // Handle slot found message
    if (event.data.type === 'DVSA_SLOT_FOUND') {
        // Process slot IMMEDIATELY!
        handleDirectReservation(event.data.slotLink);
    }

    // Handle rate limit - backoff 10 seconds
    else if (event.data.type === 'DVSA_RATE_LIMIT') {
        chrome.runtime.sendMessage({ action: 'rate_limit_detected', backoffSeconds: 10 });
    }

    // Handle captcha - stop session (no reload, user must solve manually)
    else if (event.data.type === 'DVSA_CAPTCHA') {
        chrome.runtime.sendMessage({ action: 'captcha_detected' });
        // Don't reload - let user solve captcha manually
    }

    // Handle Error 15 - stop session
    else if (event.data.type === 'DVSA_ERROR15') {
        chrome.runtime.sendMessage({ action: 'error15_detected' });
    }
});

// Check for pending reserve links when page loads (after clicking a reserve button)
function checkPendingReserveLinks() {
    chrome.runtime.sendMessage({ action: 'get_next_reserve_link' }, (response) => {
        if (chrome.runtime.lastError) {
            console.log('Failed to get pending reserve links:', chrome.runtime.lastError.message);
            return;
        }

        if (response && response.success && response.link) {
            console.log(`⏳ Found pending reserve link, clicking in 500ms (${response.hasMore ? 'more remaining' : 'last one'})`);
            // Wait 500ms before clicking next reserve button
            setTimeout(() => {
                console.log('🎯 Clicking next reserve button:', response.link);
                window.location.replace(response.link);
            }, 500);
        } else {
            console.log('✅ No pending reserve links, normal operation');
        }
    });
}

// Check for pending links on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(checkPendingReserveLinks, 100); // Small delay to ensure page is ready
    });
} else {
    setTimeout(checkPendingReserveLinks, 100);
}

// Handle direct reservation workflow
async function handleDirectReservation(slotLink) {
    try {
        const response = await fetch(slotLink, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });

        const html = await response.text();

        // Extract ALL reserve buttons (multiple slots on daily page)
        const reserveLinks = [];
        let searchPos = 0;

        while (true) {
            const reservePos = html.indexOf('_eventId=reserveSlot', searchPos);
            if (reservePos === -1) break;

            // Search backward for href="
            let hrefStart = html.lastIndexOf('href="', reservePos);
            if (hrefStart === -1) {
                searchPos = reservePos + 1;
                continue;
            }
            hrefStart += 6;

            // Search forward for closing "
            let hrefEnd = html.indexOf('"', reservePos);
            if (hrefEnd === -1) {
                searchPos = reservePos + 1;
                continue;
            }

            // Extract and decode
            let reserveLink = html.substring(hrefStart, hrefEnd).replace(/&amp;/g, '&');
            const fullReserveUrl = `https://driver-services.dvsa.gov.uk${reserveLink}`;
            reserveLinks.push(fullReserveUrl);

            searchPos = reservePos + 1;
        }

        if (reserveLinks.length === 0) {
            console.log('⚠️ No reserve buttons found in slot page HTML');
            chrome.runtime.sendMessage({
                action: 'reserve_link_not_found',
                slotLink: slotLink,
                reason: 'Reserve button (_eventId=reserveSlot) not found in HTML'
            });
            return;
        }

        console.log(`✅ Found ${reserveLinks.length} reserve button(s):`, reserveLinks);

        // Save all reserve links to background (reversed, so we pop from end)
        chrome.runtime.sendMessage({
            action: 'save_reserve_links',
            links: reserveLinks.reverse() // Reverse so last slot is clicked first
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.log('Failed to save reserve links:', chrome.runtime.lastError.message);
            }
        });

        // Click the first link (which is the last slot after reversing)
        console.log('🎯 Clicking first reserve button (last slot):', reserveLinks[0]);
        window.location.replace(reserveLinks[0]);
    } catch (error) {
        console.log('❌ Error during reserve link extraction:', error.message);
        chrome.runtime.sendMessage({
            action: 'reserve_link_not_found',
            slotLink: slotLink,
            reason: `Fetch error: ${error.message}`
        });
    }
}

let ajaxCompleteCallback = null; // Global callback for AJAX completion

// Click counter for page reload (random 30-45 clicks, in-memory only)
const CONTROLLED_RELOAD_KEY = 'bot_controlled_reload';

// In-memory click counter (resets on page reload - that's OK!)
let clickCounter = 0;

// Random threshold for next reload (30-45 clicks)
let clickReloadThreshold = Math.floor(Math.random() * (45 - 30 + 1)) + 30;

// Store deadline date for determining which button to click
// Load from localStorage first (persists across page reloads)
let deadlineDate = localStorage.getItem('dvsa_deadline_date') || null;
if (deadlineDate) {
    console.log('📅 Deadline date loaded from localStorage:', deadlineDate);
}

// Wait for DOM to be ready before setting up the rest
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeBot);
} else {
    initializeBot();
}

function initializeBot() {
    // Check for system error and redirect if needed
    if (checkAndRedirectFromSystemError()) {
        return; // Exit early, page will redirect
    }

    // Check for session timeout and redirect if needed
    if (checkAndRedirectFromSessionTimeout()) {
        return; // Exit early, page will redirect
    }

    setupMessageListeners();
    setupNotifications();
    setupWarningModalDetector();

    // Log initial random threshold
    console.log(`📊 Initial reload threshold: ${clickReloadThreshold} clicks`);

    // Check if this was a controlled reload (from search criteria refresh)
    // When we click "Change your search criteria" and close the modal, page reloads
    // The flag tells us this was intentional, so we should auto-resume the session
    const wasControlledReload = localStorage.getItem(CONTROLLED_RELOAD_KEY);
    if (wasControlledReload === 'true') {
        console.log('ℹ️ Page reloaded after search criteria refresh - auto-starting session');
        // Clear flag immediately so it doesn't trigger again
        localStorage.removeItem(CONTROLLED_RELOAD_KEY);

        // Wait for page to be fully ready, then auto-start session
        waitForPageReady().then(() => {
            console.log('✅ Page ready - auto-starting session');
            chrome.runtime.sendMessage({ action: 'auto_start_after_reload', skipAlert: true });
        });
    }

    // Check if we're already on "Test centre availability" page
    // 🚀 OPTIMIZED: Reservation handling removed - new approach will be implemented
}

// Check if on session timeout page and redirect to main OBS page
function checkAndRedirectFromSessionTimeout() {
    const currentUrl = window.location.href;

    // Check if we're on the session timeout page
    if (currentUrl.includes('/obs-web/sessionTimeout')) {
        // Redirect to main OBS page (use replace to avoid history entry)
        window.location.replace('https://driver-services.dvsa.gov.uk/obs');
        return true; // Return true to indicate redirect happening
    }

    // Check if slots timed out (_eventId=slotsTimedOut)
    if (currentUrl.includes('_eventId=slotsTimedOut')) {
        // Redirect to main OBS page (use replace to avoid history entry)
        window.location.replace('https://driver-services.dvsa.gov.uk/obs');
        return true; // Return true to indicate redirect happening
    }

    return false; // Not on timeout page
}

// Check for system error and redirect to main OBS page
function checkAndRedirectFromSystemError() {
    // Check for the system error message
    const errorElement = document.querySelector('.error');
    if (errorElement && errorElement.textContent.includes("Sorry, there's a problem with the system")) {
        // Redirect to main OBS page
        window.location.replace('https://driver-services.dvsa.gov.uk/obs');
        return true; // Return true to indicate redirect happening
    }

    // Check for the "Please try again later" message
    const tryAgainElement = document.querySelector('p');
    if (tryAgainElement && tryAgainElement.textContent.includes('Please try again later')) {
        // Redirect to main OBS page
        window.location.replace('https://driver-services.dvsa.gov.uk/obs');
        return true; // Return true to indicate redirect happening
    }

    return false; // No system error found
}

// Selectors
const SELECTORS = {
    nextAvailable: '#searchForWeeklySlotsNextAvailable',
    previousAvailable: '#searchForWeeklySlotsPreviousAvailable',
    dateRange: '.span-7 .centre.bold',  // Contains "23rd March 2026 – 29th March 2026"
};

function setupMessageListeners() {
    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        switch (message.action) {
            case 'ping':
                sendResponse({ status: 'ready' });
                return true;

            case 'refresh':
                console.log('🔄 Received refresh command from background');
                handleRefreshClick()
                    .then(() => {
                        console.log('✅ Refresh command completed');
                        sendResponse({ status: 'completed' });
                    })
                    .catch((error) => {
                        console.log('❌ Refresh command error:', error);
                        sendResponse({ status: 'error', error: error.message });
                    });
                return true;

            case 'start':
                // CRITICAL: Clear any stale controlled reload flag on fresh start
                // This prevents false positives from previous failed refresh attempts
                const staleFlag = localStorage.getItem(CONTROLLED_RELOAD_KEY);
                if (staleFlag === 'true') {
                    console.log('🧹 Clearing stale CONTROLLED_RELOAD_KEY from previous session');
                    localStorage.removeItem(CONTROLLED_RELOAD_KEY);
                }
                
                // Reset click counter on fresh start
                clickCounter = 0;
                console.log('🔄 Fresh session start - click counter reset to 0');
                
                // Store deadline date for button selection logic
                if (message.deadlineDate) {
                    deadlineDate = message.deadlineDate;
                    // Persist to localStorage so it survives page reloads
                    localStorage.setItem('dvsa_deadline_date', deadlineDate);
                    console.log('📅 Deadline date stored:', deadlineDate);

                    // Send deadline date to MAIN world (where xhr-hook.js runs)
                    window.postMessage({
                        type: 'DVSA_SET_DEADLINE',
                        deadlineDate: message.deadlineDate
                    }, '*');
                    console.log('📅 Deadline date sent to MAIN world:', message.deadlineDate);
                } else {
                    console.log('⚠️ No deadline date provided on session start');
                    // Clear localStorage if no deadline date provided
                    localStorage.removeItem('dvsa_deadline_date');
                    deadlineDate = null;
                }
                sendResponse({ status: 'ready' });
                return true;

            case 'stop':
                // Content script doesn't need to do anything - just stop receiving commands
                console.log('Content script idle (no status needed)');
                break;
                
            case 'ping':
                // Respond to ping to confirm content script is ready
                console.log('Content script ping received - responding');
                sendResponse({ ready: true, timestamp: Date.now() });
                return true;
        }

        sendResponse({ received: true });
        return true;
    });
    
    // Notify background script that content script is ready
    chrome.runtime.sendMessage({ action: 'content_script_ready' });
}

// Intelligent date-aware navigation
function getCurrentPeriod() {
    const dateRangeElement = document.querySelector(SELECTORS.dateRange);
    if (!dateRangeElement) {
        return null;
    }

    const dateText = dateRangeElement.textContent.trim();

    // Parse "23rd March 2026 – 29th March 2026" (supports en dash, em dash, or hyphen)
    const match = dateText.match(/(\d+)(?:st|nd|rd|th)?\s+(\w+)\s+(\d{4})\s*[–—-]\s*(\d+)(?:st|nd|rd|th)?\s+(\w+)\s+(\d{4})/);
    if (!match) {
        return null;
    }

    const [, startDay, startMonth, startYear, endDay, endMonth, endYear] = match;
    const startDate = new Date(`${startDay} ${startMonth} ${startYear}`);
    const endDate = new Date(`${endDay} ${endMonth} ${endYear}`);

    return { startDate, endDate, text: dateText };
}

// Calculate target period (today to deadline date from settings)
function calculateTargetPeriod() {
    const today = new Date();

    // Use deadline date from settings, or fallback to 3 months if not set
    let targetEndDate;
    if (deadlineDate) {
        targetEndDate = new Date(deadlineDate);
        console.log('📅 Using deadline date from settings:', deadlineDate);
    } else {
        // Fallback: 3 months from today
        targetEndDate = new Date(today);
        targetEndDate.setMonth(today.getMonth() + 3);
        console.log('⚠️ No deadline date set - using 3 months fallback');
    }

    return {
        startDate: new Date(today.getTime()), // Copy of today
        endDate: targetEndDate,
        text: `${today.getDate()} ${today.toLocaleString('default', { month: 'long' })} ${today.getFullYear()} – ${targetEndDate.getDate()} ${targetEndDate.toLocaleString('default', { month: 'long' })} ${targetEndDate.getFullYear()}`
    };
}

// Check if current period overlaps with target period (today to deadline date)
function isCurrentPeriodInTarget(currentPeriod) {
    if (!currentPeriod) return false;

    const targetPeriod = calculateTargetPeriod();

    // Check if current period overlaps with target period
    const overlaps = currentPeriod.startDate <= targetPeriod.endDate &&
                    currentPeriod.endDate >= targetPeriod.startDate;

    return overlaps;
}

// Main click handler - event-driven system
async function handleRefreshClick() {
    try {
        console.log('🎯 handleRefreshClick() called');
        const currentPeriod = getCurrentPeriod();
        console.log('📅 Current period:', currentPeriod);
        if (!currentPeriod) {
            console.log('⚠️ No current period found - cannot determine which button to click');
            notifyBackgroundScript('refresh_done', { status: 'period_unknown' });
            return;
        }

        let targetButton, buttonType;

        if (!isCurrentPeriodInTarget(currentPeriod)) {
            targetButton = document.querySelector(SELECTORS.previousAvailable);
            buttonType = 'previous_available';
            console.log('🔍 Looking for previousAvailable button');
        } else {
            targetButton = document.querySelector(SELECTORS.nextAvailable);
            buttonType = 'next_available';
            console.log('🔍 Looking for nextAvailable button');
        }

        console.log('🔘 Target button found:', !!targetButton, 'Type:', buttonType);
        if (!targetButton) {
            console.log('❌ Target button not found!');
            notifyBackgroundScript('refresh_done', { status: 'button_not_found' });
            return;
        }

        // Click first, then notify (faster!)
        console.log('🖱️ About to call clickElement()...');
        clickElement(targetButton);

        // Notify after click completes
        notifyBackgroundScript('button_clicked', {
            buttonType: buttonType
        });

    } catch (error) {
        console.log('❌ Click handler error:', error);
        notifyBackgroundScript('refresh_done', { status: 'error', error: error.message });
    }
}

// Helper: Click element immediately (no delays!)
function clickElement(element) {
    // Increment click counter (in-memory only - no localStorage overhead!)
    clickCounter++;
    console.log(`🖱️ Click count: ${clickCounter}/${clickReloadThreshold}`);

    // Check if we need to refresh search criteria (random 30-45 clicks)
    if (clickCounter >= clickReloadThreshold) {
        console.log(`🔄 Reached ${clickReloadThreshold} clicks - refreshing search criteria`);
        console.log(`📊 Current click count: ${clickCounter}, threshold: ${clickReloadThreshold}`);

        // Notify server about the refresh
        notifyBackgroundScript('search_criteria_refresh', {
            reason: 'click_threshold_reached',
            clickCount: clickReloadThreshold,
                    message: `Reached ${clickReloadThreshold} clicks - refreshing search criteria to prevent silent logout`
        });

        // Reset counter and generate new random threshold
        clickCounter = 0;
        clickReloadThreshold = Math.floor(Math.random() * (45 - 30 + 1)) + 30;
        console.log(`📊 Next reload will be after ${clickReloadThreshold} clicks`);

        // Click "Change your search criteria" button and close modal
        console.log('🚀 Calling refreshSearchCriteria()...');
        refreshSearchCriteria();
        return;
    }

    // Click immediately - no delays, no scrolling!
    element.click();
}

// Notify background script
function notifyBackgroundScript(action, data = {}) {
    chrome.runtime.sendMessage({
        action: action,
        ...data
    });
}

function setupNotifications() {
    // Request notification permission on load
    if (Notification.permission === 'default') {
        Notification.requestPermission();
    }
    console.log('Cancel Notifier Content Script Ready');
}

// Track if we've already clicked the warning modal (prevent multiple clicks)
let warningModalClicked = false;
let lastModalCheckTime = 0;
const MODAL_CHECK_THROTTLE = 1000; // Only check every 1000ms (1 second)
let isClosingModalProgrammatically = false; // Flag to skip warning modal detection during programmatic close

// Watch for warning modal and click "Okay, thanks" button immediately
function setupWarningModalDetector() {
    // Check immediately on load
    checkForWarningModal();

    // Watch for DOM changes (modal might appear dynamically)
    // Use throttled check to avoid excessive calls
    const observer = new MutationObserver(() => {
        const now = Date.now();
        if (now - lastModalCheckTime < MODAL_CHECK_THROTTLE) {
            return; // Throttle: skip if checked recently
        }
        lastModalCheckTime = now;
        checkForWarningModal();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

function checkForWarningModal() {
    // Skip detection if we're programmatically closing a modal (to avoid false positives)
    if (isClosingModalProgrammatically) {
        return;
    }
    
    // If we already clicked, don't check again - wait for modal to actually disappear
    if (warningModalClicked) {
        // Check if modal is completely gone from DOM
        const warningModal = document.querySelector('#back-button-warning-dialog') ||
                            document.querySelector('.ui-dialog[aria-describedby="back-button-warning-dialog"]');
        
        if (!warningModal) {
            // Modal is gone, reset flag
            warningModalClicked = false;
        }
        return; // Don't check further if we already clicked
    }

    // Look for the warning modal by ID or aria-describedby
    const warningModal = document.querySelector('#back-button-warning-dialog') ||
                        document.querySelector('.ui-dialog[aria-describedby="back-button-warning-dialog"]');

    if (!warningModal) {
        return;
    }

    // Check if modal is visible (not hidden)
    const isVisible = warningModal.style.display !== 'none' && 
                     window.getComputedStyle(warningModal).display !== 'none';

    if (!isVisible) {
        return;
    }

    // Find the "Okay, thanks" button
    const okayButton = document.querySelector('#backButtonCloseDialog');

    if (okayButton) {
        // Set flag immediately to prevent multiple clicks
        warningModalClicked = true;
        
        console.log('⚠️ Warning modal detected - clicking "Okay, thanks" immediately');
        
        // Click immediately - no delays!
        okayButton.click();

        // Also try dispatching events to ensure it works
        const clickEvent = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true
        });
        okayButton.dispatchEvent(clickEvent);

        // If it's a link, also try navigating (use replace to avoid history)
        if (okayButton.tagName === 'A' && okayButton.href) {
            window.location.replace(okayButton.href);
        }
    }
}

// Helper function to close modal - clicking close button reloads the page
async function closeModalWithRetry() {
    // Set flag to prevent warning modal detection during programmatic close
    isClosingModalProgrammatically = true;
    
    console.log('🔄 Attempting to close search criteria modal...');

    // Find the modal dialog
    const allDialogs = document.querySelectorAll('.ui-dialog');
    let targetDialog = null;

    for (const dialog of allDialogs) {
        const style = window.getComputedStyle(dialog);
        if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
            targetDialog = dialog;
            console.log(`Found modal: ${dialog.getAttribute('aria-describedby')}`);
            break;
        }
    }

    if (!targetDialog) {
        console.log('✅ No modal found - already closed or not open');
        isClosingModalProgrammatically = false;
        return;
    }

    // Click the close button - this will reload the page
    const closeButton = targetDialog.querySelector('.ui-dialog-titlebar-close') ||
                      targetDialog.querySelector('button[title="close"]') ||
                      targetDialog.querySelector('.ui-dialog-titlebar .ui-button');

    if (closeButton) {
        console.log('✅ Clicking close button - page will reload');
        closeButton.click();
        
        // Wait a moment - page should reload
        // If page doesn't reload within 3 seconds, something went wrong
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // If we're still here after 3 seconds, page didn't reload (unusual)
        if (document.body && document.readyState !== 'loading') {
            console.log('⚠️ Page did not reload after clicking close button');
        }
    } else {
        console.log('❌ Close button not found');
    }

    isClosingModalProgrammatically = false;
}

// Helper function to wait for modal to appear
async function waitForModalToOpen() {
    return new Promise((resolve) => {
        let attempts = 0;
        let resolved = false; // Flag to prevent double resolution

        const checkInterval = setInterval(() => {
            attempts++;

            // Try multiple selectors for the close button
            const closeButton = document.querySelector('.ui-dialog-titlebar-close') ||
                              document.querySelector('button[title="close"]') ||
                              document.querySelector('.ui-icon-closethick') ||
                              document.querySelector('.ui-dialog-titlebar .ui-button');

            const modalDialog = document.querySelector('.ui-dialog');

            // Debug logging
            if (attempts === 1) {
                console.log('🔍 Modal detection - closeButton:', !!closeButton, 'modalDialog:', !!modalDialog);
                if (closeButton) {
                    console.log('✅ Close button found:', closeButton.className, closeButton.tagName);
                }
            }

            // Check if modal is visible and close button exists
            if (closeButton && modalDialog) {
                if (!resolved) {
                    resolved = true;
                    clearInterval(checkInterval);
                    clearTimeout(timeoutId); // Clear the timeout!
                    console.log('✅ Modal ready, returning close button');
                    resolve(closeButton);
                }
            }
        }, 100); // Check every 100ms for faster detection

        // Safety timeout after 5 seconds
        const timeoutId = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                clearInterval(checkInterval);
                console.log('⚠️ Modal timeout after 5 seconds - searching for any close button');

                // Try all possible selectors
                const closeButton = document.querySelector('.ui-dialog-titlebar-close') ||
                                  document.querySelector('button[title="close"]') ||
                                  document.querySelector('.ui-icon-closethick')?.parentElement ||
                                  document.querySelector('.ui-dialog-titlebar .ui-button') ||
                                  document.querySelector('.ui-dialog .ui-dialog-titlebar button');

                if (closeButton) {
                    console.log('✅ Fallback found button:', closeButton.className);
                } else {
                    console.log('❌ No close button found with any selector');
                }

                resolve(closeButton);
            }
        }, 5000);
    });
}

// Helper function to wait for page to be fully ready
async function waitForPageReady() {
    return new Promise((resolve) => {
        console.log('⏳ Waiting for page to be fully loaded...');

        const checkReady = () => {
            // Check 1: Navigation buttons must exist
            const nextBtn = document.querySelector(SELECTORS.nextAvailable);
            const prevBtn = document.querySelector(SELECTORS.previousAvailable);

            if (!nextBtn && !prevBtn) {
                console.log('⏳ Navigation buttons not yet loaded...');
                setTimeout(checkReady, 100);
                return;
            }

            // Check 2: Date range must be loaded (indicates AJAX completed)
            const dateRange = document.querySelector(SELECTORS.dateRange);
            if (!dateRange || !dateRange.textContent.trim()) {
                console.log('⏳ Date range not yet loaded...');
                setTimeout(checkReady, 100);
                return;
            }

            // Check 3: Wait additional 1 second after everything appears (let AJAX fully settle)
            console.log('✅ Page elements detected - waiting 1s for AJAX to settle...');
            setTimeout(() => {
                console.log('✅ Page fully ready - safe to start session');
                resolve();
            }, 1000);
        };

        // Start checking
        checkReady();
    });
}

// Function to refresh search criteria by clicking the button and closing modal
async function refreshSearchCriteria() {
    try {
        console.log('🔄 ========== STARTING SEARCH CRITERIA REFRESH ==========');
        console.log('🔄 Starting search criteria refresh...');

        // CRITICAL: STOP session before opening modal (timer stops completely)
        console.log('🛑 Stopping session for search criteria refresh');
        chrome.runtime.sendMessage({ action: 'stop_bot', skipAlert: true }, (response) => {
            if (chrome.runtime.lastError) {
                console.log('⚠️ Failed to stop session:', chrome.runtime.lastError.message);
            } else {
                console.log('✅ Session stopped successfully');
            }
        });

        // Set controlled reload flag (for tracking purposes)
        localStorage.setItem(CONTROLLED_RELOAD_KEY, 'true');
        console.log('✅ Set controlled reload flag in localStorage');

        // Wait a moment for stop message to be processed
        console.log('⏳ Waiting 100ms for stop message to be processed...');
        await new Promise(resolve => setTimeout(resolve, 100));
        console.log('✅ Wait complete');

        // Step 1: Click "Change your search criteria" button
        console.log('🔍 Looking for refineSearch2 button...');
        const changeSearchButton = document.querySelector('#refineSearch2');
        if (changeSearchButton) {
            console.log('✅ Found refineSearch2 button, clicking...');
            changeSearchButton.click();
            console.log('✅ Clicked refineSearch2 button');

            // Wait for modal to open dynamically
            console.log('⏳ Waiting for modal to open...');
            await waitForModalToOpen();
            console.log('✅ Modal opened, proceeding to wait...');

            // Step 2: Random wait 3-6 seconds for modal to be fully initialized (human-like)
            const randomWait = Math.floor(Math.random() * (6000 - 3000 + 1)) + 3000;
            console.log(`⏳ Waiting ${randomWait}ms before closing modal...`);
            await new Promise(resolve => setTimeout(resolve, randomWait));
            console.log('✅ Wait complete, closing modal...');

            // Step 3: Close modal with retry until it's actually closed
            await closeModalWithRetry();
        } else {
            console.log('❌ refineSearch2 button not found');
        }
    } catch (error) {
        console.log('❌ Error during search criteria refresh:', error);
    }
}
