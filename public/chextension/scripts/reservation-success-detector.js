// Reservation Success Detector
console.log('🎯 Reservation Success Detector Loaded');

// Wait for DOM to be ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkForReservationSuccess);
} else {
    checkForReservationSuccess();
}

async function checkForReservationSuccess() {
    console.log('🔍 Checking for reservation success message...');

    // First, check if we're on the correct page
    const pageTitle = document.title;
    console.log('📄 Page title:', pageTitle);
    
    if (pageTitle !== 'Test centre availability - Book tests') {
        console.log('⏭️ Not on the correct page - skipping detection');
        return;
    }

    console.log('✅ On correct page - proceeding with detection');

    // Wait for page to fully load
    await sleep(2000);
    
    // Check if we're in the middle of clicking reserve links (don't interfere!)
    // This check happens AFTER the page loads to see if there are pending reserve links
    const hasPendingReserveLinks = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'get_next_reserve_link' }, (response) => {
            resolve(response && response.success && response.link);
        });
    });
    
    if (hasPendingReserveLinks) {
        console.log('⏭️ Reserve links still pending - skipping detection to avoid interference');
        return;
    }

    // Look for the success notification
    const successNotice = document.querySelector('div.notice.clockIcon');

    if (!successNotice) {
        console.log('⏭️ No reservation success notice found');
        console.log('   Looking for: div.notice.clockIcon');
        console.log('   All .notice elements:', document.querySelectorAll('.notice'));
        console.log('   All .clockIcon elements:', document.querySelectorAll('.clockIcon'));
        return;
    }

    console.log('✅ Found notice element:', successNotice);

    // Check if it contains the "minutes to complete your booking" text
    const noticeText = successNotice.textContent;
    console.log('📝 Notice text:', noticeText.trim());

    // Normalize whitespace (replace multiple spaces/newlines with single space)
    const normalizedText = noticeText.replace(/\s+/g, ' ').trim();
    console.log('📝 Normalized text:', normalizedText);

    const hasMinutesText = normalizedText.includes('minutes to complete your booking') ||
                           normalizedText.includes('minute to complete your booking');

    if (!hasMinutesText) {
        console.log('⏭️ Notice found but not the booking confirmation message');
        console.log('   Expected text to include: "minutes to complete your booking"');
        console.log('   Actual normalized text:', normalizedText);
        return;
    }

    // Extract the time remaining
    const minutesSpan = document.querySelector('#minutesToTimeout');
    const minutesRemaining = minutesSpan ? minutesSpan.textContent.trim() : 'unknown';

    console.log('✅ RESERVATION SUCCESS DETECTED!');
    console.log(`   Time remaining: ${minutesRemaining} minutes`);
    
    // CHECK: Is reservation actually done? (no more buttons + has reserved tests)
    const isReservationActuallyDone = checkIfReservationActuallyDone();
    
    if (!isReservationActuallyDone) {
        console.log('⏭️ SKIPPING - Reservation not actually done yet');
        console.log('   Still has reserve buttons or no actual reserved tests');
        return;
    }
    
    // Get reserved test count and details for the alert
    const reservedCount = getReservedTestCount();
    const slotDetails = getSlotDetails();
    console.log(`📊 Reserved test count: ${reservedCount}`);
    console.log(`📋 Slot details:`, slotDetails);
    
    // Check if no slots were secured
    // IMPORTANT: Only trigger slot lost if reservation is actually done (no reserve buttons) AND no slots secured
    // This prevents interrupting the reservation process while reserve links are still being clicked
    const reserveButtons = document.querySelectorAll('a[id^="reserve_"]');
    const hasReserveButtons = reserveButtons.length > 0;
    
    if (reservedCount === 0 && !hasReserveButtons) {
        // Reservation process is complete but no slots secured - slot lost
        console.log('⚠️ No slots secured - slot lost');
        await handleSlotLost();
        return;
    } else if (reservedCount === 0 && hasReserveButtons) {
        // Still have reserve buttons - reservation in progress, don't interrupt
        console.log('⏳ Reservation in progress - reserve buttons still available, waiting...');
        return;
    }
    
    console.log('📤 Sending success alert...');

    // Send success notification with slot details
    chrome.runtime.sendMessage({
        action: 'reservation_success',
        minutesRemaining: minutesRemaining,
        reservedCount: reservedCount,
        testCenter: slotDetails.testCenter,
        slots: slotDetails.slots,
        url: window.location.href,
        timestamp: new Date().toISOString()
    }, (response) => {
        if (chrome.runtime.lastError) {
            console.error('❌ Failed to send success alert:', chrome.runtime.lastError.message);
        } else {
            console.log('✅ Reservation success alert sent!', response);
        }
    });
}

