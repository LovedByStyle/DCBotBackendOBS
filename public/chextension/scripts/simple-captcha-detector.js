// Simple hCaptcha Detector for Cancel Notifier
// This only detects captchas and sends alerts - no solving

console.log('🔍 Simple Captcha Detector Loading...');

// Check if we're in an iframe - if so, only proceed if it's hCaptcha
if (window !== window.top) {
    console.log('⏭️ Running in iframe - checking if hCaptcha frame');
    // If we're in hCaptcha iframe, let the main frame handle the alert
    if (window.location.href.includes('hcaptcha.com')) {
        console.log('🎯 In hCaptcha iframe - letting main frame handle alert');
    } else {
        console.log('⏭️ In non-hCaptcha iframe - exiting silently');
        // Exit early if in non-hCaptcha iframe - just stop execution
        // No need to throw error or return - script will just end
    }
}

// Only continue if we're in the main frame or hCaptcha iframe
if (window === window.top || window.location.href.includes('hcaptcha.com')) {

const STORAGE_KEY = 'hcaptcha_last_alert';

// Extract sitekey from hCaptcha element
function extractSitekey() {
    // Method 1: Look for hCaptcha containers
    const containers = document.querySelectorAll('.h-captcha, [class*="hcaptcha"]');
    for (const container of containers) {
        const sitekey = container.getAttribute('data-sitekey');
        if (sitekey) {
            console.log('🔑 Found sitekey in container:', sitekey);
            return sitekey;
        }
    }

    // Method 2: Look for hCaptcha iframes
    const iframes = document.querySelectorAll('iframe[src*="hcaptcha.com"]');
    for (const iframe of iframes) {
        const src = iframe.src;
        const match = src.match(/sitekey=([^&]+)/);
        if (match) {
            console.log('🔑 Found sitekey in iframe src:', match[1]);
            return match[1];
        }
    }

    // Method 3: Try to extract from URL (if we're in hCaptcha frame)
    if (window.location.href.includes('hcaptcha.com')) {
        const urlMatch = window.location.href.match(/sitekey=([^&]+)/);
        if (urlMatch) {
            console.log('🔑 Found sitekey in URL:', urlMatch[1]);
            return urlMatch[1];
        }
    }

    return null;
}

// Detect hCaptcha on page
function detectHCaptcha() {
    // Method 1: Look for hCaptcha iframe
    const hcaptchaIframes = document.querySelectorAll('iframe[src*="hcaptcha.com"]');
    if (hcaptchaIframes.length > 0) {
        console.log('🎯 HCAPTCHA DETECTED - Found', hcaptchaIframes.length, 'iframe(s)');
        return true;
    }

    // Method 2: Look for hCaptcha div container
    const hcaptchaContainers = document.querySelectorAll('.h-captcha, [class*="hcaptcha"]');
    if (hcaptchaContainers.length > 0) {
        console.log('🎯 HCAPTCHA DETECTED - Found container div');
        return true;
    }

    // Method 3: Look for hCaptcha script
    const scripts = document.querySelectorAll('script[src*="hcaptcha.com"]');
    if (scripts.length > 0) {
        console.log('🎯 HCAPTCHA DETECTED - Found hCaptcha script');
        return true;
    }

    // Method 4: Check if current frame is hCaptcha
    if (window.location.href.includes('hcaptcha.com')) {
        console.log('🎯 HCAPTCHA DETECTED - Current frame IS hCaptcha');
        return true;
    }

    return false;
}

// Notify background script about captcha
async function notifyBackgroundAboutCaptcha() {
    try {
        const sitekey = extractSitekey();
        const url = window.location.href;
        const isReservation = url.includes('obs-web/pages/home') && 
                             (url.includes('execution=') || url.includes('_eventId='));

        // Check if we already alerted recently for the same captcha
        const lastAlert = await new Promise((resolve) => {
            chrome.storage.local.get([STORAGE_KEY], (result) => {
                resolve(result[STORAGE_KEY] || null);
            });
        });

        if (lastAlert) {
            const timeSinceLastAlert = Date.now() - lastAlert.timestamp;
            const sameCaptcha = lastAlert.sitekey === sitekey && lastAlert.url === url;
            
            if (sameCaptcha && timeSinceLastAlert < 30000) { // 30 seconds cooldown
                console.log(`⏭️ Same captcha detected ${Math.floor(timeSinceLastAlert / 1000)}s ago, skipping alert`);
                return;
            }
        }

        // Send alert for ALL captcha detections
        // IMPORTANT: No auto-redirect - let user handle captcha manually or via Telegram alert
        console.log(`⚠️ hCaptcha detected ${isReservation ? 'during RESERVATION' : '(non-reservation page)'}`);

        // Send message to background script
        chrome.runtime.sendMessage({
            type: 'captchaDetected',
            captchaType: 'hcaptcha',
            sitekey: sitekey,
            url: url,
            isReservation: isReservation,
            timestamp: Date.now()
        });

        // Store alert info to prevent spam
        chrome.storage.local.set({
            [STORAGE_KEY]: {
                sitekey: sitekey,
                url: url,
                timestamp: Date.now()
            }
        });

    } catch (error) {
        console.error('❌ Error in captcha handling:', error);
    }
}

function checkForCaptcha() {
    console.log('🔍 Checking for hCaptcha...');
    
    if (detectHCaptcha()) {
        console.log('✅ hCaptcha found on page!');
        notifyBackgroundAboutCaptcha();
    } else {
        console.log('⏭️ No hCaptcha detected on this page');
    }
}

// Check for captcha on page load
checkForCaptcha();

// Watch for dynamic hCaptcha injection
if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // Check for hCaptcha iframe
                    if (node.nodeName === 'IFRAME' && node.src && node.src.includes('hcaptcha.com')) {
                        console.log('🎯 HCAPTCHA DYNAMICALLY ADDED!');
                        notifyBackgroundAboutCaptcha();
                    }
                    
                    // Check for hCaptcha div
                    if (node.nodeName === 'DIV' && node.className && node.className.includes('captcha')) {
                        console.log('🎯 CAPTCHA DIV DYNAMICALLY ADDED!');
                        setTimeout(checkForCaptcha, 500); // Check after a delay
                    }
                }
            });
        });
    });

    // Wait for document.body to be available
    const setupObserver = () => {
        if (document.body) {
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
            console.log('✅ Mutation observer installed - watching for dynamic hCaptcha');
        } else {
            // If body isn't ready yet, wait for DOMContentLoaded
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', setupObserver);
            } else {
                console.log('⚠️ Document body not available for observer setup');
            }
        }
    };

    setupObserver();
}

// Also check when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('📄 DOM ready - checking for captcha again');
        checkForCaptcha(); // Check again after DOM ready
    });
}

console.log('✅ Simple Captcha Detector Ready');
}
