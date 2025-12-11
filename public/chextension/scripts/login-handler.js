// Government Gateway Login Auto-Handler
console.log('🔐 DVSA Login Handler Loaded');

// Only run on login page
if (!window.location.href.includes('/login/signin/creds')) {
    console.log('Not on login page, exiting...');
    throw new Error('Login handler should only run on login page');
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeLoginHandler);
} else {
    initializeLoginHandler();
}

async function initializeLoginHandler() {
    console.log('🚀 Initializing login handler...');

    // Wait for page to fully load
    await sleep(100);

    // Check for session expiration message
    const sessionExpiredHeading = document.querySelector('h1.govuk-heading-xl');
    if (sessionExpiredHeading && sessionExpiredHeading.textContent.includes('Your session has expired')) {
        console.log('⚠️ Session expired detected!');
        console.log('🔄 Redirecting to: https://driver-services.dvsa.gov.uk/obs');
        window.location.replace('https://driver-services.dvsa.gov.uk/obs');
        return; // Exit early, page will redirect
    }

    // Get saved credentials from chrome.storage
    chrome.storage.local.get(['config'], async (result) => {
        if (!result.config) {
            console.log('⚠️ No configuration found');
            sendCredentialAlert();
            return;
        }

        const { dvsaUsername, dvsaPassword } = result.config;

        if (!dvsaUsername || !dvsaPassword) {
            console.log('⚠️ DVSA credentials not configured');
            console.log('   Please enter credentials in extension popup');
            sendCredentialAlert();
            return;
        }

        console.log('✅ Found saved DVSA credentials');
        console.log(`   Username: ${dvsaUsername.substring(0, 4)}...`);
        console.log(`   Password: ${'*'.repeat(dvsaPassword.length)} (${dvsaPassword.length} chars)`);

        // Fill the form with saved credentials
        await fillLoginForm(dvsaUsername, dvsaPassword);
    });
}

async function fillLoginForm(username, password) {
    console.log('📝 Filling login form...');

    const userIdInput = document.querySelector('#user_id') ||
                       document.querySelector('input[name="user_id"]');
    const passwordInput = document.querySelector('#password') ||
                         document.querySelector('input[name="password"]');

    if (!userIdInput || !passwordInput) {
        console.error('❌ Login form fields not found!');
        return;
    }

    // Fill username
    userIdInput.value = username;
    userIdInput.dispatchEvent(new Event('input', { bubbles: true }));
    userIdInput.dispatchEvent(new Event('change', { bubbles: true }));
    console.log('✅ Username filled');

    // Fill password immediately
    passwordInput.value = password;
    passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
    passwordInput.dispatchEvent(new Event('change', { bubbles: true }));
    console.log('✅ Password filled');

    // Verify values are set
    if (userIdInput.value === username && passwordInput.value === password) {
        console.log('✅ Form filled successfully - values confirmed');

        // Auto-submit form
        await submitLoginForm();
    } else {
        console.error('❌ Form fill verification failed!');
        console.error(`   Username set: ${userIdInput.value === username}`);
        console.error(`   Password set: ${passwordInput.value === password}`);
    }
}

async function submitLoginForm() {
    console.log('🖱️ Submitting login form...');

    const signInButton = document.querySelector('#continue') ||
                        document.querySelector('button[type="submit"]') ||
                        document.querySelector('button.govuk-button');

    if (!signInButton) {
        console.error('❌ Sign in button not found!');
        return;
    }

    console.log('✅ Found Sign In button:', signInButton.textContent.trim());

    // Click immediately
    console.log('🖱️ Clicking Sign In button...');
    signInButton.click();

    console.log('✅ Sign in button clicked - form submitted');

    // No Telegram alert needed for successful login
}

// Send alert to Telegram via background script
function sendCredentialAlert() {
    console.log('📤 Sending credential missing alert...');
    console.log('   Please configure DVSA credentials in extension popup');

    chrome.runtime.sendMessage({
        action: 'credential_missing',
        url: window.location.href,
        userIdFilled: false,
        passwordFilled: false,
        timestamp: new Date().toISOString()
    }, (response) => {
        if (chrome.runtime.lastError) {
            console.error('❌ Failed to send alert:', chrome.runtime.lastError);
        } else {
            console.log('✅ Telegram alert sent:', response);
        }
    });
}

// Helper: Sleep
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