// Handle slot lost scenario
async function handleSlotLost() {
    // Extract location info from h3
    const locationH3 = document.querySelector('h3');
    let locationInfo = 'Unknown location';
    
    if (locationH3) {
        locationInfo = locationH3.textContent.trim();
        console.log('📍 Location info:', locationInfo);
    }
    
    // Send slot lost notification
    console.log('📤 Sending slot lost notification...');
    chrome.runtime.sendMessage({
        action: 'slot_lost',
        locationInfo: locationInfo,
        url: window.location.href,
        timestamp: new Date().toISOString()
    }, (response) => {
        if (chrome.runtime.lastError) {
            console.error('❌ Failed to send slot lost notification:', chrome.runtime.lastError.message);
        } else {
            console.log('✅ Slot lost notification sent!', response);
        }
    });
    
    // Wait 1-2 seconds with random jitter
    const jitter = Math.random() * 1000 + 1000; // 1000-2000ms
    console.log(`⏳ Waiting ${jitter.toFixed(0)}ms before clicking "Return to search results"...`);
    await sleep(jitter);
    
    // Click "Return to search results" button
    const returnLink = document.querySelector('a[href*="_eventId=returnToSearchResults"]');
    if (returnLink) {
        console.log('🖱️ Clicking "Return to search results"...');
        returnLink.click();
    } else {
        console.error('❌ Could not find "Return to search results" link');
    }
}

// Check if reservation is actually done (no more buttons + has reserved tests OR max slots reached)
function checkIfReservationActuallyDone() {
    console.log('🔍 Checking if reservation is actually done...');
    
    // Check if there are still reserve buttons
    const reserveButtons = document.querySelectorAll('a[id^="reserve_"]');
    const hasReserveButtons = reserveButtons.length > 0;
    
    console.log(`🔍 Reserve buttons left: ${reserveButtons.length}`);
    
    // Check if there are actual reserved tests (exclude "No information found" rows)
    const orderSideBar = document.querySelector('#orderSideBar');
    let hasReservedTests = false;
    let reservedCount = 0;
    
    if (orderSideBar) {
        const reservedRows = orderSideBar.querySelectorAll('tbody tr');
        let actualReservedCount = 0;
        
        reservedRows.forEach(row => {
            const rowText = row.textContent.trim();
            // Only count rows that are actual reserved tests
            // Look for date/time pattern (e.g., "Fri 20 Mar 2026 08:57") to identify real test rows
            const hasDateTime = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\s+\d{2}:\d{2}\b/.test(rowText);
            
            if (rowText !== 'No information found' && hasDateTime) {
                actualReservedCount++;
            }
        });
        
        hasReservedTests = actualReservedCount > 0;
        reservedCount = actualReservedCount;
    }
    
    console.log(`🔍 Reserved tests: ${reservedCount}`);
    
    // Check if maximum slots reached (reserved count >= 10)
    const hasMaxSlots = reservedCount >= 10;
    
    if (hasMaxSlots) {
        console.log('🔍 MAX SLOTS REACHED - Reserved count >= 10, reservation is done');
    }
    
    // Reservation is done if: 
    // 1. No more buttons AND has reserved tests, OR
    // 2. Reserved count >= 10 (regardless of buttons)
    const isDone = (!hasReserveButtons && hasReservedTests) || hasMaxSlots;
    
    if (isDone) {
        if (hasMaxSlots) {
            console.log('✅ Reservation is ACTUALLY DONE - Reserved count >= 10');
        } else {
            console.log('✅ Reservation is ACTUALLY DONE - no more buttons, but has reserved tests');
        }
    } else {
        console.log('⏳ Reservation not done yet - still has buttons or no reserved tests');
    }
    
    return isDone;
}

// Get count of reserved tests (exclude "No information found" rows)
function getReservedTestCount() {
    const orderSideBar = document.querySelector('#orderSideBar');
    if (!orderSideBar) {
        return 0;
    }
    
    const reservedRows = orderSideBar.querySelectorAll('tbody tr');
    let actualReservedCount = 0;
    
    reservedRows.forEach(row => {
        const rowText = row.textContent.trim();
        // Only count rows that are actual reserved tests
        // Look for date/time pattern (e.g., "Fri 20 Mar 2026 08:57") to identify real test rows
        const hasDateTime = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\s+\d{2}:\d{2}\b/.test(rowText);
        
        if (rowText !== 'No information found' && hasDateTime) {
            actualReservedCount++;
        }
    });
    
    return actualReservedCount;
}

// Get detailed slot information (test center name and slot dates/times)
function getSlotDetails() {
    const orderSideBar = document.querySelector('#orderSideBar');
    if (!orderSideBar) {
        return { testCenter: 'Unknown', slots: [] };
    }
    
    const reservedRows = orderSideBar.querySelectorAll('tbody tr');
    let testCenter = 'Unknown';
    const slots = [];
    
    reservedRows.forEach(row => {
        const rowText = row.textContent.trim();
        
        // Check if this is a test center header row (contains location name)
        if (row.classList.contains('first') || row.classList.contains('searchcriteria')) {
            const centerMatch = rowText.match(/([^(]+)\s*\(([^)]+)\)/);
            if (centerMatch) {
                testCenter = `${centerMatch[1].trim()} (${centerMatch[2].trim()})`;
            }
        }
        
        // Extract date/time from test rows
        const dateTimeMatch = rowText.match(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+(\d{2}:\d{2})\b/);
        if (dateTimeMatch && rowText !== 'No information found') {
            const [, day, date, month, year, time] = dateTimeMatch;
            slots.push(`${day} ${date} ${month} ${year} ${time}`);
        }
    });
    
    return { testCenter, slots };
}

// Helper: Sleep
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
