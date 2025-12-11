// DVSA Home Page Form Auto-Filler
console.log('📋 DVSA Home Form Filler Loaded');

// Only run on home page
if (!window.location.href.includes('/obs-web/pages/home')) {
    console.log('Not on home page, exiting...');
    throw new Error('Home form filler should only run on home page');
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeFormFiller);
} else {
    initializeFormFiller();
}

async function initializeFormFiller() {
    console.log('🚀 Initializing home page form filler...');

    // Wait for page to fully load
    await sleep(100);

    // Check if form elements exist
    const testCategorySelect = document.querySelector('#businessBookingTestCategoryRecordId');
    if (!testCategorySelect) {
        console.log('⚠️ Test category dropdown not found - form might be different');
        return;
    }

    // Check if form is already complete (both test centre group AND special needs selected)
    const testCentreSelect = document.querySelector('#testcentregroups');
    const specialNeedsNo = document.querySelector('#specialNeedsChoice-noneeds');
    const specialNeedsYes = document.querySelector('#specialNeedsChoice-yesneeds');

    const testCentreSelected = testCentreSelect && testCentreSelect.value && testCentreSelect.value !== '-1';
    const specialNeedsSelected = (specialNeedsNo && specialNeedsNo.checked) || (specialNeedsYes && specialNeedsYes.checked);

    if (testCentreSelected && specialNeedsSelected) {
        console.log('✅ Form already complete - clicking Book test button');
        await clickBookTestButton();
        return;
    }

    console.log('📝 Starting form fill process...');

    // Step 1: Select "Car" from test category
    await selectTestCategory();

    // Step 2: Select test centre group if not already selected
    if (!testCentreSelected) {
        console.log('Test centre group not selected - filling it...');
        await selectTestCentreGroup();
    } else {
        console.log('Test centre group already selected - skipping');
    }

    // Step 3: Select "No" for special needs if not already selected
    if (!specialNeedsSelected) {
        console.log('Special needs not selected - filling it...');
        await selectNoSpecialNeeds();
    } else {
        console.log('Special needs already selected - skipping');
    }

    // Step 4: Click "Book test" button
    await clickBookTestButton();

    console.log('✅ Form filled successfully!');
}

// Step 1: Select "Car" from business booking test category
async function selectTestCategory() {
    console.log('Step 1: Selecting "Car" from test category...');

    const testCategorySelect = document.querySelector('#businessBookingTestCategoryRecordId');

    if (!testCategorySelect) {
        console.error('❌ Test category dropdown not found!');
        return;
    }

    // Focus and change value immediately
    testCategorySelect.focus();

    // Find the "Car" option
    const carOption = Array.from(testCategorySelect.options).find(opt =>
        opt.textContent.trim() === 'Car' && opt.value === 'TC-B'
    );

    if (!carOption) {
        console.error('❌ "Car" option not found in dropdown!');
        return;
    }

    testCategorySelect.value = carOption.value;

    // Trigger change events
    testCategorySelect.dispatchEvent(new Event('change', { bubbles: true }));
    testCategorySelect.dispatchEvent(new Event('input', { bubbles: true }));

    testCategorySelect.blur();

    console.log('✅ Selected: Car (TC-B)');
}

// Step 2: Select first test centre group
async function selectTestCentreGroup() {
    console.log('Step 2: Selecting first test centre group...');

    const testCentreSelect = document.querySelector('#testcentregroups');

    if (!testCentreSelect) {
        console.error('❌ Test centre group dropdown not found!');
        return;
    }

    // Focus and change value immediately
    testCentreSelect.focus();

    // Debug: Log all options
    console.log('Available options:', Array.from(testCentreSelect.options).map(opt => ({
        value: opt.value,
        text: opt.textContent.trim()
    })));

    // Find first valid option (skip empty/placeholder options with value -1, 0, empty, or null)
    const firstOption = Array.from(testCentreSelect.options).find(opt => {
        const isValid = opt.value &&
            opt.value.trim() !== '' &&
            opt.value !== 'null' &&
            opt.value !== '-1' &&
            opt.value !== '0';
        console.log(`Checking option: value="${opt.value}", text="${opt.textContent.trim()}", isValid=${isValid}`);
        return isValid;
    });

    if (!firstOption) {
        console.error('❌ No valid test centre options found!');
        console.error('All options:', testCentreSelect.options);
        return;
    }

    console.log('Selected option:', firstOption.value, firstOption.textContent.trim());

    testCentreSelect.value = firstOption.value;

    // Trigger change events
    testCentreSelect.dispatchEvent(new Event('change', { bubbles: true }));
    testCentreSelect.dispatchEvent(new Event('input', { bubbles: true }));

    testCentreSelect.blur();

    console.log(`✅ Selected first option: ${firstOption.textContent.trim()} (${firstOption.value})`);
}

// Step 3: Select "No" for special needs
async function selectNoSpecialNeeds() {
    console.log('Step 3: Selecting "No" for special needs...');

    const noRadio = document.querySelector('#specialNeedsChoice-noneeds');

    if (!noRadio) {
        console.error('❌ Special needs "No" radio button not found!');
        return;
    }

    // Click immediately

    // Click the radio button
    noRadio.click();

    // Trigger change event
    noRadio.dispatchEvent(new Event('change', { bubbles: true }));

    console.log('✅ Selected: No special needs');
}

// Step 4: Click "Book test" button
async function clickBookTestButton() {
    console.log('Step 4: Clicking "Book test" button...');

    const bookTestButton = document.querySelector('#submitSlotSearch');
    
    if (!bookTestButton) {
        console.error('❌ "Book test" button not found!');
        return;
    }

    // Click immediately

    // Click the button
    bookTestButton.click();

    console.log('✅ Clicked: Book test button');
}

// Helper: Random delay between min and max (human-like timing)
function randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Helper: Sleep
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
