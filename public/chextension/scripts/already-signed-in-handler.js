// Already Signed In Handler - Auto-select "Stay" and continue
console.log('🔐 Already Signed In Handler Loading...');

// Verify we're on the correct page
if (!window.location.href.includes('/login/already-signed-in/')) {
    console.log('❌ Not on already-signed-in page, exiting...');
    throw new Error('Already Signed In Handler should only run on already-signed-in pages');
}

// Helper: Sleep function
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper: Random delay for human-like behavior
function randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Main handler
async function handleAlreadySignedIn() {
    console.log('🚀 Starting already-signed-in handler...');

    // Wait for page to fully load
    await sleep(100);

    // Step 1: Find and select "Stay" radio button
    const stayRadio = document.querySelector('#confirm-Stay');

    if (!stayRadio) {
        console.log('❌ "Stay" radio button not found');
        return;
    }

    console.log('✅ Found "Stay" radio button');

    // Check the radio button
    stayRadio.checked = true;
    stayRadio.click(); // Trigger click event to ensure any listeners are called

    // Dispatch change event for form validation
    stayRadio.dispatchEvent(new Event('change', { bubbles: true }));
    stayRadio.dispatchEvent(new Event('input', { bubbles: true }));

    console.log('✅ Selected "Stay" option');

    // Step 2: Find and click Continue button immediately
    const continueBtn = document.querySelector('#continue, button[type="submit"]');

    if (!continueBtn) {
        console.log('❌ Continue button not found');
        return;
    }

    console.log('✅ Found Continue button');

    // Click immediately
    continueBtn.click();

    console.log('✅ Clicked Continue button - proceeding with login...');
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handleAlreadySignedIn);
} else {
    handleAlreadySignedIn();
}

console.log('✅ Already Signed In Handler Ready');
